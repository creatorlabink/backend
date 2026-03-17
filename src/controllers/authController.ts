import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import Stripe from 'stripe';
import pool from '../config/db';
import { signToken } from '../utils/jwtUtils';
import { trackEvent } from '../utils/analyticsUtils';
import { sendEmail, sendWelcomeEmail } from '../utils/emailUtils';
import { renderTemplate } from '../utils/emailTemplates';

type OAuthProvider = 'google' | 'tiktok';
type OAuthIntent = 'login' | 'signup';

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';
const EARLY_ADOPTER_PRICE_CENTS = 1197;
const EARLY_ADOPTER_LABEL = 'Creatorlab – Lifetime Access (Early Adopter)';

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    _stripe = new Stripe(key, { apiVersion: '2026-02-25.clover' });
  }
  return _stripe;
}

function asErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}

function isStripeCheckoutError(err: unknown): boolean {
  const msg = asErrorMessage(err).toLowerCase();
  return (
    msg.includes('stripe') ||
    msg.includes('api key') ||
    msg.includes('checkout') ||
    msg.includes('customer_email') ||
    msg.includes('payment_method') ||
    msg.includes('no such')
  );
}

async function createRequiredPaymentCheckout(userId: string, email: string): Promise<{ url: string; sessionId: string }> {
  const session = await getStripe().checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'payment',
    customer_email: email,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: EARLY_ADOPTER_PRICE_CENTS,
          product_data: { name: EARLY_ADOPTER_LABEL },
        },
      },
    ],
    metadata: { userId },
    success_url: `${CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${CLIENT_URL}/auth/login`,
  });

  if (!session.url) {
    throw new Error('Stripe checkout session URL missing');
  }

  return { url: session.url, sessionId: session.id };
}

const GOOGLE_AUTH_URL = process.env.GOOGLE_OAUTH_AUTHORIZE_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = process.env.GOOGLE_OAUTH_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = process.env.GOOGLE_USERINFO_URL || 'https://openidconnect.googleapis.com/v1/userinfo';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `${CLIENT_URL}/auth/oauth/callback`;
const GOOGLE_SCOPES = process.env.GOOGLE_OAUTH_SCOPES || 'openid email profile';

const TIKTOK_AUTH_URL = process.env.TIKTOK_OAUTH_AUTHORIZE_URL || 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_TOKEN_URL = process.env.TIKTOK_OAUTH_TOKEN_URL || 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_USERINFO_URL = process.env.TIKTOK_USERINFO_URL || 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url';
const TIKTOK_CLIENT_ID = process.env.TIKTOK_CLIENT_ID || process.env.TIKTOK_CLIENT_KEY || '';
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || '';
const TIKTOK_REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI || `${CLIENT_URL}/auth/oauth/callback`;
const TIKTOK_SCOPES = process.env.TIKTOK_OAUTH_SCOPES || 'user.info.basic';

let oauthTablesReady = false;
let passwordResetTableReady = false;

interface OAuthTokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

interface OAuthProfile {
  providerUserId: string;
  email: string;
  name: string | null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function parseAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return parseAdminEmails().includes(normalizeEmail(email));
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  const maskedLocal = local.length <= 2 ? `${local[0]}*` : `${local.slice(0, 2)}***`;
  return `${maskedLocal}@${domain}`;
}

