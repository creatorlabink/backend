import { Router } from 'express';
import { exportPdf } from '../controllers/pdfController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// POST /api/pdf/export/:ebookId
router.post('/export/:ebookId', exportPdf);

export default router;
