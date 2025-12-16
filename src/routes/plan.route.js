import { Router } from 'express';
import { planController } from '../controllers/index.js';
import { auth, authorize } from '../middlewares/index.js';
const router = Router();

router.get('/', planController.getPlans);
router.get('/:planId', planController.getPlanById);

router.use(auth);

router.post('/', authorize(['admin']), planController.createPlan);
router.put('/:planId', authorize(['admin']), planController.updatePlan);
router.delete('/:planId', authorize(['admin']), planController.deletePlan);

// Subscription analytics (admin only)
router.get('/subscriptions', authorize(['admin']), planController.getSubscriptions);

// Update user subscription (admin only)
router.put('/users/:userId/subscription', authorize(['admin']), planController.updateUserSubscription);

export default router;


