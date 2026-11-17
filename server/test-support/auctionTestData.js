import bcrypt from 'bcryptjs';
import fs from 'node:fs';

export async function createAuctionDatabase(databasePath) {
  const passwordHash = await bcrypt.hash('auction-test-password', 4);
  const now = Date.now();
  const future = new Date(now + 60 * 60_000).toISOString();
  const past = new Date(now - 60_000).toISOString();
  const earlier = new Date(now - 60 * 60_000).toISOString();
  const users = Object.fromEntries([
    ...Array.from({ length: 10 }, (_, index) => {
      const number = index + 1;
      return [`buyer-${number}`, {
        name: `Test Buyer ${number}`,
        email: `buyer-${number}@auction.test`,
        passwordHash,
        role: 'buyer'
      }];
    }),
    ['fisherman-1', {
      name: 'Test Fisherman',
      email: 'fisherman@auction.test',
      passwordHash,
      role: 'fisherman'
    }]
  ]);
  const listings = {};
  const auctions = {};

  function addAuction(id, options = {}) {
    const listingId = `listing-${id}`;
    listings[listingId] = {
      fisherman: 'fisherman-1',
      fishType: options.fishType || 'Tuna',
      quantity: options.quantity ?? 12,
      quality: 'Good',
      size: 'Medium',
      location: 'Test Port',
      expectedPrice: 500,
      salePrice: 500,
      saleMode: 'bid',
      status: 'auction',
      imageVerification: 'verified'
    };
    auctions[id] = {
      listing: listingId,
      startPrice: 500,
      currentPrice: 500,
      currentBidder: null,
      bidCount: 0,
      minimumIncrement: 50,
      startTime: earlier,
      endTime: future,
      status: 'active',
      bidderOffers: {},
      autoBids: {},
      offerSequence: 0,
      bidHistory: {},
      processedRequests: {},
      ...options.auction
    };
  }

  for (const id of ['auction-live', 'auction-auto', 'auction-race', 'auction-retry']) addAuction(id);
  addAuction('auction-late', {
    auction: { endTime: new Date(now + 20_000).toISOString() }
  });
  addAuction('auction-web', { fishType: 'Mackerel' });
  addAuction('auction-mobile', { fishType: 'Sardine' });
  addAuction('auction-closed', {
    fishType: 'Pomfret',
    auction: {
      endTime: past,
      status: 'completed',
      winner: 'buyer-2',
      winningBid: 600,
      closedAt: past
    }
  });
  addAuction('auction-settled', {
    fishType: 'Kingfish',
    auction: {
      currentPrice: 700,
      currentBidder: 'buyer-1',
      bidCount: 2,
      endTime: past,
      status: 'active',
      bidderOffers: {
        'buyer-1': { amount: 700, source: 'manual', sequence: 1, createdAt: past },
        'buyer-2': { amount: 650, source: 'manual', sequence: 2, createdAt: past }
      },
      bidHistory: {
        'settled-bid-1': { id: 'settled-bid-1', auction: 'auction-settled', buyer: 'buyer-1', amount: 700, type: 'manual', createdAt: past },
        'settled-bid-2': { id: 'settled-bid-2', auction: 'auction-settled', buyer: 'buyer-2', amount: 650, type: 'manual', createdAt: past }
      }
    }
  });
  addAuction('auction-invalid', {
    auction: {
      currentPrice: 700,
      currentBidder: 'buyer-1',
      endTime: 'not-a-valid-date',
      status: 'active'
    }
  });
  addAuction('auction-invalid-completed', {
    auction: {
      currentPrice: 700,
      currentBidder: 'buyer-1',
      winner: 'buyer-1',
      winningBid: 700,
      endTime: 'not-a-valid-date',
      status: 'completed'
    }
  });
  addAuction('auction-invalid-quantity', {
    quantity: 0,
    auction: {
      currentPrice: 700,
      currentBidder: 'buyer-1',
      bidCount: 1,
      endTime: past,
      status: 'active'
    }
  });

  fs.writeFileSync(databasePath, JSON.stringify({
    users,
    listings,
    auctions,
    orders: {},
    payments: {
      'settlement-payment': {
        order: 'auction_auction-settled',
        orderNumber: 'test-settlement-order',
        buyer: 'buyer-1',
        amount: 8400,
        status: 'pending'
      }
    },
    bids: {},
    notifications: {}
  }, null, 2));
}
