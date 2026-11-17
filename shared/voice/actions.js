import { speechLocale } from './languages.js';
import { extractFishType, extractVoiceAmount } from './intents.js';
import { translate } from './translations.js';

const fishermanActions = new Set(['create_listing', 'update_price', 'update_quantity', 'active_listings', 'sales', 'pending_orders']);
const buyerActions = new Set(['place_bid', 'orders', 'track_order', 'help_order', 'help_bidding']);

const priceOf = item => Number(item.saleMode === 'bid'
  ? item.auction?.currentPrice || item.auction?.startPrice || item.expectedPrice
  : item.salePrice || item.expectedPrice);

function hasPermission(role, intentType) {
  if (fishermanActions.has(intentType)) return role === 'fisherman';
  if (buyerActions.has(intentType)) return role === 'buyer';
  return role === 'buyer' || role === 'fisherman';
}

function activeAuction(item, now = Date.now()) {
  const endTime = Date.parse(item.auction?.endTime || '');
  return item.saleMode === 'bid' && item.auction?.status === 'active'
    && Number.isFinite(endTime) && endTime > now;
}

function categoryMatches(item, category) {
  const fishType = String(item.fishType || '').toLowerCase();
  if (category === 'Prawns') return /prawn|shrimp/i.test(fishType);
  if (category === 'Crab') return /crab/i.test(fishType);
  if (category === 'Squid') return /squid/i.test(fishType);
  if (category === 'Shellfish') return /clam|mussel|oyster|scallop|shellfish/i.test(fishType);
  if (category === 'Fish') return !/prawn|shrimp|crab|squid|lobster|clam|mussel|oyster|shellfish/i.test(fishType);
  return true;
}

function localizedStatus(status, language) {
  const known = ['pending', 'paid', 'failed', 'processing', 'delivered', 'completed', 'cancelled'];
  return known.includes(String(status).toLowerCase())
    ? translate(language, `status${String(status).charAt(0).toUpperCase()}${String(status).slice(1).toLowerCase()}`)
    : translate(language, 'statusUnknown');
}