function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function ensurePasswordResetTable(): Promise<void> {
  if (passwordResetTableReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires ON password_reset_tokens(expires_at)');

  passwordResetTableReady = true;
}

async function ensureOAuthTables(): Promise<void> {
  if (oauthTablesReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_identities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider VARCHAR(30) NOT NULL,
      provider_user_id VARCHAR(255) NOT NULL,
      email VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(provider, provider_user_id),
      UNIQUE(user_id, provider)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS oauth_auth_states (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider VARCHAR(30) NOT NULL,
      state TEXT NOT NULL UNIQUE,
      intent VARCHAR(20) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS idx_oauth_states_provider ON oauth_auth_states(provider, expires_at)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_social_identities_user ON social_identities(user_id, provider)');

  oauthTablesReady = true;
}

function validateProvider(provider: string): provider is OAuthProvider {
  return provider === 'google' || provider === 'tiktok';
}

function getProviderConfig(provider: OAuthProvider) {
  if (provider === 'google') {
    return {
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      authUrl: GOOGLE_AUTH_URL,
      tokenUrl: GOOGLE_TOKEN_URL,
      userInfoUrl: GOOGLE_USERINFO_URL,
      redirectUri: GOOGLE_REDIRECT_URI,
      scopes: GOOGLE_SCOPES,
    };
  }

  return {
    clientId: TIKTOK_CLIENT_ID,
    clientSecret: TIKTOK_CLIENT_SECRET,
    authUrl: TIKTOK_AUTH_URL,
    tokenUrl: TIKTOK_TOKEN_URL,
    userInfoUrl: TIKTOK_USERINFO_URL,
    redirectUri: TIKTOK_REDIRECT_URI,
    scopes: TIKTOK_SCOPES,
  };
}

async function createOAuthState(provider: OAuthProvider, intent: OAuthIntent): Promise<string> {
  await ensureOAuthTables();

  const state = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await pool.query(
    'INSERT INTO oauth_auth_states (provider, state, intent, expires_at) VALUES ($1, $2, $3, $4)',
    [provider, state, intent, expiresAt]
  );

  return state;
}

async function consumeOAuthState(provider: OAuthProvider, state: string): Promise<OAuthIntent> {
  await ensureOAuthTables();

  await pool.query('DELETE FROM oauth_auth_states WHERE expires_at < NOW()');

  const result = await pool.query(
    `DELETE FROM oauth_auth_states
     WHERE provider = $1 AND state = $2 AND expires_at >= NOW()
     RETURNING intent`,
    [provider, state]
  );

  if (!result.rows.length) {
    throw new Error('Invalid or expired OAuth state');
  }

  return result.rows[0].intent as OAuthIntent;
}

async function exchangeOAuthCode(provider: OAuthProvider, code: string): Promise<OAuthTokenResult> {
  const cfg = getProviderConfig(provider);

  if (provider === 'google') {
    const response = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      throw new Error(`Google token exchange failed (${response.status})`);
    }

    const json = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!json.access_token) {
      throw new Error('Google access token missing');
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresIn: json.expires_in,
    };
  }

  const response = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_key: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    throw new Error(`TikTok token exchange failed (${response.status})`);
  }

  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    data?: { access_token?: string; refresh_token?: string; expires_in?: number };
  };

  const accessToken = json.access_token || json.data?.access_token;
  if (!accessToken) {
    throw new Error('TikTok access token missing');
  }

  return {
    accessToken,
    refreshToken: json.refresh_token || json.data?.refresh_token,
    expiresIn: json.expires_in || json.data?.expires_in,
  };
}

