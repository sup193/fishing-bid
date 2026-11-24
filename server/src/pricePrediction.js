import { get, insert, list } from './db.js';
import { isVerifiedPaidOrder } from './reputation.js';
import { FISH_TYPES, QUALITIES, SIZES, predictPrice } from './utils.js';

export const MIN_VERIFIED_SALES_FOR_MODEL = 50;
const MIN_SEGMENT_SAMPLES = 5;
const MAX_ADJUSTMENT = 1.2;
const MIN_ADJUSTMENT = 0.8;
const FRESHNESS_LEVELS = ['same_day', 'fresh', 'chilled', 'frozen'];

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const round = value => Number(value.toFixed(2));
const clamp = (value, min = MIN_ADJUSTMENT, max = MAX_ADJUSTMENT) => Math.max(min, Math.min(max, value));

export function normalizePredictionInput(input = {}) {
  const fishType = typeof input.fishType === 'string' ? input.fishType.trim() : '';
  const location = typeof input.location === 'string' ? input.location.trim().slice(0, 120) : '';
  const quantity = Number(input.quantity);
  const quality = input.quality || 'Good';
  const size = input.size || 'Medium';
  const freshness = input.freshness || 'fresh';
  const seasonMonth = input.seasonMonth === undefined ? new Date().getUTCMonth() + 1 : Number(input.seasonMonth);
  if (!FISH_TYPES.includes(fishType) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 100000
    || !QUALITIES.includes(quality) || !SIZES.includes(size)
    || !FRESHNESS_LEVELS.includes(freshness)
    || !Number.isInteger(seasonMonth) || seasonMonth < 1 || seasonMonth > 12
    || (input.location !== undefined && typeof input.location !== 'string')) {
    const error = new Error('Provide a supported fish species, quantity, grade, freshness, size, and optional location');
    error.status = 400;
    throw error;
  }
  return { fishType, quantity, quality, size, freshness, location, seasonMonth };
}

export function verifiedSaleObservations(orders, listings) {
  const listingsById = new Map(listings.map(listing => [listing.id, listing]));
  return orders.flatMap(order => {
    const listing = listingsById.get(order.listing);
    const quantity = Number(order.quantity ?? listing?.quantity);
    const amount = Number(order.amount);
    const paidAt = Date.parse(order.paidAt || order.updatedAt || order.createdAt || '');
    if (!listing || listing.demo || order.demo || !isVerifiedPaidOrder(order, listing)
      || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(amount) || amount <= 0
      || !Number.isFinite(paidAt) || !listing.fishType) return [];
    return [{
      orderId: order.id,
      fishType: listing.fishType,
      location: String(listing.location || '').trim().toLowerCase(),
      quantity,
      pricePerKg: amount / quantity,
      quality: listing.quality || 'Good',
      size: listing.size || 'Medium',
      month: new Date(paidAt).getUTCMonth() + 1,
      paidAt
    }];
  });
}

function baselinePerKg(input) {
  const range = predictPrice(input.fishType, input.quantity, input.quality, input.size);
  return (range.low + range.high) / 2;
}

export function fitLinearRegression(rows) {
  if (rows.length < 2) return null;
  const meanX = rows.reduce((sum, row) => sum + row.baseline, 0) / rows.length;
  const meanY = rows.reduce((sum, row) => sum + row.actual, 0) / rows.length;
  const variance = rows.reduce((sum, row) => sum + (row.baseline - meanX) ** 2, 0);
  if (variance <= Number.EPSILON) return null;
  const covariance = rows.reduce((sum, row) => sum + (row.baseline - meanX) * (row.actual - meanY), 0);
  const slope = covariance / variance;
  const intercept = meanY - slope * meanX;
  return Number.isFinite(slope) && Number.isFinite(intercept) ? { slope, intercept } : null;
}

function metrics(actual, predicted) {
  const errors = actual.map((value, index) => Math.abs(value - predicted[index]));
  const mae = errors.reduce((sum, value) => sum + value, 0) / errors.length;
  const rmse = Math.sqrt(actual.reduce((sum, value, index) => sum + (value - predicted[index]) ** 2, 0) / actual.length);
  const smape = actual.reduce((sum, value, index) => {
    const denominator = Math.abs(value) + Math.abs(predicted[index]);
    return sum + (denominator ? 2 * Math.abs(value - predicted[index]) / denominator : 0);
  }, 0) / actual.length * 100;
  return { mae: round(mae), rmse: round(rmse), smapePercent: round(smape), testCount: actual.length };
}

