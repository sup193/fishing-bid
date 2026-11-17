import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createAuctionDatabase } from '../test-support/auctionTestData.js';

let tempDir;
let serverHandle;
let baseUrl;
const tokens = new Map();

async function api(pathname, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}/api${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  return { response, data: await response.json() };
}

async function tokenFor(email, password = 'auction-test-password') {
  if (!tokens.has(email)) {
    const { response, data } = await api('/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(response.status, 200);
    tokens.set(email, data.token);
  }
  return tokens.get(email);
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidemarket-reputation-api-test-'));
  process.env.TIDEMARKET_DATABASE = 'local';
  process.env.TIDEMARKET_LOCAL_DB_PATH = path.join(tempDir, 'local-db.json');
  process.env.JWT_SECRET = 'test-only-reputation-jwt-secret';
  process.env.RAZORPAY_KEY_ID = '';
  process.env.RAZORPAY_KEY_SECRET = '';
  process.env.RAZORPAY_WEBHOOK_SECRET = '';
  await createAuctionDatabase(process.env.TIDEMARKET_LOCAL_DB_PATH);
  const database = JSON.parse(fs.readFileSync(process.env.TIDEMARKET_LOCAL_DB_PATH, 'utf8'));
  const passwordHash = await bcrypt.hash('auction-test-password', 4);
  database.users.admin = { name: 'Test Admin', email: 'admin@auction.test', passwordHash, role: 'admin' };
  database.users['fisherman-1'].verificationStatus = 'verified';
  database.orders = {
    'verified-completed': {
      buyer: 'buyer-1',
      fisherman: 'fisherman-1',
      listing: 'fixed-listing',
      quantity: 30,
      amount: 15000,
      paymentStatus: 'paid',
      gateway: 'razorpay',
      transactionRef: 'pay_verified_completed',
      orderStatus: 'completed',
      expectedDeliveryAt: '2026-03-05T00:00:00.000Z',
      deliveredAt: '2026-03-04T00:00:00.000Z',
      createdAt: '2026-03-01T00:00:00.000Z'
    },
    'verified-processing': {
      buyer: 'buyer-2',
      fisherman: 'fisherman-1',
      listing: 'fixed-listing',
      quantity: 10,
      amount: 5000,
      paymentStatus: 'paid',
      gateway: 'razorpay',
      transactionRef: 'pay_verified_processing',
      orderStatus: 'processing',
      createdAt: '2026-03-02T00:00:00.000Z'
    },
    'demo-completed': {
      buyer: 'buyer-2',
      fisherman: 'fisherman-1',
      listing: 'fixed-listing',
      quantity: 4,
      amount: 5000,
      paymentStatus: 'paid',
      gateway: 'razorpay',
      transactionRef: 'pay_demo',
      orderStatus: 'completed',
      demo: true
    }
  };
  fs.writeFileSync(process.env.TIDEMARKET_LOCAL_DB_PATH, JSON.stringify(database, null, 2));
  const { startServer } = await import('../src/index.js');
  serverHandle = await startServer({ port: 0, sweepIntervalMs: 60_000 });
  baseUrl = `http://127.0.0.1:${serverHandle.server.address().port}`;
});

