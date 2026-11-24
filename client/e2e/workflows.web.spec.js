import { expect, test } from '@playwright/test';
import { e2eApiUrl } from './urls.js';

const password = 'auction-test-password';
const pixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l3sAAAAASUVORK5CYII=', 'base64');

async function login(page, email, secret = password) {
  await page.goto('/login');
  const modal = page.locator('.auth-modal');
  await expect(modal).toBeVisible();
  await modal.locator('input[name="email"]').fill(email);
  await modal.locator('input[name="password"]').fill(secret);
  await modal.getByRole('button', { name: 'Log in' }).click();
}

async function logout(page, role) {
  await page.getByRole('button', { name: `Open ${role} profile` }).click();
  await page.getByRole('button', { name: 'Log out of TideMarket' }).click();
}

test('existing JWT restores session and expired JWT is cleared', async ({ page }) => {
  await login(page, 'fisherman@auction.test');
  await expect(page.getByRole('button', { name: 'Open fisherman profile for Test Fisherman' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your catch,' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open fisherman profile for Test Fisherman' })).toBeVisible();

  await page.evaluate(() => {
    localStorage.setItem('tide_token', 'expired.invalid.token');
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Log in' }).first()).toBeVisible();
  await expect(page.locator('.topbar nav').getByRole('button', { name: 'Sign up' })).toBeVisible();
});

test('buyer navigation uses dedicated routes and browser history', async ({ page }) => {
  await login(page, 'buyer-1@auction.test');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: /Welcome back,/ })).toBeVisible();

  await page.locator('.buyer-dashboard-nav').getByRole('link', { name: 'Auctions' }).click();
  await expect(page).toHaveURL(/\/auctions$/);
  await page.locator('.market-product-card .market-details-button').first().click();
  await expect(page).toHaveURL(/\/auctions\/[^/]+$/);
  await expect(page.locator('.auction-detail-page')).toBeVisible();
  await page.getByRole('button', { name: /Back to auctions/ }).click();
  await expect(page).toHaveURL(/\/auctions$/);

  await page.locator('.buyer-dashboard-nav').getByRole('link', { name: 'Bids & orders' }).click();
  await expect(page).toHaveURL(/\/bids$/);
  await expect(page.getByRole('heading', { name: 'Bids & orders', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/auctions$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/bids$/);

  await page.locator('.buyer-dashboard-nav').getByRole('link', { name: 'Notifications' }).click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await page.getByRole('button', { name: 'Open buyer profile for Test Buyer 1' }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await page.getByRole('button', { name: 'Log out of TideMarket' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('.auth-modal')).toBeVisible();
});

test('role-specific routes restore on refresh and redirect unauthorized users', async ({ page }) => {
  await login(page, 'buyer-1@auction.test');
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/notifications');
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/notifications$/);
  await page.goto('/create-auction');
  await expect(page).toHaveURL(/\/dashboard$/);
  await logout(page, 'buyer');

  await login(page, 'fisherman@auction.test');
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/my-auctions');
  await expect(page).toHaveURL(/\/my-auctions$/);
  await expect(page.getByRole('navigation', { name: 'Fisherman dashboard' })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/my-auctions$/);
  await page.goto('/notifications');
  await expect(page).toHaveURL(/\/dashboard$/);
  await logout(page, 'fisherman');

  await login(page, 'admin@auction.test');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/listings');
  await expect(page).toHaveURL(/\/admin\/listings$/);
  await expect(page.getByRole('heading', { name: 'Species listings' })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/admin\/listings$/);
  await page.goto('/orders');
  await expect(page).toHaveURL(/\/admin$/);
});

test('forgot password verifies a separate OTP, resets the password, and returns to login', async ({ page }) => {
  const email = `reset-${Date.now()}@audit.test`;
  const adminLogin = await page.context().request.post(`${e2eApiUrl}/auth/login`, {
    data: { email: 'admin@auction.test', password }
  });
  expect(adminLogin.status()).toBe(200);
  const adminToken = (await adminLogin.json()).token;
  const created = await page.context().request.post(`${e2eApiUrl}/admin/fishermen`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { name: 'Reset Test Seller', email, password: 'OriginalResetPassword123' }
  });
  expect(created.status()).toBe(201);

  await page.goto('/');
  await page.getByRole('button', { name: 'Log in' }).first().click();
  const modal = page.locator('.auth-modal');
  await modal.getByRole('button', { name: 'Forgot Password?' }).click();
  await modal.locator('input[name="resetEmail"]').fill(email);
  await modal.getByRole('button', { name: 'Proceed' }).click();
  await expect(modal.getByText(/If an account exists for this email/)).toBeVisible();
  await modal.locator('input[name="resetOtp"]').fill('123456');
  await modal.getByRole('button', { name: 'Verify OTP' }).click();

  await modal.locator('input[name="newPassword"]').fill('UpdatedResetPassword456');
  await modal.locator('input[name="confirmNewPassword"]').fill('MismatchedPassword789');
  await modal.getByRole('button', { name: 'Update Password' }).click();
  await expect(modal.getByText('The passwords do not match.')).toBeVisible();

  await modal.locator('input[name="confirmNewPassword"]').fill('UpdatedResetPassword456');
  await modal.getByRole('button', { name: 'Update Password' }).click();
  await expect(modal.getByRole('heading', { name: 'Password updated.' })).toBeVisible();
  await modal.getByRole('button', { name: 'Back to Login' }).click();
  await modal.locator('input[name="email"]').fill(email);
  await modal.locator('input[name="password"]').fill('OriginalResetPassword123');
  await modal.getByRole('button', { name: 'Log in' }).click();
  await expect(modal.getByText('Invalid email or password')).toBeVisible();

  await modal.locator('input[name="password"]').fill('UpdatedResetPassword456');
  await modal.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('button', { name: 'Open fisherman profile for Reset Test Seller' })).toBeVisible();
});

