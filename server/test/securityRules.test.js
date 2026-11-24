import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('Supabase migration enables default-deny RLS and keeps privileged operations server-only', () => {
  const migration = fs.readFileSync(
    path.join(projectRoot, 'supabase', 'migrations', '202611210001_tidemarket_schema.sql'),
    'utf8'
  );
  const rlsTables = migration.match(/ALTER TABLE public\.[a-z_]+ ENABLE ROW LEVEL SECURITY;/g) || [];
  assert.equal(rlsTables.length, 20);
  assert.match(migration, /CREATE POLICY deny_direct_access .*USING \(false\) WITH CHECK \(false\)/);
  assert.match(migration, /INSERT INTO storage\.buckets[\s\S]*'fish-images'/);
  assert.match(migration, /No direct fish image writes/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.tidemarket_compare_and_set_record/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.tidemarket_mark_payment_paid.* TO service_role/);

  const otpMigration = fs.readFileSync(
    path.join(projectRoot, 'supabase', 'migrations', '202611220001_pending_registrations.sql'),
    'utf8'
  );
  assert.match(otpMigration, /CREATE TABLE IF NOT EXISTS public\.pending_registrations/);
  assert.match(otpMigration, /"otpHash" text NOT NULL/);
  assert.match(otpMigration, /tidemarket_consume_registration_otp/);

  const resetMigration = fs.readFileSync(
    path.join(projectRoot, 'supabase', 'migrations', '202611220002_password_reset.sql'),
    'utf8'
  );
  assert.match(resetMigration, /ADD COLUMN IF NOT EXISTS "tokenVersion" integer NOT NULL DEFAULT 0/);
  assert.match(resetMigration, /CREATE TABLE IF NOT EXISTS public\.password_reset_otps/);
  assert.match(resetMigration, /CREATE TABLE IF NOT EXISTS public\.password_reset_tokens/);
  assert.match(resetMigration, /"tokenHash" text NOT NULL UNIQUE/);
  assert.match(resetMigration, /tidemarket_consume_password_reset_otp/);
  assert.match(resetMigration, /tidemarket_reset_password/);
  assert.match(resetMigration, /ALTER TABLE public\.password_reset_otps ENABLE ROW LEVEL SECURITY/);
  assert.match(resetMigration, /ALTER TABLE public\.password_reset_tokens ENABLE ROW LEVEL SECURITY/);
  assert.match(resetMigration, /REVOKE ALL ON FUNCTION public\.tidemarket_reset_password/);
  assert.match(resetMigration, /GRANT EXECUTE ON FUNCTION public\.tidemarket_reset_password.* TO service_role/);

  const approvalMigration = fs.readFileSync(
    path.join(projectRoot, 'supabase', 'migrations', '202611240001_fisherman_registration_approval.sql'),
    'utf8'
  );
  assert.match(approvalMigration, /CREATE OR REPLACE FUNCTION public\.tidemarket_consume_registration_otp/);
  assert.match(approvalMigration, /INSERT INTO public\.users/);
  assert.match(approvalMigration, /INSERT INTO public\.registration_requests/);
  assert.match(approvalMigration, /'pending_admin'/);
  assert.match(approvalMigration, /CREATE OR REPLACE FUNCTION public\.tidemarket_review_fisherman_registration/);
  assert.match(approvalMigration, /FOR UPDATE/);
  assert.match(approvalMigration, /GRANT EXECUTE ON FUNCTION public\.tidemarket_review_fisherman_registration.* TO service_role/);
  assert.match(approvalMigration, /users\.role = 'fisherman'/);
});
