import crypto from 'crypto';
import { Response } from 'express';
import pool from '../config/db';
import { AuthRequest } from '../middleware/auth';
import { decryptSecret, encryptSecret } from '../utils/integrationCrypto';

type OAuthProvider = 'gumroad' | 'convertkit';

type ProviderConfig = {
  provider: OAuthProvider;
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
  tokenProfileUrl?: string;
};

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

const GUMROAD_CONFIG: ProviderConfig = {
  provider: 'gumroad',
  authorizeUrl: process.env.GUMROAD_OAUTH_AUTHORIZE_URL || 'https://gumroad.com/oauth/authorize',
  tokenUrl: process.env.GUMROAD_OAUTH_TOKEN_URL || 'https://gumroad.com/oauth/token',
  clientId: process.env.GUMROAD_CLIENT_ID || '',
  clientSecret: process.env.GUMROAD_CLIENT_SECRET || '',
  redirectUri: process.env.GUMROAD_REDIRECT_URI || `${CLIENT_URL}/auth/integrations/gumroad/callback`,
  scopes: process.env.GUMROAD_OAUTH_SCOPES || 'view_profile edit_products',
  tokenProfileUrl: process.env.GUMROAD_PROFILE_URL || 'https://api.gumroad.com/v2/user',
};

const CONVERTKIT_CONFIG: ProviderConfig = {
  provider: 'convertkit',
  authorizeUrl: process.env.CONVERTKIT_OAUTH_AUTHORIZE_URL || 'https://app.convertkit.com/oauth/authorize',
  tokenUrl: process.env.CONVERTKIT_OAUTH_TOKEN_URL || 'https://app.convertkit.com/oauth/token',
  clientId: process.env.CONVERTKIT_CLIENT_ID || '',
  clientSecret: process.env.CONVERTKIT_CLIENT_SECRET || '',
  redirectUri: process.env.CONVERTKIT_REDIRECT_URI || `${CLIENT_URL}/auth/integrations/convertkit/callback`,
  scopes: process.env.CONVERTKIT_OAUTH_SCOPES || 'public',
  tokenProfileUrl: process.env.CONVERTKIT_PROFILE_URL || 'https://api.convertkit.com/v4/account',
};

const ZAPIER_PROVIDER = 'zapier';
const ZAPIER_EVENT_URL = process.env.ZAPIER_EVENT_URL || '';

const GUMROAD_PRODUCT_IMPORT_URL = process.env.GUMROAD_PRODUCT_IMPORT_URL || 'https://api.gumroad.com/v2/products';
const CONVERTKIT_EVENT_URL = process.env.CONVERTKIT_EVENT_URL || 'https://api.convertkit.com/v4/events';

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
    name?: string;
  };
}

function getUserId(req: AuthRequest): string | null {
  return req.user?.userId || null;
}

function getParamAsString(value: string | string[] | undefined): string {
  if (!value) return '';
  return Array.isArray(value) ? value[0] : value;
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
      ebook_id UUID REFERENCES ebooks(id) ON DELETE CASCADE,
      provider VARCHAR(80) NOT NULL,
      external_import_id TEXT,
      external_product_id TEXT,
      status VARCHAR(40) NOT NULL DEFAULT 'queued',
      response_json JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  tablesReady = true;
}

async function getConnection(userId: string, provider: string): Promise<ConnectionRow | null> {
  await ensureTables();
  const result = await pool.query(
    `SELECT access_token_enc, refresh_token_enc, token_expires_at, oauth_state, account_id, account_username, scopes
     FROM integration_connections
     WHERE user_id = $1 AND provider = $2`,
    [userId, provider]
  );
  return result.rows[0] || null;
}

