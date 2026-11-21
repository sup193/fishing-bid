import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAuctionOffer, auctionOfferError, publicAuction, recalculateAuctionOffers } from '../src/auctionBidding.js';

const now = Date.parse('2026-11-16T12:00:00.000Z');
const makeAuction = (overrides = {}) => ({
  id: 'auction-1',
  status: 'active',
  startTime: new Date(now - 60_000).toISOString(),
  endTime: new Date(now + 3_600_000).toISOString(),
  startPrice: 500,
  currentPrice: 500,
  minimumIncrement: 50,
  currentBidder: null,
  bidderOffers: {},
  autoBids: {},
  bidHistory: {},
  processedRequests: {},
  ...overrides
});

function offer(auction, buyerId, amount, mode, time = now, requestId = `${buyerId}-${time}`) {
  const result = applyAuctionOffer(auction, {
    buyerId,
    amount,
    mode,
    bidId: `bid-${buyerId}-${time}`,
    requestId,
    now: time
  });
  assert.equal(result.error, undefined);
  return result;
}

test('accepts a manual bid at the minimum increment and rejects a lower bid', () => {
  const initial = makeAuction();
  const rejected = applyAuctionOffer(initial, { buyerId: 'buyer-a', amount: 549, mode: 'manual', bidId: 'low', requestId: 'low-request', now });
  assert.match(rejected.error, /550/);

  const accepted = offer(initial, 'buyer-a', 550, 'manual');
  assert.equal(accepted.auction.currentPrice, 550);
  assert.equal(accepted.auction.currentBidder, 'buyer-a');
  assert.equal(accepted.bid.type, 'manual');
});

test('rejects zero, negative, non-numeric and sub-cent bid amounts', () => {
  for (const amount of [0, -50, Number.NaN, Number.POSITIVE_INFINITY, 550.001]) {
    const result = applyAuctionOffer(makeAuction(), {
      buyerId: 'buyer-a',
      amount,
      mode: 'manual',
      bidId: `invalid-${String(amount)}`,
      requestId: `invalid-${String(amount)}`,
      now
    });
    assert.match(result.error, /Bid amount/);
  }
});

test('automatic bidding starts at the necessary increment, not the buyer maximum', () => {
  const result = offer(makeAuction(), 'buyer-a', 1000, 'automatic');
  assert.equal(result.auction.currentPrice, 550);
  assert.equal(result.auction.autoBids['buyer-a'].amount, 1000);
  assert.equal(result.bid.amount, 550);
});

test('automatic bidding retains the buyer-private total budget beside its per-kilogram cap', () => {
  const result = applyAuctionOffer(makeAuction(), {
    buyerId: 'buyer-a',
    amount: 666.66,
    totalBudget: 8000,
    mode: 'automatic',
    bidId: 'budget-bid',
    requestId: 'budget-request',
    now
  });
  assert.equal(result.error, undefined);
  assert.equal(result.auction.autoBids['buyer-a'].amount, 666.66);
  assert.equal(result.auction.autoBids['buyer-a'].totalBudget, 8000);
  assert.equal(publicAuction(result.auction).autoBids, undefined);
});

test('competing automatic bidders raise only as needed and respect both limits', () => {
  const first = offer(makeAuction(), 'buyer-a', 1000, 'automatic');
  const second = offer(first.auction, 'buyer-b', 1500, 'automatic', now + 1);
  assert.equal(second.auction.currentBidder, 'buyer-b');
  assert.equal(second.auction.currentPrice, 1050);
  assert.ok(first.bid.amount <= first.auction.autoBids['buyer-a'].amount);
  assert.ok(second.bid.amount <= second.auction.autoBids['buyer-b'].amount);
  assert.equal(second.bid.type, 'automatic');
});

test('an automatic bidder can reach but never exceed its maximum', () => {
  const first = offer(makeAuction(), 'buyer-a', 550, 'automatic');
  assert.equal(first.auction.currentPrice, 550);
  const next = offer(first.auction, 'buyer-b', 600, 'manual', now + 1);
  assert.equal(next.auction.currentBidder, 'buyer-b');
  assert.equal(first.auction.autoBids['buyer-a'].amount, 550);
  assert.equal(first.auction.currentPrice, 550);
});

test('equal maximum bids preserve the earlier eligible bidder as leader', () => {
  const first = offer(makeAuction(), 'buyer-a', 1000, 'automatic');
  const tied = offer(first.auction, 'buyer-b', 1000, 'automatic', now);
  assert.equal(tied.auction.currentBidder, 'buyer-a');
  assert.equal(tied.auction.currentPrice, 1000);
});

test('updating an automatic maximum changes the private limit without reducing price', () => {
  const first = offer(makeAuction(), 'buyer-a', 1000, 'automatic');
  const updated = offer(first.auction, 'buyer-a', 1200, 'automatic', now + 1, 'update-limit');
  assert.equal(updated.auction.autoBids['buyer-a'].amount, 1200);
  assert.equal(updated.auction.bidderOffers['buyer-a'].amount, 1200);
  assert.equal(updated.auction.currentPrice, 550);
  assert.equal(updated.auction.currentBidder, 'buyer-a');
});

