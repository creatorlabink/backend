import { Router } from 'express';
import { captureEvent, getAnalyticsSummary } from '../controllers/analyticsController';
import { authenticate } from '../middleware/auth';

const router = Router();

// Public lightweight event capture (CTA clicks etc.)
router.post('/event', captureEvent);

// Protected summary
router.get('/summary', authenticate, getAnalyticsSummary);

export default router;
