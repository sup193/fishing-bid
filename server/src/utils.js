import { get, insert, list, where, sortAmount, transact } from './db.js';
import { auctionBidderIds } from './auctionBidding.js';

export const FISH_TYPES = [
  'Tuna', 'Pomfret', 'Mackerel', 'Sardine', 'Prawns', 'Kingfish', 'Crab', 'Squid', 'Lobster', 'Clams', 'Mussels', 'Oysters', 'Anchovy', 'Seer Fish',
  'Bangus', 'Big Head Carp', 'Black Spotted Barb', 'Catfish', 'Climbing Perch', 'Fourfinger Threadfin', 'Freshwater Eel', 'Glass Perchlet',
  'Goby', 'Gold Fish', 'Gourami', 'Grass Carp', 'Green Spotted Puffer', 'Indian Carp', 'Indo-Pacific Tarpon', 'Jaguar Gapote',
  'Janitor Fish', 'Knifefish', 'Long-Snouted Pipefish', 'Mosquito Fish', 'Mudfish', 'Mullet', 'Pangasius', 'Perch',
  'Scat Fish', 'Silver Barb', 'Silver Carp', 'Silver Perch', 'Snakehead', 'Tenpounder', 'Tilapia'
];
export const QUALITIES = ['Premium', 'Good', 'Standard'];
export const SIZES = ['Small', 'Medium', 'Large'];
export function predictPrice(fishType, quantity, quality, size) {
  const base = { Tuna: 360, Pomfret: 520, Mackerel: 220, Sardine: 180, Prawns: 600, Kingfish: 450, Bangus: 260, Crab: 720, Squid: 340, Lobster: 1200, Clams: 280, Mussels: 320, Oysters: 500, Anchovy: 200, 'Seer Fish': 680 }[fishType] || 250;
  const estimate = base * ({ Premium: 1.18, Good: 1, Standard: 0.84 }[quality] || 1) * ({ Large: 1.12, Medium: 1, Small: 0.9 }[size] || 1) * (quantity > 200 ? 0.98 : 1);
  return { low: +(estimate * 0.92).toFixed(2), high: +(estimate * 1.08).toFixed(2) };
}

export function assessBidRisk(bid, auctionBids, auction) {
  const bidTime = Date.parse(bid.createdAt || new Date().toISOString());
  const previousBids = auctionBids.filter(item => {
    if (item.id === bid.id) return false;
    const itemTime = Date.parse(item.createdAt || '');
    return Number.isFinite(itemTime) && itemTime < bidTime;
  });
  const previousHigh = Math.max(Number(auction.startPrice) || 0, ...previousBids.map(item => Number(item.amount) || 0));
  const increment = Number(auction.minimumIncrement) || 0;
  const amount = Number(bid.amount) || 0;
  const flags = [];
  const bidderBidsInWindow = auctionBids.filter(item => {
    if (item.buyer !== bid.buyer) return false;
    const itemTime = Date.parse(item.createdAt || '');
    return Number.isFinite(itemTime) && itemTime <= bidTime && itemTime >= bidTime - 60_000;
  });

  if (bidderBidsInWindow.length >= 5) {
    flags.push({
      code: 'rapid_bidding',
      severity: 'medium',
      detail: `${bidderBidsInWindow.length} bids from this buyer within 60 seconds`
    });
  }
  if (previousHigh > 0 && amount >= previousHigh * 2 && amount - previousHigh >= increment * 5) {
    flags.push({
      code: 'large_bid_jump',
      severity: 'high',
      detail: `Bid is at least twice the previous high of ₹${previousHigh.toLocaleString()}/kg`
    });
  }

  return { reviewNeeded: flags.length > 0, flags };
}

