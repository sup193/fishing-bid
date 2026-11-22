import express from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createHmac, randomInt, randomUUID } from 'node:crypto';
import { get, insert, list, update, remove, createAuctionForListing, createBuyoutOrder, markPaymentPaid as persistPaymentPaid, markPaymentFailed as persistPaymentFailed, transact, uploadFishImage, getPendingRegistration, consumePendingRegistration, initSupabase, where, sortNewest, sortAmount, sortEnd, sanitizeUser } from '../db.js';
import { buildMarketTrendPoints } from '../marketTrends.js';
import { buildDemandInsights } from '../demandForecast.js';
import { allow, requireAuth, signUser } from '../auth.js';
import { FISH_TYPES, QUALITIES, SIZES, assessBidRisk, predictPrice, refreshAuction } from '../utils.js';
import { getFishermanReputation, getPublicReputationSummaries, isVerifiedPaidOrder, refreshFishermanReputation } from '../reputation.js';
import { makePricePrediction, normalizePredictionInput } from '../pricePrediction.js';
import { analyzeAuctionActivity, buildAuctionInsights } from '../auctionInsights.js';
import { applyAuctionOffer, auctionBidderIds, minimumBidFor, publicAuction, recalculateAuctionOffers } from '../auctionBidding.js';
import { captureRazorpayPayment, createRazorpayOrder, getRazorpayPayment, razorpayConfigured, verifyRazorpaySignature, verifyRazorpayWebhookSignature } from '../payments.js';
import { sendOtpEmail } from '../emailService.js';

const router = express.Router();
const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype))
});
const imageUpload = (req, res, next) => upload.single('image')(req, res, error => {
  if (!error) return next();
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ message: error.code === 'LIMIT_FILE_SIZE' ? 'Fish image must be 5 MB or smaller' : 'Could not upload fish image' });
  }
  next(error);
});
const detectionAttempts = new Map();
const limitFishDetection = (req, res, next) => {
  const now = Date.now();
  const key = req.ip;
  const attempt = detectionAttempts.get(key);
  if (attempt && attempt.resetAt > now && attempt.count >= 12) {
    res.set('Retry-After', String(Math.ceil((attempt.resetAt - now) / 1000)));
    return res.status(429).json({ message: 'Too many photo searches. Please try again in a few minutes.' });
  }
  if (!attempt || attempt.resetAt <= now) detectionAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
  else attempt.count += 1;
  for (const [ip, value] of detectionAttempts) if (value.resetAt <= now) detectionAttempts.delete(ip);
  next();
};
const validMoney = value => Number.isFinite(value) && value > 0
  && Number.isSafeInteger(Math.round(value * 100))
  && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
const publicUser = user => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role
});

const otpRateLimits = new Map();
const otpIpLimits = new Map();
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

function normalizeOtpEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function otpSecret() {
  if (process.env.OTP_HASH_SECRET) return process.env.OTP_HASH_SECRET;
  if (process.env.NODE_ENV === 'production') throw new Error('OTP_HASH_SECRET is required in production');
  return 'dev-only-otp-secret-change-before-production';
}

function hashOtp(email, otp) {
  return createHmac('sha256', otpSecret()).update(`${normalizeOtpEmail(email)}:${otp}`).digest('hex');
}

function generateOtp() {
  if (process.env.NODE_ENV === 'test') return globalThis.__tidemarketOtpSequence === undefined
    ? (globalThis.__tidemarketOtpSequence = 123456, '123456')
    : (globalThis.__tidemarketOtpSequence = 654321, '654321');
  return String(randomInt(100000, 1000000));
}

function checkOtpRateLimit(req, email) {
  const now = Date.now();
  const emailKey = normalizeOtpEmail(email);
  const emailLimit = otpRateLimits.get(emailKey);
  if (emailLimit && emailLimit.resetAt > now && emailLimit.count >= 5) {
    const error = new Error('Too many registration attempts for this email. Try again later.');
    error.status = 429;
    throw error;
  }
  if (!emailLimit || emailLimit.resetAt <= now) otpRateLimits.set(emailKey, { count: 1, resetAt: now + 15 * 60 * 1000 });
  else emailLimit.count += 1;

  const ip = req.ip || 'unknown';
  const ipLimit = otpIpLimits.get(ip);
  if (ipLimit && ipLimit.resetAt > now && ipLimit.count >= 20) {
    const error = new Error('Too many registration attempts from this network. Try again later.');
    error.status = 429;
    throw error;
  }
  if (!ipLimit || ipLimit.resetAt <= now) otpIpLimits.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
  else ipLimit.count += 1;
}


const fishermanFor = async id => sanitizeUser(await get('users', id));
const listingView = async (listing, reputation = undefined) => {
  const auction = (await list('auctions')).find(item => item.listing === listing.id) || null;
  const bids = auction ? sortAmount(where(await list('bids'), { auction: auction.id })) : [];
  const currentPrice = Number(auction?.currentPrice || bids[0]?.amount || auction?.startPrice || listing.salePrice || listing.expectedPrice);
  const guide = predictPrice(listing.fishType, Number(listing.quantity), listing.quality, listing.size);
  const storedLow = Number(listing.predictedLow);
  const storedHigh = Number(listing.predictedHigh);
  const hasStoredGuide = Number.isFinite(storedLow) && storedLow > 0 && Number.isFinite(storedHigh) && storedHigh >= storedLow;
  const fisherman = await fishermanFor(listing.fisherman);
  return {
    ...listing,
    predictedLow: hasStoredGuide ? storedLow : guide.low,
    predictedHigh: hasStoredGuide ? storedHigh : guide.high,
    pricePrediction: listing.pricePrediction || {
      reliability: 'preliminary',
      model: { name: 'Transparent rule baseline', status: 'preliminary' },
      disclaimer: 'An estimate for guidance only, not a guaranteed sale price or live market quote.'
    },
    fisherman: fisherman ? { ...fisherman, ...(reputation ? { reputation } : {}) } : null,
    ...(reputation ? { reputation } : {}),
    auction: auction ? {
      ...publicAuction(auction),
      bidCount: Number(auction.bidCount || bids.length),
      currentPrice,
      priceIncreasePercent: auction.startPrice ? +(((currentPrice - auction.startPrice) / auction.startPrice) * 100).toFixed(2) : 0
    } : null
  };
};

async function demandSnapshot(req, { fisherman = false, buyer = false } = {}) {
  const [orders, listings, auctions, bids] = await Promise.all([
    list('orders'), list('listings'), list('auctions'), list('bids')
  ]);
  return buildDemandInsights({
    orders,
    listings,
    auctions,
    bids,
    filters: {
      from: req.query.from,
      to: req.query.to,
      fishType: req.query.fishType,
      category: req.query.category,
      location: req.query.location || req.user.location || ''
    },
    fishermanId: fisherman ? req.user.id : null,
    buyerLocation: buyer ? req.user.location || '' : '',
    now: Date.now()
  });
}

function legacyAuctionState(auction, bids) {
  if (auction.bidHistory) return auction;
  const bidderOffers = {};
  const bidHistory = {};
  const chronologicalBids = [...bids].sort((left, right) => Date.parse(left.createdAt || 0) - Date.parse(right.createdAt || 0));
  let offerSequence = 0;
  for (const bid of chronologicalBids) {
    bidHistory[bid.id] = { ...bid, type: bid.type || 'manual' };
    const previous = bidderOffers[bid.buyer];
    if (!previous || Number(bid.amount) > Number(previous.amount)) {
      offerSequence += 1;
      bidderOffers[bid.buyer] = {
        amount: Number(bid.amount),
        source: 'manual',
        sequence: offerSequence,
        createdAt: bid.createdAt || ''
      };
    }
  }
  const high = sortAmount(bids)[0];
  return {
    ...auction,
    currentPrice: Number(auction.currentPrice || high?.amount || auction.startPrice),
    currentBidder: auction.currentBidder || high?.buyer || null,
    bidCount: Number(auction.bidCount || bids.length),
    bidderOffers: auction.bidderOffers || bidderOffers,
    offerSequence: Number(auction.offerSequence || offerSequence),
    bidHistory,
    autoBids: auction.autoBids || {},
    processedRequests: auction.processedRequests || {}
  };
}

