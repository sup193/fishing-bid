import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateProductionConfig } from '../src/index.js';

test('production startup requires an explicit JWT secret and admin password', () => {
  assert.throws(
    () => validateProductionConfig({ NODE_ENV: 'production', ADMIN_PASSWORD: 'configured' }),
    /JWT_SECRET is required in production/
  );
  assert.throws(
    () => validateProductionConfig({ NODE_ENV: 'production', JWT_SECRET: 'configured' }),
    /ADMIN_PASSWORD is required in production/
  );
  assert.doesNotThrow(() => validateProductionConfig({
    NODE_ENV: 'production',
    JWT_SECRET: 'configured',
    ADMIN_PASSWORD: 'configured',
    RESEND_API_KEY: 'configured',
    OTP_FROM_EMAIL: 'Fishing Bid <verification@example.test>',
    OTP_HASH_SECRET: 'configured'
  }));
});

test('non-production startup retains local development defaults', () => {
  assert.doesNotThrow(() => validateProductionConfig({ NODE_ENV: 'development' }));
});