async function saveConnection(
  userId: string,
  provider: string,
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
      provider,
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

async function deleteConnection(userId: string, provider: string): Promise<void> {
  await ensureTables();
  await pool.query('DELETE FROM integration_connections WHERE user_id = $1 AND provider = $2', [userId, provider]);
}

function tokenExpired(tokenExpiresAt: string | null): boolean {
  if (!tokenExpiresAt) return false;
  return Date.now() > new Date(tokenExpiresAt).getTime() - 30_000;
}

function parseTokenResponse(json: Record<string, unknown>): TokenResponse {
  return {
    access_token:
      (json.access_token as string | undefined) ||
      (json.token as string | undefined) ||
      (json.auth_token as string | undefined) ||
      '',
    refresh_token: (json.refresh_token as string | undefined) || undefined,
    expires_in:
      typeof json.expires_in === 'number'
        ? json.expires_in
        : typeof json.expires_in === 'string'
          ? Number(json.expires_in)
          : undefined,
    scope: (json.scope as string | undefined) || undefined,
    token_type: (json.token_type as string | undefined) || undefined,
  };
}

async function exchangeCodeForToken(config: ProviderConfig, code: string): Promise<TokenResponse> {
  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed (${response.status}): ${await response.text()}`);
  }

  return parseTokenResponse((await response.json()) as Record<string, unknown>);
}

async function refreshAccessToken(config: ProviderConfig, refreshToken: string): Promise<TokenResponse> {
  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed (${response.status}): ${await response.text()}`);
  }

  return parseTokenResponse((await response.json()) as Record<string, unknown>);
}

async function resolveAccessToken(userId: string, config: ProviderConfig): Promise<string> {
  const connection = await getConnection(userId, config.provider);
  if (!connection?.access_token_enc) {
    throw new Error(`No ${config.provider} connection found`);
  }

  const accessToken = decryptSecret(connection.access_token_enc);
  if (!tokenExpired(connection.token_expires_at)) {
    return accessToken;
  }

  if (!connection.refresh_token_enc) {
    throw new Error(`${config.provider} token expired. Reconnect your account.`);
  }

  const refreshToken = decryptSecret(connection.refresh_token_enc);
  const refreshed = await refreshAccessToken(config, refreshToken);

  await saveConnection(userId, config.provider, {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token || refreshToken,
    tokenExpiresAt: refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000) : null,
    oauthState: null,
    accountId: connection.account_id,
    accountUsername: connection.account_username,
    scopes: refreshed.scope || connection.scopes,
  });

  return refreshed.access_token;
}

async function fetchProfileUsername(token: string, url?: string): Promise<string | null> {
  if (!url) return null;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
    if (!response.ok) return null;

    const json = (await response.json()) as Record<string, unknown>;
    const user = (json.user as Record<string, unknown> | undefined) || (json.account as Record<string, unknown> | undefined);
    return (
      (user?.username as string | undefined) ||
      (user?.name as string | undefined) ||
      (json.username as string | undefined) ||
      null
    );
  } catch {
    return null;
  }
}

