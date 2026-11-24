import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  e2eApiPort,
  e2eHost,
  e2eMobileApiPort,
  e2eMobileWebPort,
  e2eMobileWebUrl,
  e2eWebPort,
  e2eWebUrl
} from './e2e/urls.js';

const clientDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(clientDir, '..');
const mobileDir = path.join(projectRoot, 'mobile');

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 12_000 },
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  reporter: 'list',
  use: {
    trace: 'retain-on-failure'
  },
  projects: [
    {
      name: 'desktop-web',
      testMatch: '**/*.web.spec.js',
      use: { ...devices['Desktop Chrome'], baseURL: e2eWebUrl }
    },
    {
      name: 'mobile-expo-web',
      testMatch: '**/*.mobile.spec.js',
      use: { ...devices['Pixel 7'], baseURL: e2eMobileWebUrl }
    }
  ],
  webServer: [
    {
      command: 'node server/test-support/startAuctionApi.js',
      cwd: projectRoot,
      url: `http://${e2eHost}:${e2eApiPort}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PORT: String(e2eApiPort) }
    },
    {
      command: 'node server/test-support/startAuctionApi.js',
      cwd: projectRoot,
      url: `http://${e2eHost}:${e2eMobileApiPort}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PORT: String(e2eMobileApiPort) }
    },
    {
      command: `npm run dev -- --host ${e2eHost} --port ${e2eWebPort}`,
      cwd: clientDir,
      url: e2eWebUrl,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_PROXY_TARGET: `http://${e2eHost}:${e2eApiPort}` }
    },
    {
      command: `npm run web -- --port ${e2eMobileWebPort} --host localhost`,
      cwd: mobileDir,
      url: e2eMobileWebUrl,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        CI: '1',
        NODE_OPTIONS: '--max-old-space-size=4096',
        EXPO_PUBLIC_API_URL: `http://${e2eHost}:${e2eMobileApiPort}/api`
      }
    }
  ]
});
