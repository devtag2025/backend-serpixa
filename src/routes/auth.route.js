import { Router } from 'express';
import { authController } from '../controllers/index.js';
import { auth, validate } from '../middlewares/index.js';

const router = Router();

// Public routes (no auth required)
router.post('/register', validate.registerUser, authController.signup);
router.post('/login', validate.loginUser, authController.login);
router.post('/forgot-password', validate.forgotPassword, authController.forgotPassword);
router.post('/reset-password', validate.resetPassword, authController.resetPassword);
router.get('/verify-email/:token', validate.verifyEmailToken, authController.verifyEmail);
router.post('/resend-verification', validate.resendVerification, authController.resendVerification);

// Protected routes (auth middleware required)
router.use(auth);

router.get('/profile', authController.getProfile);
router.put('/profile', validate.updateProfile, authController.updateProfile);
router.post('/change-password', validate.changePassword, authController.changePassword);
router.post('/logout', authController.logout);

// User management routes
router.delete('/user/:userId', authController.deleteUser);

export default router;