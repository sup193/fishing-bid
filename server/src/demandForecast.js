import { isVerifiedPaidOrder } from './reputation.js';
import { FISH_TYPES } from './utils.js';

export const DEMAND_MODEL_VERSION = 'verified-sales-wma-v1';
export const DEMAND_CATEGORIES = Object.freeze(['Fish', 'Prawns', 'Crab', 'Squid', 'Shellfish', 'Lobster']);
export const MINIMUM_SALE_DAYS = 3;
const DAY_MS = 86400000;
const HISTORY_DAYS = 90;
const EVALUATION_TRAINING_DAYS = 28;
const MAX_FILTER_DAYS = 366;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const round = value => Number(value.toFixed(2));
const utcDate = timestamp => new Date(timestamp).toISOString().slice(0, 10);
const normalizedLocation = value => String(value || '').trim().toLocaleLowerCase();

export function fishCategory(fishType) {
  const species = String(fishType || '').toLocaleLowerCase();
  if (/prawn|shrimp/.test(species)) return 'Prawns';
  if (/crab/.test(species)) return 'Crab';
  if (/squid/.test(species)) return 'Squid';
  if (/lobster/.test(species)) return 'Lobster';
  if (/clam|mussel|oyster|scallop/.test(species)) return 'Shellfish';
  return 'Fish';
}

function parseDateFilter(value, endOfDay = false) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const error = new Error('Dates must use YYYY-MM-DD format');
    error.status = 400;
    throw error;
  }
  const timestamp = Date.parse(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  if (!Number.isFinite(timestamp) || utcDate(timestamp) !== value) {
    const error = new Error('Provide a valid calendar date');
    error.status = 400;
    throw error;
  }
  return timestamp;
}

export function normalizeDemandFilters(filters = {}, now = Date.now()) {
  const fishType = typeof filters.fishType === 'string' ? filters.fishType.trim() : '';
  const category = typeof filters.category === 'string' ? filters.category.trim() : '';
  const location = typeof filters.location === 'string' ? filters.location.trim().slice(0, 120) : '';
  const startTime = parseDateFilter(filters.from);
  const endTime = parseDateFilter(filters.to, true);
  if ((filters.fishType !== undefined && typeof filters.fishType !== 'string')
    || (filters.category !== undefined && typeof filters.category !== 'string')) {
    const error = new Error('Fish species and category filters must be strings');
    error.status = 400;
    throw error;
  }
  if (fishType && !FISH_TYPES.includes(fishType)) {
    const error = new Error('Choose a supported fish species');
    error.status = 400;
    throw error;
  }
  if (category && !DEMAND_CATEGORIES.includes(category)) {
    const error = new Error('Choose a supported fish category');
    error.status = 400;
    throw error;
  }
  if ((filters.location !== undefined && typeof filters.location !== 'string') || location.length > 120) {
    const error = new Error('Location must be a string of 120 characters or fewer');
    error.status = 400;
    throw error;
  }
  if (startTime !== null && endTime !== null && startTime > endTime) {
    const error = new Error('The start date must be on or before the end date');
    error.status = 400;
    throw error;
  }
  const effectiveEnd = endTime ?? Date.parse(`${utcDate(now)}T23:59:59.999Z`);
  const effectiveStart = startTime ?? effectiveEnd - (HISTORY_DAYS - 1) * DAY_MS;
  if (effectiveEnd - effectiveStart + DAY_MS > MAX_FILTER_DAYS * DAY_MS) {
    const error = new Error(`Date range cannot exceed ${MAX_FILTER_DAYS} days`);
    error.status = 400;
    throw error;
  }
  if (endTime !== null && utcDate(endTime) > utcDate(now)) {
    const error = new Error('The end date cannot be in the future');
    error.status = 400;
    throw error;
  }
  return {
    fishType,
    category,
    location,
    locationKey: normalizedLocation(location),
    startTime,
    endTime
  };
}

