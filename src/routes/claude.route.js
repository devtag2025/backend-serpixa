import { Router } from 'express';
import { claudeController } from '../controllers/index.js';
import { validate, auth } from '../middlewares/index.js';

const router = Router();


router.post(
  '/content-optimization',
  auth,
  claudeController.optimizeContent
);

export default router;

