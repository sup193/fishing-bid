import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initSupabase } from '../src/db.js';

const environmentKeys = [
  'NODE_ENV',
  'TIDEMARKET_DATABASE',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY'
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
    assert.throws(() => initSupabase(), /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required|Set both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/);
  });
});
