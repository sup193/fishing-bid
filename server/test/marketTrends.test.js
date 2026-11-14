import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMarketTrendPoints } from '../src/marketTrends.js';

const startTime = Date.parse('2026-11-07T00:00:00.000Z');
const observedAt = '2026-11-10T12:00:00.000Z';

test('separates auction, fixed-price, and verified paid sale prices per kg', () => {
  const listings = [
    { id: 'auction-listing', fishType: 'Tuna', saleMode: 'bid', expectedPrice: 300, createdAt: observedAt },
    { id: 'market-listing', fishType: 'Tuna', saleMode: 'sale', salePrice: 180, createdAt: observedAt }
  ];
  const points = buildMarketTrendPoints({
    listings,
    auctions: [{ id: 'auction-1', listing: 'auction-listing', startPrice: 300 }],
    bids: [{ auction: 'auction-1', amount: 420, createdAt: '2026-11-10T12:01:00.000Z' }],
    orders: [
      { id: 'paid-order', listing: 'market-listing', quantity: 2, amount: 360, paymentStatus: 'paid', gateway: 'razorpay', paidAt: observedAt },
      { id: 'pending-order', listing: 'market-listing', quantity: 2, amount: 900, paymentStatus: 'pending', gateway: 'razorpay', paidAt: observedAt },
      { id: 'practice-order', listing: 'market-listing', quantity: 2, amount: 1200, paymentStatus: 'paid', gateway: 'practice', paidAt: observedAt }
    ],
    startTime
  });
  const bySource = new Map(points.map(point => [point.source, point]));

  assert.equal(points.length, 3);
  assert.equal(bySource.get('auction').averagePrice, 420);
  assert.equal(bySource.get('market').averagePrice, 180);
  assert.equal(bySource.get('sales').averagePrice, 180);
  assert.equal(bySource.get('sales').observations, 1);
});

test('ignores paid orders outside the range and records without a valid quantity', () => {
  const listing = { id: 'market-listing', fishType: 'Prawns', saleMode: 'sale', salePrice: 600, createdAt: '2026-11-06T12:00:00.000Z' };
  const points = buildMarketTrendPoints({
    listings: [listing],
    auctions: [],
    bids: [],
    orders: [
      { id: 'old-order', listing: listing.id, quantity: 1, amount: 600, paymentStatus: 'paid', gateway: 'razorpay', paidAt: '2026-11-06T18:00:00.000Z' },
      { id: 'invalid-order', listing: listing.id, quantity: 0, amount: 600, paymentStatus: 'paid', gateway: 'razorpay', paidAt: observedAt }
    ],
    startTime
  });

  assert.deepEqual(points, []);
});
