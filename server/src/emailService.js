import { Resend } from 'resend';

let resendClient;
let testSender;

export function setEmailSenderForTests(sender) {
  testSender = sender;
}

function getClient() {
  if (!process.env.RESEND_API_KEY) {
    throw Object.assign(new Error('Email verification is not configured'), { status: 503 });
  }
  if (!resendClient) resendClient = new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function otpEmailHtml(name, otp, purpose) {
  const reset = purpose === 'password_reset';
  const greetingName = escapeHtml(name || 'there');
  const heading = reset ? 'Reset your Fishing Bid password' : 'Verify your Fishing Bid account';
  const instruction = reset
    ? 'Use this code to continue resetting your password:'
    : 'Your email verification code is:';
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f5f4ee;font-family:Arial,sans-serif;color:#123c3a">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="520" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:8px;padding:32px">
          <tr><td>
            <h1 style="margin:0 0 20px;font-size:24px">${heading}</h1>
            <p>Hello ${greetingName},</p>
            <p>${reset ? 'We received a request to reset your password.' : 'Welcome to Fishing Bid!'}</p>
            <p>${instruction}</p>
            <p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:24px 0">${otp}</p>
            <p>This verification code expires in 5 minutes.</p>
            <p><strong>Do not share this code with anyone.</strong></p>
            <p>Thank you,<br />Fishing Bid Team</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export async function sendOtpEmail({ name, email, otp, purpose = 'registration' }) {
  if (!['registration', 'password_reset'].includes(purpose)) {
    throw new Error('Unsupported email verification purpose');
  }
  const reset = purpose === 'password_reset';
  const greetingName = name || 'there';
  const subject = reset ? 'Reset your Fishing Bid password' : 'Verify your Fishing Bid account';
  const intro = reset ? 'We received a request to reset your password.' : 'Welcome to Fishing Bid!';
  const instruction = reset ? 'Use this code to continue resetting your password:' : 'Your email verification code is:';
  const from = process.env.OTP_FROM_EMAIL || 'Fishing Bid <onboarding@resend.dev>';
  const payload = {
    from,
    to: [email],
    subject,
    html: otpEmailHtml(greetingName, otp, purpose),
    text: `Hello ${greetingName},\n\n${intro}\n\n${instruction}\n\n${otp}\n\nThis verification code expires in 5 minutes.\n\nDo not share this code with anyone.\n\nThank you,\nFishing Bid Team`
  };
  if (testSender) return testSender(payload);

  const { data, error } = await getClient().emails.send(payload);
  if (error) {
    const sendError = new Error('Could not send the verification email');
    sendError.status = 502;
    sendError.providerDetail = typeof error.message === 'string' ? error.message.slice(0, 300) : '';
    throw sendError;
  }
  return data;
}
