import { get, list, transact } from './db.js';

const SCORE_WEIGHTS = Object.freeze({
  completion: 25,
  onTime: 15,
  ratings: 20,
  cancellations: 10,
  disputes: 10,
  verification: 10,
  consistency: 10
});

export function reputationLevel(score) {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Trusted';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Average';
  return 'Needs Improvement';
}

export function isVerifiedPaidOrder(order, listing = null) {
  return order?.paymentStatus === 'paid'
    && (order.gateway === 'razorpay' || (order.gateway === 'upi' && order.paymentMethod === 'upi_qr'))
    && typeof order.transactionRef === 'string'
    && order.transactionRef.length > 0
    && !order.demo
    && !listing?.demo;
}

function percentage(numerator, denominator) {
  return denominator ? Number((numerator / denominator * 100).toFixed(1)) : null;
}

function factor(key, value, sampleCount, explanation) {
  return {
    key,
    weight: SCORE_WEIGHTS[key],
    score: value === null ? null : Number(value.toFixed(1)),
    sampleCount,
    explanation
  };
}

export function calculateFishermanReputation({
  fisherman,
  orders = [],
  reviews = [],
  disputes = [],
  listings = []
}) {
  const listingById = new Map(listings.map(item => [item.id, item]));
  const fishermanOrders = orders.filter(order => order.fisherman === fisherman?.id);
  const verifiedOrders = fishermanOrders.filter(order => isVerifiedPaidOrder(order, listingById.get(order.listing)));
  const completedOrders = verifiedOrders.filter(order => order.orderStatus === 'completed');
  const eligibleOrderIds = new Set(completedOrders.map(order => order.id));
  const approvedReviews = reviews.filter(review => review.fisherman === fisherman?.id
    && review.status === 'approved'
    && eligibleOrderIds.has(review.order));
  const verifiedDisputes = disputes.filter(dispute => dispute.fisherman === fisherman?.id
    && dispute.finding === 'confirmed'
    && verifiedOrders.some(order => order.id === dispute.order));
  const sellerCancellations = verifiedOrders.filter(order => order.orderStatus === 'cancelled'
    && order.cancellationActor === 'fisherman');
  const cancellationSample = verifiedOrders.length;
  const timedDeliveries = completedOrders.filter(order => Number.isFinite(Date.parse(order.expectedDeliveryAt || ''))
    && Number.isFinite(Date.parse(order.deliveredAt || '')));
  const onTimeDeliveries = timedDeliveries.filter(order => Date.parse(order.deliveredAt) <= Date.parse(order.expectedDeliveryAt));
  const averageRating = approvedReviews.length
    ? Number((approvedReviews.reduce((sum, review) => sum + Number(review.rating), 0) / approvedReviews.length).toFixed(2))
    : null;
  const verifiedStatus = fisherman?.verificationStatus === 'verified';
  const enoughActivity = verifiedOrders.length > 0;
  const factors = [
    factor('completion', enoughActivity ? percentage(completedOrders.length, verifiedOrders.length) : null,
      verifiedOrders.length, 'Verified paid orders marked completed.'),
    factor('onTime', timedDeliveries.length ? percentage(onTimeDeliveries.length, timedDeliveries.length) : null,
      timedDeliveries.length, 'Only orders with recorded expected and delivered timestamps are measured.'),
    factor('ratings', averageRating === null ? null : averageRating / 5 * 100,
      approvedReviews.length, 'Approved reviews linked to verified completed orders.'),
    factor('cancellations', cancellationSample
      ? 100 - Number((sellerCancellations.length / cancellationSample * 100).toFixed(1))
      : null, cancellationSample, 'Only recorded fisherman-attributed cancellations are counted.'),
    factor('disputes', enoughActivity ? Math.max(0, 100 - verifiedDisputes.length * 35) : null,
      verifiedDisputes.length, 'Only disputes confirmed by an administrator affect this factor.'),
    factor('verification', verifiedStatus ? 100 : 0, 1,
      verifiedStatus ? 'Administrator-verified account.' : 'Account has not been administrator-verified.'),
    factor('consistency', enoughActivity ? Math.min(100, completedOrders.length * 10) : null,
      completedOrders.length, 'Verified completed orders; full consistency credit begins at ten orders.')
  ];
  const measuredFactors = factors.filter(item => item.score !== null);
  const measuredWeight = measuredFactors.reduce((sum, item) => sum + item.weight, 0);
  const score = enoughActivity && measuredWeight
    ? Math.max(0, Math.min(100, Math.round(measuredFactors.reduce((sum, item) => sum + item.score * item.weight, 0) / measuredWeight)))
    : 0;
  const approvedOrderReviews = approvedReviews
    .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0))
    .slice(0, 5)
    .map(review => ({
      id: review.id,
      rating: Number(review.rating),
      comment: review.comment,
      fishType: listingById.get(orders.find(order => order.id === review.order)?.listing)?.fishType || 'Fish order',
      createdAt: review.createdAt,
      buyerLabel: 'Verified buyer'
    }));
  const improvements = [];
  if (!verifiedStatus) improvements.push('Complete the administrator verification process.');
  if (!verifiedOrders.length) improvements.push('Build a record with verified, paid marketplace orders.');
  else {
    if (completedOrders.length < verifiedOrders.length) improvements.push('Complete paid orders and mark deliveries promptly.');
    if (!timedDeliveries.length) improvements.push('Record expected delivery dates so on-time performance can be measured.');
    else if (onTimeDeliveries.length < timedDeliveries.length) improvements.push('Meet the recorded delivery dates on future orders.');
    if (averageRating === null) improvements.push('Invite buyers to leave feedback after eligible completed orders.');
    else if (averageRating < 4.5) improvements.push('Use buyer feedback to improve catch quality and order communication.');
    if (sellerCancellations.length) improvements.push('Reduce fisherman-initiated order cancellations.');
    if (verifiedDisputes.length) improvements.push('Resolve the confirmed order issues and prevent repeat disputes.');
  }
  const status = enoughActivity ? 'rated' : 'unrated';
  return {
    score,
    level: enoughActivity ? reputationLevel(score) : 'Not yet rated',
    status,
    averageRating,
    reviewCount: approvedReviews.length,
    verifiedOrderCount: verifiedOrders.length,
    completedOrderCount: completedOrders.length,
    successfulDeliveryPercent: enoughActivity ? percentage(completedOrders.length, verifiedOrders.length) : null,
    onTimeDeliveryPercent: timedDeliveries.length ? percentage(onTimeDeliveries.length, timedDeliveries.length) : null,
    onTimeDeliverySampleCount: timedDeliveries.length,
    cancellationPercent: cancellationSample
      ? Number((sellerCancellations.length / cancellationSample * 100).toFixed(1))
      : null,
    cancellationCount: sellerCancellations.length,
    confirmedDisputeCount: verifiedDisputes.length,
    verificationStatus: fisherman?.verificationStatus || 'unverified',
    verified: verifiedStatus,
    factors,
    measuredWeight,
    improvements,
    recentReviews: approvedOrderReviews
  };
}