after(async () => {
  await serverHandle?.close();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

test('review submission enforces buyer ownership, verified completion, rating bounds, and one review per order', async () => {
  const buyer = await tokenFor('buyer-1@auction.test');
  const otherBuyer = await tokenFor('buyer-2@auction.test');
  const fisherman = await tokenFor('fisherman@auction.test');
  const unauthenticated = await api('/orders/verified-completed/reviews', {
    method: 'POST', body: { rating: 5 }
  });
  assert.equal(unauthenticated.response.status, 401);

  const wrongBuyer = await api('/orders/verified-completed/reviews', {
    token: otherBuyer, method: 'POST', body: { rating: 5 }
  });
  assert.equal(wrongBuyer.response.status, 404);
  const wrongRole = await api('/orders/verified-completed/reviews', {
    token: fisherman, method: 'POST', body: { rating: 5 }
  });
  assert.equal(wrongRole.response.status, 403);
  const demoOrder = await api('/orders/demo-completed/reviews', {
    token: otherBuyer, method: 'POST', body: { rating: 5 }
  });
  assert.equal(demoOrder.response.status, 409);

  const invalid = await api('/orders/verified-completed/reviews', {
    token: buyer, method: 'POST', body: { rating: 6, comment: 'Good catch' }
  });
  assert.equal(invalid.response.status, 400);
  const submitted = await api('/orders/verified-completed/reviews', {
    token: buyer, method: 'POST', body: { rating: 5, comment: 'Careful packing and on-time delivery.' }
  });
  assert.equal(submitted.response.status, 201);
  assert.equal(submitted.data.status, 'pending');
  const duplicate = await api('/orders/verified-completed/reviews', {
    token: buyer, method: 'POST', body: { rating: 4 }
  });
  assert.equal(duplicate.response.status, 409);
  const ownReviews = await api('/buyer/reviews', { token: buyer });
  assert.equal(ownReviews.data.length, 1);
  assert.equal(ownReviews.data[0].comment, 'Careful packing and on-time delivery.');
});

test('admin moderation, verification, and confirmed complaints recalculate evidence-backed scores', async () => {
  const buyer = await tokenFor('buyer-1@auction.test');
  const admin = await tokenFor('admin@auction.test');
  const fisherman = await tokenFor('fisherman@auction.test');
  const unauthorized = await api('/admin/reviews/order_verified-completed/moderation', {
    token: fisherman, method: 'PATCH', body: { status: 'approved' }
  });
  assert.equal(unauthorized.response.status, 403);

  const approved = await api('/admin/reviews/order_verified-completed/moderation', {
    token: admin, method: 'PATCH', body: { status: 'approved' }
  });
  assert.equal(approved.response.status, 200);
  const reputation = await api('/fisherman/reputation', { token: fisherman });
  assert.equal(reputation.response.status, 200);
  assert.equal(reputation.data.averageRating, 5);
  assert.equal(reputation.data.verifiedOrderCount, 2);
  assert.equal(reputation.data.completedOrderCount, 1);
  assert.ok(reputation.data.history.length >= 1);

  const complaint = await api('/orders/verified-completed/disputes', {
    token: buyer,
    method: 'POST',
    body: { complaint: 'The packaging was damaged when the order arrived.' }
  });
  assert.equal(complaint.response.status, 201);
  const pendingScore = await api('/fisherman/reputation', { token: fisherman });
  assert.equal(pendingScore.data.confirmedDisputeCount, 0);
  const confirmed = await api('/admin/disputes/order_verified-completed/review', {
    token: admin, method: 'PATCH', body: { finding: 'confirmed', adminNote: 'Confirmed from the order record.' }
  });
  assert.equal(confirmed.response.status, 200);
  const penalized = await api('/fisherman/reputation', { token: fisherman });
  assert.equal(penalized.data.confirmedDisputeCount, 1);

  const sellerCannotVerify = await api('/admin/fishermen/fisherman-1/verification', {
    token: fisherman, method: 'PATCH', body: { verified: false }
  });
  assert.equal(sellerCannotVerify.response.status, 403);
  const verification = await api('/admin/fishermen/fisherman-1/verification', {
    token: admin, method: 'PATCH', body: { verified: false }
  });
  assert.equal(verification.response.status, 200);
  assert.equal(verification.data.fisherman.verificationStatus, 'unverified');
  const adminScores = await api('/admin/reputation', { token: admin });
  assert.equal(adminScores.response.status, 200);
  assert.equal(adminScores.data.find(row => row.fisherman.id === 'fisherman-1').reputation.verified, false);
});

test('delivery evidence and score only progress through the verified order workflow', async () => {
  const fisherman = await tokenFor('fisherman@auction.test');
  const buyer = await tokenFor('buyer-2@auction.test');
  const invalidStatus = await api('/orders/verified-processing/status', {
    token: fisherman, method: 'PATCH', body: { status: 'not-a-real-order-status' }
  });
  assert.equal(invalidStatus.response.status, 400);
  const expectedDeliveryAt = new Date(Date.now() + 2 * 86400000).toISOString();
  const schedule = await api('/orders/verified-processing/delivery-schedule', {
    token: fisherman, method: 'PATCH', body: { expectedDeliveryAt }
  });
  assert.equal(schedule.response.status, 200);
  const delivered = await api('/orders/verified-processing/status', {
    token: fisherman, method: 'PATCH', body: { status: 'delivered' }
  });
  assert.equal(delivered.response.status, 200);
  assert.ok(delivered.data.deliveredAt);
  const completed = await api('/orders/verified-processing/status', {
    token: fisherman, method: 'PATCH', body: { status: 'completed' }
  });
  assert.equal(completed.response.status, 200);
  assert.ok(completed.data.completedAt);
  const review = await api('/orders/verified-processing/reviews', {
    token: buyer, method: 'POST', body: { rating: 4 }
  });
  assert.equal(review.response.status, 201);
});

test('prediction requests are role-gated, private to the requester, and do not claim model validation without data', async () => {
  const buyer = await tokenFor('buyer-1@auction.test');
  const otherBuyer = await tokenFor('buyer-2@auction.test');
  const invalid = await api('/price-predictions', {
    token: buyer, method: 'POST', body: { fishType: 'Unknown', quantity: 2 }
  });
  assert.equal(invalid.response.status, 400);
  const prediction = await api('/price-predictions', {
    token: buyer,
    method: 'POST',
    body: { fishType: 'Tuna', quantity: 2, quality: 'Good', size: 'Medium', location: 'Udupi' }
  });
  assert.equal(prediction.response.status, 201);
  assert.equal(prediction.data.reliability, 'preliminary');
  assert.equal(prediction.data.model.status, 'preliminary');
  assert.ok(prediction.data.estimatePerKg > 0);
  const ownHistory = await api('/price-predictions', { token: buyer });
  const otherHistory = await api('/price-predictions', { token: otherBuyer });
  assert.equal(ownHistory.data.length, 1);
  assert.equal(otherHistory.data.length, 0);

  const analytics = await api('/admin/price-analytics', { token: await tokenFor('admin@auction.test') });
  assert.equal(analytics.response.status, 200);
  assert.equal(analytics.data.dataAvailability.verifiedSaleCount, 2);
  assert.equal(analytics.data.dataAvailability.canEvaluateModel, false);
  const evaluate = await api('/admin/price-model/evaluate', {
    token: await tokenFor('admin@auction.test'), method: 'POST', body: {}
  });
  assert.equal(evaluate.response.status, 409);
  assert.equal(evaluate.data.status, 'insufficient_data');
});