test('buyers activate after OTP while fisherman registrations require admin approval', async ({ page }) => {
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
  await expect(page.getByRole('heading', { name: 'Welcome back, Audit Buyer.' })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tide_user') || '{}').role)).toBe('buyer');
  await logout(page, 'buyer');

  await login(page, 'admin@auction.test');
  await expect(page.getByRole('heading', { name: 'Welcome, Admin.' })).toBeVisible();
  const tabNames = [
    'Fishermen',
    'Marketplace listings',
    'Fisherman approvals',
    'Bid review',
    'Transactions',
    'Trust & prices',
    'Demand analytics',
    'Auction analytics'
  ];
  for (const name of tabNames) {
    const section = page.getByRole('navigation', { name: 'Admin dashboard sections' }).getByRole('link', { name: new RegExp(name, 'i') });
    await section.click();
    await expect(section).toHaveAttribute('aria-current', 'page');
  }

  const approvalsLink = page.getByRole('navigation', { name: 'Admin dashboard sections' }).getByRole('link', { name: /Fisherman approvals/i });
  await approvalsLink.click();
  await expect(page.getByRole('heading', { name: 'Fisherman Registration Approvals' })).toBeVisible();
  await expect(page.locator('.request-line').filter({ hasText: email })).toHaveCount(0);
  await logout(page, 'admin');

  const fishermanEmail = `fisherman-${Date.now()}@audit.test`;
  await page.goto('/register');
  const fishermanSignup = page.locator('.auth-modal');
  await fishermanSignup.locator('input[name="name"]').fill('Audit Fisherman');
  await fishermanSignup.locator('input[name="phone"]').fill('9999999998');
  await fishermanSignup.locator('select[name="role"]').selectOption('fisherman');
  await fishermanSignup.locator('input[name="email"]').fill(fishermanEmail);
  await fishermanSignup.locator('input[name="password"]').fill('audit-fisherman-password');
  await fishermanSignup.getByRole('button', { name: 'Create account' }).click();
  await fishermanSignup.locator('input[name="otp"]').fill('654321');
  await fishermanSignup.getByRole('button', { name: 'Verify email' }).click();
  await expect(fishermanSignup.getByText('Your email has been verified successfully. Your fisherman registration is awaiting admin approval. You will be able to log in once your account is approved.')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('tide_token'))).toBeNull();
  await fishermanSignup.getByRole('button', { name: 'Go to login' }).click();
  const pendingLogin = page.locator('.auth-modal');
  await expect(pendingLogin.getByRole('heading', { name: 'Welcome back to the water.' })).toBeVisible();
  await pendingLogin.locator('input[name="email"]').fill(fishermanEmail);
  await pendingLogin.locator('input[name="password"]').fill('audit-fisherman-password');
  await pendingLogin.getByRole('button', { name: 'Log in' }).click();
  await expect(pendingLogin.getByText('Your fisherman registration is awaiting admin approval.')).toBeVisible();

  await page.goto('/');
  await login(page, 'admin@auction.test');
  await approvalsLink.click();
  const request = page.locator('.request-line').filter({ hasText: fishermanEmail });
  await expect(request).toBeVisible();
  await expect(request.getByText('9999999998')).toBeVisible();
  await request.getByRole('button', { name: 'Approve' }).click();
  await expect(request).toHaveCount(0);
  await expect(page.getByText('Fisherman account approved')).toBeVisible();
  const fishermanLogin = await page.context().request.post(`${e2eApiUrl}/auth/login`, {
    data: { email: fishermanEmail, password: 'audit-fisherman-password' }
  });
  expect(fishermanLogin.status()).toBe(200);
  expect((await fishermanLogin.json()).user.role).toBe('fisherman');
  await logout(page, 'admin');
  await login(page, fishermanEmail, 'audit-fisherman-password');
  await expect(page.getByRole('heading', { name: 'Your catch,' })).toBeVisible();
  await logout(page, 'fisherman');
  await login(page, 'admin@auction.test');

  await page.getByRole('button', { name: 'Create fisherman account' }).first().click();
  const createFisherman = page.locator('.modal').filter({ has: page.getByRole('heading', { name: 'Create fisherman login.' }) });
  const createdFishermanEmail = `admin-created-${Date.now()}@audit.test`;
  await createFisherman.locator('input[name="name"]').fill('Audit Fisherman');
  await createFisherman.locator('input[name="email"]').fill(createdFishermanEmail);
  await createFisherman.locator('input[name="password"]').fill('audit-fisherman-password');
  await createFisherman.locator('input[name="location"]').fill('Test Port');
  await createFisherman.getByRole('button', { name: 'Create fisherman account' }).click();
  await expect(page.getByText('Audit Fisherman can now sign in as a fisherman.')).toBeVisible();

  const createdFishermanLogin = await page.context().request.post(`${e2eApiUrl}/auth/login`, {
    data: { email: createdFishermanEmail, password: 'audit-fisherman-password' }
  });
  expect(createdFishermanLogin.status()).toBe(200);
  expect((await createdFishermanLogin.json()).user.role).toBe('fisherman');

  const rejectedEmail = `rejected-fisherman-${Date.now()}@audit.test`;
  const rejectedRegistration = await page.context().request.post(`${e2eApiUrl}/auth/register`, {
    data: {
      name: 'Rejected Audit Fisherman',
      email: rejectedEmail,
      password: 'rejected-fisherman-password',
      role: 'fisherman'
    }
  });
  expect(rejectedRegistration.status()).toBe(202);
  const rejectedVerification = await page.context().request.post(`${e2eApiUrl}/auth/verify-otp`, {
    data: { email: rejectedEmail, otp: '654321' }
  });
  expect(rejectedVerification.status()).toBe(202);
  expect((await rejectedVerification.json()).status).toBe('pending_admin');
  await page.getByRole('button', { name: 'Refresh data dashboard' }).click();
  await approvalsLink.click();
  const rejectedRequest = page.locator('.request-line').filter({ hasText: rejectedEmail });
  await expect(rejectedRequest).toBeVisible();
  await rejectedRequest.getByRole('button', { name: 'Reject' }).click();
  await expect(rejectedRequest).toHaveCount(0);
  const rejectedLogin = await page.context().request.post(`${e2eApiUrl}/auth/login`, {
    data: { email: rejectedEmail, password: 'rejected-fisherman-password' }
  });
  expect(rejectedLogin.status()).toBe(403);
  expect((await rejectedLogin.json()).status).toBe('rejected');

  await logout(page, 'admin');
  await login(page, email, 'audit-buyer-password');
  await expect(page.getByRole('heading', { name: 'Welcome back, Audit Buyer.' })).toBeVisible();
  await expect(page.locator('.buyer-welcome h1')).not.toContainText('OTP');
  await page.evaluate(() => localStorage.setItem('tide_non_auth_state', 'preserve-me'));
  await logout(page, 'buyer');
  expect(await page.evaluate(() => localStorage.getItem('tide_token'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('tide_non_auth_state'))).toBe('preserve-me');
  await login(page, email, 'audit-buyer-password');
  await expect(page.getByRole('heading', { name: 'Welcome back, Audit Buyer.' })).toBeVisible();
  const buyerToken = await page.evaluate(() => localStorage.getItem('tide_token'));
  const adminOnly = await page.context().request.get(`${e2eApiUrl}/admin/overview`, {
    headers: { Authorization: `Bearer ${buyerToken}` }
  });
  expect(adminOnly.status()).toBe(403);
});

test('fisherman uploads, creates and edits a listing that the buyer can find and estimate', async ({ page }) => {
  const location = `AuditPort${Date.now()}`;
  await login(page, 'fisherman@auction.test');
  await expect(page.getByRole('heading', { name: 'Your catch,' })).toBeVisible();
  await page.getByRole('button', { name: 'Post a catch' }).click();

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
  const readListings = async () => page.context().request.get(`${e2eApiUrl}/fisherman/listings`, {
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
  await page.locator('.buyer-dashboard-nav').getByRole('link', { name: 'Auctions' }).click();
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

  await page.locator('.buyer-dashboard-nav').getByRole('link', { name: 'Demand insights', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Trending fish & demand insights' })).toBeVisible();
  await page.getByRole('link', { name: 'Bids & orders' }).click();
  await expect(page.getByRole('heading', { name: 'Bids & orders', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Transactions' }).click();
  await expect(page.getByRole('heading', { name: 'Transactions', exact: true })).toBeVisible();

  const buyerToken = await page.evaluate(() => localStorage.getItem('tide_token'));
  const blockedRemoval = await page.context().request.delete(`${e2eApiUrl}/admin/listings/${created.id}`, {
    headers: { Authorization: `Bearer ${buyerToken}` }
  });
  expect(blockedRemoval.status()).toBe(403);

  await logout(page, 'buyer');
  await login(page, 'admin@auction.test');
  await page.getByRole('navigation', { name: 'Admin dashboard sections' }).getByRole('link', { name: /Marketplace listings/i }).click();
  await page.getByLabel('Search marketplace listings').fill(location);
  const adminListing = page.locator('.admin-market-listing').filter({ hasText: location });
  await expect(adminListing).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await adminListing.getByRole('button', { name: 'Remove Mackerel from marketplace' }).click();
  await expect(page.getByText('Mackerel removed from the marketplace')).toBeVisible();
  const adminToken = await page.evaluate(() => localStorage.getItem('tide_token'));
  const adminListings = await page.context().request.get(`${e2eApiUrl}/admin/listings`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  expect(adminListings.status()).toBe(200);
  expect((await adminListings.json()).find(listing => listing.id === created.id).status).toBe('removed');
  const publicListings = await page.context().request.get(`${e2eApiUrl}/listings`);
  expect((await publicListings.json()).some(listing => listing.id === created.id)).toBe(false);
});

test('only admins can moderate marketplace reviews and approved changes persist', async ({ page }) => {
  const reviewId = 'e2e-pending-review';
  await login(page, 'buyer-1@auction.test');
  await expect(page.getByRole('button', { name: 'Open buyer profile' })).toBeVisible();
  const buyerToken = await page.evaluate(() => localStorage.getItem('tide_token'));
  const denied = await page.context().request.patch(`${e2eApiUrl}/admin/reviews/${reviewId}/moderation`, {
    headers: { Authorization: `Bearer ${buyerToken}` },
    data: { status: 'approved' }
  });
  expect(denied.status()).toBe(403);

  await logout(page, 'buyer');
  await login(page, 'admin@auction.test');
  await page.getByRole('navigation', { name: 'Admin dashboard sections' }).getByRole('link', { name: /Trust & prices/i }).click();
  const review = page.locator('.admin-review-row').filter({ hasText: 'E2E moderation fixture' });
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(review.getByText(/approved/i)).toBeVisible();

  const adminToken = await page.evaluate(() => localStorage.getItem('tide_token'));
  const reviews = await page.context().request.get(`${e2eApiUrl}/admin/reviews`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  expect(reviews.status()).toBe(200);
  expect((await reviews.json()).find(item => item.id === reviewId).status).toBe('approved');
});
