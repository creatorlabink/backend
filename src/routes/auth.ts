import { Router } from 'express';
import {
	signup,
	login,
	getMe,
	oauthConnectUrl,
	oauthExchangeCode,
	forgotPassword,
	verifyResetToken,
	resetPassword,
} from '../controllers/authController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/signup', signup);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.get('/reset-password/verify', verifyResetToken);
router.post('/reset-password', resetPassword);
router.get('/oauth/:provider/connect-url', oauthConnectUrl);
router.post('/oauth/:provider/exchange', oauthExchangeCode);
router.get('/me', authenticate, getMe);

export default router;
