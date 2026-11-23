ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS "tokenVersion" integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.password_reset_otps (
  id text PRIMARY KEY,
  "userId" text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  "otpHash" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  "lastSentAt" timestamptz NOT NULL,
  "consumedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS password_reset_otps_active_user_unique
  ON public.password_reset_otps ("userId")
  WHERE "consumedAt" IS NULL;
CREATE INDEX IF NOT EXISTS password_reset_otps_expiry_idx
  ON public.password_reset_otps ("expiresAt");

CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id text PRIMARY KEY,
  "userId" text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  "tokenHash" text NOT NULL UNIQUE,
  "expiresAt" timestamptz NOT NULL,
  "consumedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_active_user_idx
  ON public.password_reset_tokens ("userId")
  WHERE "consumedAt" IS NULL;
CREATE INDEX IF NOT EXISTS password_reset_tokens_expiry_idx
  ON public.password_reset_tokens ("expiresAt");

ALTER TABLE public.password_reset_otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.password_reset_otps, public.password_reset_tokens FROM anon, authenticated;
GRANT ALL ON TABLE public.password_reset_otps, public.password_reset_tokens TO service_role;

DROP POLICY IF EXISTS deny_direct_access ON public.password_reset_otps;
CREATE POLICY deny_direct_access ON public.password_reset_otps
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);
DROP POLICY IF EXISTS deny_direct_access ON public.password_reset_tokens;
CREATE POLICY deny_direct_access ON public.password_reset_tokens
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.tidemarket_issue_password_reset_otp(
  p_email text,
  p_otp_id text,
  p_otp_hash text,
  p_expires_at timestamptz,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  account public.users%ROWTYPE;
  active_otp public.password_reset_otps%ROWTYPE;
BEGIN
  SELECT * INTO account
  FROM public.users
  WHERE lower(trim(email)) = lower(trim(p_email))
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  SELECT * INTO active_otp
  FROM public.password_reset_otps
  WHERE "userId" = account.id AND "consumedAt" IS NULL
  ORDER BY "createdAt" DESC
  LIMIT 1
  FOR UPDATE;
  IF FOUND AND active_otp."lastSentAt" > p_now - interval '60 seconds' THEN
    RETURN jsonb_build_object('status', 'cooldown');
  END IF;

  UPDATE public.password_reset_otps
  SET "consumedAt" = p_now, "updatedAt" = p_now
  WHERE "userId" = account.id AND "consumedAt" IS NULL;
  UPDATE public.password_reset_tokens
  SET "consumedAt" = p_now
  WHERE "userId" = account.id AND "consumedAt" IS NULL;

  INSERT INTO public.password_reset_otps (
    id, "userId", email, "otpHash", "expiresAt", attempts, "lastSentAt", "createdAt", "updatedAt"
  ) VALUES (
    p_otp_id, account.id, lower(trim(account.email)), p_otp_hash, p_expires_at, 0, p_now, p_now, p_now
  );

  RETURN jsonb_build_object(
    'status', 'issued',
    'userId', account.id,
    'email', lower(trim(account.email)),
    'name', account.name
  );
END
$$;

CREATE OR REPLACE FUNCTION public.tidemarket_consume_password_reset_otp(
  p_email text,
  p_otp_hash text,
  p_token_id text,
  p_token_hash text,
  p_token_expires_at timestamptz,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  account public.users%ROWTYPE;
  reset_otp public.password_reset_otps%ROWTYPE;
BEGIN
  SELECT * INTO account
  FROM public.users
  WHERE lower(trim(email)) = lower(trim(p_email))
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT * INTO reset_otp
  FROM public.password_reset_otps
  WHERE "userId" = account.id AND "consumedAt" IS NULL
  ORDER BY "createdAt" DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  IF reset_otp."expiresAt" <= p_now THEN
    UPDATE public.password_reset_otps
    SET "consumedAt" = p_now, "updatedAt" = p_now
    WHERE id = reset_otp.id;
    RETURN jsonb_build_object('status', 'expired');
  END IF;
  IF reset_otp.attempts >= 5 THEN
    RETURN jsonb_build_object('status', 'locked');
  END IF;
  IF reset_otp."otpHash" IS DISTINCT FROM p_otp_hash THEN
    UPDATE public.password_reset_otps
    SET attempts = attempts + 1, "updatedAt" = p_now
    WHERE id = reset_otp.id;
    IF reset_otp.attempts + 1 >= 5 THEN
      RETURN jsonb_build_object('status', 'locked');
    END IF;
    RETURN jsonb_build_object(
      'status', 'incorrect',
      'remainingAttempts', 5 - (reset_otp.attempts + 1)
    );
  END IF;

  UPDATE public.password_reset_otps
  SET "consumedAt" = p_now, "updatedAt" = p_now
  WHERE id = reset_otp.id;
  UPDATE public.password_reset_tokens
  SET "consumedAt" = p_now
  WHERE "userId" = account.id AND "consumedAt" IS NULL;
  INSERT INTO public.password_reset_tokens (id, "userId", "tokenHash", "expiresAt", "createdAt")
  VALUES (p_token_id, account.id, p_token_hash, p_token_expires_at, p_now);

  RETURN jsonb_build_object('status', 'verified');
END
$$;

CREATE OR REPLACE FUNCTION public.tidemarket_reset_password(
  p_token_hash text,
  p_password_hash text,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_user_id text;
  reset_token public.password_reset_tokens%ROWTYPE;
BEGIN
  SELECT "userId" INTO target_user_id
  FROM public.password_reset_tokens
  WHERE "tokenHash" = p_token_hash;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  PERFORM 1 FROM public.users WHERE id = target_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT * INTO reset_token
  FROM public.password_reset_tokens
  WHERE "tokenHash" = p_token_hash
  FOR UPDATE;
  IF NOT FOUND OR reset_token."consumedAt" IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  IF reset_token."expiresAt" <= p_now THEN
    UPDATE public.password_reset_tokens
    SET "consumedAt" = p_now
    WHERE id = reset_token.id;
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  UPDATE public.users
  SET "passwordHash" = p_password_hash,
      "tokenVersion" = coalesce("tokenVersion", 0) + 1,
      "updatedAt" = p_now
  WHERE id = target_user_id;
  UPDATE public.password_reset_tokens
  SET "consumedAt" = p_now
  WHERE "userId" = target_user_id AND "consumedAt" IS NULL;
  UPDATE public.password_reset_otps
  SET "consumedAt" = p_now, "updatedAt" = p_now
  WHERE "userId" = target_user_id AND "consumedAt" IS NULL;

  RETURN jsonb_build_object('status', 'updated');
END
$$;

REVOKE ALL ON FUNCTION public.tidemarket_issue_password_reset_otp(text, text, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tidemarket_consume_password_reset_otp(text, text, text, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tidemarket_reset_password(text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tidemarket_issue_password_reset_otp(text, text, text, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.tidemarket_consume_password_reset_otp(text, text, text, text, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.tidemarket_reset_password(text, text, timestamptz) TO service_role;
