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

  await login(page, 'buyer-1@auction.test');
  await page.locator('.topbar nav').getByRole('link', { name: 'Auctions' }).click();
  await expect(page.locator('.buyer-dashboard .market-product-card').first()).toBeVisible();
  await scan('buyer');
  await logout(page, 'buyer');

  await login(page, 'fisherman@auction.test');
  await expect(page.locator('.fisherman-view .fisherman-overview')).toBeVisible();
  await scan('fisherman');
  await logout(page, 'fisherman');

  await login(page, 'admin@auction.test');
  await expect(page.locator('.admin-view .admin-section-heading')).toBeVisible();
  await scan('admin');

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
