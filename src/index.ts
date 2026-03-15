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
import { celebioWebhook } from './controllers/celebioIntegrationController';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }));
app.post('/api/integrations/celebio/webhook', express.raw({ type: 'application/json' }), celebioWebhook);
// NOTE: Stripe webhook in payment routes uses its own raw-body parser before this
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/ebooks',  ebookRoutes);
app.use('/api/pdf',     pdfRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/ai',      aiRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/integrations', integrationRoutes);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Start Server ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 CreatorLab backend running on http://localhost:${PORT}`);
});

export default app;
