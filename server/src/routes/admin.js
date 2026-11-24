import express from 'express';
import bcrypt from 'bcryptjs';
import { get, insert, list, update, transact, where, sortNewest, sanitizeUser, makeId, reviewFishermanRegistration } from '../db.js';
import { allow, requireAuth } from '../auth.js';
import { getFishermanReputation, listFishermanReputations, refreshFishermanReputation } from '../reputation.js';
import { evaluatePriceModels, MIN_VERIFIED_SALES_FOR_MODEL, verifiedSaleObservations } from '../pricePrediction.js';
import { buildDemandInsights, DEMAND_CATEGORIES, evaluateDemandForecast, fishCategory } from '../demandForecast.js';
import { buildAuctionAnalytics } from '../auctionInsights.js';
const router = express.Router();
router.use(requireAuth, allow('admin'));
router.get('/registration-requests', async (req, res) => res.json(sortNewest(
  (await list('registrationRequests'))
    .filter(item => item.role === 'fisherman' && item.status === 'pending')
    .map(({ passwordHash, ...item }) => item)
)));
router.patch('/registration-requests/:id/accept', async (req, res) => {
  const result = await reviewFishermanRegistration({
    requestId: req.params.id,
    action: 'approve',
    adminId: req.user.id,
    userId: makeId('user')
  });
  if (result.status === 'not_found') return res.status(404).json({ message: 'Pending fisherman registration not found' });
  if (result.status === 'duplicate') return res.status(409).json({ message: 'Email or phone number is already registered' });
  return res.json({ message: 'Fisherman account approved', user: sanitizeUser(result.user) });
});
router.patch('/registration-requests/:id/reject', async (req, res) => {
  const result = await reviewFishermanRegistration({
    requestId: req.params.id,
    action: 'reject',
    adminId: req.user.id,
    userId: makeId('user')
  });
  if (result.status === 'not_found') return res.status(404).json({ message: 'Pending fisherman registration not found' });
  return res.json({ status: result.status, message: 'Fisherman registration rejected' });
});
router.post('/fishermen', async (req, res) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || password.length < 8 || password.length > 128) {
      return res.status(400).json({ message: 'Use a valid name and email, and a password between 8 and 128 characters' });
    }
    const existing = (await list('users')).find(user => user.email === email);
    if (existing) return res.status(400).json({ message: 'Email is already registered' });
    const fishermanData = {
      name,
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: 'fisherman',
      verificationStatus: 'verified'
    };
    const phone = typeof req.body.phone === 'string' ? req.body.phone.trim().slice(0, 30) : '';
    const location = typeof req.body.location === 'string' ? req.body.location.trim().slice(0, 120) : '';
    if (phone) fishermanData.phone = phone;
    if (location) fishermanData.location = location;
    const fisherman = await insert('users', fishermanData);
    res.status(201).json(sanitizeUser(fisherman));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});
