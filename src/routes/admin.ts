import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import {
  listEmailMessages,
  listEmailTemplates,
  renderEmailTemplate,
  sendCustomEmail,
  sendTemplateEmail,
} from '../controllers/adminEmailController';
import { listUsers, updateUserPlan } from '../controllers/adminPlanController';
import {
  getDashboardStats,
  getAllUsers,
  getUserDetails,
  updateUser,
  deleteUser,
  resetUserPassword,
  impersonateUser,
  getRevenueStats,
  getAnalyticsDashboard,
  getAllEbooks,
  getAuditLogs,
  getSystemStatus,
  getFeatureUsageStats,
} from '../controllers/adminDashboardController';

const router = Router();

router.use(authenticate);
router.use(requireAdmin);

// ─── Dashboard Overview ─────────────────────────────────────────────────────
router.get('/dashboard/stats', getDashboardStats);
router.get('/dashboard/system', getSystemStatus);

// ─── User Management (Enhanced) ─────────────────────────────────────────────
router.get('/users', getAllUsers);
router.get('/users/:userId', getUserDetails);
router.patch('/users/:userId', updateUser);
router.delete('/users/:userId', deleteUser);
router.post('/users/:userId/reset-password', resetUserPassword);
router.post('/users/:userId/impersonate', impersonateUser);
router.patch('/users/:userId/plan', updateUserPlan);

// ─── Revenue & Billing ──────────────────────────────────────────────────────
router.get('/revenue', getRevenueStats);

// ─── Analytics ──────────────────────────────────────────────────────────────
router.get('/analytics', getAnalyticsDashboard);
router.get('/analytics/feature-usage', getFeatureUsageStats);

// ─── Ebook Management ───────────────────────────────────────────────────────
router.get('/ebooks', getAllEbooks);

// ─── Audit Logs ─────────────────────────────────────────────────────────────
router.get('/audit-logs', getAuditLogs);

// ─── Email System ───────────────────────────────────────────────────────────
router.get('/email/templates', listEmailTemplates);
router.post('/email/render', renderEmailTemplate);
router.post('/email/send-template', sendTemplateEmail);
router.post('/email/send-custom', sendCustomEmail);
router.get('/email/messages', listEmailMessages);

export default router;