export function aggregateVerifiedDemand({
  orders = [],
  listings = [],
  filters = {},
  now = Date.now()
}) {
  const normalized = normalizeDemandFilters(filters, now);
  const listingsById = new Map(listings.map(listing => [listing.id, listing]));
  const byDay = new Map();
  const seenOrders = new Set();
  for (const order of orders) {
    if (!order?.id || seenOrders.has(order.id)) continue;
    seenOrders.add(order.id);
    const listing = listingsById.get(order.listing);
    if (!listing || !isVerifiedPaidOrder(order, listing)) continue;
    const fishType = typeof listing.fishType === 'string' ? listing.fishType.trim() : '';
    if (!FISH_TYPES.includes(fishType)
      || (normalized.fishType && fishType !== normalized.fishType)
      || (normalized.category && fishCategory(fishType) !== normalized.category)) continue;
    const location = String(listing.location || '').trim().slice(0, 120);
    const locationKey = normalizedLocation(location);
    if (normalized.locationKey && locationKey !== normalized.locationKey) continue;
    const quantity = Number(order.quantity ?? listing.quantity);
    const amount = Number(order.amount);
    const timestamp = Date.parse(order.paidAt || order.updatedAt || order.createdAt || '');
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000
      || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(timestamp)
      || timestamp > now || (normalized.startTime !== null && timestamp < normalized.startTime)
      || (normalized.endTime !== null && timestamp > normalized.endTime)) continue;
    const date = utcDate(timestamp);
    const key = `${date}\u0000${fishType}\u0000${locationKey}`;
    const group = byDay.get(key) || {
      date,
      fishType,
      category: fishCategory(fishType),
      location,
      locationKey,
      quantityKg: 0,
      saleCount: 0
    };
    group.quantityKg += quantity;
    group.saleCount += 1;
    byDay.set(key, group);
  }
  return [...byDay.values()]
    .map(row => ({ ...row, quantityKg: round(row.quantityKg) }))
    .sort((left, right) => left.date.localeCompare(right.date)
      || left.fishType.localeCompare(right.fishType)
      || left.location.localeCompare(right.location));
}

function weightedMean(values) {
  if (!values.length) return null;
  let total = 0;
  let totalWeight = 0;
  values.forEach((value, index) => {
    const weight = index + 1;
    total += value * weight;
    totalWeight += weight;
  });
  return totalWeight ? total / totalWeight : null;
}

function confidenceFor(saleDays) {
  if (saleDays >= 30) return 'high';
  if (saleDays >= 10) return 'medium';
  if (saleDays >= MINIMUM_SALE_DAYS) return 'low';
  return 'insufficient_data';
}

function forecastHorizon(dailyValues, days, lookbackDays) {
  const values = dailyValues.slice(-lookbackDays);
  const saleDays = values.filter(value => value > 0).length;
  if (saleDays < MINIMUM_SALE_DAYS) {
    return {
      status: 'insufficient_data',
      expectedQuantityKg: null,
      demandIndex: null,
      demandCategory: 'Insufficient data',
      confidence: 'insufficient_data',
      observedSaleDays: saleDays
    };
  }
  const dailyAverage = weightedMean(values);
  const historicalDailyAverage = values.reduce((sum, value) => sum + value, 0) / values.length;
  const expectedQuantityKg = round(dailyAverage * days);
  const demandIndex = historicalDailyAverage > 0
    ? Math.round(dailyAverage / historicalDailyAverage * 100)
    : null;
  return {
    status: 'forecast',
    expectedQuantityKg,
    demandIndex,
    demandCategory: demandIndex === null ? 'Insufficient data'
      : demandIndex >= 120 ? 'High'
        : demandIndex <= 80 ? 'Low'
          : 'Medium',
    confidence: confidenceFor(saleDays),
    observedSaleDays: saleDays
  };
}

