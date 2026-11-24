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

async function createUpiPayment(token, body) {
  const { response, data } = await api('/payments/upi/orders', {
    token,
    method: 'POST',
    body
  });
  assert.ok([200, 201].includes(response.status), JSON.stringify(data));
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
  database.listings['upi-fixed'] = { ...database.listings['fixed-listing'], quantity: 3, salePrice: 500, status: 'available' };
  database.listings['upi-second'] = { ...database.listings['fixed-listing'], quantity: 4, salePrice: 400, status: 'available' };
  database.listings['upi-auction-listing'] = { ...database.listings['listing-auction-settled'], status: 'auction' };
  database.auctions['upi-auction'] = { ...database.auctions['auction-settled'], listing: 'upi-auction-listing' };
  database.users['admin-1'] = {
    ...database.users['buyer-1'],
    name: 'Test Admin',
    email: 'admin@auction.test',
    role: 'admin'
  };
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

test('UPI checkout uses the server-calculated fixed-price amount and a unique payment reference', async () => {
  const token = await login('buyer-1@auction.test');
  const payment = await createUpiPayment(token, { listingId: 'upi-fixed', amount: 0.01 });
  assert.equal(payment.amount, 1500);
  assert.equal(payment.upiRecipientId, 'itssupriyak1@okaxis');
  const uri = new URL(payment.paymentUri.replace('upi://pay?', 'https://upi.invalid/?'));
  assert.equal(uri.searchParams.get('pa'), 'itssupriyak1@okaxis');
  assert.equal(uri.searchParams.get('am'), '1500.00');
  assert.equal(uri.searchParams.get('cu'), 'INR');
  assert.equal(uri.searchParams.get('tn'), payment.orderNumber);
  assert.equal(uri.searchParams.get('tr'), payment.upiPaymentReference);
  assert.equal(payment.status, 'pending');
  assert.ok(payment.transactionId);
  const duplicateAttempt = await api('/payments/upi/orders', {
    token,
    method: 'POST',
    body: { listingId: 'upi-fixed' }
  });
  assert.equal(duplicateAttempt.response.status, 200);
  assert.equal(duplicateAttempt.data.transactionId, payment.transactionId);
});

test('UPI checkout supports the winning auction order and exact winning bill', async () => {
  const token = await login('buyer-1@auction.test');
  const payment = await createUpiPayment(token, { auctionId: 'upi-auction', amount: 1 });
  assert.equal(payment.amount, 8400);
  const uri = new URL(payment.paymentUri.replace('upi://pay?', 'https://upi.invalid/?'));
  assert.equal(uri.searchParams.get('pa'), 'itssupriyak1@okaxis');
  assert.equal(uri.searchParams.get('am'), '8400.00');
  assert.equal(uri.searchParams.get('tr'), payment.upiPaymentReference);
});

test('UPI references remain pending until admin approval and duplicate references are rejected', async () => {
  const buyerToken = await login('buyer-1@auction.test');
  const otherBuyerToken = await login('buyer-2@auction.test');
  const adminToken = await login('admin@auction.test');
  const first = await createUpiPayment(buyerToken, { listingId: 'upi-fixed' });
  const second = await createUpiPayment(otherBuyerToken, { listingId: 'upi-second' });

  const buyerOrder = (await api('/orders', { token: otherBuyerToken })).data
    .find(order => order.orderNumber === second.orderNumber);
  const wrongOwnerOrder = await api('/payments/upi/orders', {
    token: buyerToken,
    method: 'POST',
    body: { orderId: buyerOrder.id, amount: 1 }
  });
  assert.equal(wrongOwnerOrder.response.status, 404);
  const wrongOwnerReference = await api('/payments/upi/submit-reference', {
    token: otherBuyerToken,
    method: 'POST',
    body: { transactionId: first.transactionId, utr: 'UPI12345678' }
  });
  assert.equal(wrongOwnerReference.response.status, 404);

  const invalidUtr = await api('/payments/upi/submit-reference', {
    token: buyerToken,
    method: 'POST',
    body: { transactionId: first.transactionId, utr: '123' }
  });
  assert.equal(invalidUtr.response.status, 400);
  const submitted = await api('/payments/upi/submit-reference', {
    token: buyerToken,
    method: 'POST',
    body: { transactionId: first.transactionId, utr: 'UPI12345678' }
  });
  assert.equal(submitted.response.status, 202);
  assert.equal(submitted.data.status, 'pending_verification');

  let database = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
  const firstOrder = database.orders[database.payments[first.transactionId].order];
  assert.equal(database.payments[first.transactionId].status, 'pending_verification');
  assert.equal(firstOrder.paymentStatus, 'pending');
  assert.notEqual(firstOrder.orderStatus, 'processing');
  assert.equal(database.listings['upi-fixed'].status, 'reserved');

  const duplicateUtr = await api('/payments/upi/submit-reference', {
    token: otherBuyerToken,
    method: 'POST',
    body: { transactionId: second.transactionId, utr: 'upi12345678' }
  });
  assert.equal(duplicateUtr.response.status, 409);

  const buyerAdminQueue = await api('/admin/payments/pending', { token: buyerToken });
  assert.equal(buyerAdminQueue.response.status, 403);
  const adminQueue = await api('/admin/payments/pending', { token: adminToken });
  assert.equal(adminQueue.response.status, 200);
  assert.deepEqual(adminQueue.data.map(item => item.id), [first.transactionId]);
  assert.equal(adminQueue.data[0].buyer.name, 'Test Buyer 1');
  assert.equal(adminQueue.data[0].fisherman.name, 'Test Fisherman');
  assert.equal(adminQueue.data[0].fishType, 'Prawns');
  const buyerRejection = await api(`/admin/payments/${first.transactionId}/reject`, {
    token: buyerToken,
    method: 'PATCH'
  });
  assert.equal(buyerRejection.response.status, 403);
  const buyerStatus = await api(`/payments/upi/${first.transactionId}/status`, { token: buyerToken });
  assert.equal(buyerStatus.response.status, 200);
  assert.equal(buyerStatus.data.status, 'pending_verification');
  const priorReputation = await api('/admin/fishermen/fisherman-1', { token: adminToken });
  assert.equal(priorReputation.response.status, 200);

  const buyerApproval = await api(`/admin/payments/${first.transactionId}/verify`, {
    token: buyerToken,
    method: 'PATCH'
  });
  assert.equal(buyerApproval.response.status, 403);
  const approved = await api(`/admin/payments/${first.transactionId}/verify`, {
    token: adminToken,
    method: 'PATCH'
  });
  assert.equal(approved.response.status, 200);
  const duplicateApproval = await api(`/admin/payments/${first.transactionId}/verify`, {
    token: adminToken,
    method: 'PATCH'
  });
  assert.equal(duplicateApproval.response.status, 409);

  database = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
  const paidOrder = database.orders[database.payments[first.transactionId].order];
  assert.equal(database.payments[first.transactionId].status, 'paid');
  assert.equal(database.payments[first.transactionId].verificationStatus, 'verified');
  assert.equal(database.payments[first.transactionId].verifiedBy, 'admin-1');
  assert.equal(paidOrder.paymentStatus, 'paid');
  assert.equal(paidOrder.orderStatus, 'processing');
  assert.equal(paidOrder.transactionRef, 'UPI12345678');
  assert.equal(database.listings['upi-fixed'].status, 'sold');
  const updatedReputation = await api('/admin/fishermen/fisherman-1', { token: adminToken });
  assert.equal(updatedReputation.response.status, 200);
  assert.equal(updatedReputation.data.reputation.verifiedOrderCount, priorReputation.data.reputation.verifiedOrderCount + 1);
  const fishermanToken = await login('fisherman@auction.test');
  const fishermanTransactions = await api('/transactions', { token: fishermanToken });
  const fishermanPayment = fishermanTransactions.data.find(item => item.id === first.transactionId);
  assert.ok(fishermanPayment);
  assert.equal(Object.hasOwn(fishermanPayment, 'upiUtr'), false);
  assert.equal(Object.hasOwn(fishermanPayment, 'upiRecipientId'), false);
  assert.equal(Object.hasOwn(fishermanPayment, 'upiPaymentReference'), false);
  const fishermanOrders = await api('/fisherman/sales', { token: fishermanToken });
  const fishermanOrder = fishermanOrders.data.find(item => item.orderNumber === first.orderNumber);
  assert.equal(fishermanOrder.verifiedPayment, true);
  assert.equal(Object.hasOwn(fishermanOrder, 'transactionRef'), false);

  const rejectedReference = await api('/payments/upi/submit-reference', {
    token: otherBuyerToken,
    method: 'POST',
    body: { transactionId: second.transactionId, utr: 'UPI87654321' }
  });
  assert.equal(rejectedReference.response.status, 202);
  const rejected = await api(`/admin/payments/${second.transactionId}/reject`, {
    token: adminToken,
    method: 'PATCH',
    body: { reason: 'Receipt did not confirm the payment' }
  });
  assert.equal(rejected.response.status, 200);
  const duplicateRejection = await api(`/admin/payments/${second.transactionId}/reject`, {
    token: adminToken,
    method: 'PATCH'
  });
  assert.equal(duplicateRejection.response.status, 409);
  database = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
  const unpaidOrder = database.orders[database.payments[second.transactionId].order];
  assert.equal(database.payments[second.transactionId].status, 'rejected');
  assert.equal(unpaidOrder.paymentStatus, 'failed');
  assert.notEqual(unpaidOrder.paymentStatus, 'paid');
  assert.equal(database.listings['upi-second'].status, 'available');

  const history = await api('/transactions', { token: otherBuyerToken });
  assert.equal(history.response.status, 200);
  assert.equal(history.data.find(item => item.id === second.transactionId).status, 'rejected');
});
