import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const localDbPath = path.resolve(process.env.TIDEMARKET_LOCAL_DB_PATH
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/local-db.json'));
export const TABLES = Object.freeze({
  users: 'users',
  listings: 'listings',
  auctions: 'auctions',
  bids: 'bids',
  orders: 'orders',
  payments: 'payments',
  notifications: 'notifications',
  reviews: 'reviews',
  disputes: 'disputes',
  registrationRequests: 'registration_requests',
  verificationHistory: 'verification_history',
  reputations: 'reputations',
  priceModels: 'price_models',
  pricePredictions: 'price_predictions',
  priceModelEvaluations: 'price_model_evaluations',
  auctionMessages: 'auction_messages',
  auctionMessageReports: 'auction_message_reports',
  auctionChatRateLimits: 'auction_chat_rate_limits'
});
const fields = Object.freeze({
  users: ['name', 'email', 'passwordHash', 'role', 'phone', 'location', 'verificationStatus', 'verificationUpdatedAt', 'verificationUpdatedBy', 'demo'],
  registrationRequests: ['name', 'email', 'passwordHash', 'role', 'phone', 'location', 'status', 'reviewedAt', 'reviewedBy'],
  listings: ['fisherman', 'fishType', 'quality', 'size', 'quantity', 'location', 'price', 'expectedPrice', 'salePrice', 'saleMode', 'description', 'imageUrl', 'imageVerification', 'status', 'reservedBy', 'predictedLow', 'predictedHigh', 'pricePrediction', 'removedAt', 'removedBy', 'demo'],
  auctions: ['listing', 'startPrice', 'currentPrice', 'minimumIncrement', 'currentBidder', 'bidCount', 'startTime', 'endTime', 'status', 'winner', 'winningBid', 'result', 'closedAt', 'closingNoticeSentAt', 'closureNotificationsSent', 'cancelledBy', 'order', 'bidderOffers', 'autoBids', 'bidHistory', 'processedRequests', 'offerSequence', 'demo'],
  bids: ['auction', 'buyer', 'amount', 'type', 'riskReviewNeeded', 'riskFlags', 'demo'],
  orders: ['orderNumber', 'auction', 'listing', 'buyer', 'fisherman', 'quantity', 'amount', 'paymentStatus', 'orderStatus', 'purchaseType', 'paymentMethod', 'gateway', 'gatewayOrderId', 'transactionRef', 'address', 'expectedDeliveryAt', 'deliveredAt', 'paidAt', 'cancellationActor', 'demo'],
  payments: ['order', 'orderNumber', 'buyer', 'fisherman', 'listing', 'amount', 'currency', 'gateway', 'status', 'mode', 'gatewayOrderId', 'gatewayPaymentId', 'paymentMethod', 'failureReason', 'paidAt', 'demo'],
  notifications: ['user', 'auction', 'bid', 'type', 'title', 'message', 'read'],
  reviews: ['order', 'fisherman', 'buyer', 'listing', 'rating', 'comment', 'status', 'moderationNote', 'moderatedBy', 'moderatedAt'],
  disputes: ['order', 'fisherman', 'buyer', 'listing', 'complaint', 'status', 'finding', 'adminNote', 'reviewedBy', 'reviewedAt'],
  verificationHistory: ['fisherman', 'status', 'admin', 'previousStatus'],
  reputations: ['score', 'level', 'status', 'averageRating', 'reviewCount', 'verifiedOrderCount', 'completedOrderCount', 'successfulDeliveryPercent', 'onTimeDeliveryPercent', 'onTimeDeliverySampleCount', 'cancellationPercent', 'cancellationCount', 'confirmedDisputeCount', 'verificationStatus', 'verified', 'factors', 'improvements', 'measuredWeight', 'history', 'recentReviews', 'sourceSignature'],
  priceModels: ['model', 'status', 'intercept', 'slope', 'trainingSampleCount', 'validation', 'evaluationId', 'trainedAt'],
  pricePredictions: ['requestedBy', 'requestedRole', 'input', 'estimatePerKg', 'estimatedTotal', 'reliability', 'model'],
  priceModelEvaluations: ['status', 'requestedBy', 'evaluatedAt', 'sampleCount', 'requiredSampleCount', 'trainingCount', 'testCount', 'selectedModel', 'coefficients', 'baseline', 'linearRegression', 'split', 'reason'],
  auctionMessages: ['auction', 'author', 'authorRole', 'content', 'status', 'moderationNote', 'moderatedBy', 'moderatedAt'],
  auctionMessageReports: ['auction', 'message', 'reporter', 'reason', 'status', 'reviewedBy', 'reviewedAt'],
  auctionChatRateLimits: ['lastMessageAt']
});

let client;

function databaseMode() {
  const requested = process.env.TIDEMARKET_DATABASE;
  const hasUrl = Boolean(process.env.SUPABASE_URL);
  const hasKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (requested === 'local') {
    if (process.env.NODE_ENV === 'production') throw new Error('The local database cannot be used in production');
    return 'local';
  }
  if (requested && requested !== 'supabase') throw new Error(`Unsupported TIDEMARKET_DATABASE value: ${requested}`);
  if (hasUrl !== hasKey) throw new Error('Set both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to use Supabase');
  if (hasUrl && hasKey) return 'supabase';
  if (requested === 'supabase' || process.env.NODE_ENV === 'production') {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  return 'local';
}

export function isLocalDatabase() {
  return databaseMode() === 'local';
}

export function initSupabase() {
  if (databaseMode() === 'local') return null;
  if (!client) {
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { 'X-Client-Info': 'tidemarket-api' } }
    });
  }
  return client;
}