function formatCurrency(value, language) {
  return new Intl.NumberFormat(speechLocale(language), { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

export function filterVoiceListings(items, intent) {
  let matches = [...items];
  if (intent.fishType) matches = matches.filter(item => String(item.fishType).toLowerCase() === intent.fishType.toLowerCase());
  if (intent.category) matches = matches.filter(item => categoryMatches(item, intent.category));
  if (intent.maxPrice !== null && intent.maxPrice !== undefined) matches = matches.filter(item => priceOf(item) <= intent.maxPrice);
  if (intent.minPrice !== null && intent.minPrice !== undefined) matches = matches.filter(item => priceOf(item) >= intent.minPrice);
  if (intent.location) {
    const location = intent.location.toLocaleLowerCase();
    matches = matches.filter(item => String(item.location || '').toLocaleLowerCase().includes(location));
  } else {
    const location = matches.map(item => item.location).filter(Boolean)
      .find(value => intent.rawText?.toLocaleLowerCase().includes(value.toLocaleLowerCase()));
    if (location) matches = matches.filter(item => item.location === location);
  }
  if (intent.freshest) matches.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  return matches;
}

function timeRemaining(endTime, language) {
  const remaining = Date.parse(endTime || '') - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) return translate(language, 'statusAuctionEnded');
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return translate(language, 'remainingTime', { minutes, seconds });
}

function selectFish(listings, fishType) {
  const candidates = listings.filter(item => !fishType || String(item.fishType).toLowerCase() === fishType.toLowerCase());
  return candidates.length === 1 ? { selected: candidates[0] } : { candidates };
}

export function nextListingField(fields = {}) {
  if (!fields.fishType) return 'fishType';
  if (!Number.isFinite(Number(fields.quantity)) || Number(fields.quantity) <= 0) return 'quantity';
  if (!Number.isFinite(Number(fields.price)) || Number(fields.price) <= 0) return 'price';
  if (!String(fields.location || '').trim()) return 'location';
  return null;
}

export function fillListingField(fields, field, utterance) {
  const next = { ...fields };
  if (field === 'fishType') next.fishType = extractFishType(utterance) || String(utterance).trim();
  if (field === 'quantity') next.quantity = extractVoiceAmount(utterance);
  if (field === 'price') next.price = extractVoiceAmount(utterance);
  if (field === 'location') {
    next.location = String(utterance).trim()
      .replace(/^(?:at|in|from|near|ನಲ್ಲಿ|में|இல்|లో|ൽ)\s+/iu, '')
      .replace(/[,.!?]+$/u, '').trim();
  }
  return next;
}

function confirmationId() {
  return globalThis.crypto?.randomUUID?.()
    || `voice_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function createListingConfirmation(fields, language) {
  const quantity = Number(fields.quantity);
  const price = Number(fields.price);
  if (!String(fields.fishType || '').trim() || !Number.isFinite(quantity) || quantity <= 0
    || !Number.isFinite(price) || price <= 0 || !String(fields.location || '').trim()) {
    return { message: translate(language, 'actionFailed') };
  }
  return {
    confirmation: {
      id: confirmationId(),
      type: 'create_listing',
      requestId: confirmationId().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100),
      fields: {
        fishType: String(fields.fishType).trim(),
        quantity,
        price,
        location: String(fields.location).trim()
      }
    },
    message: translate(language, 'listingPreview', {
      fish: String(fields.fishType).trim(),
      quantity: formatCurrency(quantity, language),
      price: formatCurrency(price, language),
      location: String(fields.location).trim()
    })
  };
}

export async function resolveVoiceIntent({ intent, role, api, language = 'en' }) {
  if (!intent || !hasPermission(role, intent.type)) {
    return { message: translate(language, intent ? 'permissionDenied' : 'unclear') };
  }

  if (intent.type === 'help_order' || intent.type === 'help_bidding') {
    return { message: translate(language, intent.type === 'help_order' ? 'helpOrder' : 'helpBidding') };
  }
  if (intent.type === 'search') {
    const results = filterVoiceListings(await api.listings(), intent);
    return {
      message: results.length ? translate(language, 'searchFound', { count: results.length }) : translate(language, 'emptySearch'),
      results,
      note: intent.freshest ? translate(language, 'freshnessNote') : ''
    };
  }
  if (intent.type === 'show_auctions') {
    const listings = (await api.listings()).filter(item => activeAuction(item)
      && (!intent.fishType || String(item.fishType).toLowerCase() === intent.fishType.toLowerCase()));
    return {
      message: listings.length ? translate(language, 'searchFound', { count: listings.length }) : translate(language, 'auctionsEmpty'),
      results: listings
    };
  }
  if (intent.type === 'auction_info' || intent.type === 'place_bid') {
    const listings = (await api.listings()).filter(item => activeAuction(item)
      && (!intent.fishType || String(item.fishType).toLowerCase() === intent.fishType.toLowerCase()));
    if (!listings.length) return { message: translate(language, 'auctionsEmpty') };
    const { selected, candidates } = selectFish(listings, intent.fishType);
    if (!selected) return { askForFish: true, candidates, intent, message: translate(language, 'selectListing', { count: candidates.length }) };
    const detail = await api.auction(selected.auction.id);
    const auction = detail.auction;
    if (!activeAuction({ ...selected, auction })) return { message: translate(language, 'auctionsEmpty') };
    if (intent.type === 'auction_info') {
      return {
        message: translate(language, 'auctionInfo', {
          fish: detail.listing.fishType,
          price: formatCurrency(auction.currentPrice || auction.startPrice, language),
          time: timeRemaining(auction.endTime, language)
        }),
        auction: detail
      };
    }
    const amount = Number(intent.amount);
    const minimum = Number(auction.minimumBid
      || Number(auction.currentPrice || auction.startPrice) + Number(auction.minimumIncrement || 1));
    if (!Number.isFinite(amount) || amount < minimum) {
      return { message: translate(language, 'bidTooLow', { minimum: formatCurrency(minimum, language) }) };
    }
    return {
      confirmation: {
        id: confirmationId(),
        type: 'place_bid',
        auctionId: selected.auction.id,
        amount,
        fishType: detail.listing.fishType,
        currentBid: Number(auction.currentPrice || auction.startPrice),
        minimum,
        endTime: auction.endTime,
        requestId: confirmationId().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100)
      },
      message: translate(language, 'bidPreview', {
        fish: detail.listing.fishType,
        amount: formatCurrency(amount, language),
        current: formatCurrency(auction.currentPrice || auction.startPrice, language),
        minimum: formatCurrency(minimum, language),
        end: new Intl.DateTimeFormat(speechLocale(language), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(auction.endTime))
      })
    };
  }
  if (intent.type === 'orders' || intent.type === 'track_order') {
    const orders = await api.orders();
    if (intent.type === 'track_order') {
      const order = orders[0];
      return order ? {
        message: translate(language, 'orderStatus', {
          fish: order.fishType || translate(language, 'fishOrder'),
          order: order.orderNumber || order.id,
          status: localizedStatus(order.orderStatus, language),
          payment: localizedStatus(order.paymentStatus, language)
        }),
        orders: [order]
      } : { message: translate(language, 'unavailable') };
    }
    return {
      message: translate(language, 'ordersSummary', {
        count: orders.length,
        details: orders.slice(0, 3).map(order => `${order.fishType || ''} ${localizedStatus(order.orderStatus, language)}`).join(', ')
      }),
      orders
    };
  }
  if (intent.type === 'payment_status') {
    const transactions = await api.transactions();
    return {
      message: transactions.length
        ? translate(language, 'paymentSummary', {
          details: transactions.slice(0, 3).map(item => `${item.fishType || ''} ${localizedStatus(item.status, language)}`).join(', ')
        })
        : translate(language, 'unavailable'),
      transactions
    };
  }
  if (intent.type === 'active_listings') {
    const listings = (await api.fishermanListings()).filter(item => ['available', 'auction'].includes(item.status));
    return {
      message: translate(language, 'listingsSummary', {
        count: listings.length,
        details: listings.slice(0, 3).map(item => item.fishType).join(', ')
      }),
      results: listings
    };
  }
  if (intent.type === 'sales' || intent.type === 'pending_orders') {
    const orders = await api.fishermanSales();
    const pending = orders.filter(order => order.paymentStatus !== 'paid'
      && !['completed', 'cancelled'].includes(order.orderStatus));
    if (intent.type === 'pending_orders') {
      return { message: translate(language, 'pendingSummary', { count: pending.length }), orders: pending };
    }
    const total = orders.reduce((sum, order) => sum + Number(order.amount || 0), 0);
    return {
      message: translate(language, 'salesSummary', { count: orders.length, amount: formatCurrency(total, language) }),
      orders
    };
  }
  if (intent.type === 'create_listing') {
    const fields = intent.fields || {};
    const field = nextListingField(fields);
    if (field) return { askField: field, fields, message: translate(language, `ask${field[0].toUpperCase()}${field.slice(1)}`) };
    const meta = await api.meta();
    if (!meta.fishTypes.includes(String(fields.fishType).trim())) {
      return { askField: 'fishType', fields: { ...fields, fishType: '' }, message: translate(language, 'askFish') };
    }
    return createListingConfirmation(fields, language);
  }
  if (intent.type === 'update_price' || intent.type === 'update_quantity') {
    const listings = (await api.fishermanListings()).filter(item => item.status === 'available' && item.saleMode !== 'bid');
    const { selected, candidates } = selectFish(listings, intent.fishType);
    if (!selected && candidates.length > 1) {
      return { askForFish: true, candidates, intent, message: translate(language, 'selectListing', { count: candidates.length }) };
    }
    if (!selected) return { message: translate(language, 'unavailable') };
    const amount = Number(intent.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { message: translate(language, 'actionFailed') };
    const field = intent.type === 'update_price' ? 'price' : 'quantity';
    const confirmation = {
      id: confirmationId(),
      type: intent.type,
      listingId: selected.id,
      fishType: selected.fishType,
      amount,
      requestId: confirmationId().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100)
    };
    return {
      confirmation,
      message: translate(language, field === 'price' ? 'pricePreview' : 'quantityPreview', {
        fish: selected.fishType,
        price: formatCurrency(amount, language),
        quantity: formatCurrency(amount, language)
      })
    };
  }
  return { message: translate(language, 'unclear') };
}

export async function executeConfirmedVoiceAction({ action, role, api, language = 'en' }) {
  if (!action || !hasPermission(role, action.type)) throw new Error(translate(language, 'permissionDenied'));
  if (action.type === 'place_bid') {
    await api.bid(action.auctionId, action.amount, action.requestId);
    return { message: translate(language, 'bidSubmitted') };
  }
  if (action.type === 'create_listing') {
    const { fishType, quantity, price, location } = action.fields;
    await api.createListing({
      fishType,
      quantity,
      quality: 'Good',
      size: 'Medium',
      location,
      expectedPrice: price,
      salePrice: price,
      saleMode: 'sale',
      requestId: action.requestId
    });
    return { message: translate(language, 'listingCreated') };
  }
  if (action.type === 'update_price') {
    await api.updateListing(action.listingId, { price: action.amount });
    return { message: translate(language, 'priceUpdated') };
  }
  if (action.type === 'update_quantity') {
    await api.updateListing(action.listingId, { quantity: action.amount });
    return { message: translate(language, 'quantityUpdated') };
  }
  throw new Error(translate(language, 'permissionDenied'));
}

export function createVoiceActionGuard(execute) {
  const completed = new Set();
  const running = new Map();
  return action => {
    if (completed.has(action.id)) return Promise.resolve({ duplicate: true });
    if (running.has(action.id)) return running.get(action.id);
    const request = Promise.resolve().then(() => execute(action))
      .then(result => {
        completed.add(action.id);
        return result;
      })
      .finally(() => running.delete(action.id));
    running.set(action.id, request);
    return request;
  };
}
