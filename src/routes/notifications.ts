import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { sendTestNotificationEmail } from '../controllers/notificationController';

const router = Router();

router.use(authenticate);
router.post('/test-email', sendTestNotificationEmail);

export default router;
