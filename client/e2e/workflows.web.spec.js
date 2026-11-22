import { expect, test } from '@playwright/test';

const password = 'auction-test-password';
const pixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l3sAAAAASUVORK5CYII=', 'base64');

async function login(page, email, secret = password) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Log in' }).first().click();
  const modal = page.locator('.auth-modal');
  await modal.locator('input[name="email"]').fill(email);
  await modal.locator('input[name="password"]').fill(secret);
  await modal.getByRole('button', { name: 'Log in' }).click();
}

async function logout(page, role) {
  await page.getByRole('button', { name: `Open ${role} profile` }).click();
  await page.getByRole('button', { name: 'Log out of TideMarket' }).click();
}

test('buyer registration, admin approval, admin account creation and role restrictions work end-to-end', async ({ page }) => {
  const email = `buyer-${Date.now()}@audit.test`;
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign up' }).click();
  const signup = page.locator('.auth-modal');
  await signup.locator('input[name="name"]').fill('Audit Buyer');
  await signup.locator('input[name="phone"]').fill('9999999999');
  await signup.locator('select[name="role"]').selectOption('buyer');
  await signup.locator('input[name="email"]').fill(email);
  await signup.locator('input[name="password"]').fill('audit-buyer-password');
  await signup.getByRole('button', { name: 'Create account' }).click();
  await signup.locator('input[name="otp"]').fill('123456');
  await signup.getByRole('button', { name: 'Verify email' }).click();
  await expect(signup.getByText(/admin must approve your buyer account/i)).toBeVisible();
  await login(page, 'admin@auction.test');
  await expect(page.getByRole('heading', { name: 'Welcome, Admin.' })).toBeVisible();
  const tabNames = [
    'Fishermen',
    'Marketplace listings',
    'Buyer requests',
    'Bid review',
    'Transactions',
    'Trust & prices',
    'Demand analytics',
    'Auction analytics'
  ];
  for (const name of tabNames) {
    const tab = page.getByRole('tab', { name: new RegExp(name, 'i') });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  }

  await page.getByRole('tab', { name: /Buyer requests/i }).click();
  const request = page.locator('.request-line').filter({ hasText: email });
  await expect(request).toBeVisible();
  await request.getByRole('button', { name: 'Accept' }).click();
  await expect(request).toHaveCount(0);

  const fishermanEmail = `fisherman-${Date.now()}@audit.test`;
  await page.getByRole('button', { name: 'Create fisherman account' }).first().click();
  const createFisherman = page.locator('.modal').filter({ has: page.getByRole('heading', { name: 'Create fisherman login.' }) });
  await createFisherman.locator('input[name="name"]').fill('Audit Fisherman');
  await createFisherman.locator('input[name="email"]').fill(fishermanEmail);
  await createFisherman.locator('input[name="password"]').fill('audit-fisherman-password');
  await createFisherman.locator('input[name="location"]').fill('Test Port');
  await createFisherman.getByRole('button', { name: 'Create fisherman account' }).click();
  await expect(page.getByText('Audit Fisherman can now sign in as a fisherman.')).toBeVisible();

  const fishermanLogin = await page.context().request.post('http://127.0.0.1:5173/api/auth/login', {
    data: { email: fishermanEmail, password: 'audit-fisherman-password' }
  });
  expect(fishermanLogin.status()).toBe(200);
  expect((await fishermanLogin.json()).user.role).toBe('fisherman');

  await logout(page, 'admin');
  await login(page, email, 'audit-buyer-password');
  await expect(page.getByRole('heading', { name: 'Welcome back, Audit.' })).toBeVisible();
  const buyerToken = await page.evaluate(() => localStorage.getItem('tide_token'));
  const adminOnly = await page.context().request.get('http://127.0.0.1:5173/api/admin/overview', {
    headers: { Authorization: `Bearer ${buyerToken}` }
  });
  expect(adminOnly.status()).toBe(403);
});

