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
  assert.equal(rlsTables.length, 18);
  assert.match(migration, /CREATE POLICY deny_direct_access .*USING \(false\) WITH CHECK \(false\)/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.tidemarket_compare_and_set_record/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.tidemarket_mark_payment_paid.* TO service_role/);
});
