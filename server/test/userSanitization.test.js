import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeUser } from '../src/db.js';

test('sanitized users exclude credentials and retired language preference data', () => {
  const user = sanitizeUser({
    id: 'buyer-1',
    name: 'Buyer One',
    role: 'buyer',
    preferredLanguage: 'kn',
    passwordHash: 'secret-hash'
  });

  assert.deepEqual(user, {
    id: 'buyer-1',
    name: 'Buyer One',
    role: 'buyer'
  });
});
