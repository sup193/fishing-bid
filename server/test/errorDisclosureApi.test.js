import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

let tempDir;
let databasePath;
let serverHandle;
let baseUrl;

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidemarket-error-api-test-'));
  databasePath = path.join(tempDir, 'local-db.json');
  fs.writeFileSync(databasePath, JSON.stringify({ users: {} }));
  process.env.NODE_ENV = 'test';
  process.env.TIDEMARKET_DATABASE = 'local';
  process.env.TIDEMARKET_LOCAL_DB_PATH = databasePath;
  process.env.JWT_SECRET = 'test-only-error-jwt-secret';
  const { startServer } = await import('../src/index.js');
  serverHandle = await startServer({ port: 0, sweepIntervalMs: 60_000 });
  baseUrl = `http://127.0.0.1:${serverHandle.server.address().port}`;
});

after(async () => {
  await serverHandle?.close();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

test('unexpected API and login errors do not disclose internal error details', async () => {
  const malformedJson = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{'
  });
  assert.equal(malformedJson.status, 400);
  assert.deepEqual(await malformedJson.json(), { message: 'Invalid JSON request body' });

  fs.writeFileSync(databasePath, '{');
  const failedLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'buyer@example.test', password: 'irrelevant' })
  });
  assert.equal(failedLogin.status, 500);
  assert.deepEqual(await failedLogin.json(), { message: 'Login service failed' });
});
