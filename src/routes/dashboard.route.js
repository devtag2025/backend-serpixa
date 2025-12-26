import { Router } from 'express';
import { dashboardController } from '../controllers/index.js';
import { auth } from '../middlewares/index.js';

const router = Router();

router.use(auth);

router.get('/credits', dashboardController.getCredits);
router.get('/stats', dashboardController.getStats);

export default router;