async function notifyBidParticipants({ auction, bid, previousBidder, actorId, legacyBids, extended }) {
  if (!bid) return;
  const recipients = auctionBidderIds(auction, legacyBids);
  const messages = new Map();
  if (previousBidder && previousBidder !== auction.currentBidder) {
    messages.set(previousBidder, {
      type: 'outbid',
      title: 'You have been outbid',
      message: `The current bid is now ₹${Number(auction.currentPrice).toLocaleString()}/kg.`
    });
  }
  for (const recipient of recipients) {
    if (recipient !== auction.currentBidder && recipient !== actorId && !messages.has(recipient)) {
      messages.set(recipient, {
        type: 'new_higher_bid',
        title: 'A higher bid was placed',
        message: `The current bid is now ₹${Number(auction.currentPrice).toLocaleString()}/kg.`
      });
    }
  }
  const listing = await get('listings', auction.listing);
  if (listing?.fisherman && listing.fisherman !== actorId) {
    messages.set(listing.fisherman, {
      type: 'new_auction_bid',
      title: 'New bid on your catch',
      message: `A buyer placed a bid. The current price is now ₹${Number(auction.currentPrice).toLocaleString()}/kg.`
    });
  }
  if (auction.currentBidder) {
    messages.set(auction.currentBidder, {
      type: 'highest_bidder',
      title: 'You are the highest bidder',
      message: `You are currently leading at ₹${Number(auction.currentPrice).toLocaleString()}/kg.`
    });
  }
  if (extended && auction.currentBidder) {
    const existing = messages.get(auction.currentBidder);
    messages.set(auction.currentBidder, {
      type: existing?.type || 'auction_extended',
      title: existing?.title || 'Auction timer extended',
      message: `A valid bid in the final 30 seconds extended the auction by 30 seconds.`
    });
  }
  for (const [recipient, notification] of messages) {
    const id = `bid_${bid.id}_${recipient}_${notification.type}`;
    await insert('notifications', { ...notification, user: recipient, auction: auction.id, bid: bid.id, read: false }, id);
  }
}

async function submitAuctionOffer({ auction, amount, totalBudget, buyerId, mode, requestId }) {
  const legacyBids = where(await list('bids'), { auction: auction.id });
  const bidId = randomUUID();
  const now = Date.now();
  let failure = null;
  let operation = null;
  const result = await transact('auctions', auction.id, current => {
    if (!current) {
      failure = 'Auction not found';
      return;
    }
    operation = applyAuctionOffer(legacyAuctionState(current, legacyBids), {
      buyerId,
      amount,
      totalBudget,
      mode,
      bidId,
      requestId,
      now
    });
    if (operation.error) {
      failure = operation.error;
      return;
    }
    return operation.auction;
  });
  if (!result.committed && !operation?.duplicate) return { error: failure || 'Auction changed while placing your bid. Please try again.' };
  const updatedAuction = result.value;
  const bid = updatedAuction.bidHistory?.[bidId] || operation?.bid || null;
  if (bid && !operation?.duplicate) {
    const existing = legacyBids.find(item => item.id === bid.id);
    if (!existing) {
      const risk = assessBidRisk(bid, [...legacyBids, bid], updatedAuction);
      try {
        await insert('bids', {
          ...bid,
          riskReviewNeeded: risk.reviewNeeded,
          riskFlags: risk.flags
        }, bid.id);
      } catch (error) {
        console.error(`Bid history mirror failed for ${bid.id}:`, error);
      }
    }
    try {
      await notifyBidParticipants({
        auction: updatedAuction,
        bid,
        previousBidder: operation.previousBidder,
        actorId: buyerId,
        legacyBids,
        extended: operation.extended
      });
    } catch (error) {
      console.error(`Bid notification delivery failed for ${bid.id}:`, error);
    }
  }
  return {
    response: {
      message: operation?.duplicate ? 'This bid was already processed' : 'Bid accepted',
      bid,
      auction: publicAuction(updatedAuction),
      activeBidderCount: auctionBidderIds(updatedAuction, legacyBids).length,
      extended: Boolean(operation?.extended),
      duplicate: Boolean(operation?.duplicate)
    }
  };
}

async function beginRazorpayPayment(order, address) {
  const amount = Math.round(Number(order.amount) * 100);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    const error = new Error('Order amount is invalid');
    error.status = 400;
    throw error;
  }
  if (order.paymentStatus === 'paid') {
    const error = new Error('This order has already been paid');
    error.status = 409;
    throw error;
  }

  if (address) await update('orders', order.id, { address });
  const transaction = await insert('payments', {
    order: order.id,
    orderNumber: order.orderNumber,
    buyer: order.buyer,
    fisherman: order.fisherman,
    listing: order.listing,
    amount: Number(order.amount),
    currency: 'INR',
    gateway: 'razorpay',
    status: 'creating',
    mode: 'test'
  });

  try {
    const gatewayOrder = await createRazorpayOrder({
      amount,
      receipt: String(order.orderNumber).slice(0, 40),
      notes: { tideMarketOrder: order.id }
    });
    await update('payments', transaction.id, {
      gatewayOrderId: gatewayOrder.id,
      status: 'pending'
    });
    await update('orders', order.id, {
      paymentStatus: 'pending',
      orderStatus: 'awaiting-payment',
      paymentMethod: 'razorpay',
      gateway: 'razorpay',
      gatewayOrderId: gatewayOrder.id
    });
    return {
      keyId: process.env.RAZORPAY_KEY_ID,
      gatewayOrderId: gatewayOrder.id,
      transactionId: transaction.id,
      orderNumber: order.orderNumber,
      amount: gatewayOrder.amount,
      currency: gatewayOrder.currency,
      name: 'TideMarket',
      description: `Payment for ${order.orderNumber}`
    };
  } catch (error) {
    await update('payments', transaction.id, {
      status: 'failed',
      failureReason: 'Could not create a payment session'
    });
    await update('orders', order.id, { paymentStatus: 'failed', orderStatus: 'payment-failed' });
    if (order.listing && order.purchaseType === 'buyout') {
      const listing = await get('listings', order.listing);
      if (listing?.status === 'reserved' && listing.reservedBy === order.buyer) {
        await update('listings', listing.id, { status: 'available', reservedBy: null });
      }
    }
    console.error('Razorpay order creation failed:', error.message);
    throw Object.assign(new Error('Could not start payment. Check the Razorpay test credentials and try again.'), { status: 502 });
  }
}

async function failPayment(transaction, reason) {
  await persistPaymentFailed(transaction, reason);
}

async function markPaymentPaid(transaction, payment) {
  const order = await get('orders', transaction.order);
  if (!order) return null;
  const paidAt = payment.created_at ? new Date(payment.created_at * 1000).toISOString() : new Date().toISOString();
  const paidTransaction = await persistPaymentPaid(transaction, payment, paidAt);
  if (!paidTransaction) return null;
  if (order.fisherman) await refreshFishermanReputation(order.fisherman);
  return paidTransaction;
}