export function evaluatePriceModels(observations) {
  const rows = [...observations]
    .filter(row => Number.isFinite(row.pricePerKg) && row.pricePerKg > 0 && Number.isFinite(row.paidAt))
    .sort((left, right) => left.paidAt - right.paidAt)
    .map(row => ({
      actual: row.pricePerKg,
      baseline: baselinePerKg({
        fishType: row.fishType,
        quantity: row.quantity,
        quality: row.quality,
        size: row.size
      })
    }));
  if (rows.length < MIN_VERIFIED_SALES_FOR_MODEL) {
    return { status: 'insufficient_data', sampleCount: rows.length, requiredSampleCount: MIN_VERIFIED_SALES_FOR_MODEL };
  }
  const holdoutCount = Math.max(10, Math.ceil(rows.length * 0.2));
  const splitIndex = rows.length - holdoutCount;
  const training = rows.slice(0, splitIndex);
  const holdout = rows.slice(splitIndex);
  const regression = fitLinearRegression(training);
  if (!regression) return { status: 'model_unavailable', sampleCount: rows.length, reason: 'Baseline values do not support regression fitting.' };
  const actual = holdout.map(row => row.actual);
  const baselineMetrics = metrics(actual, holdout.map(row => row.baseline));
  const regressionMetrics = metrics(actual, holdout.map(row => regression.intercept + regression.slope * row.baseline));
  const useRegression = regressionMetrics.mae < baselineMetrics.mae * 0.95;
  return {
    status: 'evaluated',
    sampleCount: rows.length,
    trainingCount: training.length,
    testCount: holdout.length,
    split: 'chronological 80/20 holdout',
    baseline: baselineMetrics,
    linearRegression: regressionMetrics,
    selectedModel: useRegression ? 'linear_regression' : 'rule_baseline',
    coefficients: regression
  };
}

function trendForSpecies(observations, fishType, now) {
  const currentStart = now - 30 * 86400000;
  const previousStart = now - 60 * 86400000;
  const speciesSales = observations.filter(item => item.fishType === fishType);
  const current = speciesSales.filter(item => item.paidAt >= currentStart);
  const previous = speciesSales.filter(item => item.paidAt >= previousStart && item.paidAt < currentStart);
  if (current.length < 3 || previous.length < 3) {
    return { direction: 'Stable', reliability: 'insufficient_data', currentObservations: current.length, previousObservations: previous.length };
  }
  const currentAverage = current.reduce((sum, item) => sum + item.pricePerKg, 0) / current.length;
  const previousAverage = previous.reduce((sum, item) => sum + item.pricePerKg, 0) / previous.length;
  const changePercent = (currentAverage - previousAverage) / previousAverage * 100;
  return {
    direction: changePercent > 3 ? 'Increasing' : changePercent < -3 ? 'Decreasing' : 'Stable',
    changePercent: round(changePercent),
    reliability: 'based_on_verified_sales',
    currentObservations: current.length,
    previousObservations: previous.length
  };
}

function historicalPrices(speciesSales) {
  if (speciesSales.length < 3) return [];
  const grouped = new Map();
  for (const sale of speciesSales) {
    const month = new Date(sale.paidAt).toISOString().slice(0, 7);
    const group = grouped.get(month) || { month, total: 0, observations: 0 };
    group.total += sale.pricePerKg;
    group.observations += 1;
    grouped.set(month, group);
  }
  return [...grouped.values()].sort((left, right) => left.month.localeCompare(right.month)).slice(-12)
    .map(group => ({
      month: group.month,
      averagePricePerKg: round(group.total / group.observations),
      observations: group.observations
    }));
}

