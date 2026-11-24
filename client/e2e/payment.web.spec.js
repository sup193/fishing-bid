import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { e2eApiUrl, e2eWebUrl } from './urls.js';

test('buyer pays by dynamic UPI QR and order stays unpaid until admin verification', async ({ page, browser }) => {
  await page.goto('/login');
  const login = page.locator('.auth-modal');
  await expect(login).toBeVisible();
  await login.locator('input[name="email"]').fill('buyer-1@auction.test');
  await login.locator('input[name="password"]').fill('auction-test-password');
  await login.getByRole('button', { name: 'Log in' }).click();
  await page.locator('.buyer-dashboard-nav').getByRole('link', { name: 'Auctions' }).click();

  const prawns = page.locator('.market-listing-section[aria-labelledby="fresh-catch-title"] .market-product-card').filter({ hasText: 'Prawns' });
  await expect(prawns).toBeVisible();
  await prawns.getByRole('button', { name: 'Buy now' }).click();
  const details = page.locator('.auction-detail-content').filter({
    has: page.getByRole('button', { name: /Buy now ·/ })
  });
  await details.getByRole('button', { name: /Buy now ·/ }).click();

  const checkout = page.locator('.modal-backdrop .modal').last();
  await checkout.locator('textarea[name="address"]').fill('Test pickup, Udupi');
  const createAttemptResponse = page.waitForResponse(response =>
    response.url().endsWith('/api/payments/upi/orders') && response.request().method() === 'POST'
  );
  await checkout.getByRole('button', { name: 'Continue to payment' }).click();
  const createAttempt = await createAttemptResponse;
  expect(createAttempt.status()).toBe(201);
  const payment = await createAttempt.json();
  expect(payment.amount).toBe(15000);
  expect(payment.upiRecipientId).toBe('itssupriyak1@okaxis');
  const paymentUri = new URL(payment.paymentUri.replace('upi://pay?', 'https://upi.invalid/?'));
  expect(paymentUri.searchParams.get('pa')).toBe('itssupriyak1@okaxis');
  expect(paymentUri.searchParams.get('am')).toBe('15000.00');
  expect(paymentUri.searchParams.get('cu')).toBe('INR');
  expect(paymentUri.searchParams.get('tn')).toBe(payment.orderNumber);
  expect(paymentUri.searchParams.get('tr')).toBe(payment.upiPaymentReference);
  await expect(checkout.getByRole('heading', { name: 'Pay by UPI QR' })).toBeVisible();
  await expect(checkout.locator('.upi-payment-summary strong')).toHaveText('₹15,000.00');
  await expect(checkout.getByText('itssupriyak1@okaxis')).toBeVisible();
  await expect(checkout.locator('.upi-qr-code svg')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(checkout.locator('.upi-qr-layout')).toBeVisible();
  const layoutColumns = await checkout.locator('.upi-qr-layout').evaluate(element => getComputedStyle(element).gridTemplateColumns);
  expect(layoutColumns.split(' ').length).toBe(1);
  const accessibility = await new AxeBuilder({ page })
    .include('.upi-checkout-modal')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);

  await checkout.getByLabel('UPI UTR / reference number').fill('UPI12345678');
  const submitResponse = page.waitForResponse(response =>
    response.url().endsWith('/api/payments/upi/submit-reference') && response.request().method() === 'POST'
  );
  await checkout.getByRole('button', { name: 'Submit payment reference' }).click();
  expect((await submitResponse).status()).toBe(202);
  await expect(checkout.getByRole('status')).toContainText('order remains unpaid');
  const token = await page.evaluate(() => localStorage.getItem('tide_token'));
  const headers = { Authorization: `Bearer ${token}` };
  const pendingOrders = await page.context().request.get(`${e2eApiUrl}/orders`, { headers });
  const pendingOrder = (await pendingOrders.json()).find(order => order.orderNumber === payment.orderNumber);
  expect(pendingOrder.paymentStatus).toBe('pending');
  expect(pendingOrder.orderStatus).not.toBe('processing');
  const pendingStatus = await page.context().request.get(`${e2eApiUrl}/payments/upi/${payment.transactionId}/status`, { headers });
  expect((await pendingStatus.json()).status).toBe('pending_verification');

  const adminContext = await browser.newContext({ baseURL: e2eWebUrl });
  const adminPage = await adminContext.newPage();
  await adminPage.goto('/login');
  const adminLoginForm = adminPage.locator('.auth-modal');
  await adminLoginForm.locator('input[name="email"]').fill('admin@auction.test');
  await adminLoginForm.locator('input[name="password"]').fill('auction-test-password');
  await adminLoginForm.getByRole('button', { name: 'Log in' }).click();
  await expect(adminPage.getByRole('heading', { name: 'Welcome, Admin.' })).toBeVisible();
  await adminPage.goto('/admin/transactions');
  const reviewLine = adminPage.locator('.upi-review-line').filter({ hasText: payment.orderNumber });
  await expect(reviewLine).toContainText('UPI12345678');
  adminPage.once('dialog', dialog => dialog.accept());
  await reviewLine.getByRole('button', { name: 'Verify' }).click();
  await expect(adminPage.getByText('No UPI payments awaiting verification.')).toBeVisible();
  await adminContext.close();

  await expect(checkout.getByRole('status')).toContainText('Payment verified', { timeout: 15_000 });
  const paidOrders = await page.context().request.get(`${e2eApiUrl}/orders`, { headers });
  const paidOrder = (await paidOrders.json()).find(order => order.orderNumber === payment.orderNumber);
  expect(paidOrder.paymentStatus).toBe('paid');
  expect(paidOrder.orderStatus).toBe('processing');
  const transactions = await page.context().request.get(`${e2eApiUrl}/transactions`, { headers });
  expect((await transactions.json()).some(item => item.id === payment.transactionId && item.status === 'paid' && item.upiUtr === 'UPI12345678')).toBe(true);
});
