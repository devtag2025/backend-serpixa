import { Router } from 'express';
import { subscriptionController } from '../controllers/index.js';
import { auth, validate } from '../middlewares/index.js';

const router = Router();

// Public route - get available plans (subscriptions and addons)
router.get('/plans', subscriptionController.getAvailablePlans);

// Protected routes
router.use(auth);

// Get current user's subscription
router.get('/current', subscriptionController.getCurrentSubscription);

// Get user's credit balance
router.get('/credits', subscriptionController.getCredits);

// Create checkout session
router.post('/checkout', validate.createCheckout, subscriptionController.createCheckout);

// Create customer portal session
router.post('/portal', subscriptionController.createPortalSession);

export default router;



