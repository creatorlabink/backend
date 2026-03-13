import { Router, Request, Response, NextFunction } from 'express';
import express from 'express';
import { createCheckout, getPaymentStatus, verifySession, stripeWebhook } from '../controllers/paymentController';
import { authenticate } from '../middleware/auth';

const router = Router();

// ── Stripe webhook needs raw body BEFORE express.json() parses it ────────────
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  (req: Request, res: Response, next: NextFunction) => {
    stripeWebhook(req, res).catch(next);
  }
);

// ── Protected payment routes ──────────────────────────────────────────────────
router.use(authenticate);

router.post('/checkout', createCheckout);
router.get('/status',   getPaymentStatus);
router.get('/verify',   verifySession);

export default router;
