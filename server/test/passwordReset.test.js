import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import bcrypt from 'bcryptjs';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidemarket-password-reset-'));
process.env.TIDEMARKET_DATABASE = 'local';
process.env.TIDEMARKET_LOCAL_DB_PATH = path.join(tempDir, 'local-db.json');
process.env.NODE_ENV = 'test';
process.env.RESEND_API_KEY = 'test-resend-key';
process.env.OTP_FROM_EMAIL = 'Fishing Bid <test@example.com>';
process.env.OTP_HASH_SECRET = 'test-only-password-reset-secret';
process.env.JWT_SECRET = 'test-only-password-reset-jwt-secret';

const sentEmails = [];
const emailService = await import('../src/emailService.js');
emailService.setEmailSenderForTests(async payload => {
  sentEmails.push(payload);
  return { data: { id: `test-email-${sentEmails.length}` }, error: null };
});

const database = await import('../src/db.js');
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

async function post(route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function createUser({ email, name, role = 'buyer', password }) {
  const passwordHash = await bcrypt.hash(password, 4);
  const user = await database.insert('users', {
    email,
    name,
    role,
    passwordHash,
    verificationStatus: role === 'fisherman' ? 'unverified' : undefined
  });
  return { user, passwordHash };
}

function lastOtp() {
  return sentEmails.at(-1).html.match(/<p style="font-size:32px[^>]*>(\d{6})<\/p>/)?.[1];
}

function readLocalDatabase() {
  return JSON.parse(fs.readFileSync(process.env.TIDEMARKET_LOCAL_DB_PATH, 'utf8'));
}

function writeLocalDatabase(value) {
  fs.writeFileSync(process.env.TIDEMARKET_LOCAL_DB_PATH, JSON.stringify(value, null, 2));
}

test('forgot password responds generically and only emails an existing account', async () => {
  const email = `reset-generic-${Date.now()}@example.com`;
  const password = 'OriginalPassword123';
  await createUser({ email, name: 'Reset Buyer', password });

  const registered = await post('/auth/forgot-password', { email: ` ${email.toUpperCase()} ` });
  const emailCount = sentEmails.length;
  assert.equal(registered.status, 200);
  assert.equal(registered.body.message, 'If an account exists for this email, a verification code has been sent.');
  assert.equal(sentEmails.at(-1).to[0], email);
  assert.equal(sentEmails.at(-1).subject, 'Reset your Fishing Bid password');
  assert.match(sentEmails.at(-1).text, /expires in 5 minutes/);

  const unknown = await post('/auth/forgot-password', { email: `missing-${email}` });
  assert.equal(unknown.status, 200);
  assert.deepEqual(unknown.body, registered.body);
  assert.equal(sentEmails.length, emailCount);
});

test('verified reset changes only the target password and consumes tokens and existing sessions', async () => {
  const email = `reset-success-${Date.now()}@example.com`;
  const sellerEmail = `reset-seller-${Date.now()}@example.com`;
  const oldPassword = 'OriginalPassword123';
  const newPassword = 'NewSecurePassword456';
  const buyer = await createUser({ email, name: 'Reset Buyer', password: oldPassword });
  const seller = await createUser({
    email: sellerEmail,
    name: 'Unchanged Seller',
    role: 'fisherman',
    password: 'SellerPassword123'
  });

  const originalLogin = await post('/auth/login', { email, password: oldPassword });
  assert.equal(originalLogin.status, 200);
  const oldSession = await fetch(`${baseUrl}/auth/me`, {
    headers: { authorization: `Bearer ${originalLogin.body.token}` }
  });
  assert.equal(oldSession.status, 200);

  const forgot = await post('/auth/forgot-password', { email });
  assert.equal(forgot.status, 200);
  const otp = lastOtp();
  const otpRow = Object.values(readLocalDatabase().passwordResetOtps)
    .find(item => item.userId === buyer.user.id);
  assert.ok(otpRow.otpHash);
  assert.notEqual(otpRow.otpHash, otp);

  const verification = await post('/auth/verify-reset-otp', { email, otp });
  assert.equal(verification.status, 200);
  assert.match(verification.body.resetToken, /^[a-f0-9]{64}$/);
  assert.equal(verification.body.token, undefined);
  const resetToken = verification.body.resetToken;
  const storedToken = Object.values(readLocalDatabase().passwordResetTokens)
    .find(item => item.userId === buyer.user.id && !item.consumedAt);
  assert.ok(storedToken.tokenHash);
  assert.notEqual(storedToken.tokenHash, resetToken);

  const mismatch = await post('/auth/reset-password', {
    resetToken,
    newPassword,
    confirmNewPassword: 'DifferentPassword456'
  });
  assert.equal(mismatch.status, 400);

  const reset = await post('/auth/reset-password', {
    resetToken,
    newPassword,
    confirmNewPassword: newPassword
  });
  assert.equal(reset.status, 200);
  const updatedBuyer = await database.get('users', buyer.user.id);
  assert.notEqual(updatedBuyer.passwordHash, buyer.passwordHash);
  assert.equal(await bcrypt.compare(newPassword, updatedBuyer.passwordHash), true);
  assert.equal((await database.get('users', seller.user.id)).passwordHash, seller.passwordHash);

  assert.equal((await post('/auth/login', { email, password: oldPassword })).status, 401);
  const newLogin = await post('/auth/login', { email, password: newPassword });
  assert.equal(newLogin.status, 200);
  assert.equal(newLogin.body.user.role, 'buyer');
  assert.equal((await post('/auth/login', { email: sellerEmail, password: 'SellerPassword123' })).status, 200);

  const revokedSession = await fetch(`${baseUrl}/auth/me`, {
    headers: { authorization: `Bearer ${originalLogin.body.token}` }
  });
  assert.equal(revokedSession.status, 401);
  const reused = await post('/auth/reset-password', {
    resetToken,
    newPassword: 'AnotherPassword789',
    confirmNewPassword: 'AnotherPassword789'
  });
  assert.equal(reused.status, 400);
});

test('reset OTP expires and locks after five incorrect attempts', async () => {
  const expiredEmail = `reset-expired-${Date.now()}@example.com`;
  await createUser({ email: expiredEmail, name: 'Expired Buyer', password: 'ExpiredPassword123' });
  await post('/auth/forgot-password', { email: expiredEmail });
  const expiredOtp = lastOtp();
  const state = readLocalDatabase();
  const expiredRow = Object.values(state.passwordResetOtps).find(item => item.email === expiredEmail);
  expiredRow.expiresAt = new Date(Date.now() - 1000).toISOString();
  writeLocalDatabase(state);
  assert.equal((await post('/auth/verify-reset-otp', { email: expiredEmail, otp: expiredOtp })).status, 410);

  const lockedEmail = `reset-locked-${Date.now()}@example.com`;
  await createUser({ email: lockedEmail, name: 'Locked Buyer', password: 'LockedPassword123' });
  await post('/auth/forgot-password', { email: lockedEmail });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    assert.equal((await post('/auth/verify-reset-otp', { email: lockedEmail, otp: '000000' })).status, 400);
  }
  assert.equal((await post('/auth/verify-reset-otp', { email: lockedEmail, otp: '000000' })).status, 429);
});

test('resend cooldown applies and a resent password-reset OTP invalidates the previous one', async () => {
  const email = `reset-resend-${Date.now()}@example.com`;
  await createUser({ email, name: 'Resend Buyer', password: 'ResendPassword123' });
  await post('/auth/forgot-password', { email });
  const oldOtp = lastOtp();
  const count = sentEmails.length;

  const cooldown = await post('/auth/resend-reset-otp', { email });
  assert.equal(cooldown.status, 200);
  assert.equal(sentEmails.length, count);

  const state = readLocalDatabase();
  const otpRow = Object.values(state.passwordResetOtps).find(item => item.email === email && !item.consumedAt);
  otpRow.lastSentAt = new Date(Date.now() - 61_000).toISOString();
  writeLocalDatabase(state);
  await post('/auth/resend-reset-otp', { email });
  const newOtp = lastOtp();
  assert.notEqual(newOtp, oldOtp);
  assert.equal((await post('/auth/verify-reset-otp', { email, otp: oldOtp })).status, 400);
  assert.equal((await post('/auth/verify-reset-otp', { email, otp: newOtp })).status, 200);
});

test('email delivery failure stays generic and preserves the resend cooldown', async () => {
  const email = `reset-delivery-failure-${Date.now()}@example.com`;
  await createUser({ email, name: 'Retry Buyer', password: 'RetryPassword123' });
  let deliveryAttempts = 0;
  emailService.setEmailSenderForTests(async () => {
    deliveryAttempts += 1;
    throw new Error('test provider failure');
  });
  const response = await post('/auth/forgot-password', { email });
  assert.equal(response.status, 200);
  assert.equal(response.body.message, 'If an account exists for this email, a verification code has been sent.');
  assert.equal(deliveryAttempts, 1);

  emailService.setEmailSenderForTests(async payload => {
    sentEmails.push(payload);
    return { data: { id: 'retry-email' }, error: null };
  });
  const sentCount = sentEmails.length;
  const immediateResend = await post('/auth/resend-reset-otp', { email });
  assert.equal(immediateResend.status, 200);
  assert.equal(sentEmails.length, sentCount);

  const state = readLocalDatabase();
  const otpRow = Object.values(state.passwordResetOtps).find(item => item.email === email && !item.consumedAt);
  otpRow.lastSentAt = new Date(Date.now() - 61_000).toISOString();
  writeLocalDatabase(state);
  await post('/auth/resend-reset-otp', { email });
  assert.equal(sentEmails.at(-1).to[0], email);
});

test('registration OTP cannot authorize a password reset', async () => {
  const email = `reset-registration-otp-${Date.now()}@example.com`;
  const registration = await post('/auth/register', {
    name: 'Pending Seller',
    email,
    password: 'PendingPassword123',
    role: 'fisherman'
  });
  assert.equal(registration.status, 202);
  const registrationOtp = lastOtp();
  const resetRequest = await post('/auth/forgot-password', { email });
  assert.equal(resetRequest.status, 200);
  assert.equal((await post('/auth/verify-reset-otp', { email, otp: registrationOtp })).status, 400);
});
