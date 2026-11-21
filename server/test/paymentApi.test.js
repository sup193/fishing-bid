import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createAuctionDatabase } from '../test-support/auctionTestData.js';

const gatewayBase = 'https://api.razorpay.com/v1';
const gatewayOrigin = new URL(gatewayBase).origin;
const paymentSecret = 'test-only-razorpay-secret';
const webhookSecret = 'test-only-webhook-secret';
const gatewayOrders = new Map();
const paymentOrderIds = new Map();
let tempDir;
let databasePath;
let serverHandle;
let baseUrl;
let originalFetch;
let gatewayOrderSequence = 0;

async function api(pathname, { token, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}/api${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  return { response, data: await response.json() };
}

async function login(email) {
  const { response, data } = await api('/auth/login', {
    method: 'POST',
    body: { email, password: 'auction-test-password' }
  });
  assert.equal(response.status, 200);
  return data.token;
}

function razorpaySignature(orderId, paymentId) {
  return createHmac('sha256', paymentSecret).update(`${orderId}|${paymentId}`).digest('hex');
}

function webhookSignature(payload) {
  return createHmac('sha256', webhookSecret).update(payload).digest('hex');
}

async function createPayment(token, listingId) {
  const { response, data } = await api('/payments/razorpay/orders', {
    token,
    method: 'POST',
    body: { listingId }
  });
  assert.equal(response.status, 201);
  assert.equal(data.amount, 1_500_000);
  return data;
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidemarket-payment-api-test-'));
  databasePath = path.join(tempDir, 'local-db.json');
  process.env.NODE_ENV = 'test';
  process.env.TIDEMARKET_DATABASE = 'local';
  process.env.TIDEMARKET_LOCAL_DB_PATH = databasePath;
  process.env.JWT_SECRET = 'test-only-payment-jwt-secret';
  process.env.RAZORPAY_KEY_ID = 'rzp_test_fixture';
  process.env.RAZORPAY_KEY_SECRET = paymentSecret;
  process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;
  await createAuctionDatabase(databasePath);

  const database = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
  database.listings['payment-invalid'] = { ...database.listings['fixed-listing'], fisherman: 'fisherman-1' };
  database.listings['payment-webhook'] = { ...database.listings['fixed-listing'], fisherman: 'fisherman-1' };
  database.listings['payment-cancelled'] = { ...database.listings['fixed-listing'], fisherman: 'fisherman-1' };
  fs.writeFileSync(databasePath, JSON.stringify(database, null, 2));

  originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.origin !== gatewayOrigin) return originalFetch(input, options);

    const method = options?.method || 'GET';
    const requestBody = options?.body ? JSON.parse(options.body) : null;
    if (url.pathname === '/v1/orders' && method === 'POST') {
      const id = `order_test_${++gatewayOrderSequence}`;
      gatewayOrders.set(id, requestBody.amount);
      return Response.json({ id, amount: requestBody.amount, currency: 'INR' });
    }

    const paymentMatch = url.pathname.match(/^\/v1\/payments\/([^/]+)(\/capture)?$/);
    if (paymentMatch) {
      const paymentId = decodeURIComponent(paymentMatch[1]);
      if (paymentMatch[2] && method === 'POST') {
        return Response.json({
          id: paymentId,
          order_id: paymentOrderIds.get(paymentId),
          amount: requestBody.amount,
          currency: 'INR',
          status: 'captured',
          method: 'card'
        });
      }
      return Response.json({
        id: paymentId,
        order_id: paymentOrderIds.get(paymentId),
        amount: 1_500_000,
        currency: 'INR',
        status: paymentId === 'pay_authorized' ? 'authorized' : 'captured',
        method: 'card',
        created_at: 1_800_000_000
      });
    }

    throw new Error(`Unexpected Razorpay test request: ${method} ${url.pathname}`);
  };

  const { startServer } = await import('../src/index.js');
  serverHandle = await startServer({ port: 0, sweepIntervalMs: 60_000 });
  baseUrl = `http://127.0.0.1:${serverHandle.server.address().port}`;
});

