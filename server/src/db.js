import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const backendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverEnvPath = path.resolve(backendDirectory, '.env');
const rootEnvPath = path.resolve(backendDirectory, '../.env');
dotenv.config({ path: serverEnvPath, override: false });
dotenv.config({ path: rootEnvPath, override: false });

const localDbPath = path.resolve(process.env.TIDEMARKET_LOCAL_DB_PATH
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/local-db.json'));
export const TABLES = Object.freeze({
  users: 'users',
  pendingRegistrations: 'pending_registrations',
  passwordResetOtps: 'password_reset_otps',
  passwordResetTokens: 'password_reset_tokens',
  listings: 'listings',
  listingImages: 'listing_images',
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
  users: ['name', 'email', 'passwordHash', 'role', 'phone', 'location', 'verificationStatus', 'verificationUpdatedAt', 'verificationUpdatedBy', 'tokenVersion', 'demo'],
  pendingRegistrations: ['name', 'email', 'phone', 'location', 'passwordHash', 'role', 'otpHash', 'expiresAt', 'attempts', 'lastSentAt', 'verifiedAt', 'consumedAt'],
  passwordResetOtps: ['userId', 'email', 'otpHash', 'expiresAt', 'attempts', 'lastSentAt', 'consumedAt'],
  passwordResetTokens: ['userId', 'tokenHash', 'expiresAt', 'consumedAt'],
  registrationRequests: ['name', 'email', 'passwordHash', 'role', 'phone', 'location', 'status', 'reviewedAt', 'reviewedBy'],
  listings: ['fisherman', 'fishType', 'quality', 'size', 'quantity', 'location', 'freshness', 'price', 'expectedPrice', 'salePrice', 'saleMode', 'description', 'imageUrl', 'imageVerification', 'status', 'reservedBy', 'predictedLow', 'predictedHigh', 'pricePrediction', 'removedAt', 'removedBy', 'demo'],
  listingImages: ['listing', 'storagePath', 'imageUrl', 'position', 'contentType', 'metadata', 'isPrimary'],
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
  const hasKey = Boolean(process.env.SUPABASE_SECRET_KEY);
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  const placeholderSecret = !secret
    || /replace-with|your_|placeholder/i.test(secret);
  const publishableSecret = /^sb_publishable_/i.test(secret || '');

  if (requested === 'local') {
    if (process.env.NODE_ENV === 'production') throw new Error('The local database cannot be used in production');
    return 'local';
  }
  if (requested && requested !== 'supabase') throw new Error(`Unsupported TIDEMARKET_DATABASE value: ${requested}`);
  if (hasUrl !== hasKey) throw new Error('Set both SUPABASE_URL and SUPABASE_SECRET_KEY to use Supabase');
  if ((hasUrl || hasKey) && placeholderSecret) {
    throw new Error('SUPABASE_SECRET_KEY is missing or still contains a placeholder');
  }
  if (publishableSecret) {
    throw new Error('SUPABASE_SECRET_KEY must be a secret key, not a publishable key');
  }
  if (hasUrl && hasKey) return 'supabase';
  if (requested === 'supabase' || process.env.NODE_ENV === 'production') {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required');
  }
  return 'local';
}

export function isLocalDatabase() {
  return databaseMode() === 'local';
}

export function initSupabase() {
  if (databaseMode() === 'local') return null;
  if (!client) {
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { 'X-Client-Info': 'tidemarket-api' } }
    });
  }
  return client;
}

