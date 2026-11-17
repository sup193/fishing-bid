import express from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { SUPPORTED_LANGUAGES } from '../../../shared/voice/languages.js';
import { get, insert, list, update, remove, reserveListing, transact, where, sortNewest, sortAmount, sortEnd, sanitizeUser } from '../db.js';
import { buildMarketTrendPoints } from '../marketTrends.js';
import { allow, requireAuth, signUser } from '../auth.js';
import { FISH_TYPES, QUALITIES, SIZES, assessBidRisk, predictPrice, refreshAuction } from '../utils.js';
import { applyAuctionOffer, auctionBidderIds, minimumBidFor, publicAuction, recalculateAuctionOffers } from '../auctionBidding.js';
import { captureRazorpayPayment, createRazorpayOrder, getRazorpayPayment, razorpayConfigured, verifyRazorpaySignature, verifyRazorpayWebhookSignature } from '../payments.js';

const router = express.Router();
const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const uploadDir = resolve(projectRoot, 'server/uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const imageExtensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, callback) => callback(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${imageExtensions[file.mimetype] || ''}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => callback(null, Boolean(imageExtensions[file.mimetype]))
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
const preferredLanguages = new Set(SUPPORTED_LANGUAGES.map(language => language.code));
const validMoney = value => Number.isFinite(value) && value > 0
  && Number.isSafeInteger(Math.round(value * 100))
  && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
const publicUser = user => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  preferredLanguage: preferredLanguages.has(user.preferredLanguage) ? user.preferredLanguage : 'en'
});
const fishermanFor = async id => sanitizeUser(await get('users', id));
const listingView = async listing => {
  const auction = (await list('auctions')).find(item => item.listing === listing.id) || null;
  const bids = auction ? sortAmount(where(await list('bids'), { auction: auction.id })) : [];
  const currentPrice = Number(auction?.currentPrice || bids[0]?.amount || auction?.startPrice || listing.salePrice || listing.expectedPrice);
  const guide = predictPrice(listing.fishType, Number(listing.quantity), listing.quality, listing.size);
  const storedLow = Number(listing.predictedLow);
  const storedHigh = Number(listing.predictedHigh);
  const hasStoredGuide = Number.isFinite(storedLow) && storedLow > 0 && Number.isFinite(storedHigh) && storedHigh >= storedLow;
  return {
    ...listing,
    predictedLow: hasStoredGuide ? storedLow : guide.low,
    predictedHigh: hasStoredGuide ? storedHigh : guide.high,
    fisherman: await fishermanFor(listing.fisherman),
    auction: auction ? {
      ...publicAuction(auction),
      bidCount: Number(auction.bidCount || bids.length),
      currentPrice,
      priceIncreasePercent: auction.startPrice ? +(((currentPrice - auction.startPrice) / auction.startPrice) * 100).toFixed(2) : 0
    } : null
  };
};

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

async function submitAuctionOffer({ auction, amount, buyerId, mode, requestId }) {
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
  await update('payments', transaction.id, {
    status: 'failed',
    failureReason: String(reason || 'Payment was not completed').slice(0, 160)
  });
  const order = await get('orders', transaction.order);
  if (!order) return;
  await update('orders', order.id, { paymentStatus: 'failed', orderStatus: 'payment-failed' });
  if (order.listing && order.purchaseType === 'buyout') {
    const listing = await get('listings', order.listing);
    if (listing?.status === 'reserved' && listing.reservedBy === order.buyer) {
      await update('listings', listing.id, { status: 'available', reservedBy: null });
    }
  }
}

async function markPaymentPaid(transaction, payment) {
  const order = await get('orders', transaction.order);
  if (!order) return null;
  const paidAt = payment.created_at ? new Date(payment.created_at * 1000).toISOString() : new Date().toISOString();
  const paidTransaction = await update('payments', transaction.id, {
    status: 'paid',
    gatewayPaymentId: payment.id,
    paymentMethod: payment.method,
    paidAt
  });
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
  return paidTransaction;
}

