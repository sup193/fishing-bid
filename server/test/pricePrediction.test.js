import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPricePrediction,
  evaluatePriceModels,
  fitLinearRegression,
  normalizePredictionInput,
  verifiedSaleObservations
} from '../src/pricePrediction.js';

test('validates prediction inputs and accepts optional seasonal and location details', () => {
  assert.deepEqual(normalizePredictionInput({
    fishType: 'Tuna', quantity: '12', quality: 'Premium', size: 'Large',
    location: 'Mangaluru', freshness: 'same_day', seasonMonth: '5'
  }), {
    fishType: 'Tuna', quantity: 12, quality: 'Premium', size: 'Large',
    location: 'Mangaluru', freshness: 'same_day', seasonMonth: 5
  });
  assert.throws(() => normalizePredictionInput({ fishType: 'Unknown', quantity: 1 }), { status: 400 });
  assert.throws(() => normalizePredictionInput({ fishType: 'Tuna', quantity: 0 }), { status: 400 });
  assert.throws(() => normalizePredictionInput({ fishType: 'Tuna', quantity: 1, seasonMonth: 13 }), { status: 400 });
});

test('excludes demo, unverified, and malformed transactions from price history', () => {
  const listings = [
    { id: 'real', fishType: 'Tuna', location: 'Mangaluru', quantity: 2 },
    { id: 'demo-listing', fishType: 'Tuna', location: 'Mangaluru', demo: true }
  ];
  const orders = [
    { id: 'verified', listing: 'real', quantity: 2, amount: 800, paymentStatus: 'paid', gateway: 'razorpay', transactionRef: 'pay_1', paidAt: '2026-03-01T00:00:00.000Z' },
    { id: 'without-reference', listing: 'real', quantity: 2, amount: 900, paymentStatus: 'paid', gateway: 'razorpay', paidAt: '2026-03-01T00:00:00.000Z' },
    { id: 'demo', listing: 'real', quantity: 2, amount: 1000, paymentStatus: 'paid', gateway: 'razorpay', transactionRef: 'pay_demo', demo: true, paidAt: '2026-03-01T00:00:00.000Z' },
    { id: 'demo-listing-sale', listing: 'demo-listing', quantity: 2, amount: 1000, paymentStatus: 'paid', gateway: 'razorpay', transactionRef: 'pay_2', paidAt: '2026-03-01T00:00:00.000Z' }
  ];

  const observations = verifiedSaleObservations(orders, listings);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].pricePerKg, 400);
});

test('returns a clearly preliminary baseline when there is no verified price history', () => {
  const prediction = createPricePrediction({
    fishType: 'Prawns', quantity: 10, quality: 'Good', size: 'Medium', location: 'Mangaluru'
  }, [], null, Date.parse('2026-04-01T00:00:00.000Z'));

  assert.equal(prediction.reliability, 'preliminary');
  assert.equal(prediction.model.status, 'preliminary');
  assert.equal(prediction.model.trainingSampleCount, 0);
  assert.equal(prediction.trend.reliability, 'insufficient_data');
  assert.equal(prediction.estimatedTotal, prediction.estimatePerKg * 10);
  assert.match(prediction.disclaimer, /not a guaranteed sale price/i);
});

test('uses location and seasonal adjustments only when verified samples are sufficient', () => {
  const paidAt = Date.parse('2026-05-01T00:00:00.000Z');
  const observations = Array.from({ length: 10 }, (_, index) => ({
    fishType: 'Tuna',
    location: index < 5 ? 'mangaluru' : 'other-port',
    pricePerKg: index < 5 ? 500 : 300,
    month: index < 5 ? 5 : 4,
    paidAt: paidAt - index * 86400000
  }));
  const prediction = createPricePrediction({
    fishType: 'Tuna', quantity: 5, quality: 'Good', size: 'Medium',
    location: 'Mangaluru', freshness: 'fresh', seasonMonth: 5
  }, observations, null, paidAt);

  assert.equal(prediction.factors.find(item => item.name === 'Location').applied, true);
  assert.equal(prediction.factors.find(item => item.name === 'Season').applied, true);
  assert.ok(prediction.estimatePerKg > 360);
});

test('fits and evaluates regression against a chronological held-out baseline', () => {
  assert.deepEqual(fitLinearRegression([
    { baseline: 100, actual: 120 },
    { baseline: 200, actual: 220 },
    { baseline: 300, actual: 320 }
  ]), { slope: 1, intercept: 20 });

  const observations = Array.from({ length: 50 }, (_, index) => {
    const fishType = index % 2 ? 'Tuna' : 'Prawns';
    const quality = index % 3 ? 'Good' : 'Premium';
    const size = index % 4 ? 'Medium' : 'Large';
    const quantity = index + 1;
    const { low, high } = (fishType === 'Tuna' ? { low: 360 * 0.92, high: 360 * 1.08 } : { low: 600 * 0.92, high: 600 * 1.08 });
    const multipliers = { Premium: 1.18, Good: 1, Large: 1.12, Medium: 1 };
    const baseline = (low + high) / 2 * multipliers[quality] * multipliers[size] * (quantity > 200 ? 0.98 : 1);
    return {
      fishType, quality, size, quantity,
      pricePerKg: baseline * 1.1,
      paidAt: Date.parse('2026-01-01T00:00:00.000Z') + index * 86400000
    };
  });
  const evaluation = evaluatePriceModels(observations);

  assert.equal(evaluation.status, 'evaluated');
  assert.equal(evaluation.sampleCount, 50);
  assert.equal(evaluation.testCount, 10);
  assert.equal(evaluation.selectedModel, 'linear_regression');
});

test('does not fit or report validation metrics with insufficient sale history', () => {
  const evaluation = evaluatePriceModels([]);
  assert.equal(evaluation.status, 'insufficient_data');
  assert.equal(evaluation.sampleCount, 0);
  assert.equal(evaluation.requiredSampleCount, 50);
});
