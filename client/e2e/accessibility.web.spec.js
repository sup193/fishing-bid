import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

async function login(page, email) {
  await page.goto('/login');
  const modal = page.locator('.auth-modal');
  await expect(modal).toBeVisible();
  await modal.locator('input[name="email"]').fill(email);
  await modal.locator('input[name="password"]').fill('auction-test-password');
  await modal.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('button', { name: /Open .* profile/ })).toBeVisible();
}

async function logout(page, role) {
  await page.getByRole('button', { name: `Open ${role} profile` }).click();
  await page.getByRole('button', { name: 'Log out of TideMarket' }).click();
}

test('guest and role workspaces have no WCAG 2.1 A/AA axe violations', async ({ page }) => {
  const findings = [];
  const scan = async label => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    for (const violation of results.violations) {
      findings.push({
        workspace: label,
        rule: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.map(node => ({
          target: node.target,
          summary: node.failureSummary
        }))
      });
    }
  };

  await page.goto('/');
  await page.addStyleTag({ content: '*,:before,:after{animation:none!important;transition:none!important;scroll-behavior:auto!important}' });
  await scan('guest');

  await page.setViewportSize({ width: 390, height: 844 });
  const menuButton = page.locator('.mobile-menu');
  await menuButton.click();
  await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
  await expect(menuButton).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.getByRole('button', { name: 'Log in' }).first().click();
  const loginDialog = page.getByRole('dialog', { name: 'Welcome back to the water.' });
  await expect(loginDialog).toBeVisible();
  await expect(page.locator('.auth-modal input[name="email"]')).toBeFocused();
  const loginFocusables = loginDialog.locator('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
  await loginFocusables.last().focus();
  await page.keyboard.press('Tab');
  await expect(loginFocusables.first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(loginFocusables.last()).toBeFocused();
  await scan('guest login');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Log in' }).first()).toBeFocused();

  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByRole('dialog', { name: 'Create your account.' })).toBeVisible();
  await expect(page.locator('.auth-modal input[name="name"]')).toBeFocused();
  await scan('guest registration');
  await page.keyboard.press('Escape');

  await login(page, 'buyer-1@auction.test');
  await page.locator('.buyer-dashboard-nav').getByRole('link', { name: 'Auctions' }).click();
  await expect(page.locator('.buyer-dashboard .market-product-card').first()).toBeVisible();
  await scan('buyer');
  await page.locator('.market-details-button').first().click();
  await expect(page.locator('.auction-detail-page')).toBeVisible();
  await scan('buyer auction detail');
  await logout(page, 'buyer');

  await login(page, 'fisherman@auction.test');
  await expect(page.locator('.fisherman-view .fisherman-overview')).toBeVisible();
  await scan('fisherman');
  await page.goto('/create-auction');
  await expect(page.locator('.listing-form')).toBeVisible();
  await scan('fisherman auction form');
  await logout(page, 'fisherman');

  await login(page, 'admin@auction.test');
  await expect(page.locator('.admin-view .admin-section-heading')).toBeVisible();
  await scan('admin');
  await page.getByRole('button', { name: 'Create fisherman account' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Create fisherman login.' })).toBeVisible();
  await scan('admin create fisherman');
  await page.keyboard.press('Escape');

  const summaries = {};
  for (const finding of findings) {
    for (const node of finding.nodes) {
      const colorPair = node.summary.match(/foreground color: (#[0-9a-f]+), background color: (#[0-9a-f]+)/i);
      const key = `${finding.workspace}/${finding.rule}/${colorPair ? `${colorPair[1]} on ${colorPair[2]}` : finding.impact}`;
      summaries[key] ||= [];
      if (summaries[key].length < 2) summaries[key].push(node.target.join(' '));
    }
  }
  console.log(`Axe findings: ${JSON.stringify(summaries)}`);
  expect(findings.length, findings.map(({ workspace, rule, impact, nodes }) => `${workspace}/${rule}/${impact}/${nodes.length}`).join(', ')).toBe(0);
});
