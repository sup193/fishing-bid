import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAuctionDatabase } from './auctionTestData.js';

const razorpayOrigin = 'https://api.razorpay.com';
const gatewayOrders = new Map();
const originalFetch = globalThis.fetch;
let gatewayOrderSequence = 0;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidemarket-auction-api-'));
const databasePath = path.join(tempDir, 'local-db.json');
process.env.TIDEMARKET_DATABASE = 'local';
process.env.TIDEMARKET_LOCAL_DB_PATH = databasePath;
process.env.TIDEMARKET_UPLOAD_DIR = path.join(tempDir, 'uploads');
process.env.JWT_SECRET = 'test-only-auction-jwt-secret';
process.env.ADMIN_EMAIL = 'admin@auction.test';
process.env.ADMIN_PASSWORD = 'auction-test-password';
process.env.NODE_ENV = 'test';
process.env.CLIENT_URL = '*';
process.env.PORT = '5000';
process.env.RAZORPAY_KEY_ID = 'rzp_test_fixture';
process.env.RAZORPAY_KEY_SECRET = 'test-only-e2e-razorpay-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test-only-e2e-webhook-secret';
delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
delete process.env.FIREBASE_CLIENT_EMAIL;
delete process.env.FIREBASE_PRIVATE_KEY;
delete process.env.FIREBASE_PROJECT_ID;
delete process.env.FIREBASE_DATABASE_URL;
await createAuctionDatabase(databasePath);
const database = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
database.reviews = {
  ...database.reviews,
  'e2e-pending-review': {
    order: 'e2e-review-order',
    buyer: 'buyer-1',
    fisherman: 'fisherman-1',
    rating: 5,
    comment: 'E2E moderation fixture',
    status: 'pending'
  }
};
fs.writeFileSync(databasePath, JSON.stringify(database, null, 2));
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.origin !== razorpayOrigin) return originalFetch(input, options);

  const method = options.method || 'GET';
  const requestBody = options.body ? JSON.parse(options.body) : null;
  if (url.pathname === '/v1/orders' && method === 'POST') {
    const id = `order_test_${++gatewayOrderSequence}`;
    gatewayOrders.set(id, requestBody.amount);
    return Response.json({ id, amount: requestBody.amount, currency: 'INR' });
  }

  const paymentMatch = url.pathname.match(/^\/v1\/payments\/(pay_order_test_\d+)(\/capture)?$/);
  if (paymentMatch) {
    const paymentId = paymentMatch[1];
    const orderId = paymentId.slice(4);
    const amount = gatewayOrders.get(orderId);
    if (!amount) return Response.json({ error: { description: 'Unknown test order' } }, { status: 404 });
    if (paymentMatch[2] && method === 'POST') {
      if (requestBody.amount !== amount) {
        return Response.json({ error: { description: 'Test capture amount mismatch' } }, { status: 400 });
      }
      return Response.json({ id: paymentId, order_id: orderId, amount, currency: 'INR', status: 'captured', method: 'card' });
    }
    return Response.json({
      id: paymentId,
      order_id: orderId,
      amount,
      currency: 'INR',
      status: 'authorized',
      method: 'card',
      created_at: 1_800_000_000
    });
  }

  throw new Error(`Unexpected Razorpay test request: ${method} ${url.pathname}`);
};
process.on('exit', () => fs.rmSync(tempDir, { recursive: true, force: true }));
const { startServer } = await import('../src/index.js');
await startServer();
