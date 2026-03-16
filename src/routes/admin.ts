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

const router = Router();

router.use(authenticate);
router.use(requireAdmin);

router.get('/email/templates', listEmailTemplates);
router.post('/email/render', renderEmailTemplate);
router.post('/email/send-template', sendTemplateEmail);
router.post('/email/send-custom', sendCustomEmail);
router.get('/email/messages', listEmailMessages);
router.get('/users', listUsers);
router.patch('/users/:userId/plan', updateUserPlan);

export default router;