async function fetchOAuthProfile(provider: OAuthProvider, accessToken: string): Promise<OAuthProfile> {
  const cfg = getProviderConfig(provider);

  if (provider === 'google') {
    const response = await fetch(cfg.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Google userinfo failed (${response.status})`);
    }

    const json = (await response.json()) as {
      sub?: string;
      email?: string;
      name?: string;
      given_name?: string;
    };

    if (!json.sub) {
      throw new Error('Google profile missing sub');
    }

    return {
      providerUserId: json.sub,
      email: json.email || `google_${json.sub}@google.local`,
      name: json.name || json.given_name || null,
    };
  }

  const response = await fetch(cfg.userInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`TikTok userinfo failed (${response.status})`);
  }

  const json = (await response.json()) as {
    data?: {
      user?: {
        open_id?: string;
        display_name?: string;
      };
    };
  };

  const openId = json.data?.user?.open_id;
  if (!openId) {
    throw new Error('TikTok profile missing open_id');
  }

  return {
    providerUserId: openId,
    email: `tiktok_${openId}@tiktok.local`,
    name: json.data?.user?.display_name || null,
  };
}

async function findOrCreateSocialUser(provider: OAuthProvider, profile: OAuthProfile) {
  await ensureOAuthTables();

  const identity = await pool.query(
    `SELECT u.id, u.email, u.name, u.plan
     FROM social_identities si
     JOIN users u ON u.id = si.user_id
     WHERE si.provider = $1 AND si.provider_user_id = $2`,
    [provider, profile.providerUserId]
  );

  if (identity.rows.length) {
    return {
      user: identity.rows[0] as { id: string; email: string; name: string | null; plan: string },
      created: false,
    };
  }

  const existingUser = await pool.query('SELECT id, email, name, plan FROM users WHERE email = $1', [profile.email]);
  let user: { id: string; email: string; name: string | null; plan: string };

  if (existingUser.rows.length) {
    user = existingUser.rows[0];
  } else {
    const randomPassword = crypto.randomBytes(32).toString('hex');
    const passwordHash = await bcrypt.hash(randomPassword, 12);
    const inserted = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name, plan`,
      [profile.email, passwordHash, profile.name]
    );
    user = inserted.rows[0];
    const createdUser = user;

    await pool.query(
      `INSERT INTO social_identities (user_id, provider, provider_user_id, email, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (provider, provider_user_id)
       DO UPDATE SET user_id = EXCLUDED.user_id, email = EXCLUDED.email, updated_at = NOW()`,
      [createdUser.id, provider, profile.providerUserId, profile.email]
    );

    return { user: createdUser, created: true };
  }

  await pool.query(
    `INSERT INTO social_identities (user_id, provider, provider_user_id, email, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT (provider, provider_user_id)
     DO UPDATE SET user_id = EXCLUDED.user_id, email = EXCLUDED.email, updated_at = NOW()`,
    [user.id, provider, profile.providerUserId, profile.email]
  );

  return { user, created: false };
}

