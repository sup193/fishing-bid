export const AUCTION_INSIGHT_MODEL_VERSION = 'verified-auction-reference-v1';

const round = value => Number(value.toFixed(2));

function quantile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function buildAuctionInsights({ auction, listing, bids = [], verifiedSales = [] }) {
  const currentPrice = Number(auction.currentPrice || auction.startPrice || 0);
  const increment = Number(auction.minimumIncrement || 0);
  const bidders = new Set(bids.map(bid => bid.buyer).filter(Boolean));
  const historicalPrices = verifiedSales
    .filter(sale => sale.fishType === listing.fishType && sale.auctionId !== auction.id)
    .map(sale => Number(sale.pricePerKg))
    .filter(price => Number.isFinite(price) && price > 0);
  const nextMinimumBid = round(currentPrice + increment);
  const hasHistoricalEvidence = historicalPrices.length >= 5;

  let finalPriceRange;
  let historicalMedian = null;
  let method;
  if (hasHistoricalEvidence) {
    historicalMedian = quantile(historicalPrices, 0.5);
    finalPriceRange = {
      minimumPerKg: round(Math.max(currentPrice, quantile(historicalPrices, 0.25))),
      maximumPerKg: round(Math.max(currentPrice, quantile(historicalPrices, 0.75)))
    };
    method = 'verified_completed_auction_percentiles';
  } else {
    const additionalIncrements = Math.max(1, Math.min(3, Math.ceil(Math.max(1, bidders.size) / 2)));
    finalPriceRange = {
      minimumPerKg: round(currentPrice),
      maximumPerKg: round(currentPrice + increment * additionalIncrements)
    };
    method = 'current_bid_activity_baseline';
  }

  return {
    modelVersion: AUCTION_INSIGHT_MODEL_VERSION,
    species: listing.fishType,
    currentPricePerKg: round(currentPrice),
    nextMinimumBidPerKg: nextMinimumBid,
    suggestedBidPerKg: nextMinimumBid,
    estimatedFinalPricePerKg: finalPriceRange,
    historicalMedianPerKg: historicalMedian === null ? null : round(historicalMedian),
    verifiedHistoricalAuctionCount: historicalPrices.length,
    confidence: hasHistoricalEvidence ? 'moderate' : 'low',
    method,
    factors: [
      `${bids.length} recorded bids from ${bidders.size} distinct bidder${bidders.size === 1 ? '' : 's'}.`,
      hasHistoricalEvidence
        ? `Range is based on the 25th–75th percentiles of ${historicalPrices.length} verified paid auction sales for ${listing.fishType}.`
        : 'No five-sale verified history is available for this species; the range uses the current price and one to three minimum increments.'
    ],
    disclaimer: 'Advisory estimate only. It is not a guaranteed closing price; set a bid limit you can afford.'
  };
}

export function analyzeAuctionActivity(bids = []) {
  const counts = new Map();
  for (const bid of bids) {
    if (bid.buyer) counts.set(bid.buyer, (counts.get(bid.buyer) || 0) + 1);
  }
  const participantCount = counts.size;
  const largestShare = bids.length
    ? Math.max(0, ...counts.values()) / bids.length
    : 0;
  const flags = [];
  if (bids.length >= 6 && participantCount >= 1 && largestShare >= 0.75) {
    flags.push({
      code: 'bid_concentration',
      severity: 'medium',
      detail: `One buyer placed ${Math.round(largestShare * 100)}% of recorded bids`
    });
  }

  const ordered = [...bids].sort((left, right) => Date.parse(left.createdAt || 0) - Date.parse(right.createdAt || 0));
  const lastMinute = ordered.filter(bid => {
    const timestamp = Date.parse(bid.createdAt || '');
    return Number.isFinite(timestamp) && timestamp >= Date.now() - 60_000;
  });
  const rapidCounts = new Map();
  for (const bid of lastMinute) {
    rapidCounts.set(bid.buyer, (rapidCounts.get(bid.buyer) || 0) + 1);
  }
  const rapidBidCount = Math.max(0, ...rapidCounts.values());
  if (rapidBidCount >= 5) {
    flags.push({
      code: 'rapid_bidding',
      severity: 'medium',
      detail: `${rapidBidCount} bids by one buyer within the last 60 seconds`
    });
  }
  return {
    reviewNeeded: flags.length > 0,
    participantCount,
    bidCount: bids.length,
    flags
  };
}

export function buildAuctionAnalytics({ auctions = [], listings = [], bids = [] }) {
  const listingById = new Map(listings.map(listing => [listing.id, listing]));
  const bidsByAuction = new Map();
  for (const bid of bids) {
    const group = bidsByAuction.get(bid.auction) || [];
    group.push(bid);
    bidsByAuction.set(bid.auction, group);
  }
  const rows = auctions.map(auction => {
    const listing = listingById.get(auction.listing);
    const auctionBids = bidsByAuction.get(auction.id) || Object.values(auction.bidHistory || {});
    return { auction, listing, bids: auctionBids, activity: analyzeAuctionActivity(auctionBids) };
  });
  const species = new Map();
  const locations = new Map();
  for (const row of rows) {
    if (!row.listing?.fishType) continue;
    const group = species.get(row.listing.fishType) || { fishType: row.listing.fishType, auctions: 0, bids: 0, completed: 0 };
    group.auctions += 1;
    group.bids += row.bids.length;
    if (row.auction.status === 'completed') group.completed += 1;
    species.set(row.listing.fishType, group);
    const locationName = String(row.listing.location || 'Location unavailable').trim() || 'Location unavailable';
    const location = locations.get(locationName) || { location: locationName, auctions: 0, bids: 0, completed: 0 };
    location.auctions += 1;
    location.bids += row.bids.length;
    if (row.auction.status === 'completed') location.completed += 1;
    locations.set(locationName, location);
  }
  const flagged = rows.filter(row => row.activity.reviewNeeded);
  return {
    modelVersion: 'auction-activity-rules-v1',
    summary: {
      totalAuctions: rows.length,
      activeAuctions: rows.filter(row => row.auction.status === 'active').length,
      completedAuctions: rows.filter(row => row.auction.status === 'completed').length,
      totalBids: rows.reduce((total, row) => total + row.bids.length, 0),
      flaggedAuctions: flagged.length
    },
    bySpecies: [...species.values()].sort((left, right) => right.bids - left.bids || right.auctions - left.auctions),
    byLocation: [...locations.values()].sort((left, right) => right.bids - left.bids || right.auctions - left.auctions),
    flaggedAuctions: flagged.map(row => ({
      id: row.auction.id,
      fishType: row.listing?.fishType || 'Unknown',
      location: row.listing?.location || '',
      status: row.auction.status,
      activity: row.activity
    })),
    disclaimer: 'Rule-based review signals are prompts for human investigation, not proof of misconduct.'
  };
}
