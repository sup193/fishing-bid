import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createAuctionDatabase } from '../test-support/auctionTestData.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidemarket-performance-'));
const databasePath = path.join(tempDir, 'local-db.json');
process.env.NODE_ENV = 'test';
process.env.TIDEMARKET_DATABASE = 'local';
process.env.TIDEMARKET_LOCAL_DB_PATH = databasePath;
process.env.JWT_SECRET = 'test-only-performance-secret';
process.env.ADMIN_EMAIL = 'admin@performance.test';
process.env.ADMIN_PASSWORD = 'performance-test-password';
process.env.RAZORPAY_KEY_ID = 'rzp_test_fixture';
process.env.RAZORPAY_KEY_SECRET = 'test-only-razorpay-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test-only-webhook-secret';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

function percentile(samples, value) {
  const sorted = [...samples].sort((left, right) => left - right);
  return Number(sorted[Math.ceil(sorted.length * value) - 1].toFixed(2));
}

async function timedRequest(baseUrl, route, { token, body } = {}) {
  const start = performance.now();
  const response = await fetch(`${baseUrl}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  await response.arrayBuffer();
  const elapsedMs = performance.now() - start;
  return { status: response.status, elapsedMs };
}

let serverHandle;
try {
  await createAuctionDatabase(databasePath);
  const [{ startServer }, database, auth] = await Promise.all([
    import('../src/index.js'),
    import('../src/db.js'),
    import('../src/auth.js')
  ]);
  serverHandle = await startServer({ port: 0, sweepIntervalMs: 60_000 });
  const baseUrl = `http://127.0.0.1:${serverHandle.server.address().port}/api`;

  const readResults = await Promise.all(Array.from({ length: 80 }, (_, index) =>
    timedRequest(baseUrl, index % 2 === 0 ? '/listings' : '/auctions/auction-live')));
  assert.ok(readResults.every(result => result.status === 200), 'all local marketplace and auction reads must succeed');

  const bidders = await Promise.all(Array.from({ length: 10 }, async (_, index) => {
    const buyer = await database.get('users', `buyer-${index + 1}`);
    return auth.signUser(buyer);
  }));
  const bidResults = await Promise.all(bidders.map((token, index) =>
    timedRequest(baseUrl, '/auctions/auction-race/automatic-bidding', {
      token,
      body: { maxAmount: 1000 + index * 50, requestId: `performance-${index}-${Date.now()}` }
    })));
  assert.ok(bidResults.every(result => [201, 400].includes(result.status)));
  assert.ok(bidResults.some(result => result.status === 201));

  console.log(JSON.stringify({
    environment: 'temporary local-adapter test database; no external services',
    reads: {
      requests: readResults.length,
      concurrency: readResults.length,
      p50Ms: percentile(readResults.map(result => result.elapsedMs), 0.5),
      p95Ms: percentile(readResults.map(result => result.elapsedMs), 0.95)
    },
    concurrentAutomaticBids: {
      requests: bidResults.length,
      concurrency: bidResults.length,
      accepted: bidResults.filter(result => result.status === 201).length,
      rejectedByAuctionState: bidResults.filter(result => result.status === 400).length,
      p50Ms: percentile(bidResults.map(result => result.elapsedMs), 0.5),
      p95Ms: percentile(bidResults.map(result => result.elapsedMs), 0.95)
    },
    caveat: 'Smoke measurements are not production SLOs or live PostgreSQL benchmarks.'
  }, null, 2));
} finally {
  await serverHandle?.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