router.post('/auth/register', async (req, res) => { try { const { name, email, password, phone, location } = req.body; const normalizedEmail = email?.toLowerCase(); if (!name || !normalizedEmail || !password) return res.status(400).json({ message: 'Name, email and password are required' }); if ((await list('users')).some(user => user.email === normalizedEmail)) return res.status(400).json({ message: 'Email is already registered' }); const existingRequest = (await list('registrationRequests')).find(item => item.email === normalizedEmail && item.status === 'pending'); if (existingRequest) return res.status(409).json({ message: 'Your registration request is still pending admin approval.', status: 'pending' }); const request = { name, email: normalizedEmail, passwordHash: await bcrypt.hash(password, 12), role: 'buyer', status: 'pending' }; if (phone) request.phone = phone; if (location) request.location = location; await insert('registrationRequests', request); res.status(202).json({ status: 'pending', message: 'Registration submitted. An admin must approve your account before you can sign in.' }); } catch (error) { res.status(400).json({ message: error.message }); } });
router.post('/auth/login', async (req, res) => { try { const email = req.body.email?.trim().toLowerCase(); const user = (await list('users')).find(item => item.email === email); if (!user) { const request = (await list('registrationRequests')).find(item => item.email === email && item.status === 'pending'); if (request) return res.status(403).json({ message: 'Your account request is still pending admin approval.', status: 'pending' }); return res.status(401).json({ message: 'Invalid email or password' }); } if (!(await bcrypt.compare(req.body.password || '', user.passwordHash))) return res.status(401).json({ message: 'Invalid email or password' }); res.json({ token: signUser(user), user: publicUser(user) }); } catch (error) { console.error('Admin/user login failed:', error); res.status(500).json({ message: 'Login service failed', detail: error.message }); } });
router.get('/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));
router.patch('/auth/preferences', requireAuth, async (req, res) => {
  const { preferredLanguage } = req.body;
  if (!preferredLanguages.has(preferredLanguage)) {
    return res.status(400).json({ message: 'Choose a supported marketplace language' });
  }
  const user = await update('users', req.user.id, { preferredLanguage });
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json({ user: publicUser(user) });
});
router.post('/uploads/image', requireAuth, allow('fisherman'), imageUpload, (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Upload a JPG, PNG, or WEBP fish image' });
  res.status(201).json({ imageUrl: `/uploads/${req.file.filename}` });
});
router.post('/fish-detection', limitFishDetection, imageUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Upload a JPG, PNG, or WEBP fish image' });
  const script = resolve(projectRoot, 'predict.py');
  const model = resolve(projectRoot, 'server/models/fish_classifier.keras');
  const labels = resolve(projectRoot, 'server/models/fish_labels.json');
  try {
    const modelIsPointer = fs.existsSync(model) && fs.statSync(model).size < 256 && fs.readFileSync(model, 'utf8').startsWith('version https://git-lfs.github.com/spec/v1');
    if (!fs.existsSync(model) || modelIsPointer) {
      return res.status(503).json({ message: 'Species identification is not set up: the fish classifier model weights are missing. Install the model file and Python/TensorFlow requirements to enable photo detection.' });
    }
    const { stdout } = await execFileAsync(process.env.PYTHON_EXECUTABLE || 'python', [script, '--image', req.file.path, '--model', model, '--labels', labels], {
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
    fs.rmSync(req.file.path, { force: true });
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
router.get('/listings', async (req, res) => { let items = (await list('listings')).filter(item => ['available', 'auction'].includes(item.status)); if (req.query.quality) items = items.filter(item => item.quality === req.query.quality); if (req.query.fishType) items = items.filter(item => item.fishType === req.query.fishType); if (req.query.q) items = items.filter(item => `${item.fishType} ${item.location}`.toLowerCase().includes(req.query.q.toLowerCase())); res.json(await Promise.all(sortNewest(items).map(listingView))); });
router.get('/listings/:id', async (req, res) => { const item = await get('listings', req.params.id); if (!item || item.status === 'removed') return res.status(404).json({ message: 'Listing not found' }); res.json(await listingView(item)); });
router.post('/listings', requireAuth, allow('fisherman'), async (req, res) => {
  const fishType = typeof req.body.fishType === 'string' ? req.body.fishType.trim() : '';
  const quantity = Number(req.body.quantity);
  const quality = req.body.quality || 'Good';
  const size = req.body.size || 'Medium';
  const location = typeof req.body.location === 'string' ? req.body.location.trim() : '';
  const expectedPrice = Number(req.body.expectedPrice);
  const salePrice = Number(req.body.salePrice ?? req.body.expectedPrice);
  const saleMode = req.body.saleMode || 'sale';
  const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
  const imageUrl = typeof req.body.imageUrl === 'string' ? req.body.imageUrl : undefined;
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

  const range = predictPrice(fishType, quantity, quality, size);
  const fields = {
    fisherman: req.user.id,
    fishType,
    quantity,
    quality,
    size,
    location,
    expectedPrice,
    salePrice,
    saleMode,
    description,
    ...(imageUrl ? { imageUrl } : {}),
    imageVerification: 'pending',
    predictedLow: range.low,
    predictedHigh: range.high,
    status: 'available'
  };
  let listing;
  if (requestId) {
    const id = `voice_${createHash('sha256').update(`${req.user.id}:${requestId}`).digest('hex')}`;
    const now = new Date().toISOString();
    const result = await transact('listings', id, current => current ? undefined : {
      ...fields,
      createdAt: now,
      updatedAt: now
    });
    listing = result.value || await get('listings', id);
    if (!result.committed) {
      const sameRequest = listing?.fisherman === req.user.id
        && ['fishType', 'quantity', 'quality', 'size', 'location', 'expectedPrice', 'salePrice', 'saleMode', 'description']
          .every(key => listing[key] === fields[key])
        && (listing.imageUrl || undefined) === fields.imageUrl;
      if (!sameRequest) return res.status(409).json({ message: 'This listing request ID was already used' });
      return res.status(200).json({ ...listing, duplicate: true });
    }
    listing = { id, ...listing };
  } else {
    listing = await insert('listings', fields);
  }
  res.status(201).json(listing);
});
router.get('/fisherman/listings', requireAuth, allow('fisherman'), async (req, res) => res.json(await Promise.all(sortNewest(where(await list('listings'), { fisherman: req.user.id })).map(listingView))));
router.get('/fisherman/sales', requireAuth, allow('fisherman'), async (req, res) => { const orders = sortNewest(where(await list('orders'), { fisherman: req.user.id })); const listings = await list('listings'); res.json(orders.map(order => ({ ...order, listingDetails: listings.find(listing => listing.id === order.listing) || null }))); });
router.patch('/listings/:id', requireAuth, allow('fisherman'), async (req, res) => {
  const listing = await get('listings', req.params.id);
  if (!listing || listing.fisherman !== req.user.id) return res.status(404).json({ message: 'Listing not found' });
  const hasPrice = Object.hasOwn(req.body, 'price');
  const hasQuantity = Object.hasOwn(req.body, 'quantity');
  if (!hasPrice && !hasQuantity || Object.keys(req.body).some(key => !['price', 'quantity'].includes(key))) {
    return res.status(400).json({ message: 'Update only the listing price or quantity' });
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
  const auction = await insert('auctions', {
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
  await update('listings', listing.id, { status: 'auction' });
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
  res.json({
    auction: {
      ...publicAuction(auction),
      currentBidder: leader ? { id: leader.id, name: leader.name } : null,
      minimumBid: minimumBidFor(auction)
    },
    listing: await listingView(listing),
    bids,
    activeBidderCount: auctionBidderIds(auction, legacyBids).length
  });
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
  const maxAmount = Number(req.body.maxAmount);
  if (!Number.isFinite(maxAmount) || maxAmount <= 0) return res.status(400).json({ message: 'Enter a valid maximum bid amount' });
  const requestId = typeof req.body.requestId === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(req.body.requestId) ? req.body.requestId : randomUUID();
  const result = await submitAuctionOffer({ auction, amount: maxAmount, buyerId: req.user.id, mode: 'automatic', requestId });
  if (result.error) return res.status(400).json({ message: result.error });
  if (!result.response.duplicate) {
    try {
      await insert('notifications', {
        user: req.user.id,
        auction: auction.id,
        type: 'automatic_bidding_activated',
        title: 'Automatic bidding activated',
        message: `Automatic bidding is active up to your private limit of ₹${maxAmount.toLocaleString()}/kg.`,
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
  res.json({ enabled: Boolean(automaticBid), maxAmount: automaticBid?.amount || null });
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
      if (!await reserveListing(listing.id, req.user.id)) return res.status(409).json({ message: 'This fish is no longer available' });
      try {
        order = await insert('orders', {
          orderNumber: `TM-${Date.now()}`,
          listing: listing.id,
          buyer: req.user.id,
          fisherman: listing.fisherman,
          quantity: Number(listing.quantity),
          amount: Number(listing.salePrice || listing.expectedPrice) * Number(listing.quantity),
          paymentStatus: 'pending',
          orderStatus: 'awaiting-payment',
          purchaseType: 'buyout',
          ...(req.body.address ? { address: req.body.address } : {})
        });
      } catch (error) {
        await update('listings', listing.id, { status: 'available', reservedBy: null });
        throw error;
      }
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
  const [bids, auctions, listings, orders, payments] = await Promise.all([
    list('bids'),
    list('auctions'),
    list('listings'),
    list('orders'),
    list('payments')
  ]);
  const buyerBids = bids.filter(bid => bid.buyer === req.user.id);
  const buyerOrders = sortNewest(orders.filter(order => order.buyer === req.user.id));
  const buyerPayments = sortNewest(payments.filter(payment => payment.buyer === req.user.id));
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
    const verifiedPaid = order.paymentStatus === 'paid' && order.gateway === 'razorpay';
    return {
      id: order.id,
      orderNumber: order.orderNumber || order.id,
      fishType: listing?.fishType || 'Fish order',
      quantity: Number(order.quantity || listing?.quantity || 0),
      amount: Number(order.amount || 0),
      createdAt: order.createdAt,
      orderStatus: order.orderStatus || 'pending',
      paymentStatus: verifiedPaid ? 'paid' : order.paymentStatus === 'paid' ? 'unverified-demo' : order.paymentStatus || 'pending',
      paymentMethod: order.paymentMethod || null,
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
router.patch('/orders/:id/status', requireAuth, allow('fisherman', 'admin'), async (req, res) => { const order = await get('orders', req.params.id); if (!order || (req.user.role === 'fisherman' && order.fisherman !== req.user.id)) return res.status(404).json({ message: 'Order not found' }); res.json(await update('orders', order.id, { orderStatus: req.body.status })); });
router.get('/recommendations', requireAuth, allow('buyer'), async (req, res) => { const bids = where(await list('bids'), { buyer: req.user.id }); const auctionList = await list('auctions'); const listingIds = auctionList.filter(auction => bids.some(bid => bid.auction === auction.id)).map(auction => auction.listing); const items = await list('listings'); res.json(await Promise.all(sortNewest(items.filter(item => !listingIds.length || listingIds.includes(item.id))).slice(0, 12).map(listingView))); });
router.get('/meta', (req, res) => res.json({ fishTypes: FISH_TYPES, qualities: QUALITIES, sizes: SIZES }));
export default router;
