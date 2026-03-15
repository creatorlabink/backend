import crypto from 'crypto';
import { Request, Response } from 'express';
import pool from '../config/db';
import { AuthRequest } from '../middleware/auth';
import { decryptSecret, encryptSecret } from '../utils/integrationCrypto';

const PROVIDER = 'celebio';
const CELEBIO_BASE_URL = process.env.CELEBIO_BASE_URL || 'https://cele.bio';
const CELEBIO_AUTHORIZE_URL = process.env.CELEBIO_OAUTH_AUTHORIZE_URL || `${CELEBIO_BASE_URL}/oauth/authorize`;
const CELEBIO_TOKEN_URL = process.env.CELEBIO_OAUTH_TOKEN_URL || `${CELEBIO_BASE_URL}/oauth/token`;
const CELEBIO_IMPORT_URL = process.env.CELEBIO_IMPORT_URL || `${CELEBIO_BASE_URL}/v1/imports/ebook`;
const OAUTH_SCOPES = process.env.CELEBIO_OAUTH_SCOPES || 'products.write files.write products.read';
const CELEBIO_WEBHOOK_SECRET = process.env.CELEBIO_WEBHOOK_SECRET || '';
const CELEBIO_SIGNATURE_HEADER = 'x-celebio-signature-sha256';
const CELEBIO_TIMESTAMP_HEADER = 'x-celebio-timestamp';

const CLIENT_ID = process.env.CELEBIO_CLIENT_ID || '';
const CLIENT_SECRET = process.env.CELEBIO_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.CELEBIO_REDIRECT_URI || `${process.env.CLIENT_URL || 'http://localhost:3000'}/auth/integrations/celebio/callback`;

let tablesReady = false;

interface ConnectionRow {
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  oauth_state: string | null;
  account_id: string | null;
  account_username: string | null;
  scopes: string | null;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  account?: {
    id?: string;
    username?: string;
  };
}

