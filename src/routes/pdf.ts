import { Router } from 'express';
import { exportPdf, previewEbook } from '../controllers/pdfController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// POST /api/pdf/export/:ebookId  – download PDF
router.post('/export/:ebookId', exportPdf);

// GET  /api/pdf/preview/:ebookId – parsed JSON for frontend preview
router.get('/preview/:ebookId', previewEbook);

export default router;
