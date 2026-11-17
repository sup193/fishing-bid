export function auctionOfferError(auction, now = Date.now()) {
  const startsAt = Date.parse(auction.startTime);
  const endsAt = Date.parse(auction.endTime);
  if (auction.status === 'cancelled' || auction.status === 'completed' || !Number.isFinite(endsAt) || now >= endsAt) {
    return 'This auction is closed';
  }
  if (Number.isFinite(startsAt) && now < startsAt) return 'This auction has not started yet';
  return null;
}

export function minimumBidFor(auction) {
  return Number(auction.currentPrice || auction.startPrice || 0) + Number(auction.minimumIncrement || 0);
}

function validCurrencyAmount(amount) {
  const paise = Math.round(amount * 100);
  return Number.isFinite(amount) && amount > 0 && Number.isSafeInteger(paise)
    && Math.abs(amount * 100 - paise) < 1e-7;
}

export function recalculateAuctionOffers(auction, bidId, now = Date.now()) {
  const rankedOffers = Object.entries(auction.bidderOffers || {})
    .map(([id, offer]) => ({
      id,
      amount: Number(offer.amount),
      source: offer.source || 'manual',
      sequence: offer.sequence,
      createdAt: offer.createdAt || ''
    }))
    .filter(offer => Number.isFinite(offer.amount) && offer.amount > 0)
    .sort((left, right) => right.amount - left.amount
      || (Number(left.sequence) || Number.MAX_SAFE_INTEGER) - (Number(right.sequence) || Number.MAX_SAFE_INTEGER)
      || left.createdAt.localeCompare(right.createdAt)
      || left.id.localeCompare(right.id));
  const leader = rankedOffers[0];
  if (!leader) return { auction, bid: null };
  const currentPrice = Number(auction.currentPrice || auction.startPrice || 0);
  const increment = Number(auction.minimumIncrement);
  const runnerUp = rankedOffers[1];
  const proposedPrice = leader.source === 'automatic'
    ? Math.min(leader.amount, Math.max(Number(auction.startPrice) || 0, runnerUp?.amount || 0) + increment)
    : leader.amount;
  const nextPrice = Math.max(currentPrice, proposedPrice);
  const leaderChanged = leader.id !== auction.currentBidder;
  const priceChanged = nextPrice > currentPrice;
  const bid = leaderChanged || priceChanged ? {
    id: bidId,
    auction: auction.id,
    buyer: leader.id,
    amount: nextPrice,
    type: leader.source === 'automatic' ? 'automatic' : 'manual',
    createdAt: new Date(now).toISOString()
  } : null;
  const bidHistory = { ...(auction.bidHistory || {}) };
  if (bid) bidHistory[bidId] = bid;
  return {
    auction: {
      ...auction,
      bidHistory,
      currentPrice: nextPrice,
      currentBidder: leader.id,
      bidCount: Object.keys(bidHistory).length,
      lastBidAt: bid?.createdAt || auction.lastBidAt
    },
    bid,
    previousBidder: auction.currentBidder || null,
    leaderChanged,
    extended: false
  };
}