function historicalTrend(dailyValues) {
  const recent = dailyValues.slice(-7);
  const previous = dailyValues.slice(-14, -7);
  if (recent.length < 7 || previous.length < 7) {
    return { direction: 'Insufficient data', changePercent: null };
  }
  const recentTotal = recent.reduce((sum, value) => sum + value, 0);
  const previousTotal = previous.reduce((sum, value) => sum + value, 0);
  if (previousTotal <= 0) {
    return { direction: recentTotal > 0 ? 'Increasing' : 'Insufficient data', changePercent: null };
  }
  const changePercent = round((recentTotal - previousTotal) / previousTotal * 100);
  return {
    direction: changePercent > 10 ? 'Increasing' : changePercent < -10 ? 'Decreasing' : 'Stable',
    changePercent
  };
}

function weeklyPattern(dailyValues, startTime) {
  if (dailyValues.length < 56 || dailyValues.filter(value => value > 0).length < 8) return null;
  const totals = Array(7).fill(0);
  const counts = Array(7).fill(0);
  dailyValues.forEach((value, index) => {
    const day = new Date(startTime + index * DAY_MS).getUTCDay();
    totals[day] += value;
    counts[day] += 1;
  });
  const averages = totals.map((total, index) => counts[index] ? total / counts[index] : 0);
  const strongestDay = averages.indexOf(Math.max(...averages));
  return { weekday: DAY_NAMES[strongestDay], historicalAverageKg: round(averages[strongestDay]) };
}

function makeDailyValues(rows, fishType, locationKey, startTime, dayCount) {
  const totals = new Map();
  for (const row of rows) {
    if (row.fishType !== fishType || (locationKey && row.locationKey !== locationKey)) continue;
    const key = `${row.date}`;
    totals.set(key, (totals.get(key) || 0) + row.quantityKg);
  }
  return Array.from({ length: dayCount }, (_, index) => {
    const date = utcDate(startTime + index * DAY_MS);
    return Number(totals.get(date) || 0);
  });
}

function aggregateActivity({ listings = [], auctions = [], bids = [], startTime, endTime, filters }) {
  const listingsById = new Map(listings.map(listing => [listing.id, listing]));
  const auctionById = new Map(auctions.map(auction => [auction.id, auction]));
  const counts = new Map();
  const add = (fishType, location, timestamp, key) => {
    if (!FISH_TYPES.includes(fishType) || !Number.isFinite(timestamp)
      || timestamp < startTime || timestamp > endTime) return;
    if (filters.fishType && filters.fishType !== fishType) return;
    if (filters.category && filters.category !== fishCategory(fishType)) return;
    if (filters.locationKey && filters.locationKey !== normalizedLocation(location)) return;
    const entry = counts.get(fishType) || { listingCount: 0, auctionBidCount: 0 };
    entry[key] += 1;
    counts.set(fishType, entry);
  };
  for (const listing of listings) {
    if (!['available', 'auction', 'sold'].includes(listing.status)) continue;
    add(listing.fishType, listing.location, Date.parse(listing.createdAt || ''), 'listingCount');
  }
  for (const bid of bids) {
    const auction = auctionById.get(bid.auction);
    const listing = auction && listingsById.get(auction.listing);
    add(listing?.fishType, listing?.location, Date.parse(bid.createdAt || ''), 'auctionBidCount');
  }
  return counts;
}

function toHistory(rows, startTime, endTime, fishType = '') {
  const days = Math.min(MAX_FILTER_DAYS, Math.max(1, Math.floor((endTime - startTime) / DAY_MS) + 1));
  const dailyMap = new Map();
  for (const row of rows) {
    if (fishType && row.fishType !== fishType) continue;
    dailyMap.set(row.date, (dailyMap.get(row.date) || 0) + row.quantityKg);
  }
  const daily = Array.from({ length: days }, (_, index) => {
    const date = utcDate(startTime + index * DAY_MS);
    return { date, quantityKg: round(dailyMap.get(date) || 0) };
  });
  const aggregate = (keyFor) => {
    const groups = new Map();
    for (const point of daily) {
      const key = keyFor(point.date);
      groups.set(key, (groups.get(key) || 0) + point.quantityKg);
    }
    return [...groups].map(([period, quantityKg]) => ({ period, quantityKg: round(quantityKg) }));
  };
  const weekly = aggregate(date => {
    const day = Date.parse(`${date}T00:00:00.000Z`);
    const weekStart = new Date(day - ((new Date(day).getUTCDay() + 6) % 7) * DAY_MS);
    return utcDate(weekStart.getTime());
  });
  const monthly = aggregate(date => date.slice(0, 7));
  return { daily, weekly, monthly };
}

