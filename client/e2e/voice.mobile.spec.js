import { expect, test } from '@playwright/test';

test('Expo web assistant reports unavailable microphone recognition and supports typed search', async ({ page }) => {
  await page.addInitScript(() => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
  });
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill('buyer-5@auction.test');
  await page.getByPlaceholder('Enter your password').fill('auction-test-password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByText('Fresh from the coast.')).toBeVisible();

  await expect(page.getByText('Voice marketplace', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start listening' }).click();
  await expect(page.getByText('Speech recognition is unavailable here. You can type your command instead.')).toBeVisible();
  const input = page.getByLabel('Type a command');
  await input.fill('Find Tuna');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(/\d+ matching catches found\./)).toBeVisible();
  await expect(page.getByText('Tuna', { exact: true }).first()).toBeVisible();
});