export function applyAuctionOffer(auction, {
  buyerId,
  amount,
  mode,
  bidId,
  requestId,
  now = Date.now()
}) {
  const processedRequests = { ...(auction.processedRequests || {}) };
  const processedRequestKey = requestId ? JSON.stringify([buyerId, requestId]) : null;
  if (processedRequestKey && Object.prototype.hasOwnProperty.call(processedRequests, processedRequestKey)) {
    return { auction, bid: (auction.bidHistory || {})[processedRequests[processedRequestKey]], duplicate: true };
  }

  const error = auctionOfferError(auction, now);
  if (error) return { error };

  const currentPrice = Number(auction.currentPrice || auction.startPrice || 0);
  const increment = Number(auction.minimumIncrement);
  if (!validCurrencyAmount(amount) || !validCurrencyAmount(increment)) {
    return { error: 'Bid amount and minimum increment must be positive amounts with at most two decimal places' };
  }
  const floor = currentPrice + increment;
  if (amount < floor) return { error: `Bid must be at least ₹${floor.toFixed(2)}` };

  const bidderOffers = { ...(auction.bidderOffers || {}) };
  const autoBids = { ...(auction.autoBids || {}) };
  const existingOffer = Number(bidderOffers[buyerId]?.amount || 0);
  const nextSequence = Number(auction.offerSequence || 0) + 1;
  let offerSequence = Number(auction.offerSequence || 0);
  if (mode === 'automatic') {
    const sameLimit = Number(autoBids[buyerId]?.amount) === amount
      && Number(bidderOffers[buyerId]?.sequence || autoBids[buyerId]?.sequence) > 0;
    const sequence = sameLimit
      ? Number(bidderOffers[buyerId]?.sequence || autoBids[buyerId]?.sequence || nextSequence)
      : nextSequence;
    autoBids[buyerId] = {
      amount,
      sequence,
      createdAt: sameLimit ? autoBids[buyerId]?.createdAt || new Date(now).toISOString() : new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString()
    };
    bidderOffers[buyerId] = {
      amount,
      source: 'automatic',
      sequence,
      createdAt: sameLimit ? bidderOffers[buyerId]?.createdAt || new Date(now).toISOString() : new Date(now).toISOString()
    };
    if (!sameLimit) offerSequence = nextSequence;
  } else {
    const automaticLimit = Number(autoBids[buyerId]?.amount || 0);
    const nextAmount = Math.max(existingOffer, amount, automaticLimit);
    const source = automaticLimit > amount ? 'automatic' : 'manual';
    const sameOffer = nextAmount === existingOffer && source === bidderOffers[buyerId]?.source
      && Number(bidderOffers[buyerId]?.sequence) > 0;
    const sequence = sameOffer ? Number(bidderOffers[buyerId]?.sequence || nextSequence) : nextSequence;
    bidderOffers[buyerId] = {
      amount: nextAmount,
      source,
      sequence,
      createdAt: sameOffer ? bidderOffers[buyerId]?.createdAt || new Date(now).toISOString() : new Date(now).toISOString()
    };
    if (!sameOffer) offerSequence = nextSequence;
  }

  const resolved = recalculateAuctionOffers({
    ...auction,
    bidderOffers,
    autoBids,
    offerSequence
  }, bidId, now);
  const { currentPrice: nextPrice } = resolved.auction;

  const endTime = Date.parse(auction.endTime);
  const extendedEndTime = endTime - now <= 30_000
    ? new Date(endTime + 30_000).toISOString()
    : auction.endTime;
  processedRequests[processedRequestKey || bidId] = resolved.bid?.id || null;
  const processedKeys = Object.keys(processedRequests);
  for (const key of processedKeys.slice(0, Math.max(0, processedKeys.length - 200))) delete processedRequests[key];

  return {
    auction: {
      ...auction,
      ...resolved.auction,
      bidderOffers,
      autoBids,
      offerSequence,
      processedRequests,
      status: 'active',
      endTime: extendedEndTime
    },
    bid: resolved.bid,
    previousBidder: resolved.previousBidder,
    leaderChanged: resolved.leaderChanged,
    priceChanged: nextPrice > currentPrice,
    extended: extendedEndTime !== auction.endTime,
    duplicate: false
  };
}

export function auctionBidderIds(auction, legacyBids = []) {
  return [...new Set([
    ...Object.keys(auction.bidderOffers || {}),
    ...Object.values(auction.bidHistory || {}).map(bid => bid.buyer),
    ...legacyBids.map(bid => bid.buyer)
  ].filter(Boolean))];
}

export function publicAuction(auction) {
  if (!auction) return null;
  const {
    bidderOffers,
    autoBids,
    offerSequence,
    processedRequests,
    bidHistory,
    ...publicData
  } = auction;
  return publicData;
}