// ─── Signup ───────────────────────────────────────────────────────────────────
export const signup = async (req: Request, res: Response): Promise<void> => {
  const { email, password, name } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  try {
    // Check if user already exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const result = await pool.query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name, plan, created_at',
      [email, hashedPassword, name || null]
    );

    const user = result.rows[0];
    const checkout = await createRequiredPaymentCheckout(user.id, user.email);

    await trackEvent('signup', {
      userId: user.id,
      source: 'auth_signup',
      metadata: { email: user.email },
    });

    sendWelcomeEmail({
      to: user.email,
      name: user.name,
    }).catch((error) => {
      console.error('Welcome email send failed:', error);
    });

    res.status(402).json({
      error: 'payment_required',
      message: 'Payment is required to activate your account.',
      checkout_url: checkout.url,
      session_id: checkout.sessionId,
      user: { id: user.id, email: user.email, name: user.name, plan: user.plan },
    });
  } catch (err) {
    console.error('Signup error:', err);
    if (isStripeCheckoutError(err)) {
      res.status(500).json({
        error: 'payment_setup_error',
        message: asErrorMessage(err),
      });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ─── Login ────────────────────────────────────────────────────────────────────
export const login = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  try {
    const result = await pool.query(
      'SELECT id, email, name, plan, password_hash FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (user.plan === 'free' && !isAdminEmail(user.email)) {
      const checkout = await createRequiredPaymentCheckout(user.id, user.email);
      res.status(402).json({
        error: 'payment_required',
        message: 'Payment is required to access CreatorLab.',
        checkout_url: checkout.url,
        session_id: checkout.sessionId,
      });
      return;
    }

    const token = signToken({ userId: user.id, email: user.email });

    await trackEvent('login', {
      userId: user.id,
      source: 'auth_login',
      metadata: { email: user.email },
    });

    res.json({ token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan } });
  } catch (err) {
    console.error('Login error:', err);
    if (isStripeCheckoutError(err)) {
      res.status(500).json({
        error: 'payment_setup_error',
        message: asErrorMessage(err),
      });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ─── Get Me (Protected) ───────────────────────────────────────────────────────
export const getMe = async (req: Request & { user?: { userId: string; email: string } }, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      'SELECT id, email, name, plan, created_at FROM users WHERE id = $1',
      [req.user?.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('GetMe error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ─── Forgot Password ─────────────────────────────────────────────────────────
export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  const rawEmail = req.body?.email;
  const email = typeof rawEmail === 'string' ? normalizeEmail(rawEmail) : '';

  if (!email) {
    res.status(400).json({ error: 'Email is required' });
    return;
  }

  try {
    await ensurePasswordResetTable();

    const userResult = await pool.query('SELECT id, email, name FROM users WHERE email = $1 LIMIT 1', [email]);
    if (userResult.rows.length) {
      const user = userResult.rows[0] as { id: string; email: string; name: string | null };
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashResetToken(rawToken);
      const expiresAt = new Date(Date.now() + 20 * 60 * 1000);

      await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1 OR expires_at < NOW() OR used_at IS NOT NULL', [user.id]);
      await pool.query(
        'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [user.id, tokenHash, expiresAt]
      );

      const actionUrl = `${CLIENT_URL}/auth/reset-password?token=${encodeURIComponent(rawToken)}`;
      const template = renderTemplate('password_reset', {
        userName: user.name || 'Creator',
        actionUrl,
        appUrl: CLIENT_URL,
      });

      await sendEmail({
        to: user.email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      });
    }

    res.json({
      message: 'If an account exists for this email, a password reset link has been sent.',
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to process password reset request.' });
  }
};

// ─── Verify Reset Token ──────────────────────────────────────────────────────
export const verifyResetToken = async (req: Request, res: Response): Promise<void> => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!token) {
    res.status(400).json({ error: 'Token is required' });
    return;
  }

  try {
    await ensurePasswordResetTable();

    const tokenHash = hashResetToken(token);
    const result = await pool.query(
      `SELECT u.email
       FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id
       WHERE prt.token_hash = $1
         AND prt.used_at IS NULL
         AND prt.expires_at >= NOW()
       LIMIT 1`,
      [tokenHash]
    );

    if (!result.rows.length) {
      res.status(400).json({ error: 'Invalid or expired reset link.' });
      return;
    }

    const row = result.rows[0] as { email: string };
    res.json({ valid: true, email: maskEmail(row.email) });
  } catch (err) {
    console.error('Verify reset token error:', err);
    res.status(500).json({ error: 'Failed to verify reset token.' });
  }
};

// ─── Reset Password ──────────────────────────────────────────────────────────
export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const confirmPassword = typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword : '';

  if (!token || !password || !confirmPassword) {
    res.status(400).json({ error: 'Token, password and confirmation are required.' });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters.' });
    return;
  }

  if (password !== confirmPassword) {
    res.status(400).json({ error: 'Passwords do not match.' });
    return;
  }

  const client = await pool.connect();

  try {
    await ensurePasswordResetTable();

    const tokenHash = hashResetToken(token);
    await client.query('BEGIN');

    const tokenResult = await client.query(
      `SELECT prt.id AS token_id, u.id AS user_id, u.email, u.name
       FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id
       WHERE prt.token_hash = $1
         AND prt.used_at IS NULL
         AND prt.expires_at >= NOW()
       FOR UPDATE`,
      [tokenHash]
    );

    if (!tokenResult.rows.length) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Invalid or expired reset link.' });
      return;
    }

    const row = tokenResult.rows[0] as { token_id: string; user_id: string; email: string; name: string | null };
    const newHash = await bcrypt.hash(password, 12);

    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, row.user_id]);
    await client.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [row.token_id]);
    await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1 AND id <> $2', [row.user_id, row.token_id]);

    await client.query('COMMIT');

    await trackEvent('password_reset', {
      userId: row.user_id,
      source: 'auth_reset_password',
      metadata: { email: row.email },
    });

    const subject = 'Your CreatorLab password was changed';
    const html = `
      <div style="font-family: Inter, Arial, sans-serif; line-height: 1.6; color: #111; max-width: 560px; margin: 0 auto;">
        <h2 style="margin: 0 0 10px;">Password updated successfully</h2>
        <p style="margin: 0 0 12px;">Hi ${row.name?.trim() || 'Creator'}, your password was just reset.</p>
        <p style="margin: 0 0 12px;">If this wasn't you, contact <a href="mailto:support@creatorlab.ink">support@creatorlab.ink</a> immediately.</p>
        <a href="${CLIENT_URL}/auth/login" style="display: inline-block; padding: 10px 16px; background: #4f46e5; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600;">Log in to CreatorLab</a>
      </div>
    `;

    await sendEmail({
      to: row.email,
      subject,
      html,
      text: `Your CreatorLab password was just reset. If this wasn't you, contact support@creatorlab.ink immediately.`,
    });

    res.json({ message: 'Password reset successful. You can now log in with your new password.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password.' });
  } finally {
    client.release();
  }
};