export function classifySupabaseNetworkError(error) {
  const cause = error?.cause;
  const code = cause?.code || error?.code;
  if (code === 'ENOTFOUND') return 'DNS resolution failure';
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return 'connection timeout';
  if (code === 'ECONNREFUSED') return 'connection refused';
  if (code === 'ECONNRESET') return 'connection reset';
  if (code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') return 'TLS certificate verification failure';
  if (/invalid url|invalid_url/i.test(error?.message || '')) return 'invalid Supabase URL';
  if (error?.name === 'AbortError') return 'request timeout';
  if (error?.name === 'TypeError' && /fetch failed/i.test(error?.message || '')) return 'network fetch failure';
  return 'Supabase request failure';
}

export async function checkSupabaseConnection() {
  const supabase = initSupabase();
  if (!supabase) return { connected: false, local: true };
  try {
    const url = new URL(process.env.SUPABASE_URL);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')) {
      throw new Error('Invalid Supabase URL');
    }
    const { error } = await supabase.from('users').select('id').limit(1);
    if (error) throw error;
    return { connected: true, local: false, hostname: url.hostname };
  } catch (error) {
    const cause = classifySupabaseNetworkError(error);
    const detail = { name: error?.name, code: error?.code || error?.cause?.code, cause: cause };
    const wrapped = new Error(`Supabase connectivity check failed: ${cause}`);
    wrapped.cause = detail;
    throw wrapped;
  }
}

export async function uploadFishImage(buffer, mimetype, ownerId) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('Fish image content is required');
  if (isLocalDatabase()) {
    return {
      storagePath: null,
      imageUrl: `data:${mimetype};base64,${buffer.toString('base64')}`
    };
  }
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mimetype];
  if (!extension) throw new Error('Unsupported fish image type');
  const storagePath = `listings/${ownerId || 'anonymous'}/${crypto.randomUUID()}.${extension}`;
  const supabase = initSupabase();
  const { error } = await supabase.storage.from('fish-images').upload(storagePath, buffer, {
    contentType: mimetype,
    cacheControl: '3600',
    upsert: false
  });
  if (error) throw error;
  const { data } = supabase.storage.from('fish-images').getPublicUrl(storagePath);
  return { storagePath, imageUrl: data.publicUrl };
}

export async function getPendingRegistration(email) {
  if (isLocalDatabase()) {
    const store = readLocalDb();
    return Object.entries(store.pendingRegistrations || {})
      .map(([id, value]) => ({ id, ...value }))
      .filter(item => item.email === email.trim().toLowerCase() && !item.consumedAt)
      .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0))[0] || null;
  }
  const { data, error } = await initSupabase().from('pending_registrations')
    .select('*')
    .ilike('email', email.trim().toLowerCase())
    .is('consumedAt', null)
    .order('createdAt', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return normalizeRow(data);
}

export async function getLatestFishermanRegistrationRequest(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return null;
  if (isLocalDatabase()) {
    return Object.entries(readLocalDb().registrationRequests || {})
      .map(([id, value]) => ({ id, ...value }))
      .filter(item => item.role === 'fisherman' && String(item.email || '').trim().toLowerCase() === normalizedEmail)
      .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0))[0] || null;
  }
  const { data, error } = await initSupabase().from('registration_requests')
    .select('*')
    .eq('email', normalizedEmail)
    .eq('role', 'fisherman')
    .order('createdAt', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return normalizeRow(data);
}

export async function issuePasswordResetOtp({ email, otpId, otpHash, expiresAt, now }) {
  const normalizedEmail = email.trim().toLowerCase();
  if (isLocalDatabase()) {
    const store = readLocalDb();
    const user = Object.entries(store.users || {})
      .map(([id, value]) => ({ id, ...value }))
      .find(item => String(item.email || '').trim().toLowerCase() === normalizedEmail);
    if (!user) return { status: 'not_found' };

    const activeOtp = Object.entries(store.passwordResetOtps || {})
      .map(([id, value]) => ({ id, ...value }))
      .filter(item => item.userId === user.id && !item.consumedAt)
      .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0))[0];
    if (activeOtp && Date.parse(activeOtp.lastSentAt || 0) > Date.parse(now) - 60_000) {
      return { status: 'cooldown' };
    }

    const timestamp = new Date(now).toISOString();
    for (const [id, resetOtp] of Object.entries(store.passwordResetOtps || {})) {
      if (resetOtp.userId === user.id && !resetOtp.consumedAt) {
        store.passwordResetOtps[id].consumedAt = timestamp;
        store.passwordResetOtps[id].updatedAt = timestamp;
      }
    }
    for (const [id, resetToken] of Object.entries(store.passwordResetTokens || {})) {
      if (resetToken.userId === user.id && !resetToken.consumedAt) {
        store.passwordResetTokens[id].consumedAt = timestamp;
      }
    }
    store.passwordResetOtps ??= {};
    store.passwordResetOtps[otpId] = {
      userId: user.id,
      email: normalizedEmail,
      otpHash,
      expiresAt,
      attempts: 0,
      lastSentAt: timestamp,
      consumedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    writeLocalDb(store);
    return { status: 'issued', userId: user.id, email: normalizedEmail, name: user.name };
  }
  const { data, error } = await initSupabase().rpc('tidemarket_issue_password_reset_otp', {
    p_email: normalizedEmail,
    p_otp_id: otpId,
    p_otp_hash: otpHash,
    p_expires_at: expiresAt,
    p_now: now
  });
  if (error) throw error;
  return data;
}

