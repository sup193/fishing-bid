import assert from 'node:assert/strict';
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

async function tokenFor(email, role) {
  if (!tokens.has(email)) {
    const { response, data } = await api('/auth/login', {
      method: 'POST',
      body: { email, password: 'auction-test-password' }
    });
    assert.equal(response.status, 200);
    assert.equal(data.user.role, role);
    tokens.set(email, data.token);
  }
  return tokens.get(email);
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidemarket-voice-api-test-'));
  process.env.TIDEMARKET_DATABASE = 'local';
  process.env.TIDEMARKET_LOCAL_DB_PATH = path.join(tempDir, 'local-db.json');
  process.env.JWT_SECRET = 'test-only-voice-jwt-secret';
  process.env.RAZORPAY_KEY_ID = '';
  process.env.RAZORPAY_KEY_SECRET = '';
  process.env.RAZORPAY_WEBHOOK_SECRET = '';
  await createAuctionDatabase(process.env.TIDEMARKET_LOCAL_DB_PATH);
  const { startServer } = await import('../src/index.js');
  serverHandle = await startServer({ port: 0, sweepIntervalMs: 60_000 });
  baseUrl = `http://127.0.0.1:${serverHandle.server.address().port}`;
});

after(async () => {
  await serverHandle?.close();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

test('buyer registration validates name, email, and password before creating a pending request', async () => {
  const shortPassword = await api('/auth/register', {
    method: 'POST',
    body: { name: 'New Buyer', email: 'new-buyer@example.test', password: 'short' }
  });
  assert.equal(shortPassword.response.status, 400);

  const invalidEmail = await api('/auth/register', {
    method: 'POST',
    body: { name: 'New Buyer', email: 'not-an-email', password: 'StrongPass123!' }
  });
  assert.equal(invalidEmail.response.status, 400);

  const valid = await api('/auth/register', {
    method: 'POST',
    body: { name: 'New Buyer', email: 'New-Buyer@example.test', password: 'StrongPass123!' }
  });
  assert.equal(valid.response.status, 202);
  assert.equal(valid.data.status, 'pending');
});

test('language preference requires an authenticated user and only accepts supported language codes', async () => {
  const unauthenticated = await api('/auth/preferences', {
    method: 'PATCH',
    body: { preferredLanguage: 'kn' }
  });
  assert.equal(unauthenticated.response.status, 401);

  const buyer = await tokenFor('buyer-1@auction.test', 'buyer');
  const invalidSession = await api('/auth/preferences', {
    token: 'invalid-token',
    method: 'PATCH',
    body: { preferredLanguage: 'kn' }
  });
  assert.equal(invalidSession.response.status, 401);

  const updated = await api('/auth/preferences', {
    token: buyer,
    method: 'PATCH',
    body: { preferredLanguage: 'kn', role: 'admin' }
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.data.user.preferredLanguage, 'kn');
  assert.equal(updated.data.user.role, 'buyer');
  assert.equal(updated.data.user.passwordHash, undefined);

  const me = await api('/auth/me', { token: buyer });
  assert.equal(me.response.status, 200);
  assert.equal(me.data.user.preferredLanguage, 'kn');

  const unsupported = await api('/auth/preferences', {
    token: buyer,
    method: 'PATCH',
    body: { preferredLanguage: 'fr' }
  });
  assert.equal(unsupported.response.status, 400);
});

test('listing actions enforce role, input validation, ownership and auction edit restrictions', async () => {
  const buyer = await tokenFor('buyer-1@auction.test', 'buyer');
  const owner = await tokenFor('fisherman@auction.test', 'fisherman');
  const otherOwner = await tokenFor('other-fisherman@auction.test', 'fisherman');
  const listingBody = {
    fishType: 'Tuna',
    quantity: 20,
    quality: 'Good',
    size: 'Medium',
    location: 'Mangalore',
    expectedPrice: 300,
    salePrice: 300,
    saleMode: 'sale',
    requestId: 'voice-create-request-001'
  };

  const unauthorizedCreate = await api('/listings', {
    token: buyer,
    method: 'POST',
    body: listingBody
  });
  assert.equal(unauthorizedCreate.response.status, 403);
  const invalidCreate = await api('/listings', {
    token: owner,
    method: 'POST',
    body: { ...listingBody, quantity: 0, requestId: 'voice-invalid-request-01' }
  });
  assert.equal(invalidCreate.response.status, 400);

  const created = await api('/listings', { token: owner, method: 'POST', body: listingBody });
  assert.equal(created.response.status, 201);
  assert.equal(created.data.fisherman, 'fisherman-1');
  assert.equal(created.data.fishType, 'Tuna');
  assert.match(created.data.id, /^voice_[a-f0-9]{64}$/);

  const duplicate = await api('/listings', { token: owner, method: 'POST', body: listingBody });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.data.duplicate, true);
  assert.equal(duplicate.data.id, created.data.id);

  const reusedRequestId = await api('/listings', {
    token: owner,
    method: 'POST',
    body: { ...listingBody, salePrice: 350, expectedPrice: 350 }
  });
  assert.equal(reusedRequestId.response.status, 409);

  const buyerUpdate = await api('/listings/fixed-listing', {
    token: buyer,
    method: 'PATCH',
    body: { price: 350 }
  });
  assert.equal(buyerUpdate.response.status, 403);
  const foreignUpdate = await api('/listings/fixed-listing', {
    token: otherOwner,
    method: 'PATCH',
    body: { price: 350 }
  });
  assert.equal(foreignUpdate.response.status, 404);
  const auctionUpdate = await api('/listings/listing-auction-web', {
    token: owner,
    method: 'PATCH',
    body: { price: 350 }
  });
  assert.equal(auctionUpdate.response.status, 409);

  const priceUpdate = await api('/listings/fixed-listing', {
    token: owner,
    method: 'PATCH',
    body: { price: 350 }
  });
  assert.equal(priceUpdate.response.status, 200);
  assert.equal(priceUpdate.data.expectedPrice, 350);
  assert.equal(priceUpdate.data.salePrice, 350);
  const quantityUpdate = await api('/listings/fixed-listing', {
    token: owner,
    method: 'PATCH',
    body: { quantity: 15 }
  });
  assert.equal(quantityUpdate.response.status, 200);
  assert.equal(quantityUpdate.data.quantity, 15);
  const invalidUpdate = await api('/listings/fixed-listing', {
    token: owner,
    method: 'PATCH',
    body: { price: -1 }
  });
  assert.equal(invalidUpdate.response.status, 400);
  const unsupportedField = await api('/listings/fixed-listing', {
    token: owner,
    method: 'PATCH',
    body: { status: 'sold' }
  });
  assert.equal(unsupportedField.response.status, 400);

  const ownerListings = await api('/fisherman/listings', { token: owner });
  assert.ok(ownerListings.data.some(item => item.id === created.data.id));
  const otherListings = await api('/fisherman/listings', { token: otherOwner });
  assert.equal(otherListings.data.some(item => item.id === created.data.id), false);
});

test('buyer and fisherman role restrictions apply to voice-related marketplace endpoints', async () => {
  const buyer = await tokenFor('buyer-2@auction.test', 'buyer');
  const owner = await tokenFor('fisherman@auction.test', 'fisherman');

  const unauthenticatedCreate = await api('/listings', {
    method: 'POST',
    body: { fishType: 'Tuna' }
  });
  assert.equal(unauthenticatedCreate.response.status, 401);
  const fishermanBid = await api('/auctions/auction-live/bids', {
    token: owner,
    method: 'POST',
    body: { amount: 550, requestId: 'voice-fisherman-bid-01' }
  });
  assert.equal(fishermanBid.response.status, 403);
  const buyerListings = await api('/fisherman/listings', { token: buyer });
  assert.equal(buyerListings.response.status, 403);
});