async function oauthStatus(req: AuthRequest, res: Response, config: ProviderConfig): Promise<void> {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const connection = await getConnection(userId, config.provider);
    const connected = Boolean(connection?.access_token_enc);

    res.json({
      provider: config.provider,
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
    console.error(`${config.provider} status error:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function oauthConnectUrl(req: AuthRequest, res: Response, config: ProviderConfig): Promise<void> {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!config.clientId || !config.clientSecret) {
      res.status(500).json({ error: `${config.provider} OAuth is not configured on server.` });
      return;
    }

    const state = crypto.randomBytes(24).toString('hex');
    await saveConnection(userId, config.provider, { oauthState: state });

    const url = new URL(config.authorizeUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('scope', config.scopes);
    url.searchParams.set('state', state);

    res.json({ provider: config.provider, state, url: url.toString() });
  } catch (err) {
    console.error(`${config.provider} connect-url error:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function oauthExchangeCode(req: AuthRequest, res: Response, config: ProviderConfig): Promise<void> {
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

    const connection = await getConnection(userId, config.provider);
    if (!connection?.oauth_state || connection.oauth_state !== state) {
      res.status(400).json({ error: 'Invalid OAuth state' });
      return;
    }

    const token = await exchangeCodeForToken(config, code);
    if (!token.access_token) {
      throw new Error('Missing access token from provider');
    }

    const username = await fetchProfileUsername(token.access_token, config.tokenProfileUrl);

    await saveConnection(userId, config.provider, {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
      oauthState: null,
      accountUsername: username,
      scopes: token.scope || config.scopes,
    });

    res.json({ success: true, provider: config.provider });
  } catch (err) {
    console.error(`${config.provider} exchange-code error:`, err);
    res.status(500).json({ error: `Failed to complete ${config.provider} OAuth connection` });
  }
}

async function oauthDisconnect(req: AuthRequest, res: Response, provider: string): Promise<void> {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await deleteConnection(userId, provider);
    res.json({ success: true, provider });
  } catch (err) {
    console.error(`${provider} disconnect error:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function getEbook(userId: string, ebookId: string) {
  const result = await pool.query(
    `SELECT id, title, template, raw_text, formatted_json, updated_at
     FROM ebooks WHERE id = $1 AND user_id = $2`,
    [ebookId, userId]
  );

  return result.rows[0] as {
    id: string;
    title: string;
    template: string;
    raw_text: string | null;
    formatted_json: unknown;
    updated_at: string;
  } | undefined;
}

async function logPublishJob(userId: string, ebookId: string | null, provider: string, response: Record<string, unknown>) {
  await ensureTables();
  await pool.query(
    `INSERT INTO integration_publish_jobs
      (user_id, ebook_id, provider, external_import_id, external_product_id, status, response_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), NOW())`,
    [
      userId,
      ebookId,
      provider,
      (response.import_id as string | undefined) || null,
      (response.product_id as string | undefined) || null,
      (response.status as string | undefined) || 'queued',
      JSON.stringify(response),
    ]
  );
}

export const gumroadStatus = async (req: AuthRequest, res: Response) => oauthStatus(req, res, GUMROAD_CONFIG);
export const gumroadConnectUrl = async (req: AuthRequest, res: Response) => oauthConnectUrl(req, res, GUMROAD_CONFIG);
export const gumroadExchangeCode = async (req: AuthRequest, res: Response) => oauthExchangeCode(req, res, GUMROAD_CONFIG);
export const gumroadDisconnect = async (req: AuthRequest, res: Response) => oauthDisconnect(req, res, 'gumroad');

export const convertkitStatus = async (req: AuthRequest, res: Response) => oauthStatus(req, res, CONVERTKIT_CONFIG);
export const convertkitConnectUrl = async (req: AuthRequest, res: Response) => oauthConnectUrl(req, res, CONVERTKIT_CONFIG);
export const convertkitExchangeCode = async (req: AuthRequest, res: Response) => oauthExchangeCode(req, res, CONVERTKIT_CONFIG);
export const convertkitDisconnect = async (req: AuthRequest, res: Response) => oauthDisconnect(req, res, 'convertkit');

export const gumroadPublishEbook = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const ebookId = getParamAsString(req.params.ebookId as string | string[] | undefined);
    const ebook = await getEbook(userId, ebookId);
    if (!ebook) {
      res.status(404).json({ error: 'Ebook not found' });
      return;
    }

    const accessToken = await resolveAccessToken(userId, GUMROAD_CONFIG);
    const body = req.body as { description?: string; price?: number; currency?: string; };

    const payload = {
      name: ebook.title,
      description: body.description || `Created with CreatorLab.ink • Template: ${ebook.template}`,
      price: body.price ?? 0,
      currency: body.currency || 'usd',
      access_token: accessToken,
      external_source: 'creatorlab',
      external_id: ebook.id,
    };

    const response = await fetch(GUMROAD_PRODUCT_IMPORT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Gumroad publish failed (${response.status}): ${await response.text()}`);
    }

    const json = (await response.json()) as Record<string, unknown>;
    const normalized = {
      provider: 'gumroad',
      status: 'ready',
      product_id: (json.product_id as string | undefined) || (json.id as string | undefined) || null,
      edit_url: (json.edit_url as string | undefined) || null,
      raw: json,
    };

    await logPublishJob(userId, ebook.id, 'gumroad', normalized);
    res.json({ success: true, ...normalized });
  } catch (err) {
    console.error('gumroadPublishEbook error:', err);
    res.status(500).json({ error: 'Failed to publish ebook to Gumroad' });
  }
};

