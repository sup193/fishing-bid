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
const database = await import('../src/db.js');
const adminId = 'otp-test-admin';
await database.insert('users', {
  name: 'OTP Test Admin',
  email: 'otp-admin@example.test',
  passwordHash: await bcrypt.hash('OtpAdminPassword123', 4),
  role: 'admin'
}, adminId);
const adminToken = jwt.sign({ id: adminId, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });

after(async () => {
  emailService.setEmailSenderForTests(null);
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function request(route, body, { method = 'POST', token } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, body: await response.json() };
}

function latestOtp() {
  const email = sentEmails.at(-1);
  return email.html.match(/<p style="[^"]*">(\d{6})<\/p>/)?.[1];
}

test('buyer OTP verification activates the account and returns an authenticated buyer session', async () => {
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
  assert.equal(verification.status, 201);
  assert.equal(verification.body.user.role, 'buyer');
  assert.equal(verification.body.user.email, email);
  assert.ok(verification.body.token);
  const user = await database.get('users', verification.body.user.id);
  assert.equal(user.verificationStatus, 'verified');
  assert.equal(user.passwordHash, pending.passwordHash);
  assert.equal(await bcrypt.compare('BuyerPassword123', user.passwordHash), true);
  assert.equal((await database.list('registrationRequests')).some(item => item.email === email), false);

  const session = await request('/auth/me', undefined, { method: 'GET', token: verification.body.token });
  assert.equal(session.status, 200);
  assert.equal(session.body.user.role, 'buyer');
  const buyerApi = await request('/buyer/history', undefined, { method: 'GET', token: verification.body.token });
  assert.equal(buyerApi.status, 200);
  const approvals = await request('/admin/registration-requests', undefined, { method: 'GET', token: adminToken });
  assert.equal(approvals.status, 200);
  assert.equal(approvals.body.some(item => item.email === email), false);
  const forbiddenApproval = await request('/admin/registration-requests', undefined, {
    method: 'GET',
    token: verification.body.token
  });
  assert.equal(forbiddenApproval.status, 403);
});

test('fisherman OTP registration waits for admin approval before account activation', async () => {
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
  assert.equal(verification.status, 202);
  assert.equal(verification.body.status, 'pending_admin');
  assert.equal(verification.body.role, 'fisherman');
  assert.equal(verification.body.message, 'Your email has been verified successfully. Your fisherman registration is awaiting admin approval. You will be able to log in once your account is approved.');
  assert.equal(verification.body.token, undefined);
  assert.equal((await database.list('users')).some(item => item.email === email), false);
  const registrationRequest = (await database.list('registrationRequests')).find(item => item.email === email);
  assert.equal(registrationRequest.role, 'fisherman');
  assert.equal(registrationRequest.status, 'pending');
  assert.equal(registrationRequest.name, 'Shivakumar Rao');
  assert.equal(registrationRequest.passwordHash, pending.passwordHash);
  assert.equal(await bcrypt.compare('FisherPassword123', registrationRequest.passwordHash), true);

  const pendingLogin = await request('/auth/login', { email, password: 'FisherPassword123' });
  assert.equal(pendingLogin.status, 403);
  assert.equal(pendingLogin.body.status, 'pending');
  const pendingApi = await request('/fisherman/listings', undefined, { method: 'GET' });
  assert.equal(pendingApi.status, 401);

  const approvals = await request('/admin/registration-requests', undefined, { method: 'GET', token: adminToken });
  assert.ok(approvals.body.some(item => item.id === registrationRequest.id && item.role === 'fisherman'));
  assert.equal(approvals.body.some(item => item.passwordHash), false);
  const nonAdminId = `otp-non-admin-${Date.now()}`;
  await database.insert('users', {
    name: 'OTP Test Buyer',
    email: `${nonAdminId}@example.test`,
    passwordHash: await bcrypt.hash('OtpBuyerPassword123', 4),
    role: 'buyer'
  }, nonAdminId);
  const nonAdminToken = jwt.sign({ id: nonAdminId, role: 'buyer' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const forbiddenApproval = await request(`/admin/registration-requests/${registrationRequest.id}/accept`, undefined, {
    method: 'PATCH',
    token: nonAdminToken
  });
  assert.equal(forbiddenApproval.status, 403);
  const forbiddenRejection = await request(`/admin/registration-requests/${registrationRequest.id}/reject`, undefined, {
    method: 'PATCH',
    token: nonAdminToken
  });
  assert.equal(forbiddenRejection.status, 403);
  const approved = await request(`/admin/registration-requests/${registrationRequest.id}/accept`, undefined, {
    method: 'PATCH',
    token: adminToken
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.user.role, 'fisherman');
  assert.equal(approved.body.user.verificationStatus, 'verified');
  const user = await database.get('users', approved.body.user.id);
  assert.equal(user.passwordHash, pending.passwordHash);

  const login = await request('/auth/login', { email, password: 'FisherPassword123' });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, 'fisherman');
  const fishermanApi = await request('/fisherman/listings', undefined, { method: 'GET', token: login.body.token });
  assert.equal(fishermanApi.status, 200);
  const duplicateApproval = await request(`/admin/registration-requests/${registrationRequest.id}/accept`, undefined, {
    method: 'PATCH',
    token: adminToken
  });
  assert.equal(duplicateApproval.status, 404);

  const reused = await request('/auth/verify-otp', { email, otp });
  assert.equal(reused.status, 404);
});

test('rejected fishermen cannot use old sessions and can resubmit for approval', async () => {
  const email = `otp-fisher-resubmit-${Date.now()}@example.com`;
  const password = 'ResubmitFisherPassword123';
  await request('/auth/register', {
    name: 'Resubmitting Fisherman',
    email,
    phone: `91${Date.now().toString().slice(-8)}`,
    password,
    role: 'fisherman'
  });
  const verification = await request('/auth/verify-otp', { email, otp: latestOtp() });
  assert.equal(verification.status, 202);
  const registration = (await database.list('registrationRequests')).find(item => item.email === email);
  const legacyUserId = `legacy-fisher-${Date.now()}`;
  await database.insert('users', {
    name: 'Resubmitting Fisherman',
    email,
    passwordHash: await bcrypt.hash(password, 4),
    role: 'fisherman',
    verificationStatus: 'unverified'
  }, legacyUserId);
  const oldToken = jwt.sign({ id: legacyUserId, role: 'fisherman' }, process.env.JWT_SECRET, { expiresIn: '1h' });

  const blockedSession = await request('/fisherman/listings', undefined, { method: 'GET', token: oldToken });
  assert.equal(blockedSession.status, 403);
  const rejected = await request(`/admin/registration-requests/${registration.id}/reject`, undefined, {
    method: 'PATCH',
    token: adminToken
  });
  assert.equal(rejected.status, 200);
  const rejectedLogin = await request('/auth/login', { email, password });
  assert.equal(rejectedLogin.status, 403);
  assert.equal(rejectedLogin.body.status, 'rejected');
  const rejectedSession = await request('/fisherman/listings', undefined, { method: 'GET', token: oldToken });
  assert.equal(rejectedSession.status, 403);

  const resubmission = await request('/auth/register', {
    name: 'Resubmitting Fisherman',
    email,
    phone: (await database.get('users', legacyUserId)).phone,
    password,
    role: 'fisherman'
  });
  assert.equal(resubmission.status, 202);
  const resubmittedVerification = await request('/auth/verify-otp', { email, otp: latestOtp() });
  assert.equal(resubmittedVerification.status, 202);
  const pendingRequest = (await database.list('registrationRequests'))
    .filter(item => item.email === email && item.status === 'pending')
    .at(-1);
  assert.ok(pendingRequest);
  const approved = await request(`/admin/registration-requests/${pendingRequest.id}/accept`, undefined, {
    method: 'PATCH',
    token: adminToken
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.user.id, legacyUserId);
  const login = await request('/auth/login', { email, password });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, 'fisherman');
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

test('buyer JWT restores session and expired JWT is rejected', async () => {
  const email = `otp-session-${Date.now()}@example.com`;
  await request('/auth/register', {
    name: 'Session Buyer',
    email,
    password: 'SessionPassword123',
    role: 'buyer'
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
