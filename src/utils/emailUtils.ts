import { Resend } from 'resend';

const resendApiKey = process.env.RESEND_API_KEY || '';
const resendFrom = process.env.RESEND_FROM_EMAIL || 'CreatorLab <no-reply@creatorlab.ink>';
const resendReplyTo = process.env.RESEND_REPLY_TO || 'support@creatorlab.ink';
const appBaseUrl = process.env.CLIENT_URL || 'http://localhost:3000';

const resendClient = resendApiKey ? new Resend(resendApiKey) : null;

function canSendEmail(): boolean {
  if (!resendClient) {
    console.warn('[email] RESEND_API_KEY is missing; email send skipped.');
    return false;
  }
  return true;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<void> {
  if (!canSendEmail()) return;

  await resendClient!.emails.send({
    from: resendFrom,
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.text,
    replyTo: resendReplyTo,
  });
}

export async function sendWelcomeEmail(params: {
  to: string;
  name?: string | null;
}): Promise<void> {
  const displayName = params.name?.trim() || 'Creator';

  const subject = 'Welcome to CreatorLab.ink ✨';
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; line-height: 1.6; color: #111; max-width: 560px; margin: 0 auto;">
      <h2 style="margin: 0 0 10px;">Welcome, ${displayName}!</h2>
      <p style="margin: 0 0 12px;">Your CreatorLab account is ready.</p>
      <p style="margin: 0 0 16px;">You can now write, format, export, and publish your ebooks from one workspace.</p>
      <a href="${appBaseUrl}/dashboard" style="display: inline-block; padding: 10px 16px; background: #4f46e5; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600;">Open Dashboard</a>
      <p style="margin: 18px 0 0; color: #666; font-size: 13px;">Need help? Reply to this email.</p>
    </div>
  `;
  const text = `Welcome, ${displayName}! Your CreatorLab account is ready. Open your dashboard: ${appBaseUrl}/dashboard`;

  await sendEmail({
    to: params.to,
    subject,
    html,
    text,
  });
}

export async function sendTestEmail(params: {
  to: string;
  initiatedBy?: string;
}): Promise<void> {
  const subject = 'CreatorLab email test';
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; line-height: 1.6; color: #111; max-width: 560px; margin: 0 auto;">
      <h2 style="margin: 0 0 10px;">Resend integration is working ✅</h2>
      <p style="margin: 0 0 12px;">This test email was sent from your CreatorLab backend.</p>
      <p style="margin: 0 0 0; color: #666; font-size: 13px;">Triggered by: ${params.initiatedBy || 'system'}</p>
    </div>
  `;
  const text = `Resend integration is working. Triggered by: ${params.initiatedBy || 'system'}`;

  await sendEmail({
    to: params.to,
    subject,
    html,
    text,
  });
}
