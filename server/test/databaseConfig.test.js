import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initSupabase } from '../src/db.js';

const environmentKeys = [
  'NODE_ENV',
  'TIDEMARKET_DATABASE',
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY'
];

function withEnvironment(values, callback) {
  const previous = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
  for (const key of environmentKeys) {
    if (Object.hasOwn(values, key)) process.env[key] = values[key];
    else delete process.env[key];
  }
  try {
    callback();
  } finally {
    for (const key of environmentKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('production refuses to use the local database', () => {
  withEnvironment({ NODE_ENV: 'production', TIDEMARKET_DATABASE: 'local' }, () => {
    assert.throws(() => initSupabase(), /local database cannot be used in production/i);
  });
});

test('production refuses to start with incomplete Supabase credentials', () => {
  withEnvironment({
    NODE_ENV: 'production',
    SUPABASE_URL: 'https://jrgkxtlcuakxvdkqygxs.supabase.co'
  }, () => {
    assert.throws(() => initSupabase(), /SUPABASE_URL and SUPABASE_SECRET_KEY are required|Set both SUPABASE_URL and SUPABASE_SECRET_KEY/);
  });
});

test('Supabase refuses placeholder and publishable secret keys', () => {
  withEnvironment({
    NODE_ENV: 'production',
    SUPABASE_URL: 'https://jrgkxtlcuakxvdkqygxs.supabase.co',
    SUPABASE_SECRET_KEY: 'replace-with-your-backend-only-supabase-secret-key'
  }, () => {
    assert.throws(() => initSupabase(), /placeholder/i);
  });
  withEnvironment({
    NODE_ENV: 'production',
    SUPABASE_URL: 'https://jrgkxtlcuakxvdkqygxs.supabase.co',
    SUPABASE_SECRET_KEY: 'sb_publishable_not_a_secret'
  }, () => {
    assert.throws(() => initSupabase(), /publishable key/i);
  });
});