export async function consumePasswordResetOtp({
  email,
  otpHash,
  tokenId,
  tokenHash,
  tokenExpiresAt,
  now
}) {
  const normalizedEmail = email.trim().toLowerCase();
  if (isLocalDatabase()) {
    const store = readLocalDb();
    const user = Object.entries(store.users || {})
      .map(([id, value]) => ({ id, ...value }))
      .find(item => String(item.email || '').trim().toLowerCase() === normalizedEmail);
    if (!user) return { status: 'invalid' };
    const otp = Object.entries(store.passwordResetOtps || {})
      .map(([id, value]) => ({ id, ...value }))
      .filter(item => item.userId === user.id && !item.consumedAt)
      .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0))[0];
    if (!otp) return { status: 'invalid' };
    const timestamp = new Date(now).toISOString();
    if (Date.parse(otp.expiresAt) <= Date.parse(timestamp)) {
      store.passwordResetOtps[otp.id].consumedAt = timestamp;
      store.passwordResetOtps[otp.id].updatedAt = timestamp;
      writeLocalDb(store);
      return { status: 'expired' };
    }
    const attempts = Number(otp.attempts || 0);
    if (attempts >= 5) return { status: 'locked' };
    if (otp.otpHash !== otpHash) {
      store.passwordResetOtps[otp.id].attempts = attempts + 1;
      store.passwordResetOtps[otp.id].updatedAt = timestamp;
      writeLocalDb(store);
      return attempts + 1 >= 5
        ? { status: 'locked' }
        : { status: 'incorrect', remainingAttempts: 5 - attempts - 1 };
    }

    store.passwordResetOtps[otp.id].consumedAt = timestamp;
    store.passwordResetOtps[otp.id].updatedAt = timestamp;
    store.passwordResetTokens ??= {};
    for (const [id, resetToken] of Object.entries(store.passwordResetTokens)) {
      if (resetToken.userId === user.id && !resetToken.consumedAt) {
        store.passwordResetTokens[id].consumedAt = timestamp;
      }
    }
    store.passwordResetTokens[tokenId] = {
      userId: user.id,
      tokenHash,
      expiresAt: tokenExpiresAt,
      consumedAt: null,
      createdAt: timestamp
    };
    writeLocalDb(store);
    return { status: 'verified' };
  }
  const { data, error } = await initSupabase().rpc('tidemarket_consume_password_reset_otp', {
    p_email: normalizedEmail,
    p_otp_hash: otpHash,
    p_token_id: tokenId,
    p_token_hash: tokenHash,
    p_token_expires_at: tokenExpiresAt,
    p_now: now
  });
  if (error) throw error;
  return data;
}

