import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidemarket-otp-'));
process.env.TIDEMARKET_DATABASE = 'local';
process.env.TIDEMARKET_LOCAL_DB_PATH = path.join(tempDir, 'local-db.json');
process.env.SMTP_HOST = 'smtp.gmail.com';
process.env.SMTP_PORT = '465';
process.env.SMTP_SECURE = 'true';
process.env.SMTP_USER = 'test@example.com';
process.env.SMTP_PASS = 'test-app-password';
process.env.EMAIL_FROM = 'Fishing Bid <test@example.com>';
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
    name: 'Shivakumar Rao',
    email,
    phone: '9999999991',
    password: 'BuyerPassword123',
    role: 'buyer'
  });
  assert.equal(registration.status, 202);
  const database = await import('../src/db.js');
  const pending = await database.getPendingRegistration(email);
  const otp = latestOtp();
  const verification = await request('/auth/verify-otp', { email, otp });
  assert.equal(verification.status, 202);
  assert.equal(verification.body.status, 'pending');
  const registrationRequest = (await database.list('registrationRequests')).find(item => item.email === email);
  assert.equal(registrationRequest.name, 'Shivakumar Rao');
  assert.equal(registrationRequest.passwordHash, pending.passwordHash);
  assert.equal(await bcrypt.compare('BuyerPassword123', registrationRequest.passwordHash), true);
});

