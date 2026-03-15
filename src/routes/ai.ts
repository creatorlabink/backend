import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { formatEbookText } from '../controllers/aiController';

const router = Router();

router.use(authenticate);
router.post('/format', formatEbookText);

export default router;
