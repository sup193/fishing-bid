import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '../..');
dotenv.config({ path: resolve(projectRoot, 'server/.env'), override: false });
dotenv.config({ path: resolve(projectRoot, '.env'), override: false });

const url = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  throw new Error('Live check blocked: set SUPABASE_URL and SUPABASE_SECRET_KEY in a private backend environment.');
}
if (/replace-with|^your_|placeholder/i.test(secret)) {
  throw new Error('Live check blocked: SUPABASE_SECRET_KEY is still a placeholder.');
}
if (/^sb_publishable_/i.test(secret)) {
  throw new Error('Live check blocked: SUPABASE_SECRET_KEY is publishable, not secret.');
}

const supabase = createClient(url, secret, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const coreTables = [
  'users', 'listings', 'auctions', 'bids',
  'orders', 'payments', 'notifications', 'reviews', 'disputes', 'verification_history',
  'reputations', 'price_models', 'price_predictions', 'price_model_evaluations', 'registration_requests',
  'auction_messages', 'auction_message_reports', 'auction_chat_rate_limits'
];
const extraTables = [
  'fish_categories',
  'listing_images',
  'pending_registrations',
  'password_reset_otps',
  'password_reset_tokens'
];
const requiredTables = [...coreTables, ...extraTables];

const results = [];
const suffix = crypto.randomUUID();
const ids = {
  fisherman: `livecheck-user-${suffix}`,
  buyer: `livecheck-buyer-${suffix}`,
  listing: `livecheck-listing-${suffix}`,
  auction: `livecheck-auction-${suffix}`,
  bid: `livecheck-bid-${suffix}`,
  image: `livecheck/listings/${suffix}.png`
};

function record(name, passed, detail = '') {
  results.push({ operation: name, passed, detail });
}

async function cleanup() {
  await supabase.storage.from('fish-images').remove([ids.image]);
  await supabase.from('listing_images').delete().eq('listing', ids.listing);
  await supabase.from('bids').delete().eq('auction', ids.auction);
  await supabase.from('auctions').delete().eq('id', ids.auction);
  await supabase.from('listings').delete().eq('id', ids.listing);
  await supabase.from('users').delete().in('id', [ids.fisherman, ids.buyer]);
}

try {
  try {
    const { error } = await supabase.from('users').select('id').limit(1);
    record('Supabase connection', !error, error?.message || '');
  } catch (error) {
    record('Supabase connection', false, error.message);
  }

  const missingTables = [];
  for (const table of requiredTables) {
    const probeColumn = table === 'fish_categories' ? 'name' : 'id';
    const { error } = await supabase.from(table).select(probeColumn).limit(1);
    if (error) missingTables.push(`${table}: ${error.message}`);
  }
  record('Required tables exist', missingTables.length === 0,
    missingTables.length ? missingTables.join('; ') : `${requiredTables.length} tables checked`);

  const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
  record('fish-images bucket exists',
    !bucketError && Boolean(buckets?.some(bucket => bucket.name === 'fish-images')),
    bucketError?.message || '');

  const now = new Date().toISOString();
  const { error: userError } = await supabase.from('users').insert([
    {
      id: ids.fisherman,
      name: 'Live Check Fisherman',
      email: `livecheck-fisherman-${suffix}@invalid.example`,
      passwordHash: 'NOT_A_REAL_PASSWORD_HASH',
      role: 'fisherman',
      demo: false,
      createdAt: now,
      updatedAt: now
    },
    {
      id: ids.buyer,
      name: 'Live Check Buyer',
      email: `livecheck-buyer-${suffix}@invalid.example`,
      passwordHash: 'NOT_A_REAL_PASSWORD_HASH',
      role: 'buyer',
      demo: false,
      createdAt: now,
      updatedAt: now
    }
  ]);
  if (userError) throw new Error(`User insert failed: ${userError.message}`);
  const { data: savedUsers, error: userReadError } = await supabase.from('users')
    .select('id,name,role').in('id', [ids.fisherman, ids.buyer]);
  record('Insert and retrieve user records',
    !userReadError && savedUsers?.length === 2,
    userReadError?.message || '');

  const { error: categoryError } = await supabase.from('fish_categories').select('name').eq('name', 'Tuna').maybeSingle();
  record('Fish category lookup',
    !categoryError,
    categoryError?.message || '');

  const { data: listing, error: listingError } = await supabase.from('listings').insert({
    id: ids.listing,
    fisherman: ids.fisherman,
    fishType: 'Tuna',
    quality: 'Premium',
    size: 'Medium',
    quantity: 1,
    location: 'Live Check',
    freshness: 'fresh',
    expectedPrice: 100,
    salePrice: 100,
    saleMode: 'bid',
    description: 'Temporary live integration check',
    status: 'available',
    demo: false,
    createdAt: now,
    updatedAt: now
  }).select('*').single();
  if (listingError) throw new Error(`Listing insert failed: ${listingError.message}`);
  const { data: savedListing, error: listingReadError } = await supabase.from('listings')
    .select('id,fisherman,fishType,status').eq('id', ids.listing).single();
  record('Create and retrieve fish listing',
    !listingReadError && savedListing?.id === listing.id,
    listingReadError?.message || '');

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l3sAAAAASUVORK5CYII=', 'base64');
  const { error: uploadError } = await supabase.storage.from('fish-images').upload(ids.image, png, {
    contentType: 'image/png',
    upsert: false
  });
  const publicUrl = supabase.storage.from('fish-images').getPublicUrl(ids.image).data.publicUrl;
  const imageResponse = uploadError ? null : await fetch(publicUrl);
  record('Upload and retrieve fish image',
    !uploadError && imageResponse?.ok,
    uploadError?.message || (imageResponse ? `HTTP ${imageResponse.status}` : 'No response'));

  if (!uploadError) {
    await supabase.from('listing_images').insert({
      id: `livecheck-image-${suffix}`,
      listing: ids.listing,
      storagePath: ids.image,
      imageUrl: publicUrl,
      position: 0,
      contentType: 'image/png',
      isPrimary: true,
      createdAt: now,
      updatedAt: now
    });
  }

  const auctionRecord = {
    id: ids.auction,
    listing: ids.listing,
    startPrice: 100,
    currentPrice: 100,
    minimumIncrement: 10,
    bidCount: 0,
    startTime: now,
    endTime: new Date(Date.now() + 60_000).toISOString(),
    status: 'active',
    bidderOffers: {},
    autoBids: {},
    bidHistory: {},
    processedRequests: {},
    offerSequence: 0,
    closureNotificationsSent: false,
    demo: false,
    legacyData: {}
  };
  const { data: auction, error: auctionError } = await supabase.rpc('tidemarket_create_auction', {
    p_auction_id: ids.auction,
    p_listing_id: ids.listing,
    p_record: auctionRecord
  });
  record('Create auction transaction',
    !auctionError && Boolean(auction),
    auctionError?.message || '');

  if (!auctionError) {
    const row = await supabase.from('auctions').select('*').eq('id', ids.auction).single();
    const bidRecord = {
      ...auctionRecord,
      currentPrice: 110,
      bidCount: 1,
      currentBidder: ids.buyer,
      bidderOffers: {
        [ids.buyer]: { amount: 110, source: 'manual', sequence: 1, createdAt: now }
      },
      bidHistory: {
        [ids.bid]: { id: ids.bid, buyer: ids.buyer, amount: 110, type: 'manual', createdAt: now }
      },
      offerSequence: 1
    };
    const { data: casOne, error: casOneError } = await supabase.rpc('tidemarket_compare_and_set_record', {
      p_table: 'auctions',
      p_id: ids.auction,
      p_expected_version: row.data.version,
      p_record: bidRecord
    });

    const staleRecord = {
      ...bidRecord,
      currentPrice: 120,
      bidCount: 2
    };
    const stale = await supabase.rpc('tidemarket_compare_and_set_record', {
      p_table: 'auctions',
      p_id: ids.auction,
      p_expected_version: row.data.version,
      p_record: staleRecord
    });
    record('Compare-and-set bidding transaction',
      !casOneError && Boolean(casOne) && stale.data === null,
      casOneError?.message || (stale.error?.message || 'Stale transaction unexpectedly succeeded'));
  }

  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (anonKey) {
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data, error } = await anon.from('users').select('id').limit(1);
    record('Anon direct table access denied',
      Boolean(error) && data === null,
      error?.message || 'Direct anon access unexpectedly succeeded');
  } else {
    record('Anon direct table access denied', null, 'Anon/publishable key not configured');
  }
} catch (error) {
  record('Live check stopped', false, error.message);
} finally {
  await cleanup();
}

console.log(JSON.stringify({ results }, null, 2));
