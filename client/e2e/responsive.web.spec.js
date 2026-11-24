import { expect, test } from '@playwright/test';

const widths = [320, 360, 375, 390, 430, 768, 1024, 1280, 1440, 1920];
const password = 'auction-test-password';

async function login(page, email) {
  await page.goto('/login');
  const modal = page.locator('.auth-modal');
  await expect(modal).toBeVisible();
  await modal.locator('input[name="email"]').fill(email);
  await modal.locator('input[name="password"]').fill(password);
  await modal.getByRole('button', { name: 'Log in' }).click();
}

async function logout(page, role) {
  await page.getByRole('button', { name: `Open ${role} profile` }).click();
  await page.getByRole('button', { name: 'Log out of TideMarket' }).click();
}

async function expectNoHorizontalOverflow(page, width, surface) {
  await page.setViewportSize({ width, height: 900 });
  await expect.poll(() => page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
  }))).toEqual(expect.objectContaining({ clientWidth: width }));
  const size = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
  }));
  const overflowingElements = await page.evaluate(() => Array.from(document.querySelectorAll('body *'))
    .map(element => {
      const bounds = element.getBoundingClientRect();
      return {
        tag: element.tagName.toLowerCase(),
        className: element.getAttribute('class') || '',
        right: Math.round(bounds.right),
        width: Math.round(bounds.width)
      };
    })
    .filter(element => element.right > window.innerWidth + 1)
    .slice(0, 10));
  expect(size.documentWidth, `${surface} overflows at ${width}px: ${JSON.stringify(overflowingElements)}`).toBeLessThanOrEqual(size.clientWidth);
}

test('guest and buyer, fisherman, and admin workspaces fit the requested viewport widths', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Fresh to Your Table/i })).toBeVisible();
  for (const width of widths) await expectNoHorizontalOverflow(page, width, 'guest marketplace');

  await login(page, 'buyer-1@auction.test');
  await expect(page.getByRole('heading', { name: 'Welcome back, Test Buyer 1.' })).toBeVisible();
  for (const width of widths) await expectNoHorizontalOverflow(page, width, 'buyer marketplace');

  await logout(page, 'buyer');
  await login(page, 'fisherman@auction.test');
  await expect(page.getByRole('heading', { name: 'Your catch,' })).toBeVisible();
  for (const width of widths) await expectNoHorizontalOverflow(page, width, 'fisherman workspace');

  await logout(page, 'fisherman');
  await login(page, 'admin@auction.test');
  await expect(page.getByRole('heading', { name: 'Welcome, Admin.' })).toBeVisible();
  for (const width of widths) await expectNoHorizontalOverflow(page, width, 'admin workspace');
});