after(async () => {
  await serverHandle?.close();
  if (originalFetch) globalThis.fetch = originalFetch;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

test('checkout verifies and captures a test payment, then duplicate verification stays paid', async () => {
  const token = await login('buyer-1@auction.test');
  const checkout = await createPayment(token, 'fixed-listing');
  assert.equal(checkout.keyId, 'rzp_test_fixture');
  paymentOrderIds.set('pay_authorized', checkout.gatewayOrderId);

  const verified = await api('/payments/razorpay/verify', {
    token,
    method: 'POST',
    body: {
      transactionId: checkout.transactionId,
      razorpay_order_id: checkout.gatewayOrderId,
      razorpay_payment_id: 'pay_authorized',
      razorpay_signature: razorpaySignature(checkout.gatewayOrderId, 'pay_authorized')
    }
  });
  assert.equal(verified.response.status, 200);
  assert.equal(verified.data.status, 'paid');

  const duplicate = await api('/payments/razorpay/verify', {
    token,
    method: 'POST',
    body: {
      transactionId: checkout.transactionId,
      razorpay_order_id: checkout.gatewayOrderId,
      razorpay_payment_id: 'pay_authorized',
      razorpay_signature: razorpaySignature(checkout.gatewayOrderId, 'pay_authorized')
    }
  });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.data.status, 'paid');

  const database = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
  const [paidOrderId, paidOrder] = Object.entries(database.orders).find(([, order]) => order.listing === 'fixed-listing') || [];
  const paidAttempt = Object.values(database.payments).find(payment => payment.order === paidOrderId);
  assert.ok(paidOrder);
  assert.equal(paidAttempt.status, 'paid');
  assert.equal(database.listings['fixed-listing'].status, 'sold');
  assert.equal(Object.values(database.orders).filter(order => order.listing === 'fixed-listing').length, 1);
  assert.equal(Object.values(database.payments).filter(payment => payment.order === paidOrderId).length, 1);

  const orders = await api('/orders', { token });
  assert.equal(orders.response.status, 200);
  assert.equal(orders.data.filter(order => order.listing === 'fixed-listing').length, 1);
  assert.equal(orders.data.find(order => order.listing === 'fixed-listing').paymentStatus, 'paid');
});

test('invalid checkout signatures fail the attempt and release the listing', async () => {
  const token = await login('buyer-2@auction.test');
  const checkout = await createPayment(token, 'payment-invalid');
  const result = await api('/payments/razorpay/verify', {
    token,
    method: 'POST',
    body: {
      transactionId: checkout.transactionId,
      razorpay_order_id: checkout.gatewayOrderId,
      razorpay_payment_id: 'pay_invalid',
      razorpay_signature: 'invalid'
    }
  });
  assert.equal(result.response.status, 400);
  assert.match(result.data.message, /signature/i);

  const database = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
  const [orderId, order] = Object.entries(database.orders).find(([, item]) => item.listing === 'payment-invalid') || [];
  const payment = Object.values(database.payments).find(item => item.order === orderId);
  assert.equal(order.paymentStatus, 'failed');
  assert.equal(payment.status, 'failed');
  assert.equal(database.listings['payment-invalid'].status, 'available');
});

test('checkout cancellation is owner-only, idempotent, and releases the listing for retry', async () => {
  const buyerToken = await login('buyer-4@auction.test');
  const otherBuyerToken = await login('buyer-5@auction.test');
  const checkout = await createPayment(buyerToken, 'payment-cancelled');

  const unauthorized = await api('/payments/razorpay/failure', {
    token: otherBuyerToken,
    method: 'POST',
    body: { transactionId: checkout.transactionId, reason: 'Wrong buyer' }
  });
  assert.equal(unauthorized.response.status, 404);

  const cancelled = await api('/payments/razorpay/failure', {
    token: buyerToken,
    method: 'POST',
    body: { transactionId: checkout.transactionId, reason: 'Buyer closed checkout' }
  });
  assert.equal(cancelled.response.status, 200);
  const duplicate = await api('/payments/razorpay/failure', {
    token: buyerToken,
    method: 'POST',
    body: { transactionId: checkout.transactionId, reason: 'Duplicate close event' }
  });
  assert.equal(duplicate.response.status, 200);

  const database = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
  const order = Object.values(database.orders).find(item => item.listing === 'payment-cancelled');
  const payment = database.payments[checkout.transactionId];
  assert.equal(order.paymentStatus, 'failed');
  assert.equal(order.orderStatus, 'payment-failed');
  assert.equal(payment.status, 'failed');
  assert.equal(payment.failureReason, 'Buyer closed checkout');
  assert.equal(database.listings['payment-cancelled'].status, 'available');
  assert.equal(Object.values(database.orders).filter(item => item.listing === 'payment-cancelled').length, 1);
  const buyerOrders = await api('/orders', { token: buyerToken });
  assert.equal(buyerOrders.data.find(item => item.listing === 'payment-cancelled').paymentStatus, 'failed');
});

test('webhook HMAC and captured payment data are checked and duplicate events are idempotent', async () => {
  const token = await login('buyer-3@auction.test');
  const checkout = await createPayment(token, 'payment-webhook');
  const event = {
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: 'pay_webhook',
          order_id: checkout.gatewayOrderId,
          amount: 1_500_000,
          currency: 'INR',
          status: 'captured',
          method: 'card',
          created_at: 1_800_000_000
        }
      }
    }
  };
  const payload = JSON.stringify(event);

  const invalid = await api('/payments/razorpay/webhook', {
    method: 'POST',
    body: event,
    headers: { 'x-razorpay-signature': 'invalid' }
  });
  assert.equal(invalid.response.status, 400);

  const delivered = await fetch(`${baseUrl}/api/payments/razorpay/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': webhookSignature(payload) },
    body: payload
  });
  assert.equal(delivered.status, 200);

  const duplicate = await fetch(`${baseUrl}/api/payments/razorpay/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': webhookSignature(payload) },
    body: payload
  });
  assert.equal(duplicate.status, 200);

  const database = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
  const [orderId, order] = Object.entries(database.orders).find(([, item]) => item.listing === 'payment-webhook') || [];
  const payment = Object.values(database.payments).find(item => item.order === orderId);
  assert.equal(order.paymentStatus, 'paid');
  assert.equal(order.transactionRef, 'pay_webhook');
  assert.equal(payment.status, 'paid');
  assert.equal(Object.values(database.orders).filter(item => item.listing === 'payment-webhook').length, 1);
});