export async function refreshAuction(auction) {
  if (!auction?.id) {
    console.error('Auction settlement skipped: auction record has no ID');
    return auction;
  }
  const legacyBids = sortAmount(where(await list('bids'), { auction: auction.id }));
  const fallbackBid = legacyBids[0] || null;
  const now = Date.now();
  let invalidAuctionData = false;
  const result = await transact('auctions', auction.id, current => {
    if (!current || current.status === 'cancelled') return;
    const startsAt = Date.parse(current.startTime);
    const endsAt = Date.parse(current.endTime);
    const currentPrice = Number(current.currentPrice || fallbackBid?.amount || current.startPrice || 0);
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt
      || !Number.isFinite(currentPrice) || currentPrice <= 0) {
      invalidAuctionData = true;
      return;
    }
    if (current.status === 'completed') return;
    const status = now < startsAt ? 'scheduled' : now < endsAt ? 'active' : 'completed';
    const currentBidder = current.currentBidder || fallbackBid?.buyer || null;
    const bidCount = Math.max(Number(current.bidCount || 0), legacyBids.length);
    if (status === current.status && currentBidder === current.currentBidder
      && currentPrice === Number(current.currentPrice || 0)
      && bidCount === Number(current.bidCount || 0)) return;
    return {
      ...current,
      status,
      currentBidder,
      currentPrice,
      bidCount,
      ...(status === 'completed' ? {
        winner: currentBidder,
        winningBid: currentBidder ? currentPrice : null,
        result: currentBidder ? 'sold' : 'no-bids',
        closedAt: current.closedAt || new Date(now).toISOString()
      } : {})
    };
  });
  let updated = result.value || await get('auctions', auction.id) || auction;
  if (invalidAuctionData) {
    console.error(`Auction settlement skipped for ${auction.id}: invalid timer or current price`);
    return updated;
  }
  if (updated.status === 'completed') {
    const listing = await get('listings', updated.listing);
    if (listing && updated.winner) {
      const quantity = Number(listing.quantity);
      const winningPrice = Number(updated.winningBid);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(winningPrice) || winningPrice <= 0) {
        console.error(`Auction order skipped for ${updated.id}: invalid quantity or winning price`);
        return updated;
      }
      const existing = (await list('orders')).find(order => order.auction === updated.id);
      if (!existing) {
        const order = await insert('orders', {
          orderNumber: `TM-${Date.now()}`,
          auction: updated.id,
          listing: listing.id,
          buyer: updated.winner,
          fisherman: listing.fisherman,
          quantity,
          amount: Number((winningPrice * quantity).toFixed(2)),
          paymentStatus: 'pending',
          orderStatus: 'awaiting-checkout',
          purchaseType: 'auction',
          address: '',
          paymentMethod: ''
        }, `auction_${updated.id}`);
        updated.order = order.id;
      } else {
        updated.order = existing.id;
      }
    }

    if (!updated.closureNotificationsSent) {
      const recipients = auctionBidderIds(updated, legacyBids);
      const winner = updated.winner;
      for (const recipient of recipients) {
        const won = recipient === winner;
        await insert('notifications', {
          user: recipient,
          auction: updated.id,
          type: won ? 'auction_won' : 'auction_lost',
          title: won ? 'You won the auction' : 'Auction ended',
          message: won
            ? `You won at ₹${Number(updated.winningBid).toLocaleString()}/kg. Your checkout is ready.`
            : `${listing?.fishType || 'The auction'} ended at ₹${Number(updated.winningBid || 0).toLocaleString()}/kg.`,
          read: false
        }, `close_${updated.id}_${recipient}`);
      }
      const marked = await transact('auctions', updated.id, current => {
        if (!current?.closedAt || current.closureNotificationsSent) return;
        return { ...current, closureNotificationsSent: true };
      });
      updated = marked.value || updated;
    }
  } else if (updated.status === 'active' && Date.parse(updated.endTime) - now <= 5 * 60_000
    && Date.parse(updated.endTime) > now && !updated.closingNoticeSentAt) {
    const recipients = auctionBidderIds(updated, legacyBids);
    for (const recipient of recipients) {
      await insert('notifications', {
        user: recipient,
        auction: updated.id,
        type: 'auction_closing_soon',
        title: 'Auction closing soon',
        message: 'This auction is scheduled to close within five minutes.',
        read: false
      }, `closing_${updated.id}_${recipient}`);
    }
    const marked = await transact('auctions', updated.id, current => {
      if (!current || current.closingNoticeSentAt || current.status !== 'active') return;
      return { ...current, closingNoticeSentAt: new Date(now).toISOString() };
    });
    updated = marked.value || updated;
  }
  return updated;
}
