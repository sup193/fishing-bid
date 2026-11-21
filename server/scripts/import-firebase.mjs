import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSupabase, TABLES, toDatabaseRecord } from '../src/db.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '../../');
dotenv.config({ path: resolve(projectRoot, '.env') });

if (!process.argv.includes('--confirm-append-only')) {
  throw new Error('No data was written. Review the export, then rerun with --confirm-append-only.');
}

const inputArgument = process.argv.findIndex(argument => argument === '--input');
const inputValue = inputArgument >= 0 ? process.argv[inputArgument + 1] : null;
if (inputArgument >= 0 && !inputValue) throw new Error('--input requires a file path.');
const inputPath = inputValue ? resolve(inputValue) : resolve(projectRoot, 'server/data/firebase-export.json');
if (!fs.existsSync(inputPath)) throw new Error(`Firebase export file does not exist: ${inputPath}`);
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before importing.');
}

const exportData = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const client = initSupabase();
const reportArgument = process.argv.findIndex(argument => argument === '--report');
const reportValue = reportArgument >= 0 ? process.argv[reportArgument + 1] : null;
if (reportArgument >= 0 && !reportValue) throw new Error('--report requires a file path.');
const reportPath = reportValue
  ? resolve(reportValue)
  : resolve(projectRoot, `server/data/firebase-import-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const collections = [
  'users', 'registrationRequests', 'listings', 'auctions', 'bids', 'orders',
  'payments', 'notifications', 'reviews', 'disputes', 'verificationHistory',
  'reputations', 'priceModelEvaluations', 'priceModels', 'pricePredictions',
  'auctionMessages', 'auctionMessageReports', 'auctionChatRateLimits'
];
const report = {
  startedAt: new Date().toISOString(),
  inputPath,
  strategy: 'Append-only by primary key: existing Supabase rows are never overwritten.',
  collections: {},
  sourceOrphans: [],
  targetCounts: {},
  errors: []
};

function timestampValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = Math.abs(value) < 100_000_000_000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }
  if (typeof value === 'string' && /^\d{10,13}$/.test(value)) {
    return timestampValue(Number(value));
  }
  return value;
}

function normalizeValue(key, value) {
  if (/(?:At|Time)$/.test(key)) return timestampValue(value);
  if (Array.isArray(value)) return value.map(item => normalizeValue('', item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      normalizeValue(childKey, childValue)
    ]));
  }
  return value;
}

function normalizeTimestamps(record) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, normalizeValue(key, value)]));
}

function firebaseRows(collection) {
  const source = exportData[collection];
  if (!source || typeof source !== 'object' || Array.isArray(source)) return [];
  return Object.entries(source).flatMap(([id, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      report.errors.push({ collection, id, message: 'Record is not a JSON object; skipped.' });
      return [];
    }
    return [{ id, ...normalizeTimestamps(value) }];
  });
}

const sourceBids = new Map(firebaseRows('bids').map(bid => [bid.id, bid]));
for (const auction of firebaseRows('auctions')) {
  const nested = auction.bidHistory && typeof auction.bidHistory === 'object'
    ? auction.bidHistory
    : {};
  for (const [id, value] of Object.entries(nested)) {
    if (!value || typeof value !== 'object') continue;
    if (!sourceBids.has(id)) sourceBids.set(id, { id, auction: auction.id, ...normalizeTimestamps(value) });
  }
}

const allRows = Object.fromEntries(collections.map(collection => [collection, firebaseRows(collection)]));
allRows.bids = [...sourceBids.values()];

for (const collection of collections) {
  const rows = allRows[collection];
  const table = TABLES[collection];
  const summary = report.collections[collection] = {
    sourceCount: rows.length,
    insertedCount: 0,
    preexistingCount: 0,
    failedCount: 0
  };
  for (let offset = 0; offset < rows.length; offset += 200) {
    const batch = rows.slice(offset, offset + 200);
    const prepared = batch.map(row => ({
      id: row.id,
      ...toDatabaseRecord(collection, row)
    }));
    try {
      const { data: saved, error } = await client.from(table)
        .upsert(prepared, { onConflict: 'id', ignoreDuplicates: true })
        .select('id');
      if (error) throw error;
      summary.insertedCount += saved.length;
      summary.preexistingCount += batch.length - saved.length;
    } catch (batchError) {
      for (const row of batch) {
        try {
          const { data: saved, error } = await client.from(table)
            .upsert({ id: row.id, ...toDatabaseRecord(collection, row) }, {
              onConflict: 'id',
              ignoreDuplicates: true
            }).select('id').maybeSingle();
          if (error) throw error;
          if (saved) summary.insertedCount += 1;
          else summary.preexistingCount += 1;
        } catch (error) {
          summary.failedCount += 1;
          report.errors.push({
            collection,
            id: row.id,
            message: String(error.message || batchError.message).slice(0, 500)
          });
        }
      }
    }
  }
}

const sourceIds = Object.fromEntries(collections.map(collection => [
  collection,
  new Set(allRows[collection].map(row => row.id))
]));
const relationships = [
  ['registrationRequests', 'reviewedBy', 'users'],
  ['listings', 'fisherman', 'users'],
  ['listings', 'reservedBy', 'users'],
  ['auctions', 'listing', 'listings'],
  ['auctions', 'winner', 'users'],
  ['auctions', 'currentBidder', 'users'],
  ['auctions', 'cancelledBy', 'users'],
  ['bids', 'auction', 'auctions'],
  ['bids', 'buyer', 'users'],
  ['orders', 'listing', 'listings'],
  ['orders', 'buyer', 'users'],
  ['orders', 'fisherman', 'users'],
  ['orders', 'auction', 'auctions'],
  ['payments', 'order', 'orders'],
  ['payments', 'buyer', 'users'],
  ['payments', 'fisherman', 'users'],
  ['payments', 'listing', 'listings'],
  ['notifications', 'user', 'users'],
  ['notifications', 'auction', 'auctions'],
  ['notifications', 'bid', 'bids'],
  ['reviews', 'order', 'orders'],
  ['reviews', 'buyer', 'users'],
  ['reviews', 'fisherman', 'users'],
  ['disputes', 'order', 'orders'],
  ['disputes', 'buyer', 'users'],
  ['disputes', 'fisherman', 'users'],
  ['verificationHistory', 'fisherman', 'users'],
  ['verificationHistory', 'admin', 'users'],
  ['reputations', 'id', 'users'],
  ['pricePredictions', 'requestedBy', 'users'],
  ['priceModelEvaluations', 'requestedBy', 'users'],
  ['priceModels', 'evaluationId', 'priceModelEvaluations'],
  ['auctionMessages', 'auction', 'auctions'],
  ['auctionMessages', 'author', 'users'],
  ['auctionMessageReports', 'message', 'auctionMessages'],
  ['auctionMessageReports', 'reporter', 'users'],
  ['auctionMessageReports', 'auction', 'auctions']
];
for (const [collection, field, target] of relationships) {
  for (const row of allRows[collection]) {
    if (row[field] && !sourceIds[target].has(row[field])) {
      report.sourceOrphans.push({ collection, id: row.id, field, target, missingId: row[field] });
    }
  }
}

for (const collection of collections) {
  const { count, error } = await client.from(TABLES[collection])
    .select('id', { count: 'exact', head: true });
  report.targetCounts[collection] = error ? { error: error.message } : count;
  if (error) report.errors.push({ collection, message: `Count validation failed: ${error.message}` });
}

report.completedAt = new Date().toISOString();
report.status = report.errors.length || report.sourceOrphans.length ? 'completed_with_errors' : 'completed';
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({
  status: report.status,
  collections: report.collections,
  orphanRelationshipCount: report.sourceOrphans.length,
  errorCount: report.errors.length,
  reportPath
}, null, 2));
if (report.errors.length || report.sourceOrphans.length) process.exitCode = 1;