test('reports the previous leader when a competing offer takes the lead', () => {
  const first = offer(makeAuction(), 'buyer-a', 600, 'manual');
  const second = offer(first.auction, 'buyer-b', 700, 'manual', now + 1);
  assert.equal(second.previousBidder, 'buyer-a');
  assert.equal(second.auction.currentBidder, 'buyer-b');
});

test('rejects bids after expiry or before the scheduled start', () => {
  const ended = makeAuction({ endTime: new Date(now).toISOString() });
  assert.match(auctionOfferError(ended, now), /closed/);
  const scheduled = makeAuction({ startTime: new Date(now + 1000).toISOString() });
  assert.match(auctionOfferError(scheduled, now), /not started/);
});

test('extends the authoritative timer by 30 seconds for a final-window bid', () => {
  const finalWindow = makeAuction({ endTime: new Date(now + 29_000).toISOString() });
  const result = offer(finalWindow, 'buyer-a', 550, 'manual');
  assert.equal(Date.parse(result.auction.endTime), now + 59_000);
  assert.equal(result.extended, true);

  const outsideWindow = makeAuction({ endTime: new Date(now + 31_000).toISOString() });
  assert.equal(offer(outsideWindow, 'buyer-a', 550, 'manual').extended, false);
});

test('each qualifying final-window bid extends the current end time by 30 seconds', () => {
  const auction = makeAuction({ endTime: new Date(now + 10_000).toISOString() });
  const first = offer(auction, 'buyer-a', 550, 'manual');
  const second = offer(first.auction, 'buyer-b', 600, 'manual', now + 15_000);
  assert.equal(Date.parse(first.auction.endTime), now + 40_000);
  assert.equal(Date.parse(second.auction.endTime), now + 70_000);
  assert.equal(second.extended, true);
});

test('a late request cannot reopen an auction after its current end time', () => {
  const expired = makeAuction({ endTime: new Date(now - 1).toISOString() });
  const result = applyAuctionOffer(expired, {
    buyerId: 'buyer-a',
    amount: 550,
    mode: 'manual',
    bidId: 'expired-late-bid',
    requestId: 'expired-late-request',
    now
  });
  assert.match(result.error, /closed/);
  assert.equal(expired.endTime, new Date(now - 1).toISOString());
  assert.equal(Object.keys(expired.bidHistory).length, 0);
});

test('retains both bids when concurrent requests are serialized on current auction state', async () => {
  let state = makeAuction();
  const place = async (buyerId, amount, time) => {
    const result = offer(state, buyerId, amount, 'manual', time);
    state = result.auction;
  };
  await Promise.all([
    place('buyer-a', 550, now),
    place('buyer-b', 600, now + 1)
  ]);
  assert.equal(state.currentBidder, 'buyer-b');
  assert.equal(Object.keys(state.bidHistory).length, 2);
});

test('settlement reads the final transactional leader and winning price', () => {
  const first = offer(makeAuction(), 'buyer-a', 1000, 'automatic');
  const final = offer(first.auction, 'buyer-b', 1500, 'automatic', now + 1);
  const settled = recalculateAuctionOffers(final.auction, 'settle-check', now + 2).auction;
  assert.equal(settled.currentBidder, 'buyer-b');
  assert.equal(settled.currentPrice, 1050);
});

test('request IDs prevent a repeated request from placing a second bid', () => {
  const first = offer(makeAuction(), 'buyer-a', 550, 'manual', now, 'retry-key');
  const retry = applyAuctionOffer(first.auction, {
    buyerId: 'buyer-a',
    amount: 600,
    mode: 'manual',
    bidId: 'retry-bid',
    requestId: 'retry-key',
    now: now + 1
  });
  assert.equal(retry.duplicate, true);
  assert.equal(retry.auction.currentPrice, 550);
  assert.equal(Object.keys(retry.auction.bidHistory).length, 1);
});

test('request IDs are scoped to a buyer', () => {
  const first = offer(makeAuction(), 'buyer-a', 550, 'manual', now, 'shared-request');
  const otherBuyer = offer(first.auction, 'buyer-b', 600, 'manual', now + 1, 'shared-request');
  assert.equal(otherBuyer.duplicate, false);
  assert.equal(otherBuyer.auction.currentBidder, 'buyer-b');
  assert.equal(Object.keys(otherBuyer.auction.bidHistory).length, 2);
});

test('public auction data never includes automatic limits or private offer records', () => {
  const auction = makeAuction({
    autoBids: { 'buyer-a': { amount: 1500 } },
    bidderOffers: { 'buyer-a': { amount: 1500 } },
    processedRequests: { secretRequestKey: 'secretBidId' },
    bidHistory: { publicBid: { buyer: 'buyer-a', amount: 550 } }
  });
  const visible = publicAuction(auction);
  assert.equal(visible.autoBids, undefined);
  assert.equal(visible.bidderOffers, undefined);
  assert.equal(visible.processedRequests, undefined);
  assert.equal(visible.bidHistory, undefined);
  assert.equal(visible.currentPrice, 500);
});
