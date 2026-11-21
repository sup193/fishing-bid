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

async function tokenFor(email) {
  if (!tokens.has(email)) {
    const { response, data } = await api('/auth/login', {
      method: 'POST',
      body: { email, password: 'auction-test-password' }
    });
    assert.equal(response.status, 200);
    tokens.set(email, data.token);
  }
  return tokens.get(email);
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidemarket-demand-api-test-'));
  process.env.TIDEMARKET_DATABASE = 'local';
  process.env.TIDEMARKET_LOCAL_DB_PATH = path.join(tempDir, 'local-db.json');
  process.env.JWT_SECRET = 'test-only-demand-jwt-secret';
  process.env.RAZORPAY_KEY_ID = '';
  process.env.RAZORPAY_KEY_SECRET = '';
  process.env.RAZORPAY_WEBHOOK_SECRET = '';
  await createAuctionDatabase(process.env.TIDEMARKET_LOCAL_DB_PATH);
  const database = JSON.parse(fs.readFileSync(process.env.TIDEMARKET_LOCAL_DB_PATH, 'utf8'));
  const passwordHash = await bcrypt.hash('auction-test-password', 4);
  database.users.admin = { name: 'Test Admin', email: 'admin@demand.test', passwordHash, role: 'admin' };
  database.users['buyer-1'].location = 'Udupi';
  database.users['fisherman-1'].location = 'Udupi';
  database.orders = {
    'verified-sale-a': {
      buyer: 'buyer-1',
      fisherman: 'fisherman-1',
      listing: 'fixed-listing',
      quantity: 30,
      amount: 15000,
      paymentStatus: 'paid',
      gateway: 'razorpay',
      transactionRef: 'pay_demand_sale_a',
      orderStatus: 'completed',
      createdAt: '2026-03-01T10:00:00.000Z'
    },
    'verified-sale-b': {
      buyer: 'buyer-2',
      fisherman: 'fisherman-1',
      listing: 'fixed-listing',
      quantity: 20,
      amount: 10000,
      paymentStatus: 'paid',
      gateway: 'razorpay',
      transactionRef: 'pay_demand_sale_b',
      orderStatus: 'completed',
      createdAt: '2026-03-02T10:00:00.000Z'
    },
    'unverified-sale': {
      buyer: 'buyer-1',
      fisherman: 'fisherman-1',
      listing: 'fixed-listing',
      quantity: 1000,
      amount: 100000,
      paymentStatus: 'pending',
      gateway: 'razorpay',
      transactionRef: 'pending_demand_sale',
      orderStatus: 'completed',
      createdAt: '2026-03-03T10:00:00.000Z'
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

test('demand endpoints enforce authentication and buyer, fisherman, and admin roles', async () => {
  const noAuth = await api('/demand/buyer');
  assert.equal(noAuth.response.status, 401);

  const buyer = await tokenFor('buyer-1@auction.test');
  const fisherman = await tokenFor('fisherman@auction.test');
  const admin = await tokenFor('admin@demand.test');
  assert.equal((await api('/demand/fisherman', { token: buyer })).response.status, 403);
  assert.equal((await api('/demand/buyer', { token: fisherman })).response.status, 403);
  assert.equal((await api('/admin/demand/analytics', { token: buyer })).response.status, 403);
  assert.equal((await api('/admin/demand/performance', { token: fisherman })).response.status, 403);
  assert.equal((await api('/admin/demand/analytics', { token: admin })).response.status, 200);
  assert.equal((await api('/admin/demand/performance', { token: admin })).response.status, 200);
  assert.equal((await api('/admin/demand/analytics?category=unlisted', { token: admin })).response.status, 400);
});

test('buyer and fisherman forecasts aggregate only verified sales without exposing buyer identities', async () => {
  const buyer = await tokenFor('buyer-1@auction.test');
  const fisherman = await tokenFor('fisherman@auction.test');
  const query = '?from=2026-03-01&to=2026-03-31';
  const buyerResult = await api(`/demand/buyer${query}`, { token: buyer });
  assert.equal(buyerResult.response.status, 200);
  assert.equal(buyerResult.data.dataAvailability.verifiedSaleCount, 2);
  assert.equal(buyerResult.data.totals.historicalQuantityKg, 50);
  assert.equal(JSON.stringify(buyerResult.data).includes('buyer-1'), false);
  assert.equal(JSON.stringify(buyerResult.data).includes('buyer-2'), false);
  const trending = await api(`/demand/trending${query}`, { token: buyer });
  assert.equal(trending.response.status, 200);
  assert.equal(trending.data.trending[0].totalQuantityKg, 50);

  const fishermanResult = await api(`/demand/fisherman${query}`, { token: fisherman });
  assert.equal(fishermanResult.response.status, 200);
  assert.equal(fishermanResult.data.model.version, 'verified-sales-wma-v1');
  assert.equal(JSON.stringify(fishermanResult.data).includes('buyer-1'), false);
});

test('demand API rejects unsupported species and reports low-data states', async () => {
  const buyer = await tokenFor('buyer-1@auction.test');
  const invalid = await api('/demand/forecast?fishType=Unlisted%20Fish', { token: buyer });
  assert.equal(invalid.response.status, 400);

  const sparse = await api('/demand/buyer?from=2026-03-01&to=2026-03-01', { token: buyer });
  assert.equal(sparse.response.status, 200);
  assert.equal(sparse.data.model.status, 'insufficient_data');
});
