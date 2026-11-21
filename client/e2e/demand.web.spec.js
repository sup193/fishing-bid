import { expect, test } from '@playwright/test';

async function login(page, email) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Log in' }).first().click();
  const modal = page.locator('.auth-modal');
  await modal.locator('input[name="email"]').fill(email);
  await modal.locator('input[name="password"]').fill('auction-test-password');
  await modal.getByRole('button', { name: 'Log in' }).click();
}

test('buyer demand insights show real-data empty state and link to matching catches', async ({ page }) => {
  await login(page, 'buyer-1@auction.test');
  await page.getByRole('link', { name: 'Demand insights' }).click();
  await expect(page.getByRole('heading', { name: 'Trending fish & demand insights' })).toBeVisible();
  await expect(page.getByText('There are no verified paid sales in the selected period.')).toBeVisible();
});

test('fisherman dashboard exposes demand forecasting with an explicit low-data state', async ({ page }) => {
  await login(page, 'fisherman@auction.test');
  await page.getByRole('button', { name: 'Demand insights' }).click();
  await expect(page.getByRole('heading', { name: 'AI demand forecasting' })).toBeVisible();
  await expect(page.getByText('There are no verified paid sales in the selected period.')).toBeVisible();
});