router.get('/fishermen/:id', async (req, res) => { const fisherman = await get('users', req.params.id); if (!fisherman || fisherman.role !== 'fisherman') return res.status(404).json({ message: 'Fisherman not found' }); const listings = (await list('listings')).filter(item => item.fisherman === fisherman.id); const auctions = await list('auctions'); const bids = await list('bids'); const orders = (await list('orders')).filter(item => item.fisherman === fisherman.id); const paidOrders = orders.filter(order => order.paymentStatus === 'paid' && order.gateway === 'razorpay'); const fish = listings.map(listing => { const auction = auctions.find(item => item.listing === listing.id); const fishBids = auction ? bids.filter(item => item.auction === auction.id) : []; const sale = orders.find(item => item.listing === listing.id); const paidSale = paidOrders.find(item => item.listing === listing.id); return { ...listing, auction: auction || null, bids: fishBids.length, highestBid: Math.max(0, ...fishBids.map(item => Number(item.amount || 0))), saleAmount: Number(paidSale?.amount || 0), saleStatus: sale ? `${sale.orderStatus} · payment ${sale.paymentStatus}` : listing.status }; }); res.json({ fisherman: sanitizeUser(fisherman), reputation: await getFishermanReputation(fisherman.id), listings: fish, orders, totalGained: paidOrders.reduce((total, order) => total + Number(order.amount || 0), 0) }); });
router.get('/reputation', async (req, res) => res.json(await listFishermanReputations()));
router.get('/reviews', async (req, res) => res.json(sortNewest(await list('reviews'))));
router.patch('/reviews/:id/moderation', async (req, res) => {
  const review = await get('reviews', req.params.id);
  if (!review) return res.status(404).json({ message: 'Review not found' });
  const status = req.body.status;
  const moderationNote = typeof req.body.moderationNote === 'string' ? req.body.moderationNote.trim().slice(0, 500) : '';
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ message: 'Review status must be approved or rejected' });
  const moderated = await update('reviews', review.id, {
    status,
    moderationNote,
    moderatedBy: req.user.id,
    moderatedAt: new Date().toISOString()
  });
  await refreshFishermanReputation(review.fisherman);
  res.json(moderated);
});
router.get('/disputes', async (req, res) => res.json(sortNewest(await list('disputes'))));
router.patch('/disputes/:id/review', async (req, res) => {
  const dispute = await get('disputes', req.params.id);
  if (!dispute) return res.status(404).json({ message: 'Complaint not found' });
  const finding = req.body.finding;
  const adminNote = typeof req.body.adminNote === 'string' ? req.body.adminNote.trim().slice(0, 1000) : '';
  if (!['confirmed', 'not_confirmed'].includes(finding)) return res.status(400).json({ message: 'Choose confirmed or not confirmed' });
  const reviewed = await update('disputes', dispute.id, {
    finding,
    status: 'reviewed',
    adminNote,
    reviewedBy: req.user.id,
    reviewedAt: new Date().toISOString()
  });
  await refreshFishermanReputation(dispute.fisherman);
  res.json(reviewed);
});
router.get('/auction-analytics', async (req, res) => {
  const [allAuctions, listings, bids] = await Promise.all(['auctions', 'listings', 'bids'].map(list));
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const from = req.query.from ? Date.parse(`${req.query.from}T00:00:00.000Z`) : null;
  const to = req.query.to ? Date.parse(`${req.query.to}T23:59:59.999Z`) : null;
  if ((req.query.from && (!datePattern.test(req.query.from) || !Number.isFinite(from)))
    || (req.query.to && (!datePattern.test(req.query.to) || !Number.isFinite(to)))
    || (from !== null && to !== null && from > to)) {
    return res.status(400).json({ message: 'Provide a valid date range using YYYY-MM-DD' });
  }
  const listingById = new Map(listings.map(listing => [listing.id, listing]));
  const allowedStatuses = ['scheduled', 'active', 'completed', 'cancelled'];
  if (req.query.category && !DEMAND_CATEGORIES.includes(req.query.category)) {
    return res.status(400).json({ message: 'Category filter is invalid' });
  }
  if (req.query.status && !allowedStatuses.includes(req.query.status)) {
    return res.status(400).json({ message: 'Status filter is invalid' });
  }
  const filtered = allAuctions.filter(auction => {
    const listing = listingById.get(auction.listing);
    const createdAt = Date.parse(auction.createdAt || '');
    return (!req.query.fishType || listing?.fishType === req.query.fishType)
      && (!req.query.category || fishCategory(listing?.fishType) === req.query.category)
      && (!req.query.location || String(listing?.location || '').toLowerCase() === String(req.query.location).trim().toLowerCase())
      && (!req.query.status || auction.status === req.query.status)
      && (from === null || (Number.isFinite(createdAt) && createdAt >= from))
      && (to === null || (Number.isFinite(createdAt) && createdAt <= to));
  });
  res.json(buildAuctionAnalytics({ auctions: filtered, listings, bids }));
});
router.get('/auction-chat/reports', async (req, res) => {
  const [reports, messages, users] = await Promise.all(['auctionMessageReports', 'auctionMessages', 'users'].map(list));
  const messageById = new Map(messages.map(message => [message.id, message]));
  const userById = new Map(users.map(user => [user.id, sanitizeUser(user)]));
  res.json(sortNewest(reports.filter(report => report.status === 'pending').map(report => {
    const message = messageById.get(report.message);
    return {
      ...report,
      message: message ? {
        id: message.id,
        auction: message.auction,
        content: message.content,
        authorName: userById.get(message.author)?.name || 'Marketplace member',
        status: message.status || 'published'
      } : null,
      reporterName: userById.get(report.reporter)?.name || 'Marketplace member'
    };
  })));
});
router.patch('/auction-chat/:id/moderation', async (req, res) => {
  const message = await get('auctionMessages', req.params.id);
  if (!message) return res.status(404).json({ message: 'Auction message not found' });
  const status = req.body.status;
  if (!['published', 'hidden'].includes(status)) return res.status(400).json({ message: 'Status must be published or hidden' });
  const moderationNote = typeof req.body.moderationNote === 'string' ? req.body.moderationNote.trim().slice(0, 500) : '';
  const moderated = await update('auctionMessages', message.id, {
    status,
    moderationNote,
    moderatedBy: req.user.id,
    moderatedAt: new Date().toISOString()
  });
  const reports = (await list('auctionMessageReports')).filter(report => report.message === message.id && report.status === 'pending');
  await Promise.all(reports.map(report => update('auctionMessageReports', report.id, {
    status: 'reviewed',
    reviewedBy: req.user.id,
    reviewedAt: new Date().toISOString()
  })));
  res.json(moderated);
});
router.patch('/fishermen/:id/verification', async (req, res) => {
  const fisherman = await get('users', req.params.id);
  if (!fisherman || fisherman.role !== 'fisherman') return res.status(404).json({ message: 'Fisherman not found' });
  if (typeof req.body.verified !== 'boolean') return res.status(400).json({ message: 'verified must be true or false' });
  const status = req.body.verified ? 'verified' : 'unverified';
  const updated = await update('users', fisherman.id, {
    verificationStatus: status,
    verificationUpdatedAt: new Date().toISOString(),
    verificationUpdatedBy: req.user.id
  });
  await insert('verificationHistory', {
    fisherman: fisherman.id,
    status,
    admin: req.user.id,
    previousStatus: fisherman.verificationStatus || 'unverified'
  });
  const reputation = await refreshFishermanReputation(fisherman.id);
  res.json({ fisherman: sanitizeUser(updated), reputation });
});
router.get('/price-analytics', async (req, res) => {
  const [orders, listings, predictions, activeModel, evaluations] = await Promise.all([
    list('orders'), list('listings'), list('pricePredictions'), get('priceModels', 'active'), list('priceModelEvaluations')
  ]);
  const observations = verifiedSaleObservations(orders, listings);
  const groups = new Map();
  for (const sale of observations) {
    const group = groups.get(sale.fishType) || { fishType: sale.fishType, observations: 0, total: 0, prices: [] };
    group.observations += 1;
    group.total += sale.pricePerKg;
    group.prices.push(sale.pricePerKg);
    groups.set(sale.fishType, group);
  }
  const species = [...groups.values()].map(group => ({
    fishType: group.fishType,
    observations: group.observations,
    averagePricePerKg: Number((group.total / group.observations).toFixed(2)),
    minimumPricePerKg: Number(Math.min(...group.prices).toFixed(2)),
    maximumPricePerKg: Number(Math.max(...group.prices).toFixed(2))
  })).sort((left, right) => right.observations - left.observations);
  res.json({
    dataAvailability: {
      verifiedSaleCount: observations.length,
      requiredSampleCount: MIN_VERIFIED_SALES_FOR_MODEL,
      canEvaluateModel: observations.length >= MIN_VERIFIED_SALES_FOR_MODEL
    },
    model: activeModel || { model: 'rule_baseline', status: 'preliminary' },
    predictionUsageCount: predictions.length,
    species,
    mostFrequentlySold: species.slice(0, 5),
    evaluations: sortNewest(evaluations).slice(0, 10)
  });
});
router.post('/price-model/evaluate', async (req, res) => {
  const [orders, listings] = await Promise.all([list('orders'), list('listings')]);
  const observations = verifiedSaleObservations(orders, listings);
  const evaluation = evaluatePriceModels(observations);
  const record = await insert('priceModelEvaluations', {
    ...evaluation,
    requestedBy: req.user.id,
    evaluatedAt: new Date().toISOString()
  });
  if (evaluation.status === 'evaluated') {
    const model = evaluation.selectedModel === 'linear_regression' ? {
      model: 'linear_regression',
      status: 'validated',
      intercept: evaluation.coefficients.intercept,
      slope: evaluation.coefficients.slope,
      trainingSampleCount: evaluation.trainingCount,
      validation: {
        split: evaluation.split,
        testCount: evaluation.testCount,
        metrics: evaluation.linearRegression
      },
      evaluationId: record.id,
      trainedAt: record.evaluatedAt
    } : {
      model: 'rule_baseline',
      status: 'evaluated',
      trainingSampleCount: evaluation.trainingCount,
      validation: {
        split: evaluation.split,
        testCount: evaluation.testCount,
        metrics: evaluation.baseline
      },
      evaluationId: record.id,
      trainedAt: record.evaluatedAt
    };
    await transact('priceModels', 'active', () => model);
  }
  res.status(evaluation.status === 'insufficient_data' ? 409 : 200).json({ ...evaluation, evaluationId: record.id });
});
router.get('/demand/analytics', async (req, res) => {
  try {
    const [orders, listings, auctions, bids] = await Promise.all([
      list('orders'), list('listings'), list('auctions'), list('bids')
    ]);
    res.json(buildDemandInsights({
      orders,
      listings,
      auctions,
      bids,
      filters: {
        from: req.query.from,
        to: req.query.to,
        fishType: req.query.fishType,
        category: req.query.category,
        location: req.query.location
      },
      now: Date.now()
    }));
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    throw error;
  }
});
router.get('/demand/performance', async (req, res) => {
  const [orders, listings] = await Promise.all([list('orders'), list('listings')]);
  res.json({
    asOf: new Date().toISOString(),
    ...evaluateDemandForecast({ orders, listings })
  });
});
router.get('/listings', async (req, res) => {
  const [listings, users, auctions, bids] = await Promise.all(['listings', 'users', 'auctions', 'bids'].map(list));
  const usersById = new Map(users.map(user => [user.id, sanitizeUser(user)]));
  const auctionByListing = new Map(auctions.map(auction => [auction.listing, auction]));
  const bidCounts = bids.reduce((counts, bid) => {
    counts[bid.auction] = (counts[bid.auction] || 0) + 1;
    return counts;
  }, {});
  res.json(sortNewest(listings).map(item => {
    const auction = auctionByListing.get(item.id);
    return {
      ...item,
      fisherman: usersById.get(item.fisherman) || null,
      auction: auction ? { ...auction, bidCount: bidCounts[auction.id] || 0 } : null
    };
  }));
});
router.delete('/listings/:id', async (req, res) => {
  const listing = await get('listings', req.params.id);
  if (!listing || listing.status === 'removed') return res.status(404).json({ message: 'Marketplace listing not found' });
  const auction = (await list('auctions')).find(item => item.listing === listing.id);
  if (auction && auction.status !== 'completed' && auction.status !== 'cancelled') {
    await update('auctions', auction.id, { status: 'cancelled', endTime: new Date().toISOString(), cancelledBy: req.user.id });
  }
  const removedListing = await update('listings', listing.id, {
    status: 'removed',
    removedAt: new Date().toISOString(),
    removedBy: req.user.id
  });
  res.json({ message: `${listing.fishType || 'Listing'} removed from the marketplace`, listing: removedListing });
});
router.get('/overview', async (req, res) => { const [users, listings, auctions, bids, orders] = await Promise.all(['users', 'listings', 'auctions', 'bids', 'orders'].map(list)); const paidTotal = orders.filter(order => order.paymentStatus === 'paid' && order.gateway === 'razorpay').reduce((total, order) => total + Number(order.amount || 0), 0); res.json({ counts: { users: users.length, listings: listings.filter(item => ['available', 'auction'].includes(item.status)).length, auctions: auctions.length, bids: bids.length, orders: orders.length }, paidTotal, recentOrders: sortNewest(orders).slice(0, 8) }); });
router.get('/users', async (req, res) => res.json(sortNewest((await list('users')).map(sanitizeUser))));
export default router;
