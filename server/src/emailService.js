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

function otpEmailHtml(name, otp) {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f5f4ee;font-family:Arial,sans-serif;color:#123c3a">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="520" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:8px;padding:32px">
          <tr><td>
            <h1 style="margin:0 0 20px;font-size:24px">Verify your Fishing Bid account</h1>
            <p>Hello ${name},</p>
            <p>Welcome to Fishing Bid!</p>
            <p>Your email verification code is:</p>
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

export async function sendOtpEmail({ name, email, otp }) {
  const from = process.env.OTP_FROM_EMAIL || 'Fishing Bid <onboarding@resend.dev>';
  const payload = {
    from,
    to: [email],
    subject: 'Verify your Fishing Bid account',
    html: otpEmailHtml(name, otp),
    text: `Hello ${name},\n\nWelcome to Fishing Bid!\n\nYour email verification code is:\n\n${otp}\n\nThis verification code expires in 5 minutes.\n\nDo not share this code with anyone.\n\nThank you,\nFishing Bid Team`
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
