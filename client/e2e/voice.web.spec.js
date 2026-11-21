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
  const supportedLanguages = [
    { code: 'en', title: 'Voice marketplace', saved: 'Language preference saved.' },
    { code: 'kn', title: 'ಧ್ವನಿ ಮಾರುಕಟ್ಟೆ', saved: 'ಭಾಷೆಯ ಆಯ್ಕೆ ಉಳಿಸಲಾಗಿದೆ.' },
    { code: 'hi', title: 'आवाज़ बाज़ार', saved: 'भाषा प्राथमिकता सहेजी गई।' },
    { code: 'ta', title: 'குரல் சந்தை', saved: 'மொழி விருப்பம் சேமிக்கப்பட்டது.' },
    { code: 'te', title: 'వాయిస్ మార్కెట్', saved: 'భాష ప్రాధాన్యత సేవ్ చేయబడింది.' },
    { code: 'ml', title: 'വോയ്സ് മാർക്കറ്റ്', saved: 'ഭാഷാ മുൻഗണന സംരക്ഷിച്ചു.' }
  ];
  for (const option of supportedLanguages) {
    const preference = page.waitForResponse(response => response.url().endsWith('/api/auth/preferences') && response.request().method() === 'PATCH');
    await language.selectOption(option.code);
    const saved = await preference;
    expect(saved.status()).toBe(200);
    expect((await saved.json()).user.preferredLanguage).toBe(option.code);
    await expect(page.getByRole('heading', { name: option.title })).toBeVisible();
    await expect(page.getByText(option.saved)).toBeVisible();
  }

  const englishPreference = page.waitForResponse(response => response.url().endsWith('/api/auth/preferences') && response.request().method() === 'PATCH');
  await language.selectOption('en');
  expect((await englishPreference).status()).toBe(200);
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

  const secondContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
  const secondBuyer = await secondContext.newPage();
  await login(secondBuyer, 'buyer-4@auction.test');
  await expect(secondBuyer.getByRole('heading', { name: 'Voice marketplace' })).toBeVisible();
  await expect(secondBuyer.getByLabel('Type a command')).toBeVisible();
  await secondContext.close();
});