function locationSummaries(rows) {
  const locations = new Map();
  for (const row of rows) {
    if (!row.location) continue;
    const location = locations.get(row.locationKey) || {
      location: row.location,
      quantityKg: 0,
      saleCount: 0,
      fishTypes: new Set()
    };
    location.quantityKg += row.quantityKg;
    location.saleCount += row.saleCount;
    location.fishTypes.add(row.fishType);
    locations.set(row.locationKey, location);
  }
  return [...locations.values()].map(({ fishTypes, ...location }) => ({
    ...location,
    quantityKg: round(location.quantityKg),
    fishTypes: fishTypes.size
  })).sort((left, right) => right.quantityKg - left.quantityKg);
}

function groupDemandRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const group = groups.get(row.fishType) || {
      fishType: row.fishType,
      category: row.category,
      totalQuantityKg: 0,
      saleCount: 0,
      locations: new Set()
    };
    group.totalQuantityKg += row.quantityKg;
    group.saleCount += row.saleCount;
    if (row.location) group.locations.add(row.location);
    groups.set(row.fishType, group);
  }
  return groups;
}

export function buildDemandInsights({
  orders = [],
  listings = [],
  auctions = [],
  bids = [],
  filters = {},
  fishermanId = null,
  buyerLocation = '',
  now = Date.now()
}) {
  const normalized = normalizeDemandFilters(filters, now);
  const endTime = normalized.endTime ?? Date.parse(`${utcDate(now)}T23:59:59.999Z`);
  const startTime = normalized.startTime ?? Date.parse(`${utcDate(endTime)}T00:00:00.000Z`) - (HISTORY_DAYS - 1) * DAY_MS;
  const sales = aggregateVerifiedDemand({ orders, listings, filters, now });
  const dateRows = sales.filter(row => {
    const timestamp = Date.parse(`${row.date}T00:00:00.000Z`);
    return timestamp >= startTime && timestamp <= endTime;
  });
  const speciesGroups = groupDemandRows(dateRows);
  const activity = aggregateActivity({ listings, auctions, bids, startTime, endTime, filters: normalized });
  const startUtc = Date.parse(`${utcDate(startTime)}T00:00:00.000Z`);
  const dayCount = Math.min(MAX_FILTER_DAYS, Math.max(1, Math.floor((endTime - startUtc) / DAY_MS) + 1));
  const availableMarketListings = listings.filter(listing => ['available', 'auction'].includes(listing.status)
    && (!normalized.fishType || listing.fishType === normalized.fishType)
    && (!normalized.category || fishCategory(listing.fishType) === normalized.category)
    && (!normalized.locationKey || normalized.locationKey === normalizedLocation(listing.location)));
  const activeListingCounts = new Map();
  for (const listing of availableMarketListings) {
    activeListingCounts.set(listing.fishType, (activeListingCounts.get(listing.fishType) || 0) + 1);
  }
  const sellerInventory = new Map();
  if (fishermanId) {
    for (const listing of listings) {
      if (listing.fisherman !== fishermanId || !['available', 'auction'].includes(listing.status)) continue;
      const quantity = Number(listing.quantity);
      if (!FISH_TYPES.includes(listing.fishType) || !Number.isFinite(quantity) || quantity <= 0) continue;
      sellerInventory.set(listing.fishType, (sellerInventory.get(listing.fishType) || 0) + quantity);
    }
  }
  const demandBySpecies = [...speciesGroups.values()].map(group => {
    const dailyValues = makeDailyValues(dateRows, group.fishType, normalized.locationKey, startUtc, dayCount);
    const recent7 = dailyValues.slice(-7);
    const previous7 = dailyValues.slice(-14, -7);
    const activityCounts = activity.get(group.fishType) || { listingCount: 0, auctionBidCount: 0 };
    const forecast = {
      next24Hours: forecastHorizon(dailyValues, 1, 7),
      next7Days: forecastHorizon(dailyValues, 7, 28),
      next30Days: forecastHorizon(dailyValues, 30, 90)
    };
    const locationKey = normalized.locationKey;
    const inventoryKg = sellerInventory.get(group.fishType) || 0;
    const weeklyDemandKg = forecast.next7Days.expectedQuantityKg;
    const competitorListings = Math.max(1, activeListingCounts.get(group.fishType) || 0);
    const quantityRecommendation = inventoryKg > 0 && weeklyDemandKg !== null
      ? round(Math.min(inventoryKg, weeklyDemandKg / competitorListings))
      : null;
    return {
      fishType: group.fishType,
      category: group.category,
      totalQuantityKg: round(group.totalQuantityKg),
      saleCount: group.saleCount,
      locations: [...group.locations].sort(),
      trend: historicalTrend(dailyValues),
      forecast,
      bestSellingPeriod: weeklyPattern(dailyValues, startUtc),
      marketActivity: {
        ...activityCounts,
        activeListings: activeListingCounts.get(group.fishType) || 0
      },
      recommendation: fishermanId ? {
        availableCatchKg: round(inventoryKg),
        suggestedListingKg: quantityRecommendation,
        explanation: quantityRecommendation === null
          ? 'No matching available catch is recorded, or sales history is insufficient for a quantity suggestion.'
          : `Advisory only: based on forecast demand shared across ${competitorListings} current listing${competitorListings === 1 ? '' : 's'}, capped by your recorded ${round(inventoryKg)} kg available catch.`
      } : undefined,
      location: locationKey ? normalized.location : undefined
    };
  }).sort((left, right) => (right.forecast.next7Days.expectedQuantityKg ?? -1)
    - (left.forecast.next7Days.expectedQuantityKg ?? -1));

  const locationRows = locationSummaries(dateRows);
  const totalQuantityKg = round(dateRows.reduce((sum, row) => sum + row.quantityKg, 0));
  const totalSales = dateRows.reduce((sum, row) => sum + row.saleCount, 0);
  const demandHistory = toHistory(dateRows, startUtc, endTime, normalized.fishType);
  const increasing = demandBySpecies.filter(item => item.trend.direction === 'Increasing');
  const decreasing = demandBySpecies.filter(item => item.trend.direction === 'Decreasing');
  const model = {
    name: 'Weighted moving average',
    version: DEMAND_MODEL_VERSION,
    status: totalSales >= 3 ? 'baseline' : 'insufficient_data',
    trainingData: 'Verified, non-demo Razorpay-paid order quantities only',
    lookbackDays: [7, 28, 90]
  };
  const recommendations = fishermanId
    ? [...demandBySpecies].filter(item => item.recommendation?.suggestedListingKg !== null
      && item.recommendation?.suggestedListingKg > 0)
      .sort((left, right) => Number(right.trend.direction === 'Increasing') - Number(left.trend.direction === 'Increasing')
        || (right.forecast.next7Days.expectedQuantityKg || 0) - (left.forecast.next7Days.expectedQuantityKg || 0))
    : undefined;

  return {
    asOf: new Date(now).toISOString(),
    model,
    filters: {
      from: utcDate(startUtc),
      to: utcDate(endTime),
      fishType: normalized.fishType || null,
      category: normalized.category || null,
      location: normalized.location || null
    },
    dataAvailability: {
      verifiedSaleCount: totalSales,
      speciesCount: speciesGroups.size,
      minimumSaleDays: MINIMUM_SALE_DAYS,
      status: totalSales ? 'available' : 'insufficient_data'
    },
    totals: {
      historicalQuantityKg: totalQuantityKg,
      verifiedSales: totalSales,
      activeListingCount: availableMarketListings.length
    },
    species: demandBySpecies,
    mostDemanded: demandBySpecies.slice(0, 5),
    leastDemanded: [...demandBySpecies].sort((left, right) => left.totalQuantityKg - right.totalQuantityKg).slice(0, 5),
    increasing,
    decreasing,
    locationBreakdown: locationRows,
    demandHistory,
    ...(buyerLocation ? { buyerLocation: String(buyerLocation).trim().slice(0, 120) } : {}),
    ...(fishermanId ? {
      inventory: [...sellerInventory].map(([fishType, quantityKg]) => ({ fishType, quantityKg: round(quantityKg) })),
      recommendations
    } : {}),
    disclaimer: 'Demand forecasts are estimates from recorded verified sales, not guaranteed sales or a promise of future demand.'
  };
}