export function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function tableFor(collection) {
  const table = TABLES[collection];
  if (!table) throw new Error(`Unsupported database collection: ${collection}`);
  return table;
}

function normalizeRow(row) {
  if (!row) return null;
  const { version, legacyData, ...record } = row;
  return { ...(legacyData || {}), ...record };
}

function removeUndefined(value) {
  if (Array.isArray(value)) return value.map(removeUndefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, removeUndefined(item)]));
  }
  return value;
}

function cleanRecord(data) {
  return JSON.parse(JSON.stringify(removeUndefined(data)));
}

function recordWithTimestamps(data) {
  const now = new Date().toISOString();
  return cleanRecord({
    ...data,
    createdAt: data.createdAt || now,
    updatedAt: now
  });
}

export function toDatabaseRecord(collection, record, previousLegacyData = {}) {
  const allowed = new Set(['id', 'createdAt', 'updatedAt', ...fields[collection]]);
  const legacyData = { ...previousLegacyData };
  const result = {};
  for (const [key, value] of Object.entries(record)) {
    if (allowed.has(key)) result[key] = value;
    else legacyData[key] = value;
  }
  result.legacyData = legacyData;
  return result;
}

function readLocalDb() {
  if (!fs.existsSync(localDbPath)) {
    fs.mkdirSync(path.dirname(localDbPath), { recursive: true });
    fs.writeFileSync(localDbPath, JSON.stringify({}, null, 2));
  }
  return JSON.parse(fs.readFileSync(localDbPath, 'utf8'));
}

function writeLocalDb(data) {
  fs.writeFileSync(localDbPath, JSON.stringify(data, null, 2));
}

