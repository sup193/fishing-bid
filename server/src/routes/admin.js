import express from 'express';
import bcrypt from 'bcryptjs';
import { get, insert, list, update, transact, where, sortNewest, sanitizeUser } from '../db.js';
import { allow, requireAuth } from '../auth.js';
import { getFishermanReputation, listFishermanReputations, refreshFishermanReputation } from '../reputation.js';
import { evaluatePriceModels, MIN_VERIFIED_SALES_FOR_MODEL, verifiedSaleObservations } from '../pricePrediction.js';
const router = express.Router();
router.use(requireAuth, allow('admin'));
router.get('/registration-requests', async (req, res) => res.json(sortNewest((await list('registrationRequests')).filter(item => item.status === 'pending').map(item => ({ ...item, passwordHash: undefined })) )));
router.patch('/registration-requests/:id/accept', async (req, res) => { const request = await get('registrationRequests', req.params.id); if (!request || request.status !== 'pending') return res.status(404).json({ message: 'Pending request not found' }); if ((await list('users')).some(user => user.email === request.email)) return res.status(409).json({ message: 'Email is already registered' }); const userData = { name: request.name, email: request.email, passwordHash: request.passwordHash, role: 'buyer' }; if (request.phone) userData.phone = request.phone; if (request.location) userData.location = request.location; const user = await insert('users', userData); await update('registrationRequests', request.id, { status: 'accepted', reviewedAt: new Date().toISOString(), reviewedBy: req.user.id }); res.json({ message: 'Buyer account approved', user: sanitizeUser(user) }); });
router.patch('/registration-requests/:id/reject', async (req, res) => { const request = await get('registrationRequests', req.params.id); if (!request || request.status !== 'pending') return res.status(404).json({ message: 'Pending request not found' }); res.json(await update('registrationRequests', request.id, { status: 'rejected', reviewedAt: new Date().toISOString(), reviewedBy: req.user.id })); });
router.post('/fishermen', async (req, res) => { try { const { name, email, password, phone, location } = req.body; if (!name || !email || !password) return res.status(400).json({ message: 'Name, email and password are required' }); const normalizedEmail = email.toLowerCase(); const existing = (await list('users')).find(user => user.email === normalizedEmail); if (existing) return res.status(400).json({ message: 'Email is already registered' }); const fishermanData = { name, email: normalizedEmail, passwordHash: await bcrypt.hash(password, 12), role: 'fisherman' }; if (phone) fishermanData.phone = phone; if (location) fishermanData.location = location; const fisherman = await insert('users', fishermanData); res.status(201).json(sanitizeUser(fisherman)); } catch (error) { res.status(400).json({ message: error.message }); } });
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
