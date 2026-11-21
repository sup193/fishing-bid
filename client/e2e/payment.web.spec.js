import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';

const apiBase = 'http://127.0.0.1:5173/api';
const paymentSecret = 'test-only-e2e-razorpay-secret';

test('buyer cancellation releases a listing and a verified retry persists paid order history', async ({ page }) => {
  await page.addInitScript(() => {
    window.Razorpay = class {
      constructor(options) {
        window.__razorpayTestOptions = options;
        this.handlers = {};
      }

      on(event, handler) {
        this.handlers[event] = handler;
      }

      open() {}
    };
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Log in' }).first().click();
  const login = page.locator('.auth-modal');
  await login.locator('input[name="email"]').fill('buyer-1@auction.test');
  await login.locator('input[name="password"]').fill('auction-test-password');
  await login.getByRole('button', { name: 'Log in' }).click();

  const prawns = page.locator('.market-listing-section[aria-labelledby="fresh-catch-title"] .market-product-card').filter({ hasText: 'Prawns' });
  await expect(prawns).toBeVisible();
  await prawns.getByRole('button', { name: 'Buy now' }).click();
  const details = page.locator('.modal-backdrop .modal').filter({
    has: page.getByRole('button', { name: /Buy now ·/ })
  });
  await details.getByRole('button', { name: /Buy now ·/ }).click();

  const checkout = page.locator('.modal-backdrop .modal').last();
  await checkout.locator('textarea[name="address"]').fill('Test pickup, Udupi');
  const firstOrderResponse = page.waitForResponse(response =>
    response.url().endsWith('/api/payments/razorpay/orders') && response.request().method() === 'POST'
  );
  await checkout.getByRole('button', { name: 'Continue to payment' }).click();
  const firstOrder = await firstOrderResponse;
  expect(firstOrder.status()).toBe(201);
  const cancelledPayment = await firstOrder.json();
  await expect.poll(() => page.evaluate(() => window.__razorpayTestOptions?.order_id)).toBe(cancelledPayment.gatewayOrderId);

  const cancellation = page.waitForResponse(response =>
    response.url().endsWith('/api/payments/razorpay/failure') && response.request().method() === 'POST'
  );
  await page.evaluate(() => window.__razorpayTestOptions.modal.ondismiss());
  expect((await cancellation).status()).toBe(200);
  await expect(page.getByText('Checkout closed. No payment was confirmed; you can retry from the listing.')).toBeVisible();

  const token = await page.evaluate(() => localStorage.getItem('tide_token'));
  const headers = { Authorization: `Bearer ${token}` };
  const ordersAfterCancellation = await page.context().request.get(`${apiBase}/orders`, { headers });
  expect(ordersAfterCancellation.status()).toBe(200);
  const cancelledOrder = (await ordersAfterCancellation.json()).find(order => order.orderNumber === cancelledPayment.orderNumber);
  expect(cancelledOrder.paymentStatus).toBe('failed');
  expect(cancelledOrder.orderStatus).toBe('payment-failed');
  const availableListings = await page.context().request.get(`${apiBase}/listings`);
  expect((await availableListings.json()).find(listing => listing.id === 'fixed-listing').status).toBe('available');

  await details.getByRole('button', { name: /Buy now ·/ }).click();
  const retryCheckout = page.locator('.modal-backdrop .modal').last();
  await retryCheckout.locator('textarea[name="address"]').fill('Test pickup, Udupi');
  const retryResponse = page.waitForResponse(response =>
    response.url().endsWith('/api/payments/razorpay/orders') && response.request().method() === 'POST'
  );
  await retryCheckout.getByRole('button', { name: 'Continue to payment' }).click();
  const retryOrder = await retryResponse;
  expect(retryOrder.status()).toBe(201);
  const payment = await retryOrder.json();
  await expect.poll(() => page.evaluate(() => window.__razorpayTestOptions?.order_id)).toBe(payment.gatewayOrderId);

  const paymentId = `pay_${payment.gatewayOrderId}`;
  const signature = createHmac('sha256', paymentSecret)
    .update(`${payment.gatewayOrderId}|${paymentId}`)
    .digest('hex');
  const verification = page.waitForResponse(response =>
    response.url().endsWith('/api/payments/razorpay/verify') && response.request().method() === 'POST'
  );
  await page.evaluate(({ paymentId, signature }) => window.__razorpayTestOptions.handler({
    razorpay_order_id: window.__razorpayTestOptions.order_id,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature
  }), { paymentId, signature });
  expect((await verification).status()).toBe(200);
  await expect(page.getByText(`Payment confirmed. Order ${payment.orderNumber} is being processed.`)).toBeVisible();

  const finalOrders = await page.context().request.get(`${apiBase}/orders`, { headers });
  const paidOrder = (await finalOrders.json()).find(order => order.orderNumber === payment.orderNumber);
  expect(paidOrder.paymentStatus).toBe('paid');
  expect(paidOrder.orderStatus).toBe('processing');
  const transactions = await page.context().request.get(`${apiBase}/transactions`, { headers });
  expect(transactions.status()).toBe(200);
  expect((await transactions.json()).some(item => item.id === payment.transactionId && item.status === 'paid')).toBe(true);
});