router.post('/auth/register', async (req, res) => {
  try {
    checkOtpRateLimit(req, req.body.email);
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const email = normalizeOtpEmail(req.body.email);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const role = req.body.role === 'fisherman' ? 'fisherman' : req.body.role === 'buyer' ? 'buyer' : '';
    const phone = typeof req.body.phone === 'string' ? req.body.phone.trim().slice(0, 30) : '';
    const location = typeof req.body.location === 'string' ? req.body.location.trim().slice(0, 120) : '';
    if (!name || name.length > 100
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || password.length < 8 || password.length > 128
      || !role) {
      return res.status(400).json({ message: 'Use a valid name and email, role, and password between 8 and 128 characters' });
    }
    const users = await list('users');
    if (users.some(user => String(user.email).toLowerCase() === email)) {
      return res.status(409).json({ message: 'Email is already registered' });
    }
    if (phone && users.some(user => String(user.phone || '').trim() === phone)) {
      return res.status(409).json({ message: 'Phone number is already registered' });
    }
    const pendingRequests = role === 'buyer'
      ? (await list('registrationRequests')).filter(request => request.status === 'pending')
      : [];
    if (pendingRequests.some(request => String(request.email).toLowerCase() === email)) {
      return res.status(409).json({ message: 'A registration request is already pending for this email.', status: 'pending' });
    }
    if (phone && pendingRequests.some(request => String(request.phone || '').trim() === phone)) {
      return res.status(409).json({ message: 'Phone number is already used by a pending registration.' });
    }
    const existingPending = await getPendingRegistration(email);
    if (existingPending) return res.status(409).json({
      status: 'pending',
      message: 'A verification code is already pending for this email.',
      email,
      expiresAt: existingPending.expiresAt
    });
    const passwordHash = await bcrypt.hash(password, 12);
    const otp = generateOtp();
    const now = new Date();
    const pendingId = `pending_${randomUUID()}`;
    try {
      await insert('pendingRegistrations', {
        name,
        email,
        phone,
        location,
        passwordHash,
        role,
        otpHash: hashOtp(email, otp),
        expiresAt: new Date(now.getTime() + OTP_TTL_MS).toISOString(),
        attempts: 0,
        lastSentAt: now.toISOString()
      }, pendingId);
      await sendOtpEmail({ name, email, otp });
    } catch (error) {
      await remove('pendingRegistrations', pendingId);
      throw error.status ? error : Object.assign(new Error('Could not send the verification email'), { status: 502 });
    }
    return res.status(202).json({
      status: 'pending',
      message: 'Verification code sent.',
      email,
      expiresAt: new Date(now.getTime() + OTP_TTL_MS).toISOString()
    });
  } catch (error) {
    res.status(error.status || 400).json({ message: error.message });
  }
});
router.post('/auth/verify-otp', async (req, res) => {
  try {
    const email = normalizeOtpEmail(req.body.email);
    const otp = typeof req.body.otp === 'string' ? req.body.otp.trim() : '';
    if (!email || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ message: 'Provide a valid email and six-digit verification code' });
    }
    const pending = await getPendingRegistration(email);
    if (!pending) return res.status(404).json({ message: 'No pending registration found' });
    if (Date.parse(pending.expiresAt) <= Date.now()) {
      return res.status(410).json({ message: 'Verification code has expired. Request a new code.' });
    }
    if (Number(pending.attempts || 0) >= 5) {
      return res.status(429).json({ message: 'Maximum verification attempts reached. Request a new code.' });
    }
    const result = await consumePendingRegistration({
      email,
      otpHash: hashOtp(email, otp),
      userId: `user_${randomUUID()}`
    });
    if (result.status === 'expired') return res.status(410).json({ message: 'Verification code has expired. Request a new code.' });
    if (result.status === 'locked') return res.status(429).json({ message: 'Maximum verification attempts reached. Request a new code.' });
    if (result.status === 'incorrect') return res.status(400).json({ message: 'Incorrect verification code', remainingAttempts: result.remainingAttempts });
    if (result.status === 'duplicate') return res.status(409).json({ message: 'Email is already registered or awaiting approval' });
    if (result.status === 'pending_admin') {
      return res.status(202).json({
        status: 'pending',
        message: 'Registration verified. An admin must approve your buyer account before you can sign in.',
        email
      });
    }
    if (result.status !== 'verified') return res.status(400).json({ message: 'Verification could not be completed' });
    const user = await get('users', result.userId);
    if (!user) return res.status(500).json({ message: 'Account creation could not be completed' });
    return res.status(201).json({ token: signUser(user), user: publicUser(user) });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
});
router.post('/auth/resend-otp', async (req, res) => {
  try {
    checkOtpRateLimit(req, req.body.email);
    const email = normalizeOtpEmail(req.body.email);
    const pending = await getPendingRegistration(email);
    if (!pending) return res.status(404).json({ message: 'No pending registration found' });
    const elapsed = Date.now() - Date.parse(pending.lastSentAt || 0);
    if (elapsed < OTP_RESEND_COOLDOWN_MS) {
      const retryAfter = Math.ceil((OTP_RESEND_COOLDOWN_MS - elapsed) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ message: 'Please wait before requesting another code.', retryAfter });
    }
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
    const updates = {
      otpHash: hashOtp(email, otp),
      expiresAt,
      attempts: 0,
      lastSentAt: new Date().toISOString(),
      verifiedAt: null,
      consumedAt: null
    };
    if (process.env.TIDEMARKET_DATABASE === 'local' || (!process.env.SUPABASE_URL && !process.env.SUPABASE_SECRET_KEY)) {
      await update('pendingRegistrations', pending.id, updates);
    } else {
      const { error } = await initSupabase().from('pending_registrations')
        .update(updates)
        .eq('id', pending.id);
      if (error) throw error;
    }
    try {
      await sendOtpEmail({ name: pending.name, email, otp });
    } catch (error) {
      if (process.env.TIDEMARKET_DATABASE === 'local' || (!process.env.SUPABASE_URL && !process.env.SUPABASE_SECRET_KEY)) {
        await update('pendingRegistrations', pending.id, { otpHash: pending.otpHash, expiresAt: pending.expiresAt, attempts: pending.attempts, lastSentAt: pending.lastSentAt });
      } else {
        await initSupabase().from('pending_registrations')
          .update({ otpHash: pending.otpHash, expiresAt: pending.expiresAt, attempts: pending.attempts, lastSentAt: pending.lastSentAt })
          .eq('id', pending.id);
      }
      throw error;
    }
    return res.json({ status: 'pending', message: 'A new verification code was sent.', email, expiresAt });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
});
router.post('/auth/login', async (req, res) => { try { const email = req.body.email?.trim().toLowerCase(); const user = (await list('users')).find(item => item.email === email); if (!user) { const request = (await list('registrationRequests')).find(item => item.email === email && item.status === 'pending'); if (request) return res.status(403).json({ message: 'Your account request is still pending admin approval.', status: 'pending' }); return res.status(401).json({ message: 'Invalid email or password' }); } if (!(await bcrypt.compare(req.body.password || '', user.passwordHash))) return res.status(401).json({ message: 'Invalid email or password' }); res.json({ token: signUser(user), user: publicUser(user) }); } catch (error) { console.error('Admin/user login failed:', error); res.status(500).json({ message: 'Login service failed' }); } });
router.get('/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));
router.get('/fisherman/reputation', requireAuth, allow('fisherman'), async (req, res) => {
  const reputation = await getFishermanReputation(req.user.id);
  if (!reputation) return res.status(404).json({ message: 'Fisherman profile not found' });
  res.json(reputation);
});
router.get('/fishermen/:id/reputation', async (req, res) => {
  const summaries = await getPublicReputationSummaries([req.params.id]);
  const reputation = summaries.get(req.params.id);
  if (!reputation) return res.status(404).json({ message: 'Fisherman profile not found' });
  res.json(reputation);
});
router.post('/uploads/image', requireAuth, allow('fisherman'), imageUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Upload a JPG, PNG, or WEBP fish image' });
  try {
    const uploaded = await uploadFishImage(req.file.buffer, req.file.mimetype, req.user.id);
    res.status(201).json(uploaded);
  } catch (error) {
    console.error('Fish image upload failed:', error);
    res.status(502).json({ message: 'Could not store the fish image' });
  }
});
router.post('/fish-detection', limitFishDetection, imageUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Upload a JPG, PNG, or WEBP fish image' });
  const script = resolve(projectRoot, 'predict.py');
  const model = resolve(projectRoot, 'server/models/fish_classifier.keras');
  const labels = resolve(projectRoot, 'server/models/fish_labels.json');
  const temporaryPath = path.join(os.tmpdir(), `tidemarket-detect-${randomUUID()}${req.file.mimetype === 'image/png' ? '.png' : req.file.mimetype === 'image/webp' ? '.webp' : '.jpg'}`);
  try {
    fs.writeFileSync(temporaryPath, req.file.buffer);
    const modelIsPointer = fs.existsSync(model) && fs.statSync(model).size < 256 && fs.readFileSync(model, 'utf8').startsWith('version https://git-lfs.github.com/spec/v1');
    if (!fs.existsSync(model) || modelIsPointer) {
      return res.status(503).json({ message: 'Species identification is not set up: the fish classifier model weights are missing. Install the model file and Python/TensorFlow requirements to enable photo detection.' });
    }
    const { stdout } = await execFileAsync(process.env.PYTHON_EXECUTABLE || 'python', [script, '--image', temporaryPath, '--model', model, '--labels', labels], {
      cwd: projectRoot,
      timeout: 120000,
      maxBuffer: 1024 * 1024
    });
    res.json(JSON.parse(stdout.trim()));
  } catch (error) {
    if (error.code === 'ENOENT' || /No module named ['"]?tensorflow/i.test(error.stderr || '')) {
      return res.status(503).json({ message: 'Species identification is not set up: install Python, TensorFlow, and the fish classifier model weights.' });
    }
    console.error('Fish image detection failed:', error.stderr || error.message);
    res.status(500).json({ message: 'Could not identify species from this image. Try a clear photo of one fish.' });
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
});
router.get('/market/trends', async (req, res) => {
  const requestedDays = Number(req.query.days || 7);
  if (![7, 30].includes(requestedDays)) return res.status(400).json({ message: 'Trend range must be 7 or 30 days' });

  const listings = await list('listings');
  const auctions = await list('auctions');
  const bids = await list('bids');
  const orders = await list('orders');
  const startTime = Date.now() - requestedDays * 86400000;
  const points = buildMarketTrendPoints({ listings, auctions, bids, orders, startTime });
  res.json({ days: requestedDays, generatedAt: new Date().toISOString(), points });
});
router.get('/demand/forecast', requireAuth, allow('buyer', 'fisherman'), async (req, res) => {
  try {
    res.json(await demandSnapshot(req, { fisherman: req.user.role === 'fisherman', buyer: req.user.role === 'buyer' }));
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    throw error;
  }
});
router.get('/demand/trending', requireAuth, allow('buyer'), async (req, res) => {
  try {
    const snapshot = await demandSnapshot(req, { buyer: true });
    res.json({
      asOf: snapshot.asOf,
      model: snapshot.model,
      dataAvailability: snapshot.dataAvailability,
      buyerLocation: snapshot.buyerLocation || '',
      trending: snapshot.mostDemanded,
      increasing: snapshot.increasing,
      decreasing: snapshot.decreasing,
      locationBreakdown: snapshot.locationBreakdown,
      disclaimer: snapshot.disclaimer
    });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    throw error;
  }
});
router.get('/demand/buyer', requireAuth, allow('buyer'), async (req, res) => {
  try {
    res.json(await demandSnapshot(req, { buyer: true }));
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    throw error;
  }
});
router.get('/demand/fisherman', requireAuth, allow('fisherman'), async (req, res) => {
  try {
    res.json(await demandSnapshot(req, { fisherman: true }));
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    throw error;
  }
});
router.post('/price-predictions/preview', requireAuth, allow('buyer', 'fisherman'), async (req, res) => {
  try {
    normalizePredictionInput(req.body);
    res.json(await makePricePrediction(req.body, { userId: req.user.id, role: req.user.role, save: false }));
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    throw error;
  }
});
router.post('/price-predictions', requireAuth, allow('buyer', 'fisherman'), async (req, res) => {
  try {
    normalizePredictionInput(req.body);
    res.status(201).json(await makePricePrediction(req.body, { userId: req.user.id, role: req.user.role }));
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    throw error;
  }
});
router.get('/price-predictions', requireAuth, allow('buyer', 'fisherman'), async (req, res) => {
  const predictions = (await list('pricePredictions'))
    .filter(item => item.requestedBy === req.user.id)
    .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0))
    .slice(0, 100)
    .map(({ requestedBy, ...item }) => item);
  res.json(predictions);
});
router.get('/listings', async (req, res) => {
  let items = (await list('listings')).filter(item => ['available', 'auction'].includes(item.status));
  if (req.query.quality) items = items.filter(item => item.quality === req.query.quality);
  if (req.query.fishType) items = items.filter(item => item.fishType === req.query.fishType);
  if (req.query.q) items = items.filter(item => `${item.fishType} ${item.location}`.toLowerCase().includes(req.query.q.toLowerCase()));
  items = sortNewest(items);
  const reputations = await getPublicReputationSummaries(items.map(item => item.fisherman));
  res.json(await Promise.all(items.map(item => listingView(item, reputations.get(item.fisherman)))));
});
router.get('/listings/:id', async (req, res) => {
  const item = await get('listings', req.params.id);
  if (!item || item.status === 'removed') return res.status(404).json({ message: 'Listing not found' });
  const reputations = await getPublicReputationSummaries([item.fisherman]);
  res.json(await listingView(item, reputations.get(item.fisherman)));
});
router.post('/listings', requireAuth, allow('fisherman'), async (req, res) => {
  const fishType = typeof req.body.fishType === 'string' ? req.body.fishType.trim() : '';
  const quantity = Number(req.body.quantity);
  const quality = req.body.quality || 'Good';
  const size = req.body.size || 'Medium';
  const location = typeof req.body.location === 'string' ? req.body.location.trim() : '';
  const freshness = req.body.freshness || 'fresh';
  const expectedPrice = Number(req.body.expectedPrice);
  const salePrice = Number(req.body.salePrice ?? req.body.expectedPrice);
  const saleMode = req.body.saleMode || 'sale';
  const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
  const imageUrl = typeof req.body.imageUrl === 'string' ? req.body.imageUrl : undefined;
  const imagePath = typeof req.body.storagePath === 'string' ? req.body.storagePath : undefined;
  const requestId = req.body.requestId;
  if (!FISH_TYPES.includes(fishType) || !Number.isFinite(quantity) || quantity <= 0
    || !QUALITIES.includes(quality) || !SIZES.includes(size) || !location
    || location.length > 120 || !validMoney(expectedPrice) || !validMoney(salePrice)
    || !['sale', 'bid'].includes(saleMode) || description.length > 1000) {
    return res.status(400).json({ message: 'Provide a supported fish type, positive quantity and price, quality, size, and location' });
  }
  if (requestId !== undefined && (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(requestId))) {
    return res.status(400).json({ message: 'Invalid listing request ID' });
  }

  let pricePrediction;
  try {
    pricePrediction = await makePricePrediction({
      fishType, quantity, quality, size, location, freshness
    }, { userId: req.user.id, role: req.user.role, save: false });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    throw error;
  }
  const fields = {
    fisherman: req.user.id,
    fishType,
    quantity,
    quality,
    size,
    location,
    freshness,
    expectedPrice,
    salePrice,
    saleMode,
    description,
    ...(imageUrl ? { imageUrl } : {}),
    imageVerification: 'pending',
    predictedLow: pricePrediction.minimumPerKg,
    predictedHigh: pricePrediction.maximumPerKg,
    pricePrediction: {
      estimatePerKg: pricePrediction.estimatePerKg,
      minimumPerKg: pricePrediction.minimumPerKg,
      maximumPerKg: pricePrediction.maximumPerKg,
      estimatedTotal: pricePrediction.estimatedTotal,
      reliability: pricePrediction.reliability,
      model: pricePrediction.model,
      trend: pricePrediction.trend,
      factors: pricePrediction.factors,
      asOf: pricePrediction.asOf,
      disclaimer: pricePrediction.disclaimer
    },
    status: 'available'
  };
  let listing;
  if (requestId) {
    const id = `listing_${createHash('sha256').update(`${req.user.id}:${requestId}`).digest('hex')}`;
    const now = new Date().toISOString();
    const result = await transact('listings', id, current => current ? undefined : {
      ...fields,
      createdAt: now,
      updatedAt: now
    });
    listing = result.value || await get('listings', id);
    if (!result.committed) {
      const sameRequest = listing?.fisherman === req.user.id
        && ['fishType', 'quantity', 'quality', 'size', 'location', 'freshness', 'expectedPrice', 'salePrice', 'saleMode', 'description']
          .every(key => listing[key] === fields[key])
        && (listing.imageUrl || undefined) === fields.imageUrl;
      if (!sameRequest) return res.status(409).json({ message: 'This listing request ID was already used' });
      return res.status(200).json({ ...listing, duplicate: true });
    }
    listing = { id, ...listing };
  } else {
    listing = await insert('listings', fields);
  }
  if (imageUrl && imagePath) {
    await insert('listingImages', {
      listing: listing.id,
      storagePath: imagePath,
      imageUrl,
      position: 0,
      contentType: 'image',
      isPrimary: true
    });
  }
  res.status(201).json(listing);
});
router.get('/fisherman/listings', requireAuth, allow('fisherman'), async (req, res) => {
  const listings = sortNewest(where(await list('listings'), { fisherman: req.user.id }));
  const reputations = await getPublicReputationSummaries([req.user.id]);
  res.json(await Promise.all(listings.map(item => listingView(item, reputations.get(req.user.id)))));
});
router.get('/fisherman/sales', requireAuth, allow('fisherman'), async (req, res) => { const orders = sortNewest(where(await list('orders'), { fisherman: req.user.id })); const listings = await list('listings'); res.json(orders.map(order => ({ ...order, listingDetails: listings.find(listing => listing.id === order.listing) || null }))); });
router.patch('/listings/:id', requireAuth, allow('fisherman'), async (req, res) => {
  const listing = await get('listings', req.params.id);
  if (!listing || listing.fisherman !== req.user.id) return res.status(404).json({ message: 'Listing not found' });
  const hasPrice = Object.hasOwn(req.body, 'price');
  const hasQuantity = Object.hasOwn(req.body, 'quantity');
  const hasFreshness = Object.hasOwn(req.body, 'freshness');
  if (!hasPrice && !hasQuantity && !hasFreshness || Object.keys(req.body).some(key => !['price', 'quantity', 'freshness'].includes(key))) {
    return res.status(400).json({ message: 'Update only the listing price, quantity, or reported freshness' });
  }
  if (listing.status !== 'available' || listing.saleMode === 'bid'
    || (await list('auctions')).some(auction => auction.listing === listing.id)) {
    return res.status(409).json({ message: 'Only available fixed-price listings can be changed' });
  }
  const changes = {};
  if (hasPrice) {
    const price = Number(req.body.price);
    if (!validMoney(price)) return res.status(400).json({ message: 'Price must be a positive amount with at most two decimal places' });
    changes.expectedPrice = price;
    changes.salePrice = price;
  }
  if (hasQuantity) {
    const quantity = Number(req.body.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ message: 'Quantity must be greater than zero' });
    changes.quantity = quantity;
  }
  if (hasFreshness) {
    if (typeof req.body.freshness !== 'string') return res.status(400).json({ message: 'Choose a supported freshness level' });
    try {
      normalizePredictionInput({ ...listing, ...changes, freshness: req.body.freshness });
    } catch (error) {
      if (error.status === 400) return res.status(400).json({ message: error.message });
      throw error;
    }
    changes.freshness = req.body.freshness;
  }
  if (hasQuantity || hasFreshness) {
    const prediction = await makePricePrediction({
      ...listing,
      ...changes,
      fishType: listing.fishType,
      location: listing.location,
      quantity: changes.quantity ?? listing.quantity,
      freshness: changes.freshness ?? listing.freshness ?? 'fresh'
    }, { userId: req.user.id, role: req.user.role, save: false });
    changes.predictedLow = prediction.minimumPerKg;
    changes.predictedHigh = prediction.maximumPerKg;
    changes.pricePrediction = {
      estimatePerKg: prediction.estimatePerKg,
      minimumPerKg: prediction.minimumPerKg,
      maximumPerKg: prediction.maximumPerKg,
      estimatedTotal: prediction.estimatedTotal,
      reliability: prediction.reliability,
      model: prediction.model,
      trend: prediction.trend,
      factors: prediction.factors,
      asOf: prediction.asOf,
      disclaimer: prediction.disclaimer
    };
  }
  res.json(await update('listings', listing.id, changes));
});
router.delete('/listings/:id', requireAuth, allow('fisherman'), async (req, res) => { const listing = await get('listings', req.params.id); if (!listing || listing.fisherman !== req.user.id) return res.status(404).json({ message: 'Listing not found' }); const linkedOrder = (await list('orders')).find(order => order.listing === listing.id); if (linkedOrder || ['sold', 'auction'].includes(listing.status)) return res.status(409).json({ message: 'This listing cannot be deleted because it has an active bid or sale record.' }); const auction = (await list('auctions')).find(item => item.listing === listing.id); if (auction) await remove('auctions', auction.id); await remove('listings', listing.id); res.json({ message: 'Listing deleted' }); });
router.post('/listings/:id/auction', requireAuth, allow('fisherman'), async (req, res) => {
  const listing = await get('listings', req.params.id);
  if (!listing || listing.fisherman !== req.user.id || listing.status !== 'available') return res.status(400).json({ message: 'Listing is unavailable' });
  const startPrice = Number(req.body.startPrice);
  const minimumIncrement = Number(req.body.minimumIncrement || 10);
  const startTime = Date.parse(req.body.startTime);
  const endTime = Date.parse(req.body.endTime);
  if (!Number.isFinite(startPrice) || startPrice <= 0 || !Number.isSafeInteger(Math.round(startPrice * 100))
    || Math.abs(startPrice * 100 - Math.round(startPrice * 100)) >= 1e-7
    || !Number.isFinite(minimumIncrement) || minimumIncrement <= 0
    || !Number.isSafeInteger(Math.round(minimumIncrement * 100))
    || Math.abs(minimumIncrement * 100 - Math.round(minimumIncrement * 100)) >= 1e-7) {
    return res.status(400).json({ message: 'Starting price and minimum increment must be positive amounts with at most two decimal places' });
  }
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime < Date.now() - 60_000 || endTime <= Date.now() || endTime <= startTime) {
    return res.status(400).json({ message: 'Auction start and end times are invalid' });
  }
  const auction = await createAuctionForListing(listing.id, {
    listing: listing.id,
    startPrice,
    currentPrice: startPrice,
    currentBidder: null,
    bidCount: 0,
    minimumIncrement,
    startTime: new Date(startTime).toISOString(),
    endTime: new Date(endTime).toISOString(),
    status: 'scheduled',
    bidderOffers: {},
    autoBids: {},
    offerSequence: 0,
    bidHistory: {},
    processedRequests: {}
  });
  if (!auction) return res.status(409).json({ message: 'Listing is no longer available for auction' });
  res.status(201).json(publicAuction(auction));
});
router.get('/auctions/:id', async (req, res) => {
  let auction = await get('auctions', req.params.id);
  if (!auction) return res.status(404).json({ message: 'Auction not found' });
  auction = await refreshAuction(auction);
  const listing = await get('listings', auction.listing);
  if (!listing || listing.status === 'removed') return res.status(404).json({ message: 'This listing is no longer available' });
  const legacyBids = sortAmount(where(await list('bids'), { auction: auction.id }));
  const sourceBids = Object.values(auction.bidHistory || {}).length
    ? Object.values(auction.bidHistory)
    : legacyBids;
  const bidders = new Map();
  for (const bid of sourceBids) {
    const buyer = await get('users', bid.buyer);
    bidders.set(bid.buyer, buyer ? { id: buyer.id, name: buyer.name || 'Buyer' } : { id: bid.buyer, name: 'Buyer' });
  }
  const bids = [...sourceBids]
    .map(bid => ({ ...bid, buyer: bidders.get(bid.buyer) }))
    .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0));
  const leader = auction.currentBidder ? bidders.get(auction.currentBidder) || await get('users', auction.currentBidder) : null;
  const reputations = await getPublicReputationSummaries([listing.fisherman]);
  res.json({
    auction: {
      ...publicAuction(auction),
      currentBidder: leader ? { id: leader.id, name: leader.name } : null,
      minimumBid: minimumBidFor(auction)
    },
    listing: await listingView(listing, reputations.get(listing.fisherman)),
    bids,
    activeBidderCount: auctionBidderIds(auction, legacyBids).length
  });
});
router.get('/auctions/:id/insights', requireAuth, allow('buyer'), async (req, res) => {
  const auction = await get('auctions', req.params.id);
  if (!auction) return res.status(404).json({ message: 'Auction not found' });
  const listing = await get('listings', auction.listing);
  if (!listing || listing.status === 'removed') return res.status(404).json({ message: 'This listing is no longer available' });
  const [auctions, listings, bids, orders] = await Promise.all(['auctions', 'listings', 'bids', 'orders'].map(list));
  const listingById = new Map(listings.map(item => [item.id, item]));
  const auctionsById = new Map(auctions.map(item => [item.id, item]));
  const verifiedSales = orders.flatMap(order => {
    const soldListing = listingById.get(order.listing);
    const soldAuction = auctionsById.get(order.auction);
    const quantity = Number(order.quantity || soldListing?.quantity);
    const amount = Number(order.amount);
    if (!isVerifiedPaidOrder(order, soldListing) || !soldAuction || soldAuction.status !== 'completed'
      || !soldListing || !Number.isFinite(quantity) || quantity <= 0
      || !Number.isFinite(amount) || amount <= 0) return [];
    return [{
      auctionId: soldAuction.id,
      fishType: soldListing.fishType,
      pricePerKg: amount / quantity
    }];
  });
  const auctionBids = Object.values(auction.bidHistory || {}).length
    ? Object.values(auction.bidHistory)
    : where(bids, { auction: auction.id });
  const insights = buildAuctionInsights({ auction, listing, bids: auctionBids, verifiedSales });
  const [priceEstimate, demandSnapshot] = await Promise.all([
    makePricePrediction({
      fishType: listing.fishType,
      quantity: listing.quantity,
      quality: listing.quality || 'Good',
      size: listing.size || 'Medium',
      freshness: listing.freshness || 'fresh',
      location: listing.location || ''
    }, { save: false }),
    Promise.resolve(buildDemandInsights({
      orders,
      listings,
      auctions,
      bids,
      filters: { fishType: listing.fishType, location: listing.location || '' }
    }))
  ]);
  const speciesDemand = demandSnapshot.species.find(item => item.fishType === listing.fishType) || null;
  res.json({
    ...insights,
    priceEstimate: {
      estimatePerKg: priceEstimate.estimatePerKg,
      minimumPerKg: priceEstimate.minimumPerKg,
      maximumPerKg: priceEstimate.maximumPerKg,
      reliability: priceEstimate.reliability,
      confidence: priceEstimate.confidence,
      disclaimer: priceEstimate.disclaimer
    },
    demand: speciesDemand ? {
      trend: speciesDemand.trend,
      next7Days: speciesDemand.forecast.next7Days,
      dataAvailability: demandSnapshot.dataAvailability.status,
      disclaimer: demandSnapshot.disclaimer
    } : {
      trend: null,
      next7Days: null,
      dataAvailability: 'insufficient_data',
      disclaimer: demandSnapshot.disclaimer
    }
  });
});
router.get('/auctions/:id/chat', requireAuth, async (req, res) => {
  const auction = await get('auctions', req.params.id);
  const listing = auction && await get('listings', auction.listing);
  if (!auction || !listing || listing.status === 'removed') return res.status(404).json({ message: 'Auction not found' });
  if (req.user.role !== 'buyer' && !(req.user.role === 'fisherman' && listing.fisherman === req.user.id)) {
    return res.status(403).json({ message: 'Only buyers and the listing fisherman can view auction chat' });
  }
  const messages = sortNewest((await list('auctionMessages')).filter(message =>
    message.auction === auction.id && message.status !== 'hidden')).slice(0, 100);
  const authors = new Map();
  for (const id of new Set(messages.map(message => message.author))) {
    const user = await get('users', id);
    authors.set(id, user?.name || 'Marketplace member');
  }
  res.json(messages.reverse().map(message => ({
    id: message.id,
    authorName: authors.get(message.author),
    authorRole: message.authorRole,
    content: message.content,
    createdAt: message.createdAt,
    isMine: message.author === req.user.id
  })));
});
router.post('/auctions/:id/chat', requireAuth, async (req, res) => {
  const auction = await get('auctions', req.params.id);
  const listing = auction && await get('listings', auction.listing);
  if (!auction || !listing || listing.status === 'removed') return res.status(404).json({ message: 'Auction not found' });
  if (req.user.role !== 'buyer' && !(req.user.role === 'fisherman' && listing.fisherman === req.user.id)) {
    return res.status(403).json({ message: 'Only buyers and the listing fisherman can post in auction chat' });
  }
  if (['completed', 'cancelled'].includes(auction.status) || Date.parse(auction.endTime) <= Date.now()) {
    return res.status(409).json({ message: 'Auction chat is closed' });
  }
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  if (!content || content.length > 500 || /[\w.+-]+@[\w.-]+\.[A-Z]{2,}/i.test(content)
    || content.replace(/\D/g, '').length >= 10) {
    return res.status(400).json({ message: 'Enter a message up to 500 characters. Contact details are not allowed.' });
  }
  const rateKey = createHash('sha256').update(`${auction.id}:${req.user.id}`).digest('hex');
  const now = Date.now();
  const rateLimit = await transact('auctionChatRateLimits', rateKey, current => {
    if (current && now - Number(current.lastMessageAt || 0) < 1500) return current;
    return { lastMessageAt: now };
  });
  if (!rateLimit.committed) return res.status(429).json({ message: 'Please wait a moment before sending another message' });
  const message = await insert('auctionMessages', {
    auction: auction.id,
    author: req.user.id,
    authorRole: req.user.role,
    content,
    status: 'published'
  });
  res.status(201).json({
    id: message.id,
    authorName: req.user.name || 'Marketplace member',
    authorRole: req.user.role,
    content: message.content,
    createdAt: message.createdAt,
    isMine: true
  });
});
router.post('/auctions/:id/chat/:messageId/report', requireAuth, allow('buyer'), async (req, res) => {
  const message = await get('auctionMessages', req.params.messageId);
  if (!message || message.auction !== req.params.id || message.author === req.user.id) {
    return res.status(404).json({ message: 'Message not found' });
  }
  const reportId = createHash('sha256').update(`${message.id}:${req.user.id}`).digest('hex');
  const result = await transact('auctionMessageReports', reportId, current => current || {
    auction: message.auction,
    message: message.id,
    reporter: req.user.id,
    reason: typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '',
    status: 'pending'
  });
  if (!result.committed) return res.status(409).json({ message: 'You already reported this message' });
  res.status(201).json({ message: 'Report submitted for admin review' });
});
router.post('/auctions/:id/bids', requireAuth, allow('buyer'), async (req, res) => {
  const auction = await get('auctions', req.params.id);
  if (!auction) return res.status(404).json({ message: 'Auction not found' });
  const listing = await get('listings', auction.listing);
  if (!listing || listing.status === 'removed') return res.status(404).json({ message: 'This listing is no longer available' });
  const amount = Number(req.body.amount);
  if (listing.fisherman === req.user.id) return res.status(403).json({ message: 'You cannot bid on your own listing' });
  const requestId = typeof req.body.requestId === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(req.body.requestId) ? req.body.requestId : randomUUID();
  const result = await submitAuctionOffer({ auction, amount, buyerId: req.user.id, mode: 'manual', requestId });
  if (result.error) return res.status(400).json({ message: result.error });
  res.status(201).json(result.response);
});
router.post('/auctions/:id/automatic-bidding', requireAuth, allow('buyer'), async (req, res) => {
  const auction = await get('auctions', req.params.id);
  if (!auction) return res.status(404).json({ message: 'Auction not found' });
  const listing = await get('listings', auction.listing);
  if (!listing || listing.status === 'removed') return res.status(404).json({ message: 'This listing is no longer available' });
  if (listing.fisherman === req.user.id) return res.status(403).json({ message: 'You cannot bid on your own listing' });
  const quantity = Number(listing.quantity);
  const hasBudget = req.body.totalBudget !== undefined && req.body.totalBudget !== '';
  const totalBudget = hasBudget ? Number(req.body.totalBudget) : null;
  const budgetIsValid = Number.isFinite(totalBudget) && totalBudget > 0
    && Number.isSafeInteger(Math.round(totalBudget * 100))
    && Math.abs(totalBudget * 100 - Math.round(totalBudget * 100)) < 1e-7;
  if (hasBudget && (!budgetIsValid || !Number.isFinite(quantity) || quantity <= 0)) {
    return res.status(400).json({ message: 'Enter a valid total budget for this listing' });
  }
  const maxByBudget = hasBudget ? Math.floor(totalBudget / quantity * 100) / 100 : null;
  const requestedMax = req.body.maxAmount === undefined || req.body.maxAmount === ''
    ? maxByBudget
    : Number(req.body.maxAmount);
  if (!Number.isFinite(requestedMax) || requestedMax <= 0) {
    return res.status(400).json({ message: 'Enter a valid maximum bid per kg or a total budget' });
  }
  const maxAmount = hasBudget ? Math.min(requestedMax, maxByBudget) : requestedMax;
  if (hasBudget && maxAmount * quantity > totalBudget + 1e-7) {
    return res.status(400).json({ message: 'Maximum bid exceeds the total budget' });
  }
  const requestId = typeof req.body.requestId === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(req.body.requestId) ? req.body.requestId : randomUUID();
  const result = await submitAuctionOffer({ auction, amount: maxAmount, totalBudget, buyerId: req.user.id, mode: 'automatic', requestId });
  if (result.error) return res.status(400).json({ message: result.error });
  if (!result.response.duplicate) {
    try {
      await insert('notifications', {
        user: req.user.id,
        auction: auction.id,
        type: 'automatic_bidding_activated',
        title: 'Automatic bidding activated',
        message: hasBudget
          ? `Automatic bidding is active within your private total budget of ₹${totalBudget.toLocaleString()} (up to ₹${maxAmount.toLocaleString()}/kg).`
          : `Automatic bidding is active up to your private limit of ₹${maxAmount.toLocaleString()}/kg.`,
        read: false
      }, `automatic_${requestId}_${req.user.id}`);
    } catch (error) {
      console.error(`Automatic-bidding notification failed for ${req.user.id}:`, error);
    }
  }
  res.status(201).json(result.response);
});
router.get('/auctions/:id/automatic-bidding', requireAuth, allow('buyer'), async (req, res) => {
  const auction = await get('auctions', req.params.id);
  if (!auction) return res.status(404).json({ message: 'Auction not found' });
  const automaticBid = auction.autoBids?.[req.user.id];
  res.json({
    enabled: Boolean(automaticBid),
    maxAmount: automaticBid?.amount || null,
    ...(automaticBid?.totalBudget ? { totalBudget: automaticBid.totalBudget } : {})
  });
});
router.delete('/auctions/:id/automatic-bidding', requireAuth, allow('buyer'), async (req, res) => {
  const initialAuction = await get('auctions', req.params.id);
  if (!initialAuction) return res.status(404).json({ message: 'Auction not found' });
  const legacyBids = where(await list('bids'), { auction: req.params.id });
  const bidId = randomUUID();
  let operation = null;
  let closed = false;
  const result = await transact('auctions', req.params.id, current => {
    if (!current) return;
    if (['completed', 'cancelled'].includes(current.status) || Date.parse(current.endTime) <= Date.now()) {
      closed = true;
      return;
    }
    const state = legacyAuctionState(current, legacyBids);
    const autoBids = { ...(state.autoBids || {}) };
    const bidderOffers = { ...(state.bidderOffers || {}) };
    const existing = autoBids[req.user.id];
    if (!existing) return state;
    delete autoBids[req.user.id];
    bidderOffers[req.user.id] = {
      amount: Number(state.currentPrice || state.startPrice),
      source: 'manual',
      sequence: bidderOffers[req.user.id]?.sequence || Number(state.offerSequence || 0) + 1,
      createdAt: bidderOffers[req.user.id]?.createdAt || existing.createdAt
    };
    operation = recalculateAuctionOffers({ ...state, autoBids, bidderOffers }, bidId);
    return operation.auction;
  });
  if (closed) return res.status(409).json({ message: 'Automatic bidding cannot be changed after this auction closes' });
  if (!result.value) return res.status(404).json({ message: 'Auction not found' });
  const removedBid = operation?.bid;
  if (removedBid) {
    const risk = assessBidRisk(removedBid, [...legacyBids, removedBid], result.value);
    try {
      await insert('bids', { ...removedBid, riskReviewNeeded: risk.reviewNeeded, riskFlags: risk.flags }, removedBid.id);
      await notifyBidParticipants({
        auction: result.value,
        bid: removedBid,
        previousBidder: operation.previousBidder,
        actorId: req.user.id,
        legacyBids,
        extended: false
      });
    } catch (error) {
      console.error(`Automatic-bidding shutdown update failed for ${removedBid.id}:`, error);
    }
  }
  res.json({ enabled: false, ...(removedBid ? { bid: removedBid } : {}) });
});
router.patch('/auctions/:id/close', requireAuth, allow('fisherman'), async (req, res) => {
  const auction = await get('auctions', req.params.id);
  const listing = auction && await get('listings', auction.listing);
  if (!auction || !listing || listing.fisherman !== req.user.id) return res.status(404).json({ message: 'Auction not found' });
  if (['completed', 'cancelled'].includes(auction.status)) return res.json(await refreshAuction(auction));
  const endTime = new Date().toISOString();
  await transact('auctions', auction.id, current => {
    if (!current || ['completed', 'cancelled'].includes(current.status)) return;
    return { ...current, endTime };
  });
  const completedAuction = await refreshAuction({ ...auction, endTime });
  const winner = completedAuction.winner ? await get('users', completedAuction.winner) : null;
  res.json({ ...publicAuction(completedAuction), winnerName: winner?.name || null });
});
router.get('/bid-monitoring', requireAuth, allow('fisherman', 'admin'), async (req, res) => {
  const [auctions, listings, bids, users] = await Promise.all(['auctions', 'listings', 'bids', 'users'].map(list));
  const listingById = new Map(listings.map(item => [item.id, item]));
  const userById = new Map(users.map(item => [item.id, sanitizeUser(item)]));
  const visibleAuctions = auctions.filter(auction => {
    const listing = listingById.get(auction.listing);
    return req.user.role === 'admin' || listing?.fisherman === req.user.id;
  });
  res.json(visibleAuctions.map(auction => {
    const auctionBids = where(bids, { auction: auction.id });
    const listing = listingById.get(auction.listing);
    return {
      id: auction.id,
      status: auction.status,
      endTime: auction.endTime,
      winner: auction.winner || null,
      winnerName: userById.get(auction.winner)?.name || null,
      winningBid: Number(auction.winningBid || 0),
      listing: listing ? {
        id: listing.id,
        fishType: listing.fishType,
        quantity: Number(listing.quantity || 0),
        location: listing.location
      } : null,
      activity: analyzeAuctionActivity(auctionBids),
      bids: sortNewest(auctionBids).map(bid => {
        const risk = assessBidRisk(bid, auctionBids, auction);
        const flags = bid.riskFlags?.length ? bid.riskFlags : risk.flags;
        return {
          ...bid,
          buyer: userById.get(bid.buyer) ? { id: bid.buyer, name: userById.get(bid.buyer).name } : { id: bid.buyer, name: 'Unknown buyer' },
          riskReviewNeeded: Boolean(bid.riskReviewNeeded || risk.reviewNeeded),
          riskFlags: flags
        };
      })
    };
  }).sort((a, b) => new Date(b.endTime || 0) - new Date(a.endTime || 0)));
});
router.get('/orders', requireAuth, async (req, res) => { const key = req.user.role === 'buyer' ? 'buyer' : req.user.role === 'fisherman' ? 'fisherman' : null; const orders = key ? where(await list('orders'), { [key]: req.user.id }) : await list('orders'); res.json(sortNewest(orders)); });
router.post('/payments/razorpay/webhook', async (req, res) => {
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) return res.status(503).json({ message: 'Razorpay webhook secret is not configured' });
  const signature = req.get('x-razorpay-signature');
  if (!verifyRazorpayWebhookSignature(req.body, signature)) return res.status(400).json({ message: 'Razorpay webhook signature could not be verified' });

  let event;
  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json({ message: 'Invalid Razorpay webhook payload' });
  }
  if (!['payment.captured', 'order.paid', 'payment.failed'].includes(event.event)) return res.json({ received: true });

  const payment = event.payload?.payment?.entity;
  if (!payment?.order_id) return res.status(400).json({ message: 'Razorpay event is missing its payment order' });
  const transaction = (await list('payments')).find(item => item.gatewayOrderId === payment.order_id);
  if (!transaction) {
    console.warn('Ignoring Razorpay webhook for an unknown order:', payment.order_id);
    return res.status(202).json({ received: true, ignored: true });
  }
  if (transaction.status === 'paid') return res.json({ received: true });
  if (transaction.status !== 'pending') return res.json({ received: true, ignored: true });

  if (event.event === 'payment.failed') {
    await failPayment(transaction, payment.error_description || 'Razorpay payment failed');
    return res.json({ received: true });
  }
  if (payment.status !== 'captured' || Number(payment.amount) !== Math.round(Number(transaction.amount) * 100) || payment.currency !== 'INR') {
    console.error('Razorpay captured payment does not match its transaction:', transaction.id);
    return res.status(400).json({ message: 'Razorpay payment does not match the recorded order' });
  }
  if (!await markPaymentPaid(transaction, payment)) return res.status(404).json({ message: 'Order not found for Razorpay payment' });
  res.json({ received: true });
});
router.post('/payments/razorpay/orders', requireAuth, allow('buyer'), async (req, res) => {
  if (!razorpayConfigured()) return res.status(503).json({ message: 'Razorpay test mode is not configured. Add a Test Mode RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to the root .env file.' });
  let order;
  if (req.body.orderId) {
    order = await get('orders', req.body.orderId);
    if (!order || order.buyer !== req.user.id) return res.status(404).json({ message: 'Order not found' });
  } else if (req.body.auctionId) {
    const auction = await get('auctions', req.body.auctionId);
    if (!auction) return res.status(404).json({ message: 'Auction not found' });
    const refreshed = await refreshAuction(auction);
    if (refreshed.status !== 'completed' || refreshed.winner !== req.user.id) return res.status(403).json({ message: 'Only the winning buyer can checkout this completed bid' });
    order = (await list('orders')).find(item => item.auction === auction.id);
    if (!order) return res.status(404).json({ message: 'Winning order not found' });
  } else if (req.body.listingId) {
    const listing = await get('listings', req.body.listingId);
    if (!listing || listing.saleMode !== 'sale') return res.status(400).json({ message: 'This fish is not available for direct purchase' });
    const existing = (await list('orders')).find(item => item.listing === listing.id && item.purchaseType === 'buyout' && item.paymentStatus === 'pending');
    if (existing && existing.buyer !== req.user.id) return res.status(409).json({ message: 'This fish is currently reserved for another buyer’s payment' });
    if (existing) {
      order = existing;
    } else {
      order = await createBuyoutOrder({ listing, buyerId: req.user.id, address: req.body.address });
      if (!order) return res.status(409).json({ message: 'This fish is no longer available' });
    }
  } else {
    return res.status(400).json({ message: 'Provide a listingId, auctionId, or orderId' });
  }
  try {
    const payment = await beginRazorpayPayment(order, req.body.address);
    res.status(201).json(payment);
  } catch (error) {
    res.status(error.status || 502).json({ message: error.message });
  }
});
router.post('/payments/razorpay/verify', requireAuth, allow('buyer'), async (req, res) => {
  const { transactionId, razorpay_order_id: gatewayOrderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body;
  const transaction = await get('payments', transactionId);
  if (!transaction || transaction.buyer !== req.user.id) return res.status(404).json({ message: 'Payment attempt not found' });
  if (transaction.status === 'paid') return res.json(transaction);
  if (transaction.status !== 'pending' || transaction.gatewayOrderId !== gatewayOrderId) return res.status(409).json({ message: 'Payment attempt is no longer pending' });
  if (!verifyRazorpaySignature(gatewayOrderId, paymentId, signature)) {
    await failPayment(transaction, 'Payment signature could not be verified');
    return res.status(400).json({ message: 'Payment signature could not be verified' });
  }

  const expectedAmount = Math.round(Number(transaction.amount) * 100);
  let payment;
  try {
    payment = await getRazorpayPayment(paymentId);
  } catch (error) {
    console.error('Razorpay payment verification failed:', error.message);
    return res.status(502).json({ message: 'Payment verification is temporarily unavailable. Check transaction history before retrying.' });
  }
  if (payment.order_id !== gatewayOrderId || Number(payment.amount) !== expectedAmount || payment.currency !== 'INR') {
    return res.status(400).json({ message: 'Payment details do not match this order' });
  }
  if (payment.status === 'authorized') {
    try {
      payment = await captureRazorpayPayment(paymentId, expectedAmount);
    } catch (error) {
      console.error('Razorpay payment capture failed:', error.message);
      return res.status(502).json({ message: 'Razorpay authorized the payment but capture could not be confirmed. Check transaction history before retrying.' });
    }
  }
  if (payment.status !== 'captured') {
    await failPayment(transaction, 'Payment was not captured');
    return res.status(402).json({ message: 'Payment was not captured by Razorpay' });
  }

  const paidTransaction = await markPaymentPaid(transaction, payment);
  if (!paidTransaction) return res.status(404).json({ message: 'Order not found for this payment' });
  res.json(paidTransaction);
});
router.post('/payments/razorpay/failure', requireAuth, allow('buyer'), async (req, res) => {
  const transaction = await get('payments', req.body.transactionId);
  if (!transaction || transaction.buyer !== req.user.id) return res.status(404).json({ message: 'Payment attempt not found' });
  if (transaction.status === 'pending') {
    await failPayment(transaction, req.body.reason || 'Payment was cancelled');
  }
  res.json({ message: 'Payment attempt recorded' });
});
router.get('/notifications', requireAuth, async (req, res) => {
  const notifications = where(await list('notifications'), { user: req.user.id });
  res.json(sortNewest(notifications).slice(0, 40));
});
router.patch('/notifications/:id/read', requireAuth, async (req, res) => {
  const notification = await get('notifications', req.params.id);
  if (!notification || notification.user !== req.user.id) return res.status(404).json({ message: 'Notification not found' });
  res.json(await update('notifications', notification.id, { read: true }));
});
router.get('/transactions', requireAuth, async (req, res) => {
  const transactions = sortNewest(await list('payments'));
  const visible = req.user.role === 'admin'
    ? transactions
    : transactions.filter(item => item[req.user.role === 'buyer' ? 'buyer' : 'fisherman'] === req.user.id);
  res.json(await Promise.all(visible.map(async item => {
    const order = await get('orders', item.order);
    const listing = order?.listing ? await get('listings', order.listing) : null;
    return {
      ...item,
      fishType: listing?.fishType || 'Fish order',
      quantity: order?.quantity || 0,
      orderStatus: order?.orderStatus || 'unknown'
    };
  })));
});
router.get('/buyer/history', requireAuth, allow('buyer'), async (req, res) => {
  const [bids, auctions, listings, orders, payments, users, reviews, disputes] = await Promise.all([
    list('bids'),
    list('auctions'),
    list('listings'),
    list('orders'),
    list('payments'),
    list('users'),
    list('reviews'),
    list('disputes')
  ]);
  const buyerBids = bids.filter(bid => bid.buyer === req.user.id);
  const buyerOrders = sortNewest(orders.filter(order => order.buyer === req.user.id));
  const buyerPayments = sortNewest(payments.filter(payment => payment.buyer === req.user.id));
  const buyerReviewOrders = new Set(reviews.filter(review => review.buyer === req.user.id).map(review => review.order));
  const buyerDisputeOrders = new Set(disputes.filter(dispute => dispute.buyer === req.user.id).map(dispute => dispute.order));
  const usersById = new Map(users.map(item => [item.id, item]));
  const bidHistory = buyerBids.map(bid => {
    const auction = auctions.find(item => item.id === bid.auction);
    const listing = auction && listings.find(item => item.id === auction.listing);
    const auctionBids = auction ? sortAmount(bids.filter(item => item.auction === auction.id)) : [];
    const endsAt = auction?.endTime ? new Date(auction.endTime) : null;
    const completed = auction?.status === 'completed' || (endsAt && endsAt <= new Date());
    const winningBid = auctionBids[0];
    return {
      id: bid.id,
      auctionId: auction?.id,
      fishType: listing?.fishType || 'Fish auction',
      quantity: Number(listing?.quantity || 0),
      amount: Number(bid.amount || 0),
      createdAt: bid.createdAt,
      auctionStatus: completed ? 'completed' : auction?.status || 'unknown',
      bidStatus: completed
        ? winningBid?.buyer === req.user.id && winningBid?.id === bid.id ? 'won' : 'ended'
        : winningBid?.id === bid.id ? 'leading' : 'outbid',
      highestBid: Number(winningBid?.amount || 0),
      endTime: auction?.endTime || null,
      demo: Boolean(bid.demo || listing?.demo)
    };
  });
  const orderHistory = buyerOrders.map(order => {
    const listing = listings.find(item => item.id === order.listing);
    const transactions = buyerPayments.filter(payment => payment.order === order.id);
    const verifiedPaid = isVerifiedPaidOrder(order, listing);
    return {
      id: order.id,
      orderNumber: order.orderNumber || order.id,
      fishType: listing?.fishType || 'Fish order',
      fisherman: usersById.get(order.fisherman)?.name || 'Fisherman',
      fishermanId: order.fisherman,
      quantity: Number(order.quantity || listing?.quantity || 0),
      amount: Number(order.amount || 0),
      createdAt: order.createdAt,
      orderStatus: order.orderStatus || 'pending',
      paymentStatus: verifiedPaid ? 'paid' : order.paymentStatus === 'paid' ? 'unverified-demo' : order.paymentStatus || 'pending',
      paymentMethod: order.paymentMethod || null,
      canReview: verifiedPaid && order.orderStatus === 'completed' && !buyerReviewOrders.has(order.id),
      reviewSubmitted: buyerReviewOrders.has(order.id),
      canReport: verifiedPaid && !buyerDisputeOrders.has(order.id),
      demo: Boolean(order.demo),
      transactionIds: transactions.map(payment => payment.id)
    };
  });
  const paymentHistory = await Promise.all(buyerPayments.map(async payment => {
    const order = buyerOrders.find(item => item.id === payment.order);
    const listing = order && listings.find(item => item.id === order.listing);
    return {
      ...payment,
      orderNumber: order?.orderNumber || payment.orderNumber || payment.order,
      fishType: listing?.fishType || 'Fish order',
      quantity: Number(order?.quantity || listing?.quantity || 0)
    };
  }));
  res.json({ bids: sortNewest(bidHistory), orders: orderHistory, payments: paymentHistory });
});
router.get('/buyer/reviews', requireAuth, allow('buyer'), async (req, res) => {
  res.json(sortNewest(where(await list('reviews'), { buyer: req.user.id })));
});
router.post('/orders/:id/reviews', requireAuth, allow('buyer'), async (req, res) => {
  const order = await get('orders', req.params.id);
  if (!order || order.buyer !== req.user.id) return res.status(404).json({ message: 'Order not found' });
  const listing = await get('listings', order.listing);
  if (!isVerifiedPaidOrder(order, listing) || order.orderStatus !== 'completed') {
    return res.status(409).json({ message: 'Reviews are available only for verified paid orders marked completed' });
  }
  const rating = Number(req.body.rating);
  const comment = typeof req.body.comment === 'string' ? req.body.comment.trim() : '';
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || comment.length > 1000) {
    return res.status(400).json({ message: 'Choose a 1–5 star rating and keep feedback under 1,000 characters' });
  }
  const review = {
    order: order.id,
    fisherman: order.fisherman,
    buyer: req.user.id,
    listing: listing.id,
    rating,
    comment,
    status: 'pending',
    moderatedBy: null,
    moderatedAt: null
  };
  const result = await transact('reviews', `order_${order.id}`, current => current ? undefined : review);
  if (!result.committed) return res.status(409).json({ message: 'A review has already been submitted for this order' });
  await refreshFishermanReputation(order.fisherman);
  res.status(201).json({ id: `order_${order.id}`, ...review });
});
router.post('/orders/:id/disputes', requireAuth, allow('buyer'), async (req, res) => {
  const order = await get('orders', req.params.id);
  if (!order || order.buyer !== req.user.id) return res.status(404).json({ message: 'Order not found' });
  const listing = await get('listings', order.listing);
  if (!isVerifiedPaidOrder(order, listing)) return res.status(409).json({ message: 'A complaint requires a verified paid order' });
  const complaint = typeof req.body.complaint === 'string' ? req.body.complaint.trim() : '';
  if (complaint.length < 10 || complaint.length > 2000) {
    return res.status(400).json({ message: 'Describe the issue in 10–2,000 characters' });
  }
  const dispute = {
    order: order.id,
    fisherman: order.fisherman,
    buyer: req.user.id,
    listing: listing.id,
    complaint,
    status: 'open',
    finding: 'unreviewed',
    adminNote: ''
  };
  const result = await transact('disputes', `order_${order.id}`, current => current ? undefined : dispute);
  if (!result.committed) return res.status(409).json({ message: 'A complaint has already been submitted for this order' });
  res.status(201).json({ id: `order_${order.id}`, ...dispute });
});
router.patch('/orders/:id/delivery-schedule', requireAuth, allow('fisherman'), async (req, res) => {
  const order = await get('orders', req.params.id);
  if (!order || order.fisherman !== req.user.id) return res.status(404).json({ message: 'Order not found' });
  const listing = await get('listings', order.listing);
  if (!isVerifiedPaidOrder(order, listing) || ['completed', 'cancelled'].includes(order.orderStatus)) {
    return res.status(409).json({ message: 'A delivery date can be set only for an active, verified paid order' });
  }
  const expectedAt = Date.parse(req.body.expectedDeliveryAt || '');
  if (!Number.isFinite(expectedAt) || expectedAt < Date.now() || expectedAt > Date.now() + 90 * 86400000) {
    return res.status(400).json({ message: 'Choose an expected delivery date within the next 90 days' });
  }
  res.json(await update('orders', order.id, { expectedDeliveryAt: new Date(expectedAt).toISOString() }));
});
router.patch('/orders/:id/status', requireAuth, allow('fisherman', 'admin'), async (req, res) => {
  const order = await get('orders', req.params.id);
  if (!order || (req.user.role === 'fisherman' && order.fisherman !== req.user.id)) return res.status(404).json({ message: 'Order not found' });
  if (typeof req.body.status !== 'string' || !req.body.status) return res.status(400).json({ message: 'Choose an order status' });
  const changes = { orderStatus: req.body.status };
  if (req.user.role === 'fisherman') {
    if (!['delivered', 'completed', 'cancelled'].includes(req.body.status)) {
      return res.status(400).json({ message: 'Fishermen may mark verified orders delivered, completed, or cancelled' });
    }
    const listing = await get('listings', order.listing);
    if (!isVerifiedPaidOrder(order, listing)) return res.status(409).json({ message: 'Only verified paid orders can be progressed' });
    if (req.body.status === 'delivered' && order.orderStatus !== 'processing') {
      return res.status(409).json({ message: 'Only processing orders can be marked delivered' });
    }
    if (req.body.status === 'completed' && order.orderStatus !== 'delivered') {
      return res.status(409).json({ message: 'Mark the order delivered before completing it' });
    }
    if (req.body.status === 'cancelled' && ['completed', 'delivered'].includes(order.orderStatus)) {
      return res.status(409).json({ message: 'Delivered or completed orders cannot be cancelled' });
    }
    if (req.body.status === 'delivered') changes.deliveredAt = new Date().toISOString();
    if (req.body.status === 'completed') changes.completedAt = new Date().toISOString();
    if (req.body.status === 'cancelled') changes.cancellationActor = 'fisherman';
  }
  const updatedOrder = await update('orders', order.id, changes);
  if (order.fisherman) await refreshFishermanReputation(order.fisherman);
  res.json(updatedOrder);
});
router.get('/recommendations', requireAuth, allow('buyer'), async (req, res) => {
  const bids = where(await list('bids'), { buyer: req.user.id });
  const auctionList = await list('auctions');
  const listingIds = auctionList.filter(auction => bids.some(bid => bid.auction === auction.id)).map(auction => auction.listing);
  const items = sortNewest((await list('listings')).filter(item => !listingIds.length || listingIds.includes(item.id))).slice(0, 12);
  const reputations = await getPublicReputationSummaries(items.map(item => item.fisherman));
  res.json(await Promise.all(items.map(item => listingView(item, reputations.get(item.fisherman)))));
});
router.get('/meta', (req, res) => res.json({ fishTypes: FISH_TYPES, qualities: QUALITIES, sizes: SIZES }));
export default router;
