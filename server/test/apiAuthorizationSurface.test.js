import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createAuctionDatabase } from '../test-support/auctionTestData.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidemarket-api-surface-'));
const databasePath = path.join(tempDir, 'local-db.json');
process.env.NODE_ENV = 'test';
process.env.TIDEMARKET_DATABASE = 'local';
process.env.TIDEMARKET_LOCAL_DB_PATH = databasePath;
process.env.JWT_SECRET = 'test-only-api-surface-secret';
process.env.ADMIN_EMAIL = 'admin@api-surface.test';
process.env.ADMIN_PASSWORD = 'api-surface-test-password';
process.env.RAZORPAY_KEY_ID = 'rzp_test_fixture';
process.env.RAZORPAY_KEY_SECRET = 'test-only-razorpay-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test-only-webhook-secret';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

let serverHandle;
let baseUrl;
let buyerToken;
let userProtectedRoutes;
let adminRoutes;
let discoveredRoutes;

function routeMethods(router, prefix, protectedByRouter = false) {
  return router.stack
    .filter(layer => layer.route)
    .flatMap(layer => {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      return paths.flatMap(routePath => Object.keys(layer.route.methods)
        .filter(method => ['get', 'post', 'put', 'patch', 'delete'].includes(method))
        .map(method => ({
          method: method.toUpperCase(),
          path: `${prefix}${routePath === '/' ? '' : routePath}`,
          access: protectedByRouter
            ? 'admin'
            : layer.route.stack.some(handler => handler.handle.name === 'requireAuth')
              ? 'authenticated'
              : 'public',
          authorizationProbe: protectedByRouter
            ? 'anonymous-401-and-buyer-403'
            : layer.route.stack.some(handler => handler.handle.name === 'requireAuth')
              ? 'anonymous-401'
              : 'endpoint-specific'
        })));
    });
}

function requestPath(pathname) {
  return pathname.replace(/:([A-Za-z0-9_]+)/g, 'qa-$1');
}

async function request(endpoint, token) {
  const method = endpoint.method;
  const response = await fetch(`${baseUrl}${requestPath(endpoint.path)}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(['GET', 'DELETE'].includes(method) ? {} : { 'content-type': 'application/json' })
    },
    ...(['GET', 'DELETE'].includes(method) ? {} : { body: '{}' })
  });
  return response.status;
}

before(async () => {
  await createAuctionDatabase(databasePath);
  const database = await import('../src/db.js');
  const auth = await import('../src/auth.js');
  const [{ default: userRouter }, { default: adminRouter }, { startServer }] = await Promise.all([
    import('../src/routes/user.js'),
    import('../src/routes/admin.js'),
    import('../src/index.js')
  ]);
  const buyer = await database.get('users', 'buyer-1');
  buyerToken = auth.signUser(buyer);
  const healthEndpoint = {
    method: 'GET',
    path: '/api/health',
    access: 'public',
    authorizationProbe: 'endpoint-specific'
  };
  const allUserRoutes = routeMethods(userRouter, '/api');
  adminRoutes = routeMethods(adminRouter, '/api/admin', true);
  discoveredRoutes = [healthEndpoint, ...allUserRoutes, ...adminRoutes]
    .sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method));
  const savedInventory = JSON.parse(fs.readFileSync(
    new URL('./api-endpoint-inventory.json', import.meta.url),
    'utf8'
  ));
  assert.deepEqual(discoveredRoutes, savedInventory.endpoints, 'tracked API endpoint inventory must match Express routes');
  userProtectedRoutes = allUserRoutes.filter(endpoint => endpoint.access === 'authenticated');
  serverHandle = await startServer({ port: 0, sweepIntervalMs: 60_000 });
  baseUrl = `http://127.0.0.1:${serverHandle.server.address().port}`;
});

after(async () => {
  await serverHandle?.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('all registered protected API endpoints reject unauthenticated requests', async t => {
  const endpoints = [...userProtectedRoutes, ...adminRoutes];
  assert.ok(endpoints.length > 0, 'API endpoint discovery must find protected routes');

  for (const endpoint of endpoints) {
    assert.equal(
      await request(endpoint),
      401,
      `${endpoint.method} ${endpoint.path} should require authentication`
    );
  }

  t.diagnostic(`Unauthenticated access denied for ${endpoints.length} of ${discoveredRoutes.length} discovered API endpoints.`);
});

test('every admin API endpoint rejects an authenticated buyer', async t => {
  assert.ok(adminRoutes.length > 0, 'API endpoint discovery must find admin routes');

  for (const endpoint of adminRoutes) {
    assert.equal(
      await request(endpoint, buyerToken),
      403,
      `${endpoint.method} ${endpoint.path} should require the admin role`
    );
  }

  t.diagnostic(`Buyer access denied for all ${adminRoutes.length} discovered admin endpoints.`);
});
