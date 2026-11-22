import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidemarket-otp-'));
process.env.TIDEMARKET_DATABASE = 'local';
process.env.TIDEMARKET_LOCAL_DB_PATH = path.join(tempDir, 'local-db.json');
process.env.RESEND_API_KEY = 'test-resend-key';
process.env.OTP_FROM_EMAIL = 'Fishing Bid <test@example.com>';
process.env.OTP_HASH_SECRET = 'test-only-otp-secret';
process.env.JWT_SECRET = 'test-only-jwt-secret';

const sentEmails = [];
const emailService = await import('../src/emailService.js');
emailService.setEmailSenderForTests(async payload => {
  sentEmails.push(payload);
  return { data: { id: 'email_test' }, error: null };
});

const { app } = await import('../src/index.js');
const server = await new Promise((resolve, reject) => {
  const listener = app.listen(0, () => resolve(listener));
  listener.once('error', reject);
});
const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

after(async () => {
  emailService.setEmailSenderForTests(null);
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function request(route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

function latestOtp() {
  const email = sentEmails.at(-1);
  return email.html.match(/<p style="[^"]*">(\d{6})<\/p>/)?.[1];
}

test('buyer OTP registration creates a pending admin request after verification', async () => {
  const email = `otp-buyer-${Date.now()}@example.com`;
  const registration = await request('/auth/register', {
    name: 'OTP Buyer',
    email,
    phone: '9999999991',
    password: 'BuyerPassword123',
    role: 'buyer'
  });
  assert.equal(registration.status, 202);
  const otp = latestOtp();
  const verification = await request('/auth/verify-otp', { email, otp });
  assert.equal(verification.status, 202);
  assert.equal(verification.body.status, 'pending');
});

test('seller OTP registration creates a bcrypt-backed fisherman JWT', async () => {
  const email = `otp-fisher-${Date.now()}@example.com`;
  const registration = await request('/auth/register', {
    name: 'OTP Fisherman',
    email,
    phone: '9999999992',
    password: 'FisherPassword123',
    role: 'fisherman'
  });
  assert.equal(registration.status, 202);
  const otp = latestOtp();
  const verification = await request('/auth/verify-otp', { email, otp });
  assert.equal(verification.status, 201);
  assert.equal(verification.body.user.role, 'fisherman');
  assert.ok(verification.body.token);

  const reused = await request('/auth/verify-otp', { email, otp });
  assert.equal(reused.status, 404);
});

test('incorrect and expired OTP responses are enforced', async () => {
  const email = `otp-attempts-${Date.now()}@example.com`;
  await request('/auth/register', {
    name: 'OTP Attempts',
    email,
    password: 'AttemptPassword123',
    role: 'fisherman'
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await request('/auth/verify-otp', { email, otp: '000000' });
    assert.equal(result.status, 400);
  }
  const locked = await request('/auth/verify-otp', { email, otp: '000000' });
  assert.equal(locked.status, 429);
});