function errorMetrics(actual, predicted) {
  if (!actual.length) return null;
  const absoluteErrors = actual.map((value, index) => Math.abs(value - predicted[index]));
  const mae = absoluteErrors.reduce((sum, value) => sum + value, 0) / absoluteErrors.length;
  const smape = actual.reduce((sum, value, index) => {
    const denominator = Math.abs(value) + Math.abs(predicted[index]);
    return sum + (denominator ? 2 * Math.abs(value - predicted[index]) / denominator : 0);
  }, 0) / actual.length * 100;
  const mapeValues = actual.flatMap((value, index) => value > 0
    ? [Math.abs(value - predicted[index]) / value]
    : []);
  return {
    maeKg: round(mae),
    mapePercent: mapeValues.length
      ? round(mapeValues.reduce((sum, value) => sum + value, 0) / mapeValues.length * 100)
      : null,
    smapePercent: round(smape),
    evaluatedDays: actual.length,
    mapeEvaluatedDays: mapeValues.length
  };
}

export function evaluateDemandForecast({ orders = [], listings = [], now = Date.now() }) {
  const endTime = Date.parse(`${utcDate(now)}T00:00:00.000Z`) - DAY_MS;
  const startTime = endTime - 364 * DAY_MS;
  const rows = aggregateVerifiedDemand({
    orders,
    listings,
    filters: { from: utcDate(startTime), to: utcDate(endTime) },
    now
  });
  const bySpecies = new Map();
  for (const row of rows) {
    const timestamp = Date.parse(`${row.date}T00:00:00.000Z`);
    if (timestamp < startTime || timestamp > endTime) continue;
    const history = bySpecies.get(row.fishType) || new Map();
    history.set(row.date, (history.get(row.date) || 0) + row.quantityKg);
    bySpecies.set(row.fishType, history);
  }
  const actual = [];
  const predicted = [];
  for (const history of bySpecies.values()) {
    const fullSeries = Array.from({ length: 365 }, (_, index) => {
      const date = utcDate(startTime + index * DAY_MS);
      return history.get(date) || 0;
    });
    for (let index = EVALUATION_TRAINING_DAYS; index < fullSeries.length; index += 1) {
      const training = fullSeries.slice(index - EVALUATION_TRAINING_DAYS, index);
      if (training.filter(value => value > 0).length < MINIMUM_SALE_DAYS) continue;
      const prediction = weightedMean(training);
      if (!Number.isFinite(prediction)) continue;
      predicted.push(prediction);
      actual.push(fullSeries[index]);
    }
  }
  if (actual.length < 7) {
    return {
      status: 'insufficient_data',
      model: DEMAND_MODEL_VERSION,
      minimumEvaluationDays: 7,
      evaluatedDays: actual.length,
      metrics: null,
      method: 'Rolling one-day-ahead backtest; each prediction uses only the preceding 28 days.'
    };
  }
  return {
    status: 'evaluated',
    model: DEMAND_MODEL_VERSION,
    metrics: errorMetrics(actual, predicted),
    method: 'Rolling one-day-ahead backtest; each prediction uses only the preceding 28 days.'
  };
}
