import { Router } from 'express';
import authRoutes from './auth.route.js';
import seoAuditRoutes from './seoAudit.route.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/seo-audits', seoAuditRoutes);

export default router;