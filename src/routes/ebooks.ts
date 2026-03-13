import { Router } from 'express';
import { getEbooks, getEbook, createEbook, updateEbook, deleteEbook } from '../controllers/ebookController';
import { authenticate } from '../middleware/auth';

const router = Router();

// All ebook routes are protected
router.use(authenticate);

router.get('/', getEbooks);
router.get('/:id', getEbook);
router.post('/', createEbook);
router.put('/:id', updateEbook);
router.delete('/:id', deleteEbook);

export default router;
