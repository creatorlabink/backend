import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import ebookRoutes from './routes/ebooks';
import pdfRoutes from './routes/pdf';
import paymentRoutes from './routes/payment';
import aiRoutes from './routes/ai';
import analyticsRoutes from './routes/analytics';
import integrationRoutes from './routes/integrations';
import notificationRoutes from './routes/notifications';
import adminRoutes from './routes/admin';
import { celebioWebhook } from './controllers/celebioIntegrationController';
import { receiveInboundEmail } from './controllers/adminEmailController';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// ─── Middleware ──────────────────────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  process.env.CLIENT_URL,                          // e.g. https://creatorlab.ink
].filter(Boolean) as string[];

app.use(cors({
  origin(origin, callback) {
    // Allow requests with no origin (server-to-server, curl, mobile)
    if (!origin) return callback(null, true);
    // Exact match against allow-list
    if (allowedOrigins.includes(origin)) return callback(null, origin);
    // Allow any *.vercel.app preview deployment
    if (/\.vercel\.app$/.test(origin)) return callback(null, origin);
    // Allow www variant of creatorlab.ink
    if (origin === 'https://www.creatorlab.ink') return callback(null, origin);
    callback(null, false);
  },
  credentials: true,
}));
app.post('/api/integrations/celebio/webhook', express.raw({ type: 'application/json' }), celebioWebhook);
app.post('/api/notifications/inbound', express.json(), receiveInboundEmail);
// NOTE: Stripe webhook in payment routes uses its own raw-body parser before this

// ─── Body Parsing (Vercel-compatible) ────────────────────────────────────────
// Vercel's @vercel/node runtime pre-parses the request body and consumes the
// readable stream. Express 5's express.json() then sees Content-Length > 0 but
// an empty stream and throws 400 "Bad Request". Fix: if the body is already
// available (object or Buffer), skip Express's parser.
app.use((req, _res, next) => {
  // Body already parsed by Vercel as an object → skip
  if (req.body && typeof req.body === 'object' && !(req.body instanceof Buffer) && Object.keys(req.body).length > 0) {
    return next();
  }
  // Body is a Buffer (Vercel raw mode) → parse manually
  if (Buffer.isBuffer(req.body)) {
    const ct = req.headers['content-type'] || '';
    if (ct.includes('application/json')) {
      try { req.body = JSON.parse(req.body.toString('utf-8')); } catch { /* leave as-is */ }
    }
    return next();
  }
  // Normal path (local dev / body not yet parsed) → use Express parser
  express.json()(req, _res, next);
});
app.use(express.urlencoded({ extended: true }));

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/ebooks',  ebookRoutes);
app.use('/api/pdf',     pdfRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/ai',      aiRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Start Server ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 CreatorLab backend running on http://localhost:${PORT}`);
});

export default app;
