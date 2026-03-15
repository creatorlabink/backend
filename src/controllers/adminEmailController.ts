import { Response } from 'express';
import pool from '../config/db';
import { AuthRequest } from '../middleware/auth';
import { sendEmail } from '../utils/emailUtils';
import { EMAIL_TEMPLATES, renderTemplate } from '../utils/emailTemplates';

let emailTablesReady = false;

async function ensureEmailTables(): Promise<void> {
  if (emailTablesReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      direction VARCHAR(20) NOT NULL,
      template_key VARCHAR(100),
      sender_email VARCHAR(255),
      recipient_email VARCHAR(255),
      subject TEXT,
      html_body TEXT,
      text_body TEXT,
      payload_json JSONB,
      provider_message_id TEXT,
      status VARCHAR(40) DEFAULT 'queued',
      created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS idx_email_messages_created_at ON email_messages(created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_email_messages_direction ON email_messages(direction, created_at DESC)');

  emailTablesReady = true;
}

export const listEmailTemplates = async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({ templates: EMAIL_TEMPLATES });
};

export const renderEmailTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { templateKey, variables } = req.body as { templateKey?: string; variables?: Record<string, unknown> };
    if (!templateKey) {
      res.status(400).json({ error: 'templateKey is required.' });
      return;
    }

    const rendered = renderTemplate(templateKey as never, (variables || {}) as Record<string, string | number | boolean | null | undefined>);
    res.json({ templateKey, ...rendered });
  } catch (err) {
    console.error('renderEmailTemplate error:', err);
    res.status(500).json({ error: 'Failed to render template.' });
  }
};

export const sendTemplateEmail = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await ensureEmailTables();

    const { to, templateKey, variables } = req.body as {
      to?: string;
      templateKey?: string;
      variables?: Record<string, unknown>;
    };

    if (!to || !templateKey) {
      res.status(400).json({ error: 'to and templateKey are required.' });
      return;
    }

    const rendered = renderTemplate(templateKey as never, (variables || {}) as Record<string, string | number | boolean | null | undefined>);

    await sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    const result = await pool.query(
      `INSERT INTO email_messages (
        direction, template_key, sender_email, recipient_email, subject,
        html_body, text_body, payload_json, status, created_by_user_id,
        created_at, updated_at
      ) VALUES (
        'outbound', $1, $2, $3, $4,
        $5, $6, $7::jsonb, 'sent', $8,
        NOW(), NOW()
      )
      RETURNING id`,
      [
        templateKey,
        process.env.RESEND_FROM_EMAIL || 'CreatorLab <no-reply@creatorlab.ink>',
        to,
        rendered.subject,
        rendered.html,
        rendered.text,
        JSON.stringify(variables || {}),
        req.user?.userId || null,
      ]
    );

    res.json({ success: true, id: result.rows[0]?.id || null });
  } catch (err) {
    console.error('sendTemplateEmail error:', err);
    res.status(500).json({ error: 'Failed to send template email.' });
  }
};

export const sendCustomEmail = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await ensureEmailTables();

    const { to, subject, html, text } = req.body as {
      to?: string;
      subject?: string;
      html?: string;
      text?: string;
    };

    if (!to || !subject || !html) {
      res.status(400).json({ error: 'to, subject and html are required.' });
      return;
    }

    await sendEmail({ to, subject, html, text });

    const result = await pool.query(
      `INSERT INTO email_messages (
        direction, template_key, sender_email, recipient_email, subject,
        html_body, text_body, payload_json, status, created_by_user_id,
        created_at, updated_at
      ) VALUES (
        'outbound', 'custom', $1, $2, $3,
        $4, $5, '{}'::jsonb, 'sent', $6,
        NOW(), NOW()
      )
      RETURNING id`,
      [
        process.env.RESEND_FROM_EMAIL || 'CreatorLab <no-reply@creatorlab.ink>',
        to,
        subject,
        html,
        text || null,
        req.user?.userId || null,
      ]
    );

    res.json({ success: true, id: result.rows[0]?.id || null });
  } catch (err) {
    console.error('sendCustomEmail error:', err);
    res.status(500).json({ error: 'Failed to send custom email.' });
  }
};

export const listEmailMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await ensureEmailTables();

    const direction = (req.query.direction as string | undefined)?.toLowerCase();
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const args: unknown[] = [];
    let where = '';

    if (direction === 'inbound' || direction === 'outbound') {
      args.push(direction);
      where = `WHERE direction = $${args.length}`;
    }

    args.push(limit);

    const result = await pool.query(
      `SELECT id, direction, template_key, sender_email, recipient_email, subject, status, created_at
       FROM email_messages
       ${where}
       ORDER BY created_at DESC
       LIMIT $${args.length}`,
      args
    );

    res.json({ messages: result.rows });
  } catch (err) {
    console.error('listEmailMessages error:', err);
    res.status(500).json({ error: 'Failed to list emails.' });
  }
};

export const receiveInboundEmail = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await ensureEmailTables();

    const payload = req.body as {
      from?: string;
      to?: string;
      subject?: string;
      text?: string;
      html?: string;
      message_id?: string;
    };

    const sender = payload.from || 'unknown@unknown.com';
    const recipient = payload.to || 'unknown@creatorlab.ink';

    await pool.query(
      `INSERT INTO email_messages (
        direction, template_key, sender_email, recipient_email, subject,
        html_body, text_body, payload_json, provider_message_id, status,
        created_at, updated_at
      ) VALUES (
        'inbound', 'inbound', $1, $2, $3,
        $4, $5, $6::jsonb, $7, 'received',
        NOW(), NOW()
      )`,
      [
        sender,
        recipient,
        payload.subject || '(no subject)',
        payload.html || null,
        payload.text || null,
        JSON.stringify(payload),
        payload.message_id || null,
      ]
    );

    res.json({ received: true });
  } catch (err) {
    console.error('receiveInboundEmail error:', err);
    res.status(500).json({ error: 'Failed to ingest inbound email.' });
  }
};
