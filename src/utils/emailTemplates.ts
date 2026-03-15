type TemplateKey =
  | 'account_verification'
  | 'password_reset'
  | 'ebook_export_ready'
  | 'celebio_publish_success'
  | 'celebio_publish_failure'
  | 'payment_success'
  | 'payment_receipt'
  | 'integration_connected'
  | 'integration_disconnected'
  | 'weekly_digest'
  | 'failed_payment_alert'
  | 'new_login_alert'
  | 'feature_release';

export interface EmailTemplateDefinition {
  key: TemplateKey;
  name: string;
  description: string;
  category: 'auth' | 'ebook' | 'publishing' | 'payment' | 'integration' | 'engagement' | 'security' | 'product';
}

interface TemplateRenderInput {
  [key: string]: string | number | boolean | null | undefined;
}

interface TemplateRenderResult {
  subject: string;
  html: string;
  text: string;
}

const BRAND = {
  name: 'CreatorLab.ink',
  accent: '#6D5BFF',
  accent2: '#A855F7',
  dark: '#0b0b12',
  card: '#141420',
  text: '#F4F5FF',
  muted: '#A7A9C0',
};

export const EMAIL_TEMPLATES: EmailTemplateDefinition[] = [
  { key: 'account_verification', name: 'Account Verification', description: 'Verify a newly created account.', category: 'auth' },
  { key: 'password_reset', name: 'Password Reset', description: 'Reset password action email.', category: 'auth' },
  { key: 'ebook_export_ready', name: 'Ebook Export Ready', description: 'Notify user when ebook export finishes.', category: 'ebook' },
  { key: 'celebio_publish_success', name: 'cele.bio Publish Success', description: 'Publish/import completed successfully.', category: 'publishing' },
  { key: 'celebio_publish_failure', name: 'cele.bio Publish Failure', description: 'Publish/import failed and needs retry.', category: 'publishing' },
  { key: 'payment_success', name: 'Payment Success', description: 'Payment completed successfully.', category: 'payment' },
  { key: 'payment_receipt', name: 'Payment Receipt', description: 'Detailed payment receipt.', category: 'payment' },
  { key: 'integration_connected', name: 'Integration Connected', description: 'An app integration connected.', category: 'integration' },
  { key: 'integration_disconnected', name: 'Integration Disconnected', description: 'An app integration disconnected.', category: 'integration' },
  { key: 'weekly_digest', name: 'Weekly Creator Digest', description: 'Weekly activity summary.', category: 'engagement' },
  { key: 'failed_payment_alert', name: 'Failed Payment Alert', description: 'Payment failure and next steps.', category: 'payment' },
  { key: 'new_login_alert', name: 'New Login Alert', description: 'Security alert for sign-in from new device.', category: 'security' },
  { key: 'feature_release', name: 'Feature Release', description: 'Product update / new feature launch.', category: 'product' },
];