test('seller OTP registration creates a bcrypt-backed fisherman JWT', async () => {
  const email = `otp-fisher-${Date.now()}@example.com`;
  const registration = await request('/auth/register', {
    name: 'Shivakumar Rao',
    email,
    phone: '9999999992',
    password: 'FisherPassword123',
    role: 'fisherman'
  });
  assert.equal(registration.status, 202);
  const database = await import('../src/db.js');
  const pending = await database.getPendingRegistration(email);
  const otp = latestOtp();
  const verification = await request('/auth/verify-otp', { email, otp });
  assert.equal(verification.status, 201);
  assert.equal(verification.body.user.role, 'fisherman');
  assert.equal(verification.body.user.name, 'Shivakumar Rao');
  assert.notEqual(verification.body.user.name, otp);
  assert.ok(verification.body.token);
  const user = await database.get('users', verification.body.user.id);
  assert.equal(user.passwordHash, pending.passwordHash);
  assert.equal(await bcrypt.compare('FisherPassword123', user.passwordHash), true);

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

test('resend preserves cooldown and replaces the previous OTP', async () => {
  const email = `otp-resend-${Date.now()}@example.com`;
  await request('/auth/register', {
    name: 'Resend Test',
    email,
    phone: '9999999994',
    password: 'ResendPassword123',
    role: 'fisherman'
  });
  const oldOtp = latestOtp();
  const cooldown = await request('/auth/resend-otp', { email });
  assert.equal(cooldown.status, 429);

  const database = await import('../src/db.js');
  const pending = await database.getPendingRegistration(email);
  await database.update('pendingRegistrations', pending.id, {
    lastSentAt: new Date(Date.now() - 61000).toISOString()
  });
  const resend = await request('/auth/resend-otp', { email });
  assert.equal(resend.status, 200);
  const newOtp = latestOtp();
  assert.notEqual(newOtp, oldOtp);
  const oldVerification = await request('/auth/verify-otp', { email, otp: oldOtp });
  assert.equal(oldVerification.status, 400);
});

test('duplicate email and phone are rejected', async () => {
  const email = `otp-duplicate-${Date.now()}@example.com`;
  await request('/auth/register', {
    name: 'Duplicate Seller',
    email,
    phone: '9999999995',
    password: 'DuplicatePassword123',
    role: 'fisherman'
  });
  const otp = latestOtp();
  await request('/auth/verify-otp', { email, otp });

  const duplicateEmail = await request('/auth/register', {
    name: 'Duplicate Email',
    email,
    phone: '9999999996',
    password: 'DuplicatePassword123',
    role: 'fisherman'
  });
  assert.equal(duplicateEmail.status, 409);

  const duplicatePhone = await request('/auth/register', {
    name: 'Duplicate Phone',
    email: `different-${Date.now()}@example.com`,
    phone: '9999999995',
    password: 'DuplicatePassword123',
    role: 'fisherman'
  });
  assert.equal(duplicatePhone.status, 409);
});

test('valid JWT restores session and expired JWT is rejected', async () => {
  const email = `otp-session-${Date.now()}@example.com`;
  await request('/auth/register', {
    name: 'Session Seller',
    email,
    password: 'SessionPassword123',
    role: 'fisherman'
  });
  const otp = latestOtp();
  const verification = await request('/auth/verify-otp', { email, otp });
  assert.equal(verification.status, 201);

  const validSession = await fetch(`${baseUrl}/auth/me`, {
    headers: { authorization: `Bearer ${verification.body.token}` }
  });
  assert.equal(validSession.status, 200);

  const expiredToken = jwt.sign(
    { id: verification.body.user.id, role: 'fisherman' },
    process.env.JWT_SECRET,
    { expiresIn: -1 }
  );
  const expiredSession = await fetch(`${baseUrl}/auth/me`, {
    headers: { authorization: `Bearer ${expiredToken}` }
  });
  assert.equal(expiredSession.status, 401);
});

test('expired OTP is rejected', async () => {
  const email = `otp-expired-${Date.now()}@example.com`;
  await request('/auth/register', {
    name: 'Expired OTP',
    email,
    password: 'ExpiredPassword123',
    role: 'fisherman'
  });
  const database = await import('../src/db.js');
  const pending = await database.getPendingRegistration(email);
  await database.update('pendingRegistrations', pending.id, {
    expiresAt: new Date(Date.now() - 1000).toISOString()
  });
  const otp = latestOtp();
  const result = await request('/auth/verify-otp', { email, otp });
  assert.equal(result.status, 410);
});

test('Resend delivery failure is reported safely', async () => {
  const email = `otp-email-failure-${Date.now()}@example.com`;
  await request('/auth/register', {
    name: 'Email Failure',
    email,
    password: 'EmailFailurePassword123',
    role: 'fisherman'
  });
  const database = await import('../src/db.js');
  const pending = await database.getPendingRegistration(email);
  await database.update('pendingRegistrations', pending.id, {
    lastSentAt: new Date(Date.now() - 61000).toISOString()
  });
  emailService.setEmailSenderForTests(async () => {
    throw Object.assign(new Error('Could not send the verification email'), { status: 502 });
  });
  const result = await request('/auth/resend-otp', { email });
  assert.equal(result.status, 502);
  emailService.setEmailSenderForTests(async payload => ({ data: { id: 'email_test' }, error: null }));
});

test('existing buyer login ignores stale pending OTP and verifies bcrypt', async () => {
  const email = `otp-buyer-login-${Date.now()}@example.com`;
  const passwordHash = await bcrypt.hash('BuyerLoginPassword123', 12);
  const database = await import('../src/db.js');
  const userId = `buyer-login-${Date.now()}`;
  await database.insert('users', {
    name: 'Existing Buyer',
    email: ` ${email.toUpperCase()} `,
    passwordHash,
    role: 'buyer',
    phone: '9999999997',
    verificationStatus: 'verified'
  }, userId);
  await database.insert('pendingRegistrations', {
    name: 'Stale Buyer OTP',
    email,
    passwordHash: 'unused',
    role: 'buyer',
    otpHash: 'unused',
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    attempts: 0,
    lastSentAt: new Date().toISOString()
  }, `stale-buyer-${Date.now()}`);

  const login = await request('/auth/login', {
    email: ` ${email.toUpperCase()} `,
    password: 'BuyerLoginPassword123'
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, 'buyer');
  assert.equal(login.body.user.name, 'Existing Buyer');
  assert.ok(login.body.token);

  const repeatedLogin = await request('/auth/login', {
    email: email.toUpperCase(),
    password: 'BuyerLoginPassword123'
  });
  assert.equal(repeatedLogin.status, 200);
  assert.equal((await database.get('users', userId)).passwordHash, passwordHash);
  const incorrectPassword = await request('/auth/login', {
    email,
    password: 'IncorrectPassword123'
  });
  assert.equal(incorrectPassword.status, 401);
});

test('pending OTP registration can resume or resend and login ignores pending OTP', async () => {
  const email = `otp-login-${Date.now()}@example.com`;
  const database = await import('../src/db.js');
  const passwordHash = await bcrypt.hash('ExistingPassword123', 12);
  await database.insert('users', {
    name: 'Existing Seller',
    email,
    passwordHash,
    role: 'fisherman',
    phone: '9999999993',
  }, `existing-login-${Date.now()}`);
  await database.insert('pendingRegistrations', {
    name: 'Stale Pending',
    email,
    phone: '9999999993',
    passwordHash: 'unused',
    role: 'fisherman',
    otpHash: 'unused',
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    attempts: 0,
    lastSentAt: new Date().toISOString()
  }, `stale-pending-${Date.now()}`);

  const login = await request('/auth/login', {
    email,
    password: 'ExistingPassword123'
  });
  assert.equal(login.status, 200);
  assert.ok(login.body.token);
});
