import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5173' }
    },
    {
      name: 'mobile-expo-web',
      testMatch: '**/*.mobile.spec.js',
      use: { ...devices['Pixel 7'], baseURL: 'http://localhost:8081' }
    }
  ],
  webServer: [
    {
      command: 'node server/test-support/startAuctionApi.js',
      cwd: projectRoot,
      url: 'http://127.0.0.1:5000/api/health',
      reuseExistingServer: false,
      timeout: 60_000
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5173',
      cwd: clientDir,
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: true,
      timeout: 60_000
    },
    {
      command: 'npm run web -- --port 8081 --host localhost',
      cwd: mobileDir,
      url: 'http://localhost:8081',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        CI: '1',
        NODE_OPTIONS: '--max-old-space-size=4096',
        EXPO_PUBLIC_API_URL: 'http://127.0.0.1:5000/api'
      }
    }
  ]
});
