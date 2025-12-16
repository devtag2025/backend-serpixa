import { Router } from 'express';
import { claudeController } from '../controllers/index.js';
import { validate, auth, checkCredit } from '../middlewares/index.js';

const router = Router();


router.post(
  '/content-optimization',
  auth,
  checkCredit('ai_generations'),
  claudeController.optimizeContent
);

export default router;

