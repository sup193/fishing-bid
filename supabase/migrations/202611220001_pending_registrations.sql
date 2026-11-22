CREATE TABLE IF NOT EXISTS public.pending_registrations (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  location text,
  "passwordHash" text NOT NULL,
  role text NOT NULL,
  "otpHash" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  "lastSentAt" timestamptz NOT NULL,
  "verifiedAt" timestamptz,
  "consumedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pending_registrations_role_check CHECK (role IN ('buyer', 'fisherman')),
  CONSTRAINT pending_registrations_attempts_check CHECK (attempts >= 0 AND attempts <= 5)
);

CREATE UNIQUE INDEX IF NOT EXISTS pending_registrations_active_email_unique
  ON public.pending_registrations (lower(email))
  WHERE "consumedAt" IS NULL;
CREATE INDEX IF NOT EXISTS pending_registrations_email_idx
  ON public.pending_registrations (lower(email), "createdAt" DESC);
CREATE INDEX IF NOT EXISTS pending_registrations_expiry_idx
  ON public.pending_registrations ("expiresAt");

ALTER TABLE public.pending_registrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pending_registrations FROM anon, authenticated;
GRANT ALL ON TABLE public.pending_registrations TO service_role;
DROP POLICY IF EXISTS deny_direct_access ON public.pending_registrations;
CREATE POLICY deny_direct_access ON public.pending_registrations
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

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
  user_row public.users%ROWTYPE;
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

  IF EXISTS (SELECT 1 FROM public.users WHERE lower(email) = lower(pending.email))
     OR EXISTS (SELECT 1 FROM public.registration_requests WHERE lower(email) = lower(pending.email) AND status = 'pending')
     OR (pending.phone IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.users WHERE phone = pending.phone
       UNION ALL
       SELECT 1 FROM public.registration_requests WHERE phone = pending.phone AND status = 'pending'
     )) THEN
    UPDATE public.pending_registrations
      SET "consumedAt" = p_now, "updatedAt" = p_now
      WHERE id = pending.id;
    RETURN jsonb_build_object('status', 'duplicate');
  END IF;

  IF pending.role = 'buyer' THEN
    INSERT INTO public.registration_requests (
      id, name, email, "passwordHash", role, phone, location, status, "createdAt", "updatedAt"
    ) VALUES (
      'registration_' || replace(p_user_id, 'user_', ''),
      pending.name, lower(pending.email), pending."passwordHash", 'buyer',
      pending.phone, pending.location, 'pending', p_now, p_now
    )
    ON CONFLICT (id) DO NOTHING;
  ELSE
    INSERT INTO public.users (
      id, name, email, "passwordHash", role, phone, location,
      "verificationStatus", demo, "createdAt", "updatedAt", "legacyData", version
    ) VALUES (
      p_user_id, pending.name, lower(pending.email), pending."passwordHash", 'fisherman',
      pending.phone, pending.location, 'unverified', false, p_now, p_now, '{}'::jsonb, 1
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING * INTO user_row;
  END IF;

  UPDATE public.pending_registrations
    SET "verifiedAt" = p_now, "consumedAt" = p_now, "updatedAt" = p_now
    WHERE id = pending.id;

  IF pending.role = 'buyer' THEN
    RETURN jsonb_build_object(
      'status', 'pending_admin',
      'email', lower(pending.email),
      'name', pending.name,
      'role', 'buyer'
    );
  END IF;

  IF user_row.id IS NULL THEN
    RETURN jsonb_build_object('status', 'duplicate');
  END IF;
  RETURN jsonb_build_object(
    'status', 'verified',
    'userId', user_row.id,
    'name', user_row.name,
    'email', user_row.email,
    'role', user_row.role,
    'phone', user_row.phone,
    'location', user_row.location
  );
END
$$;

REVOKE ALL ON FUNCTION public.tidemarket_consume_registration_otp(text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tidemarket_consume_registration_otp(text, text, text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.tidemarket_cleanup_expired_pending_registrations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  removed_count integer;
BEGIN
  DELETE FROM public.pending_registrations
  WHERE "consumedAt" IS NOT NULL
     OR "expiresAt" < now() - interval '24 hours';
  GET DIAGNOSTICS removed_count = ROW_COUNT;
  RETURN removed_count;
END
$$;

REVOKE ALL ON FUNCTION public.tidemarket_cleanup_expired_pending_registrations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tidemarket_cleanup_expired_pending_registrations() TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique
  ON public.users (phone)
  WHERE phone IS NOT NULL AND btrim(phone) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS registration_requests_pending_phone_unique
  ON public.registration_requests (phone)
  WHERE status = 'pending' AND phone IS NOT NULL AND btrim(phone) <> '';
