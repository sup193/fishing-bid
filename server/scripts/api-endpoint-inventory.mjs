import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import userRouter from '../src/routes/user.js';
import adminRouter from '../src/routes/admin.js';
import { requireAuth } from '../src/auth.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const inventoryPath = path.resolve(scriptDirectory, '../test/api-endpoint-inventory.json');
const methods = ['get', 'post', 'put', 'patch', 'delete'];

function routerEndpoints(router, prefix, access) {
  return router.stack
    .filter(layer => layer.route)
    .flatMap(layer => {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      return paths.flatMap(routePath => Object.keys(layer.route.methods)
        .filter(method => methods.includes(method))
        .map(method => {
          const routeAccess = access || (layer.route.stack.some(handler => handler.handle === requireAuth)
            ? 'authenticated'
            : 'public');
          return {
            method: method.toUpperCase(),
            path: `${prefix}${routePath === '/' ? '' : routePath}`,
            access: routeAccess,
            authorizationProbe: routeAccess === 'admin'
              ? 'anonymous-401-and-buyer-403'
              : routeAccess === 'authenticated'
                ? 'anonymous-401'
                : 'endpoint-specific'
          };
        }));
    });
}

export function collectApiEndpoints() {
  return [
    {
      method: 'GET',
      path: '/api/health',
      access: 'public',
      authorizationProbe: 'endpoint-specific'
    },
    ...routerEndpoints(userRouter, '/api'),
    ...routerEndpoints(adminRouter, '/api/admin', 'admin')
  ].sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method));
}

const inventory = {
  generatedFrom: [
    'server/src/index.js',
    'server/src/routes/user.js',
    'server/src/routes/admin.js'
  ],
  endpointCount: collectApiEndpoints().length,
  endpoints: collectApiEndpoints()
};

if (process.argv.includes('--check')) {
  const saved = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  if (JSON.stringify(saved) !== JSON.stringify(inventory)) {
    console.error('API endpoint inventory is stale. Run npm run report:api --prefix server to regenerate it.');
    process.exitCode = 1;
  } else {
    console.log(`API endpoint inventory is current (${inventory.endpointCount} endpoints).`);
  }
} else {
  fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
  console.log(`Wrote API endpoint inventory (${inventory.endpointCount} endpoints) to ${inventoryPath}.`);
}
