import { expect, test } from '@playwright/test';

test('local guest landing page records browser navigation timing', async ({ page }, testInfo) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.locator('body')).not.toBeEmpty();

  const navigation = await page.evaluate(() => {
    const entry = performance.getEntriesByType('navigation')[0];
    return {
      domContentLoadedMs: entry?.domContentLoadedEventEnd,
      loadEventMs: entry?.loadEventEnd,
      transferSizeBytes: entry?.transferSize
    };
  });
  console.log(`Browser navigation timing: ${JSON.stringify(navigation)}`);
  expect(Number.isFinite(navigation.domContentLoadedMs)).toBe(true);
  await testInfo.attach('browser-navigation-timing.json', {
    body: Buffer.from(JSON.stringify(navigation, null, 2)),
    contentType: 'application/json'
  });
});
