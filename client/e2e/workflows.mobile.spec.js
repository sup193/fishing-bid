import { expect, test } from '@playwright/test';

const password = 'auction-test-password';
const pixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l3sAAAAASUVORK5CYII=', 'base64');

async function login(page, email) {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Enter your password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
}

async function tokenFor(page) {
  return page.evaluate(() => localStorage.getItem('tide_token'));
}

test('Expo buyer navigates all tabs, keeps session on refresh, and is redirected away from other roles', async ({ page }) => {
  await login(page, 'buyer-10@auction.test');
  await expect(page.getByText('Fresh from the coast.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();

  const token = await tokenFor(page);
  await page.getByText('Price guide', { exact: true }).click();
  await expect(page).toHaveURL(/\/buyer\/prices$/);
  await expect(page.getByText('Fish price estimate')).toBeVisible();
  const speciesField = page.getByText('Fish species', { exact: true }).locator('..');
  await speciesField.getByRole('button', { name: 'Mackerel' }).click();
  await page.getByPlaceholder('e.g. 10').fill('10');
  const predictionResponse = page.waitForResponse(response => response.url().endsWith('/api/price-predictions') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Get price estimate' }).click();
  expect((await predictionResponse).status()).toBe(201);
  await expect(page.getByText('INDICATIVE MARKET PRICE')).toBeVisible();

  await page.getByText('Demand', { exact: true }).click();
  await expect(page).toHaveURL(/\/buyer\/demand$/);
  await expect(page.getByText('Trending fish & demand')).toBeVisible();

  await page.getByText('My activity', { exact: true }).click();
  await expect(page).toHaveURL(/\/buyer\/history$/);
  await expect(page.getByText('Your activity')).toBeVisible();

  await page.getByText('Payments', { exact: true }).click();
  await expect(page).toHaveURL(/\/buyer\/transactions$/);
  await expect(page.getByText('Payment activity')).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/buyer\/transactions$/);
  await expect(page.getByText('Payment activity')).toBeVisible();

  await page.getByText('Market', { exact: true }).click();
  await page.getByPlaceholder('Try tuna or Mangalore').fill('Anchovy');
  const anchovy = page.getByText('Anchovy', { exact: true }).last();
  await expect(anchovy).toBeVisible();
  const card = anchovy.locator('xpath=../..');
  const auctionResponse = await page.request.get('http://127.0.0.1:5000/api/auctions/auction-notifications', {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect(auctionResponse.status()).toBe(200);
  const auction = (await auctionResponse.json()).auction;
  await card.getByRole('button', { name: 'Place a bid' }).click();
  await page.getByPlaceholder('Enter your bid').fill(String(auction.minimumBid));
  await page.getByRole('button', { name: 'Submit bid' }).click();
  await expect(page.getByText(new RegExp(`Your ₹${auction.minimumBid}/kg bid was submitted`))).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.reload();
  const notificationsBefore = await page.request.get('http://127.0.0.1:5000/api/notifications', {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect(notificationsBefore.status()).toBe(200);
  const allNotificationsBefore = await notificationsBefore.json();
  expect(allNotificationsBefore).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'highest_bidder', read: false })
  ]));
  const unreadBefore = allNotificationsBefore.filter(notification => !notification.read);
  await expect(page.getByText('Auction notifications')).toBeVisible();
  await page.getByRole('button', { name: 'Read' }).first().click();
  const notificationsAfter = await page.request.get('http://127.0.0.1:5000/api/notifications', {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect((await notificationsAfter.json()).filter(notification => !notification.read).length).toBeLessThan(unreadBefore.length);

  await page.goto('/admin');
  await expect(page).toHaveURL(/\/buyer$/);
  await expect(page.getByText('Fresh from the coast.')).toBeVisible();
  await page.goto('/fisherman');
  await expect(page).toHaveURL(/\/buyer$/);

  await page.getByRole('button', { name: 'Log out' }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/buyer');
  await expect(page).toHaveURL(/\/login$/);
});

test('Expo fisherman handles the catch form, photo upload, and listing creation through the API', async ({ page }) => {
  const location = `MobileAudit${Date.now()}`;
  await login(page, 'fisherman@auction.test');
  await expect(page.getByText('Your catch, your terms.')).toBeVisible();
  await page.getByRole('button', { name: /Post a catch/ }).click();
  await expect(page.getByText('Post a catch', { exact: true })).toBeVisible();

  const species = page.getByPlaceholder('e.g. Tuna');
  await species.fill('Mackerel');
  await page.getByPlaceholder('e.g. 25').fill('8');
  await page.getByPlaceholder('e.g. 380').fill('650');
  await page.getByPlaceholder('e.g. Mangalore').fill(location);
  await species.focus();
  const fieldBounds = await species.boundingBox();
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  expect(fieldBounds.y).toBeGreaterThanOrEqual(0);
  expect(fieldBounds.y + fieldBounds.height).toBeLessThanOrEqual(viewportHeight);

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Choose catch photo' }).click()
  ]);
  await fileChooser.setFiles({
    name: 'mobile-audit-catch.png',
    mimeType: 'image/png',
    buffer: pixelPng
  });
  await expect(page.getByLabel('Selected catch photo preview')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish listing' })).toBeEnabled();
  await page.getByRole('button', { name: 'Publish listing' }).click();
  await expect(page.getByText('Fixed-price listing published.')).toBeVisible();
  await expect(page.getByText(new RegExp(location))).toBeVisible();

  const token = await tokenFor(page);
  const response = await page.request.get('http://127.0.0.1:5000/api/fisherman/listings', {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect(response.status()).toBe(200);
  const listings = await response.json();
  const created = listings.find(listing => listing.location === location);
  expect(created).toBeTruthy();
  expect(created.fishType).toBe('Mackerel');
  expect(created.quantity).toBe(8);
  expect(created.salePrice).toBe(650);
  expect(created.imageUrl).toContain('/uploads/');
  const uploadedPhoto = await page.request.get(`http://127.0.0.1:5000${created.imageUrl}`);
  expect(uploadedPhoto.status()).toBe(200);

  await page.getByRole('button', { name: 'Log out' }).first().click();
  await expect(page).toHaveURL(/\/login$/);
});
