import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeAuctionActivity,
  buildAuctionAnalytics,
  buildAuctionInsights
} from '../src/auctionInsights.js';

const auction = {
  id: 'auction-1',
  startPrice: 500,
  currentPrice: 600,
  minimumIncrement: 50,
  status: 'active'
};
const listing = { id: 'listing-1', fishType: 'Pomfret' };

test('auction guidance uses a transparent low-confidence fallback without verified history', () => {
  const insight = buildAuctionInsights({
    auction,
    listing,
    bids: [{ buyer: 'buyer-1' }]
  });
  assert.equal(insight.confidence, 'low');
  assert.equal(insight.method, 'current_bid_activity_baseline');
  assert.equal(insight.nextMinimumBidPerKg, 650);
  assert.deepEqual(insight.estimatedFinalPricePerKg, { minimumPerKg: 600, maximumPerKg: 650 });
  assert.equal(insight.verifiedHistoricalAuctionCount, 0);
});

test('auction guidance uses verified-species percentiles after five sales', () => {
  const insight = buildAuctionInsights({
    auction,
    listing,
    verifiedSales: [500, 550, 600, 650, 700].map((pricePerKg, index) => ({
      auctionId: `past-${index}`,
      fishType: 'Pomfret',
      pricePerKg
    }))
  });
  assert.equal(insight.confidence, 'moderate');
  assert.equal(insight.method, 'verified_completed_auction_percentiles');
  assert.equal(insight.verifiedHistoricalAuctionCount, 5);
  assert.equal(insight.historicalMedianPerKg, 600);
  assert.deepEqual(insight.estimatedFinalPricePerKg, { minimumPerKg: 600, maximumPerKg: 650 });
});

test('auction activity marks concentration for human review but never blocks it', () => {
  const bids = Array.from({ length: 6 }, (_, index) => ({ buyer: index < 5 ? 'buyer-1' : 'buyer-2' }));
  const activity = analyzeAuctionActivity(bids);
  assert.equal(activity.reviewNeeded, true);
  assert.ok(activity.flags.some(flag => flag.code === 'bid_concentration'));
  assert.equal(activity.bidCount, 6);
});

test('admin summary aggregates auctions and species without exposing buyer identifiers', () => {
  const summary = buildAuctionAnalytics({
    auctions: [{ ...auction, listing: 'listing-1' }, { id: 'auction-2', listing: 'listing-2', status: 'completed' }],
    listings: [listing, { id: 'listing-2', fishType: 'Tuna', location: 'Port A' }],
    bids: [{ id: 'bid-1', auction: 'auction-1', buyer: 'private-buyer-id' }]
  });
  assert.deepEqual(summary.summary, {
    totalAuctions: 2,
    activeAuctions: 1,
    completedAuctions: 1,
    totalBids: 1,
    flaggedAuctions: 0
  });
  assert.deepEqual(summary.byLocation.map(item => item.location), ['Location unavailable', 'Port A']);
  assert.equal(JSON.stringify(summary).includes('private-buyer-id'), false);
});
