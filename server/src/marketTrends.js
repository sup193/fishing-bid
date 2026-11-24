const trendSources = ['auction', 'market', 'sales'];

export function buildMarketTrendPoints({ listings, auctions, bids, orders, startTime }) {
  const auctionById = new Map(auctions.map(auction => [auction.id, auction]));
  const auctionByListing = new Map(auctions.map(auction => [auction.listing, auction]));
  const listingById = new Map(listings.map(listing => [listing.id, listing]));
  const observationsByDayAndListing = new Map();
  const addObservation = (listing, timestamp, amount, source, recordId = listing?.id) => {
    const observedAt = new Date(timestamp || '').getTime();
    const price = Number(amount);
    if (!listing || !listing.fishType || !trendSources.includes(source)
      || !Number.isFinite(observedAt) || observedAt < startTime
      || !Number.isFinite(price) || price <= 0) return;
    const date = new Date(observedAt).toISOString().slice(0, 10);
    const key = `${date}:${listing.id}:${source}:${recordId}`;
    const previous = observationsByDayAndListing.get(key);
    if (!previous || observedAt > previous.observedAt) {
      observationsByDayAndListing.set(key, { date, fishType: listing.fishType, source, amount: price, observedAt });
    }
  };

  for (const listing of listings) {
    const auction = auctionByListing.get(listing.id);
    const source = listing.saleMode === 'bid' ? 'auction' : 'market';
    const initialPrice = source === 'auction'
      ? auction?.startPrice ?? listing.expectedPrice
      : listing.salePrice || listing.expectedPrice;
    addObservation(listing, listing.createdAt, initialPrice, source);
  }
  for (const bid of bids) {
    const auction = auctionById.get(bid.auction);
    addObservation(auction && listingById.get(auction.listing), bid.createdAt, bid.amount, 'auction');
  }
  for (const order of orders) {
    const listing = listingById.get(order.listing);
    if (order.paymentStatus !== 'paid' || !['razorpay', 'upi'].includes(order.gateway)
      || order.demo || listing?.demo) continue;
    const quantity = Number(order.quantity ?? listing?.quantity);
    const amount = Number(order.amount);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(amount) || amount <= 0) continue;
    addObservation(
      listing,
      order.paidAt || order.updatedAt || order.createdAt,
      amount / quantity,
      'sales',
      order.id || order.orderNumber
    );
  }

  const dailyPrices = new Map();
  for (const observation of observationsByDayAndListing.values()) {
    const key = `${observation.date}:${observation.fishType}:${observation.source}`;
    const point = dailyPrices.get(key) || { date: observation.date, fishType: observation.fishType, source: observation.source, total: 0, observations: 0 };
    point.total += observation.amount;
    point.observations += 1;
    dailyPrices.set(key, point);
  }

  return [...dailyPrices.values()]
    .map(point => ({
      date: point.date,
      fishType: point.fishType,
      source: point.source,
      averagePrice: Number((point.total / point.observations).toFixed(2)),
      observations: point.observations
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.fishType.localeCompare(b.fishType) || a.source.localeCompare(b.source));
}