async function ensureTables(): Promise<void> {
  if (tablesReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS integration_connections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider VARCHAR(80) NOT NULL,
      access_token_enc TEXT,
      refresh_token_enc TEXT,
      token_expires_at TIMESTAMPTZ,
      oauth_state TEXT,
      account_id TEXT,
      account_username TEXT,
      scopes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, provider)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS integration_publish_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ebook_id UUID NOT NULL REFERENCES ebooks(id) ON DELETE CASCADE,
      provider VARCHAR(80) NOT NULL,
      external_import_id TEXT,
      external_product_id TEXT,
      status VARCHAR(40) NOT NULL DEFAULT 'queued',
      response_json JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_integration_connections_user_provider
      ON integration_connections(user_id, provider);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_integration_publish_jobs_user
      ON integration_publish_jobs(user_id, provider, created_at DESC);
  `);

  tablesReady = true;
}

async function getConnection(userId: string): Promise<ConnectionRow | null> {
  await ensureTables();

  const result = await pool.query(
    `SELECT access_token_enc, refresh_token_enc, token_expires_at, oauth_state, account_id, account_username, scopes
     FROM integration_connections
     WHERE user_id = $1 AND provider = $2`,
    [userId, PROVIDER]
  );

  return result.rows[0] || null;
}

function tokenExpired(tokenExpiresAt: string | null): boolean {
  if (!tokenExpiresAt) return false;
  return Date.now() > new Date(tokenExpiresAt).getTime() - 30_000;
}

async function saveConnection(
  userId: string,
  payload: {
    accessToken?: string;
    refreshToken?: string;
    tokenExpiresAt?: Date | null;
    oauthState?: string | null;
    accountId?: string | null;
    accountUsername?: string | null;
    scopes?: string | null;
  }
): Promise<void> {
  await ensureTables();

  const accessTokenEnc = payload.accessToken ? encryptSecret(payload.accessToken) : null;
  const refreshTokenEnc = payload.refreshToken ? encryptSecret(payload.refreshToken) : null;

  await pool.query(
    `INSERT INTO integration_connections
      (user_id, provider, access_token_enc, refresh_token_enc, token_expires_at, oauth_state, account_id, account_username, scopes, created_at, updated_at)
     VALUES
      ($1, $2, COALESCE($3, NULL), COALESCE($4, NULL), $5, $6, $7, $8, $9, NOW(), NOW())
     ON CONFLICT (user_id, provider)
     DO UPDATE SET
      access_token_enc = COALESCE($3, integration_connections.access_token_enc),
      refresh_token_enc = COALESCE($4, integration_connections.refresh_token_enc),
      token_expires_at = COALESCE($5, integration_connections.token_expires_at),
      oauth_state = $6,
      account_id = COALESCE($7, integration_connections.account_id),
      account_username = COALESCE($8, integration_connections.account_username),
      scopes = COALESCE($9, integration_connections.scopes),
      updated_at = NOW()`,
    [
      userId,
      PROVIDER,
      accessTokenEnc,
      refreshTokenEnc,
      payload.tokenExpiresAt ?? null,
      payload.oauthState ?? null,
      payload.accountId ?? null,
      payload.accountUsername ?? null,
      payload.scopes ?? null,
    ]
  );
}

async function exchangeCodeForToken(code: string): Promise<TokenResponse> {
  const response = await fetch(CELEBIO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${body}`);
  }

  return (await response.json()) as TokenResponse;
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const response = await fetch(CELEBIO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${body}`);
  }

  return (await response.json()) as TokenResponse;
}

async function resolveValidAccessToken(userId: string): Promise<string> {
  const connection = await getConnection(userId);
  if (!connection?.access_token_enc) {
    throw new Error('No cele.bio connection found');
  }

  const currentAccessToken = decryptSecret(connection.access_token_enc);
  if (!tokenExpired(connection.token_expires_at)) {
    return currentAccessToken;
  }

  if (!connection.refresh_token_enc) {
    throw new Error('cele.bio token expired. Reconnect your account.');
  }

  const refreshToken = decryptSecret(connection.refresh_token_enc);
  const token = await refreshAccessToken(refreshToken);

  await saveConnection(userId, {
    accessToken: token.access_token,
    refreshToken: token.refresh_token || refreshToken,
    tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
    oauthState: null,
    scopes: token.scope || connection.scopes,
    accountId: token.account?.id || connection.account_id,
    accountUsername: token.account?.username || connection.account_username,
  });

  return token.access_token;
}

function getUserId(req: AuthRequest): string | null {
  return req.user?.userId || null;
}

function constantTimeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a, 'utf8');
  const bBuffer = Buffer.from(b, 'utf8');
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

export const celebioWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!CELEBIO_WEBHOOK_SECRET) {
      res.status(500).json({ error: 'CELEBIO_WEBHOOK_SECRET is not configured.' });
      return;
    }

    const signature = req.header(CELEBIO_SIGNATURE_HEADER) || '';
    const timestamp = req.header(CELEBIO_TIMESTAMP_HEADER) || '';

    if (!signature || !timestamp) {
      res.status(400).json({ error: 'Missing webhook signature headers.' });
      return;
    }

    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : JSON.stringify(req.body || {});

    const signedPayload = `${timestamp}.${rawBody}`;
    const expectedSignature = crypto
      .createHmac('sha256', CELEBIO_WEBHOOK_SECRET)
      .update(signedPayload)
      .digest('hex');

    if (!constantTimeEqual(signature.trim(), expectedSignature)) {
      res.status(401).json({ error: 'Invalid webhook signature.' });
      return;
    }

    const event = JSON.parse(rawBody) as {
      event?: string;
      type?: string;
      import_id?: string;
      status?: string;
      data?: {
        import_id?: string;
        status?: string;
        [key: string]: unknown;
      };
      [key: string]: unknown;
    };

    const eventType = event.event || event.type || '';
    if (eventType !== 'import.completed' && eventType !== 'import.failed') {
      res.json({ received: true, ignored: true });
      return;
    }

    const importId = event.data?.import_id || event.import_id || null;
    const status =
      event.data?.status ||
      event.status ||
      (eventType === 'import.completed' ? 'ready' : 'failed');

    if (importId) {
      await ensureTables();
      await pool.query(
        `UPDATE integration_publish_jobs
         SET status = $1,
             response_json = $2::jsonb,
             updated_at = NOW()
         WHERE provider = $3 AND external_import_id = $4`,
        [status, JSON.stringify(event), PROVIDER, importId]
      );
    }

    res.json({ received: true });
  } catch (err) {
    console.error('celebioWebhook error:', err);
    res.status(500).json({ error: 'Failed to process cele.bio webhook.' });
  }
};

export const celebioStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const connection = await getConnection(userId);
    const connected = Boolean(connection?.access_token_enc);

    res.json({
      provider: PROVIDER,
      connected,
      account: connected
        ? {
            id: connection?.account_id,
            username: connection?.account_username,
          }
        : null,
      expires_at: connection?.token_expires_at || null,
      scopes: connection?.scopes || null,
    });
  } catch (err) {
    console.error('celebioStatus error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const celebioConnectUrl = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!CLIENT_ID || !CLIENT_SECRET) {
      res.status(500).json({ error: 'Cele.bio OAuth is not configured on server.' });
      return;
    }

    const state = crypto.randomBytes(24).toString('hex');

    await saveConnection(userId, {
      oauthState: state,
    });

    const url = new URL(CELEBIO_AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('scope', OAUTH_SCOPES);
    url.searchParams.set('state', state);

    res.json({ url: url.toString(), state, provider: PROVIDER });
  } catch (err) {
    console.error('celebioConnectUrl error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const celebioExchangeCode = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { code, state } = req.body as { code?: string; state?: string };
    if (!code || !state) {
      res.status(400).json({ error: 'code and state are required' });
      return;
    }

    const connection = await getConnection(userId);
    if (!connection?.oauth_state || connection.oauth_state !== state) {
      res.status(400).json({ error: 'Invalid OAuth state' });
      return;
    }

    const token = await exchangeCodeForToken(code);
    await saveConnection(userId, {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
      oauthState: null,
      scopes: token.scope || OAUTH_SCOPES,
      accountId: token.account?.id || null,
      accountUsername: token.account?.username || null,
    });

    res.json({ success: true, provider: PROVIDER });
  } catch (err) {
    console.error('celebioExchangeCode error:', err);
    res.status(500).json({ error: 'Failed to complete cele.bio OAuth connection' });
  }
};

export const celebioDisconnect = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await ensureTables();
    await pool.query(
      `DELETE FROM integration_connections WHERE user_id = $1 AND provider = $2`,
      [userId, PROVIDER]
    );

    res.json({ success: true, provider: PROVIDER });
  } catch (err) {
    console.error('celebioDisconnect error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const celebioPublishEbook = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const ebookId = req.params.ebookId;
    if (!ebookId) {
      res.status(400).json({ error: 'ebookId is required' });
      return;
    }

    const accessToken = await resolveValidAccessToken(userId);

    const ebookResult = await pool.query(
      `SELECT id, title, template, raw_text, formatted_json, updated_at
       FROM ebooks WHERE id = $1 AND user_id = $2`,
      [ebookId, userId]
    );

    if (!ebookResult.rows.length) {
      res.status(404).json({ error: 'Ebook not found' });
      return;
    }

    const ebook = ebookResult.rows[0] as {
      id: string;
      title: string;
      template: string;
      raw_text: string | null;
      formatted_json: unknown;
      updated_at: string;
    };

    const body = req.body as {
      subtitle?: string;
      description?: string;
      price?: number;
      currency?: string;
      tags?: string[];
      category?: string;
      language?: string;
      isDraft?: boolean;
      assetUrls?: {
        epub?: string;
        pdf?: string;
      };
    };

    const payload = {
      external_source: 'creatorlab',
      external_id: ebook.id,
      metadata: {
        title: ebook.title,
        subtitle: body.subtitle || null,
        description: body.description || '',
        category: body.category || 'ebooks',
        tags: Array.isArray(body.tags) ? body.tags : [],
        language: body.language || 'en',
        price: body.price ?? 0,
        currency: body.currency || 'USD',
      },
      content: {
        raw_text: ebook.raw_text || '',
        formatted_json: ebook.formatted_json || null,
      },
      assets: {
        epub_url: body.assetUrls?.epub || null,
        pdf_url: body.assetUrls?.pdf || null,
      },
      options: {
        draft: body.isDraft ?? true,
      },
    };

    const publishResponse = await fetch(CELEBIO_IMPORT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!publishResponse.ok) {
      const bodyText = await publishResponse.text();
      throw new Error(`Publish failed (${publishResponse.status}): ${bodyText}`);
    }

    const responseJson = (await publishResponse.json()) as {
      import_id?: string;
      product_id?: string;
      status?: string;
      edit_url?: string;
      [key: string]: unknown;
    };

    await ensureTables();
    await pool.query(
      `INSERT INTO integration_publish_jobs
        (user_id, ebook_id, provider, external_import_id, external_product_id, status, response_json, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), NOW())`,
      [
        userId,
        ebook.id,
        PROVIDER,
        responseJson.import_id || null,
        responseJson.product_id || null,
        responseJson.status || 'queued',
        JSON.stringify(responseJson),
      ]
    );

    res.json({
      success: true,
      provider: PROVIDER,
      import_id: responseJson.import_id || null,
      product_id: responseJson.product_id || null,
      status: responseJson.status || 'queued',
      edit_url: responseJson.edit_url || null,
    });
  } catch (err) {
    console.error('celebioPublishEbook error:', err);
    res.status(500).json({ error: 'Failed to publish ebook to cele.bio' });
  }
};
