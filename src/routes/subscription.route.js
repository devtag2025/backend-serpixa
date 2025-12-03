import { Router } from 'express';
import { subscriptionController } from '../controllers/index.js';
import { auth, validate } from '../middlewares/index.js';

const router = Router();

router.use(auth);

// Get current user's subscription
router.get('/current', subscriptionController.getCurrentSubscription);

// Create checkout session for plan or price
router.post('/checkout', validate.createCheckout, subscriptionController.createCheckout);

// Create customer portal session
router.post('/portal', subscriptionController.createPortalSession);

export default router;

