import { Router } from 'express';
import { signup, login, getMe, oauthConnectUrl, oauthExchangeCode } from '../controllers/authController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/signup', signup);
router.post('/login', login);
router.get('/oauth/:provider/connect-url', oauthConnectUrl);
router.post('/oauth/:provider/exchange', oauthExchangeCode);
router.get('/me', authenticate, getMe);

export default router;