export function createPricePrediction(inputValue, observations = [], activeModel = null, now = Date.now()) {
  const input = normalizePredictionInput(inputValue);
  const speciesSales = observations.filter(item => item.fishType === input.fishType);
  const localSales = input.location
    ? speciesSales.filter(item => item.location === input.location.toLowerCase())
    : [];
  const seasonalSales = speciesSales.filter(item => item.month === input.seasonMonth);
  const speciesMedian = median(speciesSales.map(item => item.pricePerKg));
  let baseline = baselinePerKg(input);
  const factors = [
    { name: 'Species and grade', applied: true, description: `Existing rule baseline for ${input.fishType}, ${input.quality.toLowerCase()} grade, and ${input.size.toLowerCase()} size.` },
    { name: 'Quantity', applied: true, description: `${input.quantity} kg; the existing guide applies a quantity adjustment above 200 kg.` },
    { name: 'Freshness', applied: false, description: `${input.freshness.replace('_', ' ')} is seller-reported and has no verified historical calibration yet.` },
    { name: 'Location', applied: false, description: input.location ? 'A local adjustment is applied only when at least five verified sales exist for this species and location.' : 'No landing location was provided.' },
    { name: 'Season', applied: false, description: `A seasonal adjustment is applied only when at least five verified sales exist for this species in month ${input.seasonMonth}.` }
  ];
  if (localSales.length >= MIN_SEGMENT_SAMPLES && speciesMedian > 0) {
    baseline *= clamp(median(localSales.map(item => item.pricePerKg)) / speciesMedian);
    factors[3] = { ...factors[3], applied: true, description: `Adjusted using ${localSales.length} verified sales at ${input.location}.` };
  }
  if (seasonalSales.length >= MIN_SEGMENT_SAMPLES && speciesMedian > 0) {
    baseline *= clamp(median(seasonalSales.map(item => item.pricePerKg)) / speciesMedian);
    factors[4] = { ...factors[4], applied: true, description: `Adjusted using ${seasonalSales.length} verified sales in month ${input.seasonMonth}.` };
  }
  const model = activeModel?.model === 'linear_regression'
    && Number.isFinite(activeModel.intercept) && Number.isFinite(activeModel.slope)
    ? activeModel
    : null;
  const estimatePerKg = model ? Math.max(0, model.intercept + model.slope * baseline) : baseline;
  const margin = 0.08;
  const priceRange = {
    minimumPerKg: round(estimatePerKg * (1 - margin)),
    estimatePerKg: round(estimatePerKg),
    maximumPerKg: round(estimatePerKg * (1 + margin)),
    minimumTotal: round(estimatePerKg * (1 - margin) * input.quantity),
    estimatedTotal: round(estimatePerKg * input.quantity),
    maximumTotal: round(estimatePerKg * (1 + margin) * input.quantity)
  };
  return {
    input,
    ...priceRange,
    trend: trendForSpecies(observations, input.fishType, now),
    historicalPrices: historicalPrices(speciesSales),
    reliability: model ? 'validated' : 'preliminary',
    confidence: model ? 'based on held-out verified sale evaluation' : speciesSales.length >= MIN_SEGMENT_SAMPLES
      ? 'limited historical evidence; baseline remains preliminary'
      : 'low; insufficient verified sale history',
    model: model ? {
      name: 'Linear regression calibrated to the rule baseline',
      status: 'validated',
      validation: model.validation || null,
      trainingSampleCount: model.trainingSampleCount
    } : {
      name: 'Transparent rule baseline',
      status: 'preliminary',
      trainingSampleCount: speciesSales.length,
      requiredSampleCount: MIN_VERIFIED_SALES_FOR_MODEL
    },
    factors,
    asOf: new Date(now).toISOString(),
    disclaimer: 'An estimate for guidance only, not a guaranteed sale price or live market quote.'
  };
}

export async function makePricePrediction(input, { userId = null, role = null, save = true } = {}) {
  const normalized = normalizePredictionInput(input);
  const [orders, listings, activeModel] = await Promise.all([
    list('orders'),
    list('listings'),
    get('priceModels', 'active')
  ]);
  const observations = verifiedSaleObservations(orders, listings);
  const prediction = createPricePrediction(normalized, observations, activeModel);
  if (!save) return prediction;
  const record = await insert('pricePredictions', {
    requestedBy: userId,
    requestedRole: role,
    input: prediction.input,
    estimatePerKg: prediction.estimatePerKg,
    estimatedTotal: prediction.estimatedTotal,
    reliability: prediction.reliability,
    model: prediction.model.name,
    createdAt: prediction.asOf
  });
  return { ...prediction, predictionId: record.id };
}
