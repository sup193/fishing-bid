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

async function tokenFor(number = 1) {
  if (!tokens.has(number)) {
    const { response, data } = await api('/auth/login', {
      method: 'POST',
      body: { email: `buyer-${number}@auction.test`, password: 'auction-test-password' }
    });
    assert.equal(response.status, 200);
    assert.equal(data.user.role, 'buyer');
    tokens.set(number, data.token);
  }
  return tokens.get(number);
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidemarket-auction-api-test-'));
  process.env.TIDEMARKET_DATABASE = 'local';
  process.env.TIDEMARKET_LOCAL_DB_PATH = path.join(tempDir, 'local-db.json');
  process.env.JWT_SECRET = 'test-only-auction-jwt-secret';
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

test('real API login, marketplace, public auction detail and auth gates', async () => {
  const login = await api('/auth/login', {
    method: 'POST',
    body: { email: 'buyer-1@auction.test', password: 'auction-test-password' }
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.data.user.id, 'buyer-1');
  tokens.set(1, login.data.token);

  const invalidLogin = await api('/auth/login', {
    method: 'POST',
    body: { email: 'buyer-1@auction.test', password: 'incorrect' }
  });
  assert.equal(invalidLogin.response.status, 401);

  const unauthenticatedBid = await api('/auctions/auction-live/bids', {
    method: 'POST',
    body: { amount: 550, requestId: 'unauthenticated-01' }
  });
  assert.equal(unauthenticatedBid.response.status, 401);
  const invalidSession = await api('/auctions/auction-live/bids', {
    token: 'not-a-valid-session',
    method: 'POST',
    body: { amount: 550, requestId: 'invalid-session-001' }
  });
  assert.equal(invalidSession.response.status, 401);
  assert.equal((await api('/auctions/auction-live/automatic-bidding')).response.status, 401);

  const listings = await api('/listings');
  assert.equal(listings.response.status, 200);
  assert.ok(listings.data.some(item => item.auction?.id === 'auction-live'));

  const details = await api('/auctions/auction-live');
  assert.equal(details.response.status, 200);
  assert.equal(details.data.auction.currentPrice, 500);
  assert.equal(details.data.bids.length, 0);
  assert.equal(details.data.activeBidderCount, 0);
  assert.equal(details.data.auction.autoBids, undefined);
  assert.equal(details.data.auction.bidderOffers, undefined);
  assert.equal(details.data.auction.processedRequests, undefined);
  assert.equal((await api('/auctions/no-such-auction')).response.status, 404);
});

test('manual bid validation, ownership checks, request idempotency and closed auction handling', async () => {
  const buyerToken = await tokenFor(1);
  const ownerLogin = await api('/auth/login', {
    method: 'POST',
    body: { email: 'fisherman@auction.test', password: 'auction-test-password' }
  });
  assert.equal(ownerLogin.response.status, 200);
  const forbidden = await api('/auctions/auction-live/bids', {
    token: ownerLogin.data.token,
    method: 'POST',
    body: { amount: 550, requestId: 'fisherman-bid-01' }
  });
  assert.equal(forbidden.response.status, 403);

  const auctionBefore = await api('/auctions/auction-live');
  const accepted = await api('/auctions/auction-live/bids', {
    token: buyerToken,
    method: 'POST',
    body: {
      amount: 550,
      requestId: 'manual-request-001',
      winner: 'buyer-9',
      endTime: new Date(Date.now() + 10_000_000).toISOString()
    }
  });
  assert.equal(accepted.response.status, 201);
  assert.equal(accepted.data.bid.type, 'manual');
  assert.equal(accepted.data.auction.currentBidder, 'buyer-1');
  assert.equal(accepted.data.auction.winner, undefined);
  assert.equal(accepted.data.auction.endTime, auctionBefore.data.auction.endTime);

  const duplicate = await api('/auctions/auction-live/bids', {
    token: buyerToken,
    method: 'POST',
    body: { amount: 600, requestId: 'manual-request-001' }
  });
  assert.equal(duplicate.response.status, 201);
  assert.equal(duplicate.data.duplicate, true);
  assert.equal(duplicate.data.auction.currentPrice, 550);
  const historyAfterRetry = await api('/auctions/auction-live');
  assert.equal(historyAfterRetry.data.bids.length, 1);
  assert.equal(historyAfterRetry.data.auction.bidCount, 1);

  for (const amount of [0, -1, 'not-a-number', 550.001, 549]) {
    const rejected = await api('/auctions/auction-live/bids', {
      token: buyerToken,
      method: 'POST',
      body: { amount, requestId: `invalid-bid-${String(amount).replace(/\W/g, '')}` }
    });
    assert.equal(rejected.response.status, 400);
    assert.equal(typeof rejected.data.message, 'string');
  }

  const closed = await api('/auctions/auction-closed/bids', {
    token: buyerToken,
    method: 'POST',
    body: { amount: 650, requestId: 'closed-auction-001' }
  });
  assert.equal(closed.response.status, 400);
});

test('automatic bidding stays private, updates limits and resolves competing buyers', async () => {
  const buyerOne = await tokenFor(1);
  const buyerTwo = await tokenFor(2);
  const activated = await api('/auctions/auction-auto/automatic-bidding', {
    token: buyerOne,
    method: 'POST',
    body: { maxAmount: 1000, requestId: 'auto-activate-001' }
  });
  assert.equal(activated.response.status, 201);
  assert.equal(activated.data.auction.currentPrice, 550);
  assert.equal(activated.data.auction.autoBids, undefined);

  const publicState = await api('/auctions/auction-auto');
  assert.equal(publicState.response.status, 200);
  assert.equal(publicState.data.auction.bidderOffers, undefined);
  assert.equal(publicState.data.auction.autoBids, undefined);
  assert.equal(JSON.stringify(publicState.data).includes('1000'), false);

  const ownStatus = await api('/auctions/auction-auto/automatic-bidding', { token: buyerOne });
  assert.deepEqual(ownStatus.data, { enabled: true, maxAmount: 1000 });
  const otherStatus = await api('/auctions/auction-auto/automatic-bidding', { token: buyerTwo });
  assert.deepEqual(otherStatus.data, { enabled: false, maxAmount: null });

  const updateLimit = await api('/auctions/auction-auto/automatic-bidding', {
    token: buyerOne,
    method: 'POST',
    body: { maxAmount: 1200, requestId: 'auto-update-001' }
  });
  assert.equal(updateLimit.response.status, 201);
  assert.equal((await api('/auctions/auction-auto/automatic-bidding', { token: buyerOne })).data.maxAmount, 1200);
  assert.equal((await api('/auctions/auction-auto')).data.auction.currentPrice, 550);

  const competing = await api('/auctions/auction-auto/automatic-bidding', {
    token: buyerTwo,
    method: 'POST',
    body: { maxAmount: 1500, requestId: 'auto-compete-001', buyerId: 'buyer-1' }
  });
  assert.equal(competing.response.status, 201);
  assert.equal(competing.data.auction.currentBidder, 'buyer-2');
  assert.equal(competing.data.auction.currentPrice, 1250);
  assert.ok(competing.data.auction.bidCount >= 2);
  assert.ok(competing.data.auction.currentPrice <= 1500);
  assert.equal((await api('/auctions/auction-auto/automatic-bidding', { token: buyerOne })).data.maxAmount, 1200);
  assert.equal((await api('/auctions/auction-auto/automatic-bidding', { token: buyerTwo })).data.maxAmount, 1500);
  const history = await api('/auctions/auction-auto');
  assert.ok(history.data.bids.some(bid => bid.type === 'automatic'));
  assert.equal(history.data.auction.bidCount, history.data.bids.length);

  const privateHistory = await api('/buyer/history', { token: buyerOne });
  assert.equal(privateHistory.response.status, 200);
  assert.equal(JSON.stringify(privateHistory.data).includes('1200'), false);
  const notifications = await api('/notifications', { token: buyerOne });
  assert.equal(notifications.response.status, 200);
  assert.ok(notifications.data.some(item => item.type === 'outbid'));
  const otherNotifications = await api('/notifications', { token: buyerTwo });
  assert.equal(otherNotifications.data.some(item => item.user === 'buyer-1'), false);
  const fishermanLogin = await api('/auth/login', {
    method: 'POST',
    body: { email: 'fisherman@auction.test', password: 'auction-test-password' }
  });
  const fishermanNotifications = await api('/notifications', { token: fishermanLogin.data.token });
  assert.ok(fishermanNotifications.data.some(item => item.type === 'new_auction_bid' && item.auction === 'auction-auto'));
});

test('ten buyers can submit concurrent bids without corrupting price or history', async () => {
  const bidders = await Promise.all(Array.from({ length: 10 }, (_, index) => tokenFor(index + 1)));
  const responses = await Promise.all(bidders.map((token, index) => api('/auctions/auction-race/automatic-bidding', {
    token,
    method: 'POST',
    body: { maxAmount: 1000 + (index * 50), requestId: `stress-request-${index}-001` }
  })));
  assert.ok(responses.every(({ response }) => response.status === 201 || response.status === 400));
  assert.ok(responses.some(({ response }) => response.status === 201));

  const detail = await api('/auctions/auction-race');
  assert.equal(detail.response.status, 200);
  assert.ok(detail.data.auction.currentPrice >= 500);
  assert.ok(detail.data.auction.currentPrice <= 1450);
  assert.equal(detail.data.auction.bidCount, detail.data.bids.length);
  assert.ok(detail.data.activeBidderCount >= 1 && detail.data.activeBidderCount <= 10);
  assert.equal(detail.data.auction.autoBids, undefined);
  assert.ok(detail.data.auction.currentBidder?.id);
  const leaderLimit = await api('/auctions/auction-race/automatic-bidding', {
    token: await tokenFor(Number(detail.data.auction.currentBidder.id.split('-')[1]))
  });
  assert.equal(leaderLimit.data.enabled, true);
  assert.ok(detail.data.auction.currentPrice <= leaderLimit.data.maxAmount);
});

test('parallel request retries remain idempotent and final-window API bids extend the timer', async () => {
  const buyerToken = await tokenFor(1);
  const retries = await Promise.all(Array.from({ length: 10 }, () => api('/auctions/auction-retry/bids', {
    token: buyerToken,
    method: 'POST',
    body: { amount: 550, requestId: 'parallel-retry-001' }
  })));
  assert.ok(retries.every(({ response }) => response.status === 201));
  assert.equal(retries.filter(({ data }) => data.duplicate).length, 9);
  const retriedHistory = await api('/auctions/auction-retry');
  assert.equal(retriedHistory.data.bids.length, 1);
  assert.equal(retriedHistory.data.auction.bidCount, 1);

  const before = await api('/auctions/auction-late');
  const extended = await api('/auctions/auction-late/bids', {
    token: buyerToken,
    method: 'POST',
    body: { amount: 550, requestId: 'final-window-bid-001' }
  });
  assert.equal(extended.response.status, 201);
  assert.equal(extended.data.extended, true);
  assert.equal(Date.parse(extended.data.auction.endTime), Date.parse(before.data.auction.endTime) + 30_000);
});

test('settlement selects one winner and payment failure does not mark its order paid', async () => {
  const buyerOne = await tokenFor(1);
  const settled = await api('/auctions/auction-settled');
  assert.equal(settled.response.status, 200);
  assert.equal(settled.data.auction.status, 'completed');
  assert.equal(settled.data.auction.winner, 'buyer-1');
  assert.equal(settled.data.auction.winningBid, 700);
  assert.equal(settled.data.auction.order, 'auction_auction-settled');

  const history = await api('/buyer/history', { token: buyerOne });
  const order = history.data.orders.find(item => item.id === 'auction_auction-settled');
  assert.ok(order);
  assert.equal(order.amount, 8400);
  assert.equal(order.paymentStatus, 'pending');
  assert.equal(order.orderStatus, 'awaiting-checkout');
  const loserHistory = await api('/buyer/history', { token: await tokenFor(2) });
  assert.equal(loserHistory.data.orders.some(item => item.id === 'auction_auction-settled'), false);
  await api('/auctions/auction-settled');
  const repeatedSettlement = await api('/buyer/history', { token: buyerOne });
  assert.equal(repeatedSettlement.data.orders.filter(item => item.id === 'auction_auction-settled').length, 1);

  const invalidAuction = await api('/auctions/auction-invalid');
  assert.equal(invalidAuction.response.status, 200);
  assert.equal(invalidAuction.data.auction.status, 'active');
  assert.equal(invalidAuction.data.auction.winner, undefined);
  const invalidOrders = await api('/buyer/history', { token: buyerOne });
  assert.equal(invalidOrders.data.orders.some(item => item.id === 'auction_auction-invalid'), false);
  await api('/auctions/auction-invalid-completed');
  assert.equal((await api('/buyer/history', { token: buyerOne })).data.orders.some(item => item.id === 'auction_auction-invalid-completed'), false);
  await api('/auctions/auction-invalid-quantity');
  assert.equal((await api('/buyer/history', { token: buyerOne })).data.orders.some(item => item.id === 'auction_auction-invalid-quantity'), false);

  const unauthorizedFailure = await api('/payments/razorpay/failure', {
    token: await tokenFor(2),
    method: 'POST',
    body: { transactionId: 'settlement-payment', reason: 'test ownership' }
  });
  assert.equal(unauthorizedFailure.response.status, 404);

  const paymentFailure = await api('/payments/razorpay/failure', {
    token: buyerOne,
    method: 'POST',
    body: { transactionId: 'settlement-payment', reason: 'isolated test failure' }
  });
  assert.equal(paymentFailure.response.status, 200);
  const historyAfterFailure = await api('/buyer/history', { token: buyerOne });
  const failedOrder = historyAfterFailure.data.orders.find(item => item.id === 'auction_auction-settled');
  assert.equal(failedOrder.paymentStatus, 'failed');
  assert.equal(failedOrder.orderStatus, 'payment-failed');
  assert.notEqual(failedOrder.paymentStatus, 'paid');
});

test('automatic bidding can be capped by a buyer-private total budget', async () => {
  const buyerToken = await tokenFor(3);
  const tooSmall = await api('/auctions/auction-mobile/automatic-bidding', {
    token: buyerToken,
    method: 'POST',
    body: { totalBudget: 5000, requestId: 'budget-too-small-001' }
  });
  assert.equal(tooSmall.response.status, 400);

  const activated = await api('/auctions/auction-mobile/automatic-bidding', {
    token: buyerToken,
    method: 'POST',
    body: { totalBudget: 8000, requestId: 'budget-activate-001' }
  });
  assert.equal(activated.response.status, 201);
  assert.ok(activated.data.bid.amount * 12 <= 8000);
  assert.equal(activated.data.auction.autoBids, undefined);
  assert.deepEqual((await api('/auctions/auction-mobile/automatic-bidding', { token: buyerToken })).data, {
    enabled: true,
    maxAmount: 666.66,
    totalBudget: 8000
  });
  assert.equal((await api('/auctions/auction-mobile/automatic-bidding', { token: await tokenFor(4) })).data.enabled, false);
});

test('auction insights are authenticated, use preliminary history honestly and include existing market estimates', async () => {
  const before = await api('/auctions/auction-insights');
  const insight = await api('/auctions/auction-insights/insights', { token: await tokenFor(1) });
  assert.equal(insight.response.status, 200);
  assert.equal(insight.data.confidence, 'low');
  assert.equal(insight.data.verifiedHistoricalAuctionCount, 0);
  assert.equal(insight.data.priceEstimate.reliability, 'preliminary');
  assert.equal(insight.data.demand.dataAvailability, 'insufficient_data');
  assert.equal(JSON.stringify(insight.data).includes('autoBids'), false);
  assert.equal((await api('/auctions/auction-insights/insights')).response.status, 401);
  const after = await api('/auctions/auction-insights');
  assert.equal(after.data.auction.currentPrice, before.data.auction.currentPrice);
  assert.equal(after.data.bids.length, before.data.bids.length);

  const fisherman = await api('/auth/login', {
    method: 'POST',
    body: { email: 'fisherman@auction.test', password: 'auction-test-password' }
  });
  assert.equal((await api('/auctions/auction-insights/insights', { token: fisherman.data.token })).response.status, 403);
});

test('auction chat validates messages, limits rate, and supports report moderation', async () => {
  const buyerOne = await tokenFor(5);
  const sent = await api('/auctions/auction-web/chat', {
    token: buyerOne,
    method: 'POST',
    body: { content: 'Is this catch available for pickup today?' }
  });
  assert.equal(sent.response.status, 201);
  assert.equal(sent.data.authorName, 'Test Buyer 5');
  assert.equal(sent.data.author, undefined);
  assert.equal((await api('/auctions/auction-web/chat', { token: buyerOne })).data[0].content, sent.data.content);

  const phone = await api('/auctions/auction-web/chat', {
    token: await tokenFor(6),
    method: 'POST',
    body: { content: 'Call me at 9876543210' }
  });
  assert.equal(phone.response.status, 400);
  const fastRepeat = await api('/auctions/auction-web/chat', {
    token: buyerOne,
    method: 'POST',
    body: { content: 'A second message too soon' }
  });
  assert.equal(fastRepeat.response.status, 429);

  const report = await api(`/auctions/auction-web/chat/${sent.data.id}/report`, {
    token: await tokenFor(6),
    method: 'POST',
    body: { reason: 'Please review this message' }
  });
  assert.equal(report.response.status, 201);
  const adminLogin = await api('/auth/login', {
    method: 'POST',
    body: { email: 'tide@gmail.com', password: 'Tide@123' }
  });
  const reports = await api('/admin/auction-chat/reports', { token: adminLogin.data.token });
  assert.ok(reports.data.some(item => item.message?.id === sent.data.id));
  const moderated = await api(`/admin/auction-chat/${sent.data.id}/moderation`, {
    token: adminLogin.data.token,
    method: 'PATCH',
    body: { status: 'hidden', moderationNote: 'Test moderation' }
  });
  assert.equal(moderated.response.status, 200);
  assert.deepEqual((await api('/auctions/auction-web/chat', { token: await tokenFor(7) })).data, []);

  const listingFisherman = await api('/auth/login', {
    method: 'POST',
    body: { email: 'fisherman@auction.test', password: 'auction-test-password' }
  });
  assert.equal((await api('/auctions/auction-web/chat', { token: listingFisherman.data.token })).response.status, 200);
  const fishermanMessage = await api('/auctions/auction-web/chat', {
    token: listingFisherman.data.token,
    method: 'POST',
    body: { content: 'This catch is ready for pickup today.' }
  });
  assert.equal(fishermanMessage.response.status, 201);

  const unrelatedFisherman = await api('/auth/login', {
    method: 'POST',
    body: { email: 'other-fisherman@auction.test', password: 'auction-test-password' }
  });
  assert.equal((await api('/auctions/auction-web/chat', { token: unrelatedFisherman.data.token })).response.status, 403);
  assert.equal((await api('/auctions/auction-web/chat', {
    token: unrelatedFisherman.data.token,
    method: 'POST',
    body: { content: 'I do not own this catch.' }
  })).response.status, 403);
});

test('auction analytics are admin-only, filterable, and do not expose bidder IDs', async () => {
  const buyer = await tokenFor(8);
  assert.equal((await api('/admin/auction-analytics', { token: buyer })).response.status, 403);
  const adminLogin = await api('/auth/login', {
    method: 'POST',
    body: { email: 'tide@gmail.com', password: 'Tide@123' }
  });
  const analytics = await api('/admin/auction-analytics?fishType=Tuna', { token: adminLogin.data.token });
  assert.equal(analytics.response.status, 200);
  assert.ok(analytics.data.summary.totalAuctions > 0);
  assert.ok(analytics.data.bySpecies.every(item => item.fishType === 'Tuna'));
  assert.equal(JSON.stringify(analytics.data).includes('buyer-'), false);
  assert.equal((await api('/admin/auction-analytics?from=bad-date', { token: adminLogin.data.token })).response.status, 400);
  assert.equal((await api('/admin/auction-analytics?category=unlisted', { token: adminLogin.data.token })).response.status, 400);
});

test('only admins may remove a listing, and removing an active auction closes it', async () => {
  const listingId = 'listing-auction-notifications';
  const buyerToken = await tokenFor(9);
  const adminLogin = await api('/auth/login', {
    method: 'POST',
    body: { email: 'tide@gmail.com', password: 'Tide@123' }
  });

  const forbidden = await api(`/admin/listings/${listingId}`, {
    token: buyerToken,
    method: 'DELETE'
  });
  assert.equal(forbidden.response.status, 403);
  const before = await api('/admin/listings', { token: adminLogin.data.token });
  assert.equal(before.data.find(item => item.id === listingId).status, 'auction');

  const removed = await api(`/admin/listings/${listingId}`, {
    token: adminLogin.data.token,
    method: 'DELETE'
  });
  assert.equal(removed.response.status, 200);
  assert.equal(removed.data.listing.status, 'removed');
  assert.equal(removed.data.listing.removedBy, adminLogin.data.user.id);
  const after = await api('/admin/listings', { token: adminLogin.data.token });
  const updatedListing = after.data.find(item => item.id === listingId);
  assert.equal(updatedListing.status, 'removed');
  assert.equal(updatedListing.auction.status, 'cancelled');
  assert.equal(updatedListing.auction.cancelledBy, adminLogin.data.user.id);
  assert.equal((await api('/listings')).data.some(item => item.id === listingId), false);
  assert.equal((await api(`/admin/listings/${listingId}`, {
    token: adminLogin.data.token,
    method: 'DELETE'
  })).response.status, 404);
});
