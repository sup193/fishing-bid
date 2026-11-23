import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { sendOtpEmail, setEmailSenderForTests } from '../src/emailService.js';

process.env.EMAIL_FROM = 'Fishing Bid <amorelicious1@gmail.com>';
const sentMessages = [];

after(() => setEmailSenderForTests(null));

test('registration and password-reset OTPs use the branded Gmail sender', async () => {
  setEmailSenderForTests(async message => {
    sentMessages.push(message);
    return { messageId: `test-${sentMessages.length}` };
  });

  await sendOtpEmail({
    name: '<Buyer & Co>',
    email: 'buyer@example.test',
    otp: '123456'
  });
  await sendOtpEmail({
    name: 'Buyer',
    email: 'buyer@example.test',
    otp: '654321',
    purpose: 'password_reset'
  });

  assert.equal(sentMessages.length, 2);
  assert.equal(sentMessages[0].from, 'Fishing Bid <amorelicious1@gmail.com>');
  assert.deepEqual(sentMessages[0].to, ['buyer@example.test']);
  assert.equal(sentMessages[0].subject, 'Verify your Fishing Bid account');
  assert.match(sentMessages[0].html, /Hello &lt;Buyer &amp; Co&gt;/);
  assert.match(sentMessages[0].text, /123456/);
  assert.equal(sentMessages[1].subject, 'Reset your Fishing Bid password');
  assert.match(sentMessages[1].html, /expires in 5 minutes/);
  assert.match(sentMessages[1].text, /654321/);
});

test('SMTP delivery failures return a safe generic error', async () => {
  setEmailSenderForTests(async () => {
    throw new Error('Sensitive SMTP authentication response');
  });

  await assert.rejects(
    sendOtpEmail({ name: 'Buyer', email: 'buyer@example.test', otp: '123456' }),
    error => error.status === 502
      && error.message === 'Could not send the verification email'
      && !error.message.includes('Sensitive SMTP')
  );
});
