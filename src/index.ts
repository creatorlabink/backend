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
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }));
app.post('/api/integrations/celebio/webhook', express.raw({ type: 'application/json' }), celebioWebhook);
app.post('/api/notifications/inbound', express.json(), receiveInboundEmail);
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
