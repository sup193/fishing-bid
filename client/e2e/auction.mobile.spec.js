import { expect, test } from '@playwright/test';

test('Expo buyer can browse, bid, enable automatic bidding and see closed state', async ({ page }) => {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill('buyer-1@auction.test');
  await page.getByPlaceholder('Enter your password').fill('auction-test-password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByText('Fresh from the coast.')).toBeVisible();

  await page.getByText('Auctions', { exact: true }).click();
  const listing = page.getByText('Sardine', { exact: true });
  await expect(listing).toBeVisible();
  const card = listing.locator('xpath=../..');
  await card.getByRole('button', { name: 'Place a bid' }).click();

  await expect(page.getByText('Sardine auction')).toBeVisible();
  await expect(page.getByText(/Time remaining:/)).toBeVisible();
  await expect(page.getByText(/Active bidders:/)).toBeVisible();

  const bidInput = page.getByPlaceholder('Enter your bid');
  await bidInput.fill('400');
  await page.getByRole('button', { name: 'Submit bid' }).click();
  await expect(page.getByRole('dialog').getByText('Your bid must be at least')).toBeVisible();

  await bidInput.fill('550');
  await page.getByRole('button', { name: 'Submit bid' }).click();
  await expect(page.getByText('Your ₹550/kg bid was submitted.')).toBeVisible();
  await expect(page.getByText(/Bid history · 1/)).toBeVisible();

  await page.getByPlaceholder('Set your maximum').fill('1000');
  await page.getByRole('button', { name: 'Activate automatic bidding' }).click();
  await expect(page.getByText('Automatic bidding is active. Your maximum stays private.')).toBeVisible();

  await page.getByRole('button', { name: 'Close' }).click();
  const closedCard = page.getByText('Pomfret', { exact: true }).locator('xpath=../..');
  await expect(closedCard.getByRole('button', { name: 'Auction ended' })).toBeDisabled();
});

test('Expo buyer receives a visible message when auction listing API fails', async ({ page }) => {
  await page.route('**/api/listings', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'Auction service unavailable' })
  }));
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill('buyer-2@auction.test');
  await page.getByPlaceholder('Enter your password').fill('auction-test-password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByText('Auction service unavailable')).toBeVisible();
  await expect(page.getByText('No catches match this view yet. Pull down to refresh.')).toHaveCount(0);
});