function sourceSignature(fisherman, orders, reviews, disputes, listings) {
  const listingById = new Map(listings.map(item => [item.id, item]));
  const verified = orders.filter(order => order.fisherman === fisherman.id
    && isVerifiedPaidOrder(order, listingById.get(order.listing)))
    .map(order => [order.id, order.orderStatus, order.expectedDeliveryAt, order.deliveredAt, order.cancellationActor])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
  const reviewState = reviews.filter(item => item.fisherman === fisherman.id)
    .map(item => [item.id, item.status, item.rating, item.order])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
  const disputeState = disputes.filter(item => item.fisherman === fisherman.id)
    .map(item => [item.id, item.status, item.finding, item.order])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
  return JSON.stringify([fisherman.verificationStatus || 'unverified', verified, reviewState, disputeState]);
}

async function loadReputationSources() {
  const [users, orders, reviews, disputes, listings] = await Promise.all([
    list('users'), list('orders'), list('reviews'), list('disputes'), list('listings')
  ]);
  return { users, orders, reviews, disputes, listings };
}

async function persistReputation(fisherman, calculated, sources) {
  const signature = sourceSignature(fisherman, sources.orders, sources.reviews, sources.disputes, sources.listings);
  const result = await transact('reputations', fisherman.id, current => {
    if (current?.sourceSignature === signature) return undefined;
    const changedAt = new Date().toISOString();
    const changed = !current || current.score !== calculated.score
      || current.level !== calculated.level || current.status !== calculated.status;
    const history = changed
      ? [...(current?.history || []), {
        score: calculated.score,
        level: calculated.level,
        status: calculated.status,
        changedAt
      }]
      : current.history || [];
    return {
      ...calculated,
      sourceSignature: signature,
      updatedAt: changedAt,
      history
    };
  });
  return result.value || await get('reputations', fisherman.id);
}

export async function getFishermanReputation(fishermanId) {
  const sources = await loadReputationSources();
  const fisherman = sources.users.find(user => user.id === fishermanId && user.role === 'fisherman');
  if (!fisherman) return null;
  const calculated = calculateFishermanReputation({ fisherman, ...sources });
  const persisted = await persistReputation(fisherman, calculated, sources);
  return { ...calculated, history: persisted?.history || [], updatedAt: persisted?.updatedAt || null };
}

export async function getPublicReputationSummaries(fishermanIds) {
  const ids = [...new Set(fishermanIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const sources = await loadReputationSources();
  const usersById = new Map(sources.users.map(user => [user.id, user]));
  return new Map(ids.map(id => {
    const fisherman = usersById.get(id);
    return [id, fisherman?.role === 'fisherman'
      ? calculateFishermanReputation({ fisherman, ...sources })
      : null];
  }));
}

export async function listFishermanReputations() {
  const sources = await loadReputationSources();
  const fishermen = sources.users.filter(user => user.role === 'fisherman');
  return Promise.all(fishermen.map(async fisherman => ({
    fisherman: {
      id: fisherman.id,
      name: fisherman.name,
      location: fisherman.location || '',
      verificationStatus: fisherman.verificationStatus || 'unverified'
    },
    reputation: await persistReputation(
      fisherman,
      calculateFishermanReputation({ fisherman, ...sources }),
      sources
    )
  })));
}

export async function refreshFishermanReputation(fishermanId) {
  return getFishermanReputation(fishermanId);
}
