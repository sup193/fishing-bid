import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateVerifiedDemand,
  buildDemandInsights,
  evaluateDemandForecast,
  normalizeDemandFilters
} from '../src/demandForecast.js';

const now = Date.parse('2026-11-19T12:00:00.000Z');
const listing = {
  id: 'listing-tuna',
  fishType: 'Tuna',
  location: 'Mangaluru',
  quantity: 20,
  status: 'available'
};

function paidOrder(id, day, quantity = 10, extra = {}) {
  return {
    id,
    listing: listing.id,
    buyer: `buyer-${id}`,
    quantity,
    amount: quantity * 400,
    paymentStatus: 'paid',
    gateway: 'razorpay',
    transactionRef: `pay-${id}`,
    paidAt: `${day}T12:00:00.000Z`,
    ...extra
  };
}

function saleDays(count, quantity = 10, firstDay = '2026-11-01') {
  const first = Date.parse(`${firstDay}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, index) => paidOrder(
    `sale-${index}`,
    new Date(first + index * 86400000).toISOString().slice(0, 10),
    quantity
  ));
}

test('aggregates only verified paid sale quantities and never returns buyer identifiers', () => {
  const orders = [
    paidOrder('real', '2026-11-18', 12),
    paidOrder('no-reference', '2026-11-18', 100, { transactionRef: '' }),
    paidOrder('demo', '2026-11-18', 100, { demo: true }),
    paidOrder('unpaid', '2026-11-18', 100, { paymentStatus: 'pending' }),
    paidOrder('future', '2026-11-20', 100)
  ];

  const result = aggregateVerifiedDemand({ orders, listings: [listing], now });

  assert.equal(result.length, 1);
  assert.equal(result[0].quantityKg, 12);
  assert.equal(result[0].saleCount, 1);
  assert.equal(JSON.stringify(result).includes('buyer-real'), false);
});

test('builds daily, weekly, and monthly history and 24-hour, 7-day, and 30-day forecasts', () => {
  const orders = saleDays(90, 10, '2026-08-22');
  const result = buildDemandInsights({ orders, listings: [listing], now });
  const tuna = result.species.find(item => item.fishType === 'Tuna');

  assert.equal(tuna.forecast.next24Hours.status, 'forecast');
  assert.equal(tuna.forecast.next24Hours.expectedQuantityKg, 10);
  assert.equal(tuna.forecast.next7Days.expectedQuantityKg, 70);
  assert.equal(tuna.forecast.next30Days.expectedQuantityKg, 300);
  assert.equal(tuna.forecast.next7Days.demandIndex, 100);
  assert.equal(result.demandHistory.daily.length, 90);
  assert.ok(result.demandHistory.weekly.length > 1);
  assert.ok(result.demandHistory.monthly.length > 1);
});

test('returns an explicit insufficient-data state instead of manufacturing a forecast', () => {
  const result = buildDemandInsights({
    orders: [paidOrder('one', '2026-11-18')],
    listings: [listing],
    now
  });
  const tuna = result.species.find(item => item.fishType === 'Tuna');

  assert.equal(tuna.forecast.next7Days.status, 'insufficient_data');
  assert.equal(tuna.forecast.next7Days.expectedQuantityKg, null);
  assert.equal(tuna.forecast.next7Days.confidence, 'insufficient_data');
  assert.equal(result.model.status, 'insufficient_data');
});

test('filters forecasts by location, species, category, and date without returning personal data', () => {
  const otherListing = { ...listing, id: 'listing-prawns', fishType: 'Prawns', location: 'Udupi' };
  const orders = [
    ...saleDays(10),
    ...saleDays(10, 4, '2026-11-05').map((order, index) => ({
      ...order,
      id: `prawns-${index}`,
      listing: otherListing.id,
      buyer: `private-buyer-${index}`
    }))
  ];
  const result = buildDemandInsights({
    orders,
    listings: [listing, otherListing],
    filters: { category: 'Prawns', location: 'Udupi', from: '2026-11-05', to: '2026-11-18' },
    now
  });

  assert.deepEqual(result.species.map(item => item.fishType), ['Prawns']);
  assert.equal(result.species[0].totalQuantityKg, 40);
  assert.equal(JSON.stringify(result).includes('private-buyer-'), false);
});

test('rejects invalid species, category, and date filters', () => {
  assert.throws(() => normalizeDemandFilters({ fishType: 'Imaginary Fish' }, now), { status: 400 });
  assert.throws(() => normalizeDemandFilters({ category: 'Other' }, now), { status: 400 });
  assert.throws(() => normalizeDemandFilters({ from: '2026-02-30' }, now), { status: 400 });
  assert.throws(() => normalizeDemandFilters({ from: '2026-11-01', to: '2026-10-31' }, now), { status: 400 });
  assert.throws(() => normalizeDemandFilters({ to: '2026-11-20' }, now), { status: 400 });
});

test('caps fisherman suggested quantities to recorded available catch and keeps them advisory', () => {
  const fishermanListings = [
    { ...listing, fisherman: 'seller-1', quantity: 12, status: 'available' },
    { ...listing, id: 'seller-tuna-auction', fisherman: 'seller-1', quantity: 5, status: 'auction' }
  ];
  const result = buildDemandInsights({
    orders: saleDays(14, 100),
    listings: fishermanListings,
    fishermanId: 'seller-1',
    now
  });
  const recommendation = result.recommendations[0];

  assert.equal(recommendation.recommendation.availableCatchKg, 17);
  assert.ok(recommendation.recommendation.suggestedListingKg <= 17);
  assert.match(recommendation.recommendation.explanation, /Advisory only/);
});

test('walk-forward performance uses only preceding days and reports errors only with enough held-out data', () => {
  const observations = saleDays(365, 5, '2025-11-19');
  const result = evaluateDemandForecast({ orders: observations, listings: [listing], now });
  const insufficient = evaluateDemandForecast({
    orders: saleDays(5, 5, '2026-11-10'),
    listings: [listing],
    now
  });

  assert.equal(result.status, 'evaluated');
  assert.equal(result.metrics.evaluatedDays, 337);
  assert.equal(result.metrics.maeKg, 0);
  assert.match(result.method, /preceding 28 days/);
  assert.equal(insufficient.status, 'insufficient_data');
  assert.equal(insufficient.metrics, null);
});