// ─── OAuth connect URL ───────────────────────────────────────────────────────
export const oauthConnectUrl = async (req: Request, res: Response): Promise<void> => {
  const providerRaw = Array.isArray(req.params.provider) ? req.params.provider[0] : req.params.provider;
  if (!validateProvider(providerRaw)) {
    res.status(400).json({ error: 'Unsupported OAuth provider' });
    return;
  }

  const provider = providerRaw;
  const cfg = getProviderConfig(provider);

  if (!cfg.clientId || !cfg.clientSecret) {
    res.status(500).json({ error: `${provider} OAuth is not configured on server.` });
    return;
  }

  const intentRaw = (req.query.intent as string | undefined) || 'login';
  const intent: OAuthIntent = intentRaw === 'signup' ? 'signup' : 'login';

  try {
    const state = await createOAuthState(provider, intent);
    const url = new URL(cfg.authUrl);

    if (provider === 'google') {
      url.searchParams.set('client_id', cfg.clientId);
      url.searchParams.set('redirect_uri', cfg.redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', cfg.scopes);
      url.searchParams.set('access_type', 'offline');
      url.searchParams.set('prompt', 'consent');
      url.searchParams.set('state', state);
    } else {
      url.searchParams.set('client_key', cfg.clientId);
      url.searchParams.set('redirect_uri', cfg.redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', cfg.scopes);
      url.searchParams.set('state', state);
    }

    res.json({ provider, intent, state, url: url.toString() });
  } catch (err) {
    console.error('oauthConnectUrl error:', err);
    res.status(500).json({ error: 'Failed to start social login.' });
  }
};

// ─── OAuth exchange code ─────────────────────────────────────────────────────
export const oauthExchangeCode = async (req: Request, res: Response): Promise<void> => {
  const providerRaw = Array.isArray(req.params.provider) ? req.params.provider[0] : req.params.provider;
  if (!validateProvider(providerRaw)) {
    res.status(400).json({ error: 'Unsupported OAuth provider' });
    return;
  }

  const provider = providerRaw;
  const { code, state } = req.body as { code?: string; state?: string };

  if (!code || !state) {
    res.status(400).json({ error: 'code and state are required' });
    return;
  }

  try {
    const intent = await consumeOAuthState(provider, state);
    const tokenResult = await exchangeOAuthCode(provider, code);
    const profile = await fetchOAuthProfile(provider, tokenResult.accessToken);
    const { user, created } = await findOrCreateSocialUser(provider, profile);

    if (user.plan === 'free' && !isAdminEmail(user.email)) {
      const checkout = await createRequiredPaymentCheckout(user.id, user.email);
      res.status(402).json({
        error: 'payment_required',
        message: 'Payment is required to access CreatorLab.',
        checkout_url: checkout.url,
        session_id: checkout.sessionId,
      });
      return;
    }

    const token = signToken({ userId: user.id, email: user.email });

    await trackEvent('login', {
      userId: user.id,
      source: `oauth_${provider}`,
      metadata: {
        provider,
        intent,
      },
    });

    if (created) {
      sendWelcomeEmail({
        to: user.email,
        name: user.name,
      }).catch((error) => {
        console.error('Welcome email send failed:', error);
      });
    }

    res.json({ token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan }, provider });
  } catch (err) {
    console.error('oauthExchangeCode error:', err);
    if (isStripeCheckoutError(err)) {
      res.status(500).json({
        error: 'payment_setup_error',
        message: asErrorMessage(err),
      });
      return;
    }
    res.status(500).json({ error: 'Social login failed. Please try again.' });
  }
};
