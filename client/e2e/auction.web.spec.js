import { expect, test } from '@playwright/test';
import { e2eWebUrl } from './urls.js';

async function login(page, email) {
  await page.goto('/login');
  const modal = page.locator('.auth-modal');
  await expect(modal).toBeVisible();
  await modal.locator('input[name="email"]').fill(email);
  await modal.locator('input[name="password"]').fill('auction-test-password');
  await modal.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: /^Welcome back,/ })).toBeVisible();
  await page.locator('.buyer-dashboard-nav').getByRole('link', { name: 'Auctions' }).click();
}

async function openAuction(page, fishType, region = 'Live Auctions') {
  const card = page.getByRole('region', { name: region })
    .locator('.market-product-card')
    .filter({ hasText: fishType });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'View details' }).click();
  return page.locator('.auction-detail-modal');
}

test('buyers see live bidding, errors, proxy bidding, history and outbid notices', async ({ page, browser }) => {
  await login(page, 'buyer-1@auction.test');
  const listing = page.locator('.market-product-card').filter({ hasText: 'Mackerel' });
  await expect(listing.getByText('Live auction')).toBeVisible();

  const detail = await openAuction(page, 'Mackerel');
  await expect(detail.locator('.auction-live-summary')).toContainText(/\d+h \d+m \d+s left/);
  await expect(detail.getByText('Current highest bid')).toBeVisible();
  await expect(detail.getByText('Active bidders')).toBeVisible();
  await expect(detail.getByText('Minimum increment')).toBeVisible();
  await expect(detail.getByText('Status:')).toBeVisible();
  await expect(detail.getByRole('heading', { name: 'Bid history' })).toBeVisible();

  await detail.locator('#manual-bid-amount').fill('400');
  await detail.getByRole('button', { name: 'Place bid' }).click();
  await expect(detail.getByRole('status')).toContainText('Bid must be at least');

  await detail.locator('#manual-bid-amount').fill('600');
  await detail.getByRole('button', { name: 'Place bid' }).click();
  await expect(detail.getByRole('status')).toContainText('Your bid is live.');
  await expect(detail.locator('.auction-bid-row')).toHaveCount(1);

  await detail.locator('#automatic-bid-maximum').fill('1000');
  await detail.getByRole('button', { name: 'Activate automatic bidding' }).click();
  await expect(detail.getByRole('status')).toContainText('Automatic bidding is active');

  const secondContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    baseURL: e2eWebUrl
  });
  const secondBuyer = await secondContext.newPage();
  await login(secondBuyer, 'buyer-2@auction.test');
  const secondDetail = await openAuction(secondBuyer, 'Mackerel');
  await secondDetail.locator('#automatic-bid-maximum').fill('1500');
  await secondDetail.getByRole('button', { name: 'Activate automatic bidding' }).click();
  await expect(secondDetail.getByRole('status')).toContainText('Automatic bidding is active');

  await expect(secondDetail.locator('.auction-live-summary')).toContainText('₹1,050');
  const activeBidders = secondDetail.locator('.auction-live-summary article').filter({ hasText: 'Active bidders' });
  await expect(activeBidders).toContainText('2');
  await expect(secondDetail.locator('.auction-bid-row')).toHaveCount(2);
  await page.locator('.buyer-dashboard-nav').getByRole('link', { name: 'Notifications' }).click();
  await expect(page.getByText('You have been outbid')).toBeVisible({ timeout: 20_000 });
  await secondContext.close();
});

test('closed auctions disable bids and the winning buyer can open existing checkout', async ({ page }) => {
  await login(page, 'buyer-1@auction.test');
  const closedListing = page.locator('.market-product-card').filter({ hasText: 'Pomfret' });
  await expect(closedListing.getByRole('button', { name: 'Auction ended' })).toBeDisabled();

  const winnerDetail = await openAuction(page, 'Kingfish', 'Available Catch');
  const checkoutButton = winnerDetail.getByRole('button', { name: 'Checkout winning bid' });
  await expect(checkoutButton).toBeVisible();
  await checkoutButton.click();
  await expect(page.getByRole('heading', { name: 'Pay securely with Razorpay.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to payment' })).toBeVisible();
});
