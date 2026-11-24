import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createAuctionDatabase } from '../test-support/auctionTestData.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidemarket-login-limit-'));
const databasePath = path.join(tempDir, 'local-db.json');
process.env.NODE_ENV = 'test';
process.env.TIDEMARKET_DATABASE = 'local';
process.env.TIDEMARKET_LOCAL_DB_PATH = databasePath;
process.env.JWT_SECRET = 'test-only-login-rate-limit-secret';
process.env.ADMIN_EMAIL = 'admin@login-limit.test';
process.env.ADMIN_PASSWORD = 'login-limit-test-password';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

let serverHandle;
let baseUrl;

async function login(email, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  return {
    status: response.status,
    retryAfter: response.headers.get('retry-after'),
    body: await response.json()
  };
}

before(async () => {
  await createAuctionDatabase(databasePath);
  const { startServer } = await import('../src/index.js');
  serverHandle = await startServer({ port: 0, sweepIntervalMs: 60_000 });
  baseUrl = `http://127.0.0.1:${serverHandle.server.address().port}`;
});

after(async () => {
  await serverHandle?.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('repeated invalid passwords are throttled per account with a retry interval', async () => {
  const email = 'buyer-1@auction.test';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal((await login(email, 'incorrect-password')).status, 401);
  }

  const blocked = await login(email, 'incorrect-password');
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.message, /too many sign-in attempts/i);
  assert.ok(Number(blocked.retryAfter) > 0);
});

test('a successful login clears that account’s failed-attempt counter', async () => {
  const email = 'buyer-2@auction.test';
  for (let attempt = 0; attempt < 9; attempt += 1) {
    assert.equal((await login(email, 'incorrect-password')).status, 401);
  }
  assert.equal((await login(email, 'auction-test-password')).status, 200);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal((await login(email, 'incorrect-password')).status, 401);
  }
  assert.equal((await login(email, 'incorrect-password')).status, 429);
});

test('concurrent invalid login attempts cannot bypass the account limit', async () => {
  const responses = await Promise.all(
    Array.from({ length: 15 }, () => login('buyer-3@auction.test', 'incorrect-password'))
  );
  assert.equal(responses.filter(result => result.status === 401).length, 10);
  assert.equal(responses.filter(result => result.status === 429).length, 5);
});

test('malformed login payloads are rejected before consuming rate-limit attempts', async () => {
  const invalid = await login('', 'incorrect-password');
  assert.equal(invalid.status, 400);
});

test('repeated failed logins from one client are throttled across accounts', async () => {
  for (let attempt = 0; attempt < 21; attempt += 1) {
    assert.equal((await login(`unknown-${attempt}@example.test`, 'incorrect-password')).status, 401);
  }
  const blocked = await login('unknown-after-limit@example.test', 'incorrect-password');
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.retryAfter) > 0);
});
