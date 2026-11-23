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
  const configured = {
    NODE_ENV: 'production',
    JWT_SECRET: 'configured',
    ADMIN_PASSWORD: 'configured',
    SMTP_HOST: 'smtp.gmail.com',
    SMTP_PORT: '465',
    SMTP_SECURE: 'true',
    SMTP_USER: 'verification@example.test',
    SMTP_PASS: 'test-app-password',
    EMAIL_FROM: 'Fishing Bid <verification@example.test>',
    OTP_HASH_SECRET: 'configured'
  };
  assert.doesNotThrow(() => validateProductionConfig(configured));
  assert.throws(
    () => validateProductionConfig({ ...configured, SMTP_PASS: '' }),
    /SMTP_PASS is required in production/
  );
  assert.throws(
    () => validateProductionConfig({ ...configured, SMTP_PORT: 'invalid' }),
    /SMTP_PORT must be a valid port in production/
  );
});

test('non-production startup retains local development defaults', () => {
  assert.doesNotThrow(() => validateProductionConfig({ NODE_ENV: 'development' }));
});