test('fisherman uploads, creates and edits a listing that the buyer can find and estimate', async ({ page }) => {
  const location = `AuditPort${Date.now()}`;
  await login(page, 'fisherman@auction.test');
  await expect(page.getByRole('heading', { name: 'Your catch,' })).toBeVisible();
  await page.getByRole('button', { name: 'Post a catch' }).click();
  await page.getByRole('button', { name: /Fixed price/i }).click();

  const form = page.locator('.listing-form');
  await form.getByLabel('Fish species').selectOption({ label: 'Mackerel' });
  await form.getByLabel('Quantity (kg)').fill('12');
  await form.getByLabel('Landing port').fill(location);
  await form.getByLabel('Sale price / kg').fill('800');
  await form.locator('input[type="file"]').setInputFiles({
    name: 'audit-catch.png',
    mimeType: 'image/png',
    buffer: pixelPng
  });
  await expect(form.locator('img.upload-preview')).toBeVisible();
  await expect(page.getByText(/Photo uploaded|Detected/)).toBeVisible();
  await expect(form.getByRole('region', { name: 'Estimated market price' })).toBeVisible();
  await form.getByRole('button', { name: 'Publish sale listing' }).click();
  await expect(page.getByText('Sale listing created.')).toBeVisible();

  const token = await page.evaluate(() => localStorage.getItem('tide_token'));
  const readListings = async () => page.context().request.get('http://127.0.0.1:5173/api/fisherman/listings', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const initialResponse = await readListings();
  expect(initialResponse.status()).toBe(200);
  const initialListings = await initialResponse.json();
  const created = initialListings.find(listing => listing.location === location);
  expect(created).toBeTruthy();
  expect(created.imageUrl).toMatch(/^(data:image\/|https:\/\/)/);
  expect(created.quantity).toBe(12);
  expect(created.salePrice).toBe(800);

  const row = page.locator('.inventory-sale-list .catch-row').filter({ hasText: location });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Edit listing' }).click();
  const editor = page.locator('.listing-edit-panel');
  await editor.getByLabel('Sale price / kg').fill('825');
  await editor.getByLabel('Quantity (kg)').fill('10');
  await editor.getByRole('button', { name: 'Save listing changes' }).click();
  await expect(page.getByText('Listing updated with a refreshed price estimate.')).toBeVisible();
  const updatedResponse = await readListings();
  const updated = (await updatedResponse.json()).find(listing => listing.id === created.id);
  expect(updated.salePrice).toBe(825);
  expect(updated.quantity).toBe(10);

  await logout(page, 'fisherman');
  await login(page, 'buyer-1@auction.test');
  await page.locator('.seafood-category-card').filter({ has: page.getByText('Fish', { exact: true }) }).click();
  const buyerCard = page.locator('.market-listing-section[aria-labelledby="fresh-catch-title"] .market-product-card').filter({ hasText: location });
  await expect(buyerCard).toBeVisible();
  const wishlist = buyerCard.getByRole('button', { name: 'Add Mackerel to wishlist' });
  await wishlist.click();
  await expect(buyerCard.getByRole('button', { name: 'Remove Mackerel from wishlist' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('link', { name: 'Price estimate' }).click();
  await expect(page.getByRole('heading', { name: 'Fish price estimate' })).toBeVisible();
  const predictionForm = page.locator('.price-prediction-tool form');
  await predictionForm.getByLabel('Fish species').selectOption({ label: 'Mackerel' });
  await predictionForm.getByLabel('Quantity (kg)').fill('10');
  const estimateResponse = page.waitForResponse(response => response.url().endsWith('/api/price-predictions') && response.request().method() === 'POST');
  await predictionForm.getByRole('button', { name: 'Get price estimate' }).click();
  expect((await estimateResponse).status()).toBe(201);
  await expect(page.getByRole('region', { name: 'Estimated market price' })).toBeVisible();

  await page.getByRole('link', { name: 'Demand insights' }).click();
  await expect(page.getByRole('heading', { name: 'Trending fish & demand insights' })).toBeVisible();
  await page.getByRole('link', { name: 'Bids & orders' }).click();
  await expect(page.getByRole('heading', { name: 'Bids & orders', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Transactions' }).click();
  await expect(page.getByRole('heading', { name: 'Transactions', exact: true })).toBeVisible();

  const buyerToken = await page.evaluate(() => localStorage.getItem('tide_token'));
  const blockedRemoval = await page.context().request.delete(`http://127.0.0.1:5173/api/admin/listings/${created.id}`, {
    headers: { Authorization: `Bearer ${buyerToken}` }
  });
  expect(blockedRemoval.status()).toBe(403);

  await logout(page, 'buyer');
  await login(page, 'admin@auction.test');
  await page.getByRole('tab', { name: /Marketplace listings/i }).click();
  await page.getByLabel('Search marketplace listings').fill(location);
  const adminListing = page.locator('.admin-market-listing').filter({ hasText: location });
  await expect(adminListing).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await adminListing.getByRole('button', { name: 'Remove Mackerel from marketplace' }).click();
  await expect(page.getByText('Mackerel removed from the marketplace')).toBeVisible();
  const adminToken = await page.evaluate(() => localStorage.getItem('tide_token'));
  const adminListings = await page.context().request.get('http://127.0.0.1:5173/api/admin/listings', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  expect(adminListings.status()).toBe(200);
  expect((await adminListings.json()).find(listing => listing.id === created.id).status).toBe('removed');
  const publicListings = await page.context().request.get('http://127.0.0.1:5173/api/listings');
  expect((await publicListings.json()).some(listing => listing.id === created.id)).toBe(false);
});

test('only admins can moderate marketplace reviews and approved changes persist', async ({ page }) => {
  const reviewId = 'e2e-pending-review';
  await login(page, 'buyer-1@auction.test');
  await expect(page.getByRole('button', { name: 'Open buyer profile' })).toBeVisible();
  const buyerToken = await page.evaluate(() => localStorage.getItem('tide_token'));
  const denied = await page.context().request.patch(`http://127.0.0.1:5173/api/admin/reviews/${reviewId}/moderation`, {
    headers: { Authorization: `Bearer ${buyerToken}` },
    data: { status: 'approved' }
  });
  expect(denied.status()).toBe(403);

  await logout(page, 'buyer');
  await login(page, 'admin@auction.test');
  await page.getByRole('tab', { name: /Trust & prices/i }).click();
  const review = page.locator('.admin-review-row').filter({ hasText: 'E2E moderation fixture' });
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(review.getByText(/approved/i)).toBeVisible();

  const adminToken = await page.evaluate(() => localStorage.getItem('tide_token'));
  const reviews = await page.context().request.get('http://127.0.0.1:5173/api/admin/reviews', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  expect(reviews.status()).toBe(200);
  expect((await reviews.json()).find(item => item.id === reviewId).status).toBe('approved');
});
