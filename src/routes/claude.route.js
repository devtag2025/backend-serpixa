import { Router } from 'express';
import { claudeController } from '../controllers/index.js';
import { validate, auth } from '../middlewares/index.js';

const router = Router();

/**
 * @route   POST /api/v1/claude/content-optimization
 * @desc    Generate AI-powered SEO content optimization
 * @access  Private (requires authentication)
 * @body    { url?: string, keyword?: string }
 */
router.post(
  '/content-optimization',
  auth,
  validate.optimizeContent,
  claudeController.optimizeContent
);

export default router;