async function readSupabaseRow(collection, id) {
  const { data, error } = await initSupabase().from(tableFor(collection))
    .select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function readSupabaseRows(collection, selection = '*') {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await initSupabase().from(tableFor(collection))
      .select(selection).range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

export async function get(collection, id) {
  if (isLocalDatabase()) {
    const record = readLocalDb()[collection]?.[id];
    return record ? { id, ...record } : null;
  }
  return normalizeRow(await readSupabaseRow(collection, id));
}

export async function list(collection) {
  let items;
  if (isLocalDatabase()) {
    const store = readLocalDb();
    items = Object.entries(store[collection] || {}).map(([id, item]) => ({ id, ...item }));
    if (collection === 'bids') {
      for (const [auctionId, auction] of Object.entries(store.auctions || {})) {
        for (const [id, bid] of Object.entries(auction.bidHistory || {})) {
          items.push({ id, auction: auctionId, ...bid });
        }
      }
    }
  } else {
    items = (await readSupabaseRows(collection)).map(normalizeRow);
    if (collection === 'bids') {
      const auctions = await readSupabaseRows('auctions', 'id,bidHistory');
      for (const auction of auctions) {
        for (const [id, bid] of Object.entries(auction.bidHistory || {})) {
          items.push({ id, auction: auction.id, ...bid });
        }
      }
    }
  }
  if (collection !== 'bids') return items;
  const unique = new Map();
  for (const bid of items) unique.set(bid.id, bid);
  return [...unique.values()];
}

export async function insert(collection, data, id = null) {
  const key = id || makeId(collection.replace(/s$/, ''));
  const record = recordWithTimestamps(data);
  delete record.id;
  if (isLocalDatabase()) {
    const store = readLocalDb();
    store[collection] ??= {};
    if (store[collection][key]) return { id: key, ...store[collection][key] };
    store[collection][key] = record;
    writeLocalDb(store);
    return { id: key, ...record };
  }
  const { data: saved, error } = await initSupabase().from(tableFor(collection))
    .upsert({ id: key, ...toDatabaseRecord(collection, record) }, { onConflict: 'id', ignoreDuplicates: true })
    .select('*').maybeSingle();
  if (error) throw error;
  return normalizeRow(saved || await readSupabaseRow(collection, key));
}

export async function upsert(collection, data, id) {
  const key = id || data.id || makeId(collection.replace(/s$/, ''));
  const record = recordWithTimestamps(data);
  delete record.id;
  if (isLocalDatabase()) {
    const store = readLocalDb();
    store[collection] ??= {};
    const existing = store[collection][key];
    const saved = { ...existing, ...record, createdAt: existing?.createdAt || record.createdAt };
    store[collection][key] = saved;
    writeLocalDb(store);
    return { id: key, ...saved };
  }
  const result = await transact(collection, key, current => ({
    ...current,
    ...record,
    id: key,
    createdAt: current?.createdAt || record.createdAt
  }));
  return result.value;
}

export async function update(collection, id, data) {
  const record = cleanRecord({ ...data, updatedAt: new Date().toISOString() });
  delete record.id;
  if (isLocalDatabase()) {
    const store = readLocalDb();
    const existing = store[collection]?.[id];
    if (!existing) return null;
    const saved = cleanRecord({ ...existing, ...record });
    store[collection][id] = saved;
    writeLocalDb(store);
    return { id, ...saved };
  }
  const result = await transact(collection, id, current => current ? { ...current, ...record } : null);
  return result.value;
}

export async function transact(collection, id, transform) {
  if (isLocalDatabase()) {
    const store = readLocalDb();
    const current = store[collection]?.[id] || null;
    const next = transform(current ? { id, ...current } : null);
    if (next === undefined || next === null) return { committed: false, value: current ? { id, ...current } : null };
    const { id: ignoredId, ...record } = next;
    const cleaned = cleanRecord(record);
    if (JSON.stringify(cleaned) === JSON.stringify(current || null)) {
      return { committed: false, value: current ? { id, ...current } : null };
    }
    store[collection] ??= {};
    store[collection][id] = cleaned;
    writeLocalDb(store);
    return { committed: true, value: { id, ...cleaned } };
  }

  const table = tableFor(collection);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const raw = await readSupabaseRow(collection, id);
    const current = normalizeRow(raw);
    const next = transform(current);
    if (next === undefined || next === null) return { committed: false, value: current };
    const comparison = cleanRecord(next);
    delete comparison.id;
    const currentData = current ? { ...current } : null;
    if (currentData) delete currentData.id;
    if (isDeepStrictEqual(comparison, currentData)) return { committed: false, value: current };
    const cleaned = toDatabaseRecord(collection, cleanRecord({
      ...next,
      id,
      createdAt: next.createdAt || current?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }), raw?.legacyData);
    const { data, error } = await initSupabase().rpc('tidemarket_compare_and_set_record', {
      p_table: table,
      p_id: id,
      p_expected_version: raw?.version ?? null,
      p_record: cleaned
    });
    if (error) throw error;
    if (data) return { committed: true, value: normalizeRow(data) };
  }
  throw new Error(`Database transaction conflicted repeatedly: ${collection}/${id}`);
}

export async function reserveListing(id, buyerId) {
  const updatedAt = new Date().toISOString();
  if (isLocalDatabase()) {
    const store = readLocalDb();
    const listing = store.listings?.[id];
    if (!listing || listing.status !== 'available') return false;
    store.listings[id] = { ...listing, status: 'reserved', reservedBy: buyerId, updatedAt };
    writeLocalDb(store);
    return true;
  }
  const { data, error } = await initSupabase().rpc('tidemarket_reserve_listing', {
    p_listing_id: id,
    p_buyer_id: buyerId
  });
  if (error) throw error;
  return data === true;
}

export async function createAuctionForListing(listingId, auctionData) {
  const auctionId = makeId('auction');
  const record = recordWithTimestamps(auctionData);
  if (isLocalDatabase()) {
    const listing = await get('listings', listingId);
    if (!listing || listing.status !== 'available') return null;
    await update('listings', listingId, { status: 'auction' });
    try {
      return await insert('auctions', { ...record, listing: listingId }, auctionId);
    } catch (error) {
      await update('listings', listingId, { status: 'available' });
      throw error;
    }
  }
  const { data, error } = await initSupabase().rpc('tidemarket_create_auction', {
    p_auction_id: auctionId,
    p_listing_id: listingId,
    p_record: { id: auctionId, ...toDatabaseRecord('auctions', { ...record, listing: listingId }) }
  });
  if (error) {
    if (error.code === 'P0001') return null;
    throw error;
  }
  return normalizeRow(data);
}

export async function createBuyoutOrder({ listing, buyerId, address }) {
  const orderId = makeId('order');
  const orderNumber = `TM-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  if (isLocalDatabase()) {
    if (!await reserveListing(listing.id, buyerId)) return null;
    try {
      return await insert('orders', {
        orderNumber,
        listing: listing.id,
        buyer: buyerId,
        fisherman: listing.fisherman,
        quantity: Number(listing.quantity),
        amount: Number(listing.salePrice || listing.expectedPrice) * Number(listing.quantity),
        paymentStatus: 'pending',
        orderStatus: 'awaiting-payment',
        purchaseType: 'buyout',
        ...(address ? { address } : {})
      }, orderId);
    } catch (error) {
      await update('listings', listing.id, { status: 'available', reservedBy: null });
      throw error;
    }
  }
  const { data, error } = await initSupabase().rpc('tidemarket_create_buyout_order', {
    p_listing_id: listing.id,
    p_buyer_id: buyerId,
    p_order_id: orderId,
    p_order_number: orderNumber,
    p_address: address || null
  });
  if (error) {
    if (error.code === 'P0001') return null;
    throw error;
  }
  return normalizeRow(data);
}

export async function markPaymentPaid(transaction, payment, paidAt) {
  if (isLocalDatabase()) {
    const saved = await update('payments', transaction.id, {
      status: 'paid',
      gatewayPaymentId: payment.id,
      paymentMethod: payment.method,
      paidAt
    });
    const order = await get('orders', transaction.order);
    if (!order) return null;
    await update('orders', order.id, {
      paymentStatus: 'paid',
      orderStatus: 'processing',
      paymentMethod: 'razorpay',
      gateway: 'razorpay',
      gatewayOrderId: transaction.gatewayOrderId,
      transactionRef: payment.id,
      paidAt
    });
    if (order.listing) await update('listings', order.listing, { status: 'sold', reservedBy: null });
    return saved;
  }
  const { data, error } = await initSupabase().rpc('tidemarket_mark_payment_paid', {
    p_payment_id: transaction.id,
    p_payment_payload: {
      id: payment.id,
      method: payment.method || null,
      paidAt,
      gatewayOrderId: transaction.gatewayOrderId
    }
  });
  if (error) throw error;
  return normalizeRow(data);
}

export async function markPaymentFailed(transaction, reason) {
  if (isLocalDatabase()) {
    const saved = await update('payments', transaction.id, {
      status: 'failed',
      failureReason: String(reason || 'Payment was not completed').slice(0, 160)
    });
    const order = await get('orders', transaction.order);
    if (order) {
      await update('orders', order.id, { paymentStatus: 'failed', orderStatus: 'payment-failed' });
      if (order.listing && order.purchaseType === 'buyout') {
        const listing = await get('listings', order.listing);
        if (listing?.status === 'reserved' && listing.reservedBy === order.buyer) {
          await update('listings', listing.id, { status: 'available', reservedBy: null });
        }
      }
    }
    return saved;
  }
  const { data, error } = await initSupabase().rpc('tidemarket_mark_payment_failed', {
    p_payment_id: transaction.id,
    p_reason: String(reason || 'Payment was not completed').slice(0, 160)
  });
  if (error) throw error;
  return normalizeRow(data);
}

export async function remove(collection, id) {
  if (isLocalDatabase()) {
    const store = readLocalDb();
    if (store[collection]) delete store[collection][id];
    writeLocalDb(store);
    return;
  }
  const { error } = await initSupabase().from(tableFor(collection)).delete().eq('id', id);
  if (error) throw error;
}

export async function clearCollections(collections) {
  if (isLocalDatabase()) {
    const store = readLocalDb();
    for (const collection of collections) delete store[collection];
    writeLocalDb(store);
    return;
  }
  for (const collection of collections) {
    const { error } = await initSupabase().from(tableFor(collection)).delete().not('id', 'is', null);
    if (error) throw error;
  }
}

export function where(items, filters = {}) { return items.filter(item => Object.entries(filters).every(([key, value]) => item[key] === value)); }
export function sortNewest(items) { return [...items].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)); }
export function sortAmount(items) { return [...items].sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0)); }
export function sortEnd(items) { return [...items].sort((a, b) => new Date(a.endTime || 0) - new Date(b.endTime || 0)); }
export function sanitizeUser(user) {
  if (!user) return null;
  const safe = { ...user };
  delete safe.passwordHash;
  delete safe.preferredLanguage;
  return safe;
}
