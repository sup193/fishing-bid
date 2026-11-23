import nodemailer from 'nodemailer';

let transporter;
let testSender;

export function setEmailSenderForTests(sender) {
  testSender = sender;
}

function getTransporter() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || 465);
  const secureValue = process.env.SMTP_SECURE === undefined
    ? 'true'
    : process.env.SMTP_SECURE.trim().toLowerCase();
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.EMAIL_FROM;
  if (!user || !pass || !from) {
    throw Object.assign(new Error('SMTP email delivery is not configured'), { status: 503 });
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !['true', 'false'].includes(secureValue)) {
    throw Object.assign(new Error('SMTP email configuration is invalid'), { status: 503 });
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: secureValue === 'true',
      auth: { user, pass }
    });
  }
  return transporter;
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
            <p style="margin:0 0 8px;color:#28796d;font-size:12px;font-weight:700;letter-spacing:2px">FISHING BID</p>
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
  const payload = {
    from: process.env.EMAIL_FROM,
    to: [email],
    subject,
    html: otpEmailHtml(greetingName, otp, purpose),
    text: `Fishing Bid\n\nHello ${greetingName},\n\n${intro}\n\n${instruction}\n\n${otp}\n\nThis verification code expires in 5 minutes.\n\nDo not share this code with anyone.\n\nThank you,\nFishing Bid Team`
  };
  const mailTransport = testSender ? null : getTransporter();
  try {
    return testSender
      ? await testSender(payload)
      : await mailTransport.sendMail(payload);
  } catch {
    throw Object.assign(new Error('Could not send the verification email'), { status: 502 });
  }
}
