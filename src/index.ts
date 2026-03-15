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
// Vercel's @vercel/node runtime consumes the request stream and may set
// req.body as a Buffer, parsed object, or string — OR leave it undefined while
// the stream is already drained. Express 5's express.json() then fails with a
// 400 "Bad Request" because Content-Length > 0 but the stream is empty.
// Fix: try express.json() first; if it errors, recover from Vercel's req.body
// or req.rawBody.
app.use((req: any, res: any, next: any) => {
  // 1. Already a parsed JS object (Vercel pre-parsed) → use as-is
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return next();
  }
  // 2. Buffer body (Vercel raw mode) → parse manually
  if (Buffer.isBuffer(req.body)) {
    if ((req.headers['content-type'] || '').includes('application/json')) {
      try { req.body = JSON.parse(req.body.toString('utf-8')); } catch { /* leave as Buffer */ }
    }
    return next();
  }
  // 3. String body → parse if JSON
  if (typeof req.body === 'string' && req.body.length > 0) {
    if ((req.headers['content-type'] || '').includes('application/json')) {
      try { req.body = JSON.parse(req.body); } catch { /* leave as string */ }
    }
    return next();
  }
  // 4. Try Express parser (works on local dev where stream is intact)
  //    If it fails (Vercel consumed the stream), recover from rawBody
  express.json()(req, res, (err: any) => {
    if (err) {
      // Express parser failed — try Vercel's rawBody fallback
      const raw = req.rawBody;
      if (raw && (req.headers['content-type'] || '').includes('application/json')) {
        const str = Buffer.isBuffer(raw) ? raw.toString('utf-8') : String(raw);
        try { req.body = JSON.parse(str); } catch { /* ignore */ }
      }
      return next(); // continue even if body is empty — let route handlers validate
    }
    next();
  });
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

// ─── Debug endpoint (temporary — remove after deploy verification) ────────────
app.post('/debug-body', (req: any, res) => {
  res.json({
    bodyType: typeof req.body,
    bodyIsBuffer: Buffer.isBuffer(req.body),
    bodyKeys: req.body && typeof req.body === 'object' ? Object.keys(req.body) : null,
    bodySnippet: typeof req.body === 'string' ? req.body.slice(0, 100) : JSON.stringify(req.body)?.slice(0, 200),
    hasRawBody: !!(req as any).rawBody,
    rawBodyType: typeof (req as any).rawBody,
    headers: { 'content-type': req.headers['content-type'], 'content-length': req.headers['content-length'] },
  });
});

// ─── Start Server ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 CreatorLab backend running on http://localhost:${PORT}`);
});

export default app;
