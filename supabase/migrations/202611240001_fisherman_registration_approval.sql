DROP INDEX IF EXISTS public.registration_requests_pending_email_unique;
CREATE UNIQUE INDEX registration_requests_pending_email_unique
  ON public.registration_requests (lower(email))
  WHERE status = 'pending' AND role = 'fisherman' AND email IS NOT NULL;

DROP INDEX IF EXISTS public.registration_requests_pending_phone_unique;
CREATE UNIQUE INDEX registration_requests_pending_phone_unique
  ON public.registration_requests (phone)
  WHERE status = 'pending'
    AND role = 'fisherman'
    AND phone IS NOT NULL
    AND btrim(phone) <> '';

INSERT INTO public.registration_requests (
  id, name, email, "passwordHash", role, phone, location, status, "createdAt", "updatedAt"
)
SELECT
  'registration_backfill_' || users.id,
  users.name,
  lower(users.email),
  users."passwordHash",
  'fisherman',
  users.phone,
  users.location,
  'pending',
  COALESCE(users."createdAt", now()),
  now()
FROM public.users AS users
WHERE users.role = 'fisherman'
  AND lower(COALESCE(users."verificationStatus", '')) IN ('unverified', 'pending')
  AND users.email IS NOT NULL
  AND users."passwordHash" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.registration_requests AS requests
    WHERE lower(requests.email) = lower(users.email)
      AND requests.role = 'fisherman'
      AND requests.status IN ('pending', 'accepted')
  )
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.tidemarket_consume_registration_otp(
  p_email text,
  p_otp_hash text,
  p_user_id text,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  pending public.pending_registrations%ROWTYPE;
  existing_user public.users%ROWTYPE;
  previous_request public.registration_requests%ROWTYPE;
  user_row public.users%ROWTYPE;
  request_id text;
  can_resubmit boolean := false;
BEGIN
  SELECT * INTO pending
  FROM public.pending_registrations
  WHERE lower(email) = lower(trim(p_email))
    AND "consumedAt" IS NULL
  ORDER BY "createdAt" DESC
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid', 'reason', 'pending_not_found');
  END IF;
  IF pending."expiresAt" <= p_now THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;
  IF pending.attempts >= 5 THEN
    RETURN jsonb_build_object('status', 'locked');
  END IF;
  IF pending."otpHash" IS DISTINCT FROM p_otp_hash THEN
    UPDATE public.pending_registrations
      SET attempts = attempts + 1, "updatedAt" = p_now
      WHERE id = pending.id;
    RETURN jsonb_build_object(
      'status', 'incorrect',
      'remainingAttempts', GREATEST(0, 5 - (pending.attempts + 1))
    );
  END IF;

  SELECT * INTO existing_user
  FROM public.users
  WHERE lower(email) = lower(pending.email)
  FOR UPDATE;
  IF FOUND AND pending.role = 'fisherman' AND existing_user.role = 'fisherman' THEN
    SELECT * INTO previous_request
    FROM public.registration_requests
    WHERE lower(email) = lower(pending.email)
      AND role = 'fisherman'
    ORDER BY "createdAt" DESC
    LIMIT 1;
    can_resubmit := FOUND AND previous_request.status = 'rejected';
  END IF;

  IF (existing_user.id IS NOT NULL AND NOT can_resubmit)
     OR (pending.role = 'fisherman' AND EXISTS (
       SELECT 1 FROM public.registration_requests
       WHERE lower(email) = lower(pending.email)
         AND role = 'fisherman'
         AND status = 'pending'
     ))
     OR (NULLIF(btrim(pending.phone), '') IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.users
       WHERE phone = pending.phone
         AND (existing_user.id IS NULL OR id <> existing_user.id)
       UNION ALL
       SELECT 1 FROM public.registration_requests
       WHERE phone = pending.phone
         AND role = 'fisherman'
         AND status = 'pending'
         AND pending.role = 'fisherman'
     )) THEN
    UPDATE public.pending_registrations
      SET "consumedAt" = p_now, "updatedAt" = p_now
      WHERE id = pending.id;
    RETURN jsonb_build_object('status', 'duplicate');
  END IF;

  IF pending.role = 'buyer' THEN
    INSERT INTO public.users (
      id, name, email, "passwordHash", role, phone, location,
      "verificationStatus", demo, "createdAt", "updatedAt", "legacyData", version
    ) VALUES (
      p_user_id, pending.name, lower(pending.email), pending."passwordHash", 'buyer',
      pending.phone, pending.location, 'verified', false, p_now, p_now, '{}'::jsonb, 1
    )
    ON CONFLICT DO NOTHING
    RETURNING * INTO user_row;
    IF user_row.id IS NULL THEN
      UPDATE public.pending_registrations
        SET "consumedAt" = p_now, "updatedAt" = p_now
        WHERE id = pending.id;
      RETURN jsonb_build_object('status', 'duplicate');
    END IF;
  ELSE
    INSERT INTO public.registration_requests (
      id, name, email, "passwordHash", role, phone, location, status, "createdAt", "updatedAt"
    ) VALUES (
      'registration_' || replace(p_user_id, 'user_', ''),
      pending.name, lower(pending.email), pending."passwordHash", 'fisherman',
      pending.phone, pending.location, 'pending', p_now, p_now
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO request_id;
    IF request_id IS NULL THEN
      UPDATE public.pending_registrations
        SET "consumedAt" = p_now, "updatedAt" = p_now
        WHERE id = pending.id;
      RETURN jsonb_build_object('status', 'duplicate');
    END IF;
  END IF;

  UPDATE public.pending_registrations
    SET "verifiedAt" = p_now, "consumedAt" = p_now, "updatedAt" = p_now
    WHERE id = pending.id;

  IF pending.role = 'buyer' THEN
    RETURN jsonb_build_object(
      'status', 'verified',
      'userId', user_row.id,
      'email', user_row.email,
      'name', user_row.name,
      'role', user_row.role
    );
  END IF;
  RETURN jsonb_build_object(
    'status', 'pending_admin',
    'email', lower(pending.email),
    'name', pending.name,
    'role', 'fisherman'
  );
END
$$;

CREATE OR REPLACE FUNCTION public.tidemarket_review_fisherman_registration(
  p_request_id text,
  p_action text,
  p_admin_id text,
  p_user_id text,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  registration public.registration_requests%ROWTYPE;
  existing_user public.users%ROWTYPE;
  user_row public.users%ROWTYPE;
BEGIN
  SELECT * INTO registration
  FROM public.registration_requests
  WHERE id = p_request_id
    AND role = 'fisherman'
    AND status = 'pending'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF p_action = 'reject' THEN
    UPDATE public.registration_requests
      SET status = 'rejected',
          "reviewedAt" = p_now,
          "reviewedBy" = p_admin_id,
          "updatedAt" = p_now
      WHERE id = registration.id;
    RETURN jsonb_build_object('status', 'rejected');
  END IF;
  IF p_action <> 'approve' THEN
    RETURN jsonb_build_object('status', 'invalid_action');
  END IF;

  SELECT * INTO existing_user
  FROM public.users
  WHERE lower(email) = lower(registration.email)
  FOR UPDATE;
  IF FOUND THEN
    IF existing_user.role <> 'fisherman'
       OR (NULLIF(btrim(registration.phone), '') IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.users
         WHERE phone = registration.phone AND id <> existing_user.id
       )) THEN
      RETURN jsonb_build_object('status', 'duplicate');
    END IF;

    UPDATE public.users
      SET name = registration.name,
          email = lower(registration.email),
          "passwordHash" = registration."passwordHash",
          phone = COALESCE(NULLIF(btrim(registration.phone), ''), existing_user.phone),
          location = COALESCE(NULLIF(btrim(registration.location), ''), existing_user.location),
          role = 'fisherman',
          "verificationStatus" = 'verified',
          "verificationUpdatedAt" = p_now,
          "verificationUpdatedBy" = p_admin_id,
          "updatedAt" = p_now
      WHERE id = existing_user.id
      RETURNING * INTO user_row;
  ELSE
    INSERT INTO public.users (
      id, name, email, "passwordHash", role, phone, location,
      "verificationStatus", "verificationUpdatedAt", "verificationUpdatedBy",
      demo, "createdAt", "updatedAt", "legacyData", version
    ) VALUES (
      p_user_id, registration.name, lower(registration.email), registration."passwordHash", 'fisherman',
      registration.phone, registration.location, 'verified', p_now, p_admin_id,
      false, p_now, p_now, '{}'::jsonb, 1
    )
    ON CONFLICT DO NOTHING
    RETURNING * INTO user_row;
    IF user_row.id IS NULL THEN
      RETURN jsonb_build_object('status', 'duplicate');
    END IF;
  END IF;

  UPDATE public.registration_requests
    SET status = 'accepted',
        "reviewedAt" = p_now,
        "reviewedBy" = p_admin_id,
        "updatedAt" = p_now
    WHERE id = registration.id;
  RETURN jsonb_build_object('status', 'approved', 'userId', user_row.id);
END
$$;

REVOKE ALL ON FUNCTION public.tidemarket_consume_registration_otp(text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tidemarket_consume_registration_otp(text, text, text, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.tidemarket_review_fisherman_registration(text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tidemarket_review_fisherman_registration(text, text, text, text, timestamptz) TO service_role;