export async function resetPasswordWithToken({ tokenHash, passwordHash, now }) {
  if (isLocalDatabase()) {
    const store = readLocalDb();
    const token = Object.entries(store.passwordResetTokens || {})
      .map(([id, value]) => ({ id, ...value }))
      .find(item => item.tokenHash === tokenHash && !item.consumedAt);
    if (!token) return { status: 'invalid' };
    const timestamp = new Date(now).toISOString();
    if (Date.parse(token.expiresAt) <= Date.parse(timestamp)) {
      store.passwordResetTokens[token.id].consumedAt = timestamp;
      writeLocalDb(store);
      return { status: 'expired' };
    }
    const user = store.users?.[token.userId];
    if (!user) return { status: 'invalid' };
    store.users[token.userId] = {
      ...user,
      passwordHash,
      tokenVersion: Number(user.tokenVersion || 0) + 1,
      updatedAt: timestamp
    };
    for (const [id, resetToken] of Object.entries(store.passwordResetTokens || {})) {
      if (resetToken.userId === token.userId && !resetToken.consumedAt) {
        store.passwordResetTokens[id].consumedAt = timestamp;
      }
    }
    for (const [id, resetOtp] of Object.entries(store.passwordResetOtps || {})) {
      if (resetOtp.userId === token.userId && !resetOtp.consumedAt) {
        store.passwordResetOtps[id].consumedAt = timestamp;
        store.passwordResetOtps[id].updatedAt = timestamp;
      }
    }
    writeLocalDb(store);
    return { status: 'updated' };
  }
  const { data, error } = await initSupabase().rpc('tidemarket_reset_password', {
    p_token_hash: tokenHash,
    p_password_hash: passwordHash,
    p_now: now
  });
  if (error) throw error;
  return data;
}

export async function reviewFishermanRegistration({ requestId, action, adminId, userId }) {
  if (!['approve', 'reject'].includes(action)) throw new Error('Unsupported fisherman registration action');
  const now = new Date().toISOString();
  if (isLocalDatabase()) {
    const store = readLocalDb();
    const request = store.registrationRequests?.[requestId];
    if (!request || request.role !== 'fisherman' || request.status !== 'pending') {
      return { status: 'not_found' };
    }

    const users = store.users || {};
    const existing = Object.entries(users)
      .map(([id, user]) => ({ id, ...user }))
      .find(user => String(user.email || '').trim().toLowerCase() === String(request.email || '').trim().toLowerCase());
    if (action === 'approve') {
      if (existing && existing.role !== 'fisherman') return { status: 'duplicate' };
      if (request.phone && Object.entries(users).some(([id, user]) =>
        id !== existing?.id && String(user.phone || '').trim() === request.phone)) {
        return { status: 'duplicate' };
      }

      const fishermanId = existing?.id || userId;
      const fisherman = {
        ...(existing || {}),
        id: undefined,
        name: request.name,
        email: String(request.email).trim().toLowerCase(),
        passwordHash: request.passwordHash,
        role: 'fisherman',
        phone: request.phone || existing?.phone,
        location: request.location || existing?.location,
        verificationStatus: 'verified',
        verificationUpdatedAt: now,
        verificationUpdatedBy: adminId,
        demo: existing?.demo || false,
        createdAt: existing?.createdAt || now,
        updatedAt: now
      };
      delete fisherman.id;
      users[fishermanId] = fisherman;
      store.users = users;
      store.registrationRequests[requestId] = {
        ...request,
        status: 'accepted',
        reviewedAt: now,
        reviewedBy: adminId,
        updatedAt: now
      };
      writeLocalDb(store);
      return { status: 'approved', user: { id: fishermanId, ...fisherman } };
    }

    store.registrationRequests[requestId] = {
      ...request,
      status: 'rejected',
      reviewedAt: now,
      reviewedBy: adminId,
      updatedAt: now
    };
    writeLocalDb(store);
    return { status: 'rejected' };
  }

  const { data, error } = await initSupabase().rpc('tidemarket_review_fisherman_registration', {
    p_request_id: requestId,
    p_action: action,
    p_admin_id: adminId,
    p_user_id: userId,
    p_now: now
  });
  if (error) throw error;
  if (data?.status === 'approved' && data.userId) {
    return { ...data, user: await get('users', data.userId) };
  }
  return data;
}

