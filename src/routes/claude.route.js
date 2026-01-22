import { Router } from 'express';
import { claudeController } from '../controllers/index.js';
import { validate, auth, checkCredit } from '../middlewares/index.js';

const router = Router();

router.use(auth);

// Generate AI content
router.post(
  '/content-optimization',
  auth,
  checkCredit('ai_generations'),
  claudeController.optimizeContent
);

// Get user's AI content list
router.get(
  '/content',
  claudeController.getUserContent
);

// Get AI content by ID
router.get(
  '/content/:contentId',
  validate.aiContentIdParam,
  claudeController.getContentById
);

// Delete AI content
router.delete(
  '/content/:contentId',
  validate.aiContentIdParam,
  claudeController.deleteContent
);

// PDF download/view - supports ?view=true to open in browser
router.get(
  '/content/:contentId/pdf',
  validate.aiContentIdParam,
  claudeController.downloadContentPDF
);

export default router;