import { expect, test } from '@playwright/test';

async function login(page, email) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Log in' }).first().click();
  const modal = page.locator('.auth-modal');
  await modal.locator('input[name="email"]').fill(email);
  await modal.locator('input[name="password"]').fill('auction-test-password');
  await modal.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back, Test.' })).toBeVisible();
}

test('buyer preferences persist and typed multilingual search filters the live marketplace', async ({ page }) => {
  await login(page, 'buyer-3@auction.test');
  const language = page.locator('.voice-language-select select');
  const preference = page.waitForResponse(response => response.url().endsWith('/api/auth/preferences') && response.request().method() === 'PATCH');
  await language.selectOption('kn');
  const saved = await preference;
  expect(saved.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'ಧ್ವನಿ ಮಾರುಕಟ್ಟೆ' })).toBeVisible();
  await expect(page.getByText('ಭಾಷೆಯ ಆಯ್ಕೆ ಉಳಿಸಲಾಗಿದೆ.')).toBeVisible();

  await language.selectOption('en');
  await expect(page.getByRole('heading', { name: 'Voice marketplace' })).toBeVisible();
  const command = page.getByLabel('Type a command');
  await command.fill('Find prawns under 500 in Mangalore');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('No available catches match those filters.')).toBeVisible();
});

test('voice bid details require confirmation before any bid request is submitted', async ({ page, browser }) => {
  await login(page, 'buyer-6@auction.test');
  let submissions = 0;
  await page.route('**/api/auctions/auction-voice/bids', async route => {
    submissions += 1;
    await route.continue();
  });
  const command = page.getByLabel('Type a command');
  await command.fill('Place a bid of 600 rupees on Tilapia');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.locator('.voice-confirmation').getByText(/Confirm a bid of 600 rupees per kg for Tilapia/)).toBeVisible();
  await expect(page.getByRole('group', { name: 'Confirm action' })).toBeVisible();
  expect(submissions).toBe(0);
  await page.getByRole('button', { name: 'Confirm action' }).click();
  await expect.poll(() => submissions).toBe(1);
  await expect(page.getByText('Your bid was submitted.')).toBeVisible();

  const secondBuyer = await browser.newPage();
  await login(secondBuyer, 'buyer-4@auction.test');
  await expect(secondBuyer.getByRole('heading', { name: 'Voice marketplace' })).toBeVisible();
  await expect(secondBuyer.getByLabel('Type a command')).toBeVisible();
  await secondBuyer.close();
});
