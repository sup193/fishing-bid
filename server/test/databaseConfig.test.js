import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initFirebase } from '../src/db.js';

const environmentKeys = [
  'NODE_ENV',
  'TIDEMARKET_DATABASE',
  'FIREBASE_SERVICE_ACCOUNT_JSON',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY'
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
    assert.throws(() => initFirebase(), /local database cannot be used in production/i);
  });
});

test('production surfaces invalid Firebase credentials instead of falling back locally', () => {
  withEnvironment({
    NODE_ENV: 'production',
    FIREBASE_SERVICE_ACCOUNT_JSON: '{'
  }, () => {
    assert.throws(() => initFirebase());
  });
});