export const convertkitSyncEbook = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const ebookId = getParamAsString(req.params.ebookId as string | string[] | undefined);
    const ebook = await getEbook(userId, ebookId);
    if (!ebook) {
      res.status(404).json({ error: 'Ebook not found' });
      return;
    }

    const accessToken = await resolveAccessToken(userId, CONVERTKIT_CONFIG);

    const payload = {
      event: 'ebook_published',
      source: 'creatorlab',
      user_id: userId,
      ebook: {
        id: ebook.id,
        title: ebook.title,
        template: ebook.template,
        updated_at: ebook.updated_at,
      },
      metadata: req.body || {},
    };

    const response = await fetch(CONVERTKIT_EVENT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`ConvertKit sync failed (${response.status}): ${await response.text()}`);
    }

    const json = (await response.json()) as Record<string, unknown>;
    const normalized = {
      provider: 'convertkit',
      status: 'synced',
      sync_id: (json.sync_id as string | undefined) || (json.id as string | undefined) || null,
      raw: json,
    };

    await logPublishJob(userId, ebook.id, 'convertkit', normalized);
    res.json({ success: true, ...normalized });
  } catch (err) {
    console.error('convertkitSyncEbook error:', err);
    res.status(500).json({ error: 'Failed to sync ebook event to ConvertKit' });
  }
};

export const zapierStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const connection = await getConnection(userId, ZAPIER_PROVIDER);
    const connected = Boolean(connection?.access_token_enc);

    res.json({
      provider: ZAPIER_PROVIDER,
      connected,
      account: connected
        ? {
            username: 'Webhook connected',
          }
        : null,
    });
  } catch (err) {
    console.error('zapierStatus error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const zapierConnect = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { webhookUrl } = req.body as { webhookUrl?: string };
    const effectiveWebhook = webhookUrl || ZAPIER_EVENT_URL;

    if (!effectiveWebhook) {
      res.status(400).json({ error: 'webhookUrl is required to connect Zapier.' });
      return;
    }

    await saveConnection(userId, ZAPIER_PROVIDER, {
      accessToken: effectiveWebhook,
      oauthState: null,
      accountUsername: 'Webhook connected',
    });

    res.json({ success: true, provider: ZAPIER_PROVIDER });
  } catch (err) {
    console.error('zapierConnect error:', err);
    res.status(500).json({ error: 'Failed to connect Zapier' });
  }
};

export const zapierDisconnect = async (req: AuthRequest, res: Response): Promise<void> => oauthDisconnect(req, res, ZAPIER_PROVIDER);

async function sendZapierEvent(userId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const connection = await getConnection(userId, ZAPIER_PROVIDER);
  if (!connection?.access_token_enc) {
    throw new Error('Zapier is not connected');
  }

  const webhookUrl = decryptSecret(connection.access_token_enc);
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Zapier webhook failed (${response.status}): ${await response.text()}`);
  }

  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { status: 'ok', raw: text };
  }
}

export const zapierTest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const json = await sendZapierEvent(userId, {
      event: 'creatorlab.zapier.test',
      timestamp: new Date().toISOString(),
    });

    await logPublishJob(userId, null, 'zapier', { provider: 'zapier', status: 'sent', raw: json });
    res.json({ success: true, provider: 'zapier', status: 'sent', response: json });
  } catch (err) {
    console.error('zapierTest error:', err);
    res.status(500).json({ error: 'Failed to send Zapier test event' });
  }
};

export const zapierPublishEbook = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const ebookId = getParamAsString(req.params.ebookId as string | string[] | undefined);
    const ebook = await getEbook(userId, ebookId);
    if (!ebook) {
      res.status(404).json({ error: 'Ebook not found' });
      return;
    }

    const json = await sendZapierEvent(userId, {
      event: 'creatorlab.ebook.published',
      timestamp: new Date().toISOString(),
      user_id: userId,
      ebook: {
        id: ebook.id,
        title: ebook.title,
        template: ebook.template,
        updated_at: ebook.updated_at,
      },
      metadata: req.body || {},
    });

    const normalized = { provider: 'zapier', status: 'sent', raw: json };
    await logPublishJob(userId, ebook.id, 'zapier', normalized);
    res.json({ success: true, ...normalized });
  } catch (err) {
    console.error('zapierPublishEbook error:', err);
    res.status(500).json({ error: 'Failed to send ebook publish event to Zapier' });
  }
};
