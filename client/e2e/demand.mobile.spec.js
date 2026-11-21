import { expect, test } from '@playwright/test';

test('Expo buyer demand tab displays verified-data limitations', async ({ page }) => {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill('buyer-1@auction.test');
  await page.getByPlaceholder('Enter your password').fill('auction-test-password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByRole('tab', { name: 'Demand' }).click();
  await expect(page.getByText('Trending fish & demand')).toBeVisible();
  await expect(page.getByText('No verified paid sales are available for your area yet.')).toBeVisible();
});