function v(input: TemplateRenderInput, key: string, fallback: string): string {
  const value = input[key];
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

function shell(title: string, preheader: string, body: string): string {
  return `
  <html>
    <body style="margin:0;background:${BRAND.dark};font-family:Inter,Segoe UI,Arial,sans-serif;color:${BRAND.text};">
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
      <div style="max-width:620px;margin:0 auto;padding:28px 18px;">
        <div style="background:linear-gradient(135deg,${BRAND.accent} 0%,${BRAND.accent2} 100%);padding:24px;border-radius:18px 18px 0 0;">
          <h1 style="margin:0;font-size:24px;line-height:1.2;color:white;">${title}</h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,.85);font-size:13px;">${BRAND.name}</p>
        </div>
        <div style="background:${BRAND.card};padding:24px;border-radius:0 0 18px 18px;border:1px solid rgba(255,255,255,.08);border-top:0;">
          ${body}
          <hr style="border:none;border-top:1px solid rgba(255,255,255,.08);margin:24px 0;" />
          <p style="margin:0;color:${BRAND.muted};font-size:12px;line-height:1.5;">You are receiving this because you have a ${BRAND.name} account.</p>
        </div>
      </div>
    </body>
  </html>`;
}

function cta(label: string, url: string): string {
  return `<a href="${url}" style="display:inline-block;background:linear-gradient(135deg,${BRAND.accent} 0%,${BRAND.accent2} 100%);color:#fff;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:700;font-size:14px;">${label}</a>`;
}

export function renderTemplate(key: TemplateKey, input: TemplateRenderInput): TemplateRenderResult {
  const userName = v(input, 'userName', 'Creator');
  const appUrl = v(input, 'appUrl', 'https://creatorlab.ink');
  const actionUrl = v(input, 'actionUrl', appUrl);
  const ebookTitle = v(input, 'ebookTitle', 'Your ebook');
  const provider = v(input, 'provider', 'Integration');
  const amount = v(input, 'amount', '$11.97');
  const date = v(input, 'date', new Date().toLocaleDateString());

  switch (key) {
    case 'account_verification': {
      const subject = 'Verify your CreatorLab account';
      const html = shell('Confirm your account', 'Verify your account to start creating.', `
        <p style="margin:0 0 12px;">Hi ${userName},</p>
        <p style="margin:0 0 18px;color:${BRAND.muted};">Welcome to CreatorLab. Verify your email to secure your account and unlock publishing features.</p>
        ${cta('Verify Account', actionUrl)}
      `);
      return { subject, html, text: `Hi ${userName}, verify your account: ${actionUrl}` };
    }
    case 'password_reset': {
      const subject = 'Reset your CreatorLab password';
      const html = shell('Password reset request', 'Use this link to reset your password.', `
        <p style="margin:0 0 12px;">Hi ${userName},</p>
        <p style="margin:0 0 18px;color:${BRAND.muted};">We received a request to reset your password. If this was you, continue below.</p>
        ${cta('Reset Password', actionUrl)}
      `);
      return { subject, html, text: `Hi ${userName}, reset your password: ${actionUrl}` };
    }
    case 'ebook_export_ready': {
      const subject = `${ebookTitle} is ready to download`;
      const html = shell('Export complete ✅', 'Your ebook export is ready.', `
        <p style="margin:0 0 12px;">Great news, ${userName}.</p>
        <p style="margin:0 0 18px;color:${BRAND.muted};"><strong>${ebookTitle}</strong> has finished exporting and is ready for download.</p>
        ${cta('Open Export', actionUrl)}
      `);
      return { subject, html, text: `${ebookTitle} is ready. Download: ${actionUrl}` };
    }
    case 'celebio_publish_success': {
      const subject = `${ebookTitle} published to cele.bio`; 
      const html = shell('Publish successful 🚀', 'Your ebook is now live in cele.bio workflow.', `
        <p style="margin:0 0 12px;">Hi ${userName},</p>
        <p style="margin:0 0 18px;color:${BRAND.muted};"><strong>${ebookTitle}</strong> was published successfully to cele.bio.</p>
        ${cta('Open Listing', actionUrl)}
      `);
      return { subject, html, text: `${ebookTitle} published to cele.bio. Open: ${actionUrl}` };
    }
    case 'celebio_publish_failure': {
      const subject = `${ebookTitle} failed to publish`; 
      const html = shell('Publish failed ⚠️', 'Your publish attempt needs attention.', `
        <p style="margin:0 0 12px;">Hi ${userName},</p>
        <p style="margin:0 0 18px;color:${BRAND.muted};">We couldn't publish <strong>${ebookTitle}</strong> to cele.bio. Review details and retry.</p>
        ${cta('Review & Retry', actionUrl)}
      `);
      return { subject, html, text: `${ebookTitle} publish failed. Retry: ${actionUrl}` };
    }
    case 'payment_success': {
      const subject = 'Payment successful';
      const html = shell('Payment complete 💳', 'Your payment was processed successfully.', `
        <p style="margin:0 0 12px;">Hi ${userName},</p>
        <p style="margin:0 0 18px;color:${BRAND.muted};">We received your payment of <strong>${amount}</strong> on ${date}. Your premium access is active.</p>
        ${cta('Open Account', actionUrl)}
      `);
      return { subject, html, text: `Payment received: ${amount} on ${date}.` };
    }
    case 'payment_receipt': {
      const subject = 'Your CreatorLab receipt';
      const invoiceId = v(input, 'invoiceId', 'INV-0001');
      const html = shell('Receipt', 'Your payment receipt from CreatorLab.', `
        <p style="margin:0 0 12px;">Receipt for ${userName}</p>
        <p style="margin:0 0 6px;color:${BRAND.muted};">Amount: <strong>${amount}</strong></p>
        <p style="margin:0 0 6px;color:${BRAND.muted};">Date: <strong>${date}</strong></p>
        <p style="margin:0 0 18px;color:${BRAND.muted};">Invoice: <strong>${invoiceId}</strong></p>
        ${cta('View Billing', actionUrl)}
      `);
      return { subject, html, text: `Receipt ${invoiceId}: ${amount} on ${date}` };
    }
    case 'integration_connected': {
      const subject = `${provider} connected successfully`;
      const html = shell('Integration connected', 'Your app integration is now active.', `
        <p style="margin:0 0 12px;">Hi ${userName},</p>
        <p style="margin:0 0 18px;color:${BRAND.muted};"><strong>${provider}</strong> is now connected to your CreatorLab workspace.</p>
        ${cta('Manage Integrations', actionUrl)}
      `);
      return { subject, html, text: `${provider} connected successfully.` };
    }
    case 'integration_disconnected': {
      const subject = `${provider} disconnected`;
      const html = shell('Integration disconnected', 'One of your integrations was disconnected.', `
        <p style="margin:0 0 12px;">Hi ${userName},</p>
        <p style="margin:0 0 18px;color:${BRAND.muted};"><strong>${provider}</strong> was disconnected from your account.</p>
        ${cta('Reconnect Integration', actionUrl)}
      `);
      return { subject, html, text: `${provider} disconnected.` };
    }
    case 'weekly_digest': {
      const subject = 'Your CreatorLab weekly digest';
      const exports = v(input, 'exports', '0');
      const published = v(input, 'published', '0');
      const html = shell('Weekly digest', 'Your weekly creator summary is ready.', `
        <p style="margin:0 0 12px;">Hi ${userName},</p>
        <p style="margin:0 0 6px;color:${BRAND.muted};">Exports this week: <strong>${exports}</strong></p>
        <p style="margin:0 0 18px;color:${BRAND.muted};">Published this week: <strong>${published}</strong></p>
        ${cta('Open Dashboard', actionUrl)}
      `);
      return { subject, html, text: `Weekly digest: exports ${exports}, published ${published}` };
    }
    case 'failed_payment_alert': {
      const subject = 'Payment failed — action needed';
      const html = shell('Payment issue', 'Your payment could not be processed.', `
        <p style="margin:0 0 12px;">Hi ${userName},</p>
        <p style="margin:0 0 18px;color:${BRAND.muted};">We couldn't process your recent payment. Update billing details to keep premium access active.</p>
        ${cta('Update Billing', actionUrl)}
      `);
      return { subject, html, text: 'Payment failed. Update billing details.' };
    }
    case 'new_login_alert': {
      const subject = 'New login detected';
      const location = v(input, 'location', 'Unknown location');
      const html = shell('Security alert', 'A new login was detected on your account.', `
        <p style="margin:0 0 12px;">Hi ${userName},</p>
        <p style="margin:0 0 18px;color:${BRAND.muted};">A new login was detected from <strong>${location}</strong>. If this wasn't you, reset your password immediately.</p>
        ${cta('Review Security', actionUrl)}
      `);
      return { subject, html, text: `New login detected from ${location}` };
    }
    case 'feature_release': {
      const subject = 'New feature: Publish Center upgrade';
      const featureName = v(input, 'featureName', 'New feature');
      const html = shell('New in CreatorLab ✨', 'A new feature just shipped.', `
        <p style="margin:0 0 12px;">Hi ${userName},</p>
        <p style="margin:0 0 18px;color:${BRAND.muted};"><strong>${featureName}</strong> is now live in your workspace.</p>
        ${cta('Try It Now', actionUrl)}
      `);
      return { subject, html, text: `${featureName} is now live.` };
    }
    default: {
      const fallbackSubject = 'CreatorLab notification';
      const html = shell('CreatorLab update', 'A new notification from CreatorLab.', `<p style="margin:0;">Hi ${userName}, you have a new update.</p>`);
      return { subject: fallbackSubject, html, text: `Hi ${userName}, you have a new update.` };
    }
  }
}
