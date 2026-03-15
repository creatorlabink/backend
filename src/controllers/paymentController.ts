/**
 * Payment Controller – Phase 3
 * Stripe Checkout: creates a $11.97 lifetime-access session.
 * Webhook: upgrades user plan to 'lifetime' on payment completion.
 */
import { Request, Response } from 'express';
import Stripe from 'stripe';
import pool from '../config/db';
import { AuthRequest } from '../middleware/auth';

// Lazy accessor – prevents crash on startup when STRIPE_SECRET_KEY is not yet set
let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set in .env');
    _stripe = new Stripe(key, { apiVersion: '2026-02-25.clover' });
  }
  return _stripe;
}

const EARLY_ADOPTER_PRICE_CENTS = 1197; // $11.97
const EARLY_ADOPTER_LABEL = 'Creatorlab – Lifetime Access (Early Adopter)';

// ── POST /api/payment/checkout ─────────────────────────────────────────────
export const createCheckout = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const userRow = await pool.query('SELECT email, plan FROM users WHERE id = $1', [userId]);
    if (!userRow.rows.length) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const { email, plan } = userRow.rows[0];

    if (plan !== 'free') {
      res.status(400).json({ error: 'Already a paid member', plan });
      return;
    }

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
      metadata: { userId: userId as string },
      success_url: `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.CLIENT_URL}/dashboard`,
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('createCheckout error:', err);
    res.status(500).json({ error: 'Could not create checkout session' });
  }
};

// ── GET /api/payment/status ────────────────────────────────────────────────
export const getPaymentStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userRow = await pool.query('SELECT plan FROM users WHERE id = $1', [req.user?.userId]);
    res.json({ plan: userRow.rows[0]?.plan ?? 'free' });
  } catch (err) {
    console.error('getPaymentStatus error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── GET /api/payment/verify?session_id=xxx ────────────────────────────────
// Called from the success page to confirm payment and upgrade plan.
export const verifySession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sessionId = req.query.session_id as string;
    if (!sessionId) {
      res.status(400).json({ error: 'session_id required' });
      return;
    }

    const session = await getStripe().checkout.sessions.retrieve(sessionId);

    if (session.payment_status === 'paid' && session.metadata?.userId) {
      await pool.query(
        "UPDATE users SET plan = 'lifetime', updated_at = NOW() WHERE id = $1",
        [session.metadata.userId]
      );

      // Record payment
      await pool.query(
        `INSERT INTO payments (user_id, stripe_session_id, amount, currency, status)
         VALUES ($1, $2, $3, $4, 'completed')
         ON CONFLICT DO NOTHING`,
        [session.metadata.userId, session.id, session.amount_total, session.currency]
      );

      res.json({ success: true, plan: 'lifetime' });
    } else {
      res.json({ success: false, payment_status: session.payment_status });
    }
  } catch (err) {
    console.error('verifySession error:', err);
    res.status(500).json({ error: 'Could not verify session' });
  }
};

// ── POST /api/payment/webhook ──────────────────────────────────────────────
// Stripe sends events here. Requires raw body (configured in index.ts).
export const stripeWebhook = async (req: Request, res: Response): Promise<void> => {
  const sig = req.headers['stripe-signature'] as string;
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? '';

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, sig, secret);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Webhook error';
    console.error('Webhook signature error:', message);
    res.status(400).send(`Webhook Error: ${message}`);
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.userId;
    if (userId && session.payment_status === 'paid') {
      await pool.query(
        "UPDATE users SET plan = 'lifetime', updated_at = NOW() WHERE id = $1",
        [userId]
      );
      await pool.query(
        `INSERT INTO payments (user_id, stripe_session_id, amount, currency, status)
         VALUES ($1, $2, $3, $4, 'completed')
         ON CONFLICT DO NOTHING`,
        [userId, session.id, session.amount_total, session.currency]
      );
      console.log(`✅ Upgraded user ${userId} to lifetime plan`);
    }
  }

  res.json({ received: true });
};