export async function consumePendingRegistration({ email, otpHash, userId }) {
  if (isLocalDatabase()) {
    const store = readLocalDb();
    const pending = Object.entries(store.pendingRegistrations || {})
      .map(([id, value]) => ({ id, ...value }))
      .filter(item => item.email === email.trim().toLowerCase() && !item.consumedAt)
      .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0))[0];
    if (!pending) return { status: 'invalid', reason: 'pending_not_found' };
    if (Date.parse(pending.expiresAt) <= Date.now()) return { status: 'expired' };
    if (Number(pending.attempts || 0) >= 5) return { status: 'locked' };
    if (pending.otpHash !== otpHash) {
      const attempts = Number(pending.attempts || 0) + 1;
      store.pendingRegistrations[pending.id].attempts = attempts;
      store.pendingRegistrations[pending.id].updatedAt = new Date().toISOString();
      writeLocalDb(store);
      return { status: 'incorrect', remainingAttempts: Math.max(0, 5 - attempts) };
    }
    const users = store.users || {};
    const registrationRequests = store.registrationRequests || {};
    const existingUser = Object.entries(users)
      .map(([id, user]) => ({ id, ...user }))
      .find(user => String(user.email).trim().toLowerCase() === pending.email);
    const latestRequest = Object.values(registrationRequests)
      .filter(request => request.role === 'fisherman' && String(request.email || '').trim().toLowerCase() === pending.email)
      .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0))[0];
    const isFishermanResubmission = pending.role === 'fisherman'
      && existingUser?.role === 'fisherman'
      && latestRequest?.status === 'rejected';
    const hasPendingFishermanRequest = pending.role === 'fisherman'
      && Object.values(registrationRequests).some(request =>
        request.role === 'fisherman'
        && String(request.email || '').trim().toLowerCase() === pending.email
        && request.status === 'pending');
    if ((existingUser && !isFishermanResubmission)
      || hasPendingFishermanRequest
      || (pending.phone && Object.entries(users).some(([id, user]) =>
        id !== existingUser?.id && String(user.phone || '').trim() === pending.phone))
      || (pending.phone && pending.role === 'fisherman' && Object.values(registrationRequests).some(request =>
        request.role === 'fisherman' && request.status === 'pending' && String(request.phone || '').trim() === pending.phone))) {
      store.pendingRegistrations[pending.id].consumedAt = new Date().toISOString();
      writeLocalDb(store);
      return { status: 'duplicate' };
    }
    const now = new Date().toISOString();
    if (pending.role === 'buyer') {
      users[userId] = {
        name: pending.name,
        email: pending.email,
        passwordHash: pending.passwordHash,
        role: 'buyer',
        phone: pending.phone,
        location: pending.location,
        verificationStatus: 'verified',
        demo: false,
        createdAt: now,
        updatedAt: now
      };
      store.users = users;
    } else {
      const requestId = `registration_${crypto.randomUUID()}`;
      registrationRequests[requestId] = {
        name: pending.name,
        email: pending.email,
        passwordHash: pending.passwordHash,
        role: 'fisherman',
        phone: pending.phone,
        location: pending.location,
        status: 'pending',
        createdAt: now,
        updatedAt: now
      };
      store.registrationRequests = registrationRequests;
    }
    store.pendingRegistrations[pending.id].verifiedAt = now;
    store.pendingRegistrations[pending.id].consumedAt = now;
    store.pendingRegistrations[pending.id].updatedAt = now;
    writeLocalDb(store);
    if (pending.role === 'buyer') {
      return {
        status: 'verified',
        userId,
        email: pending.email,
        name: pending.name,
        role: 'buyer'
      };
    }
    return {
      status: 'pending_admin',
      name: pending.name,
      email: pending.email,
      role: 'fisherman',
      phone: pending.phone,
      location: pending.location
    };
  }
  const { data, error } = await initSupabase().rpc('tidemarket_consume_registration_otp', {
    p_email: email.trim().toLowerCase(),
    p_otp_hash: otpHash,
    p_user_id: userId,
    p_now: new Date().toISOString()
  });
  if (error) throw error;
  return data;
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
  if (collection !== 'pendingRegistrations') result.legacyData = legacyData;
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
