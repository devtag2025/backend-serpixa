import { Router } from 'express';
import authRoutes from './auth.route.js';
import claudeRoutes from './claude.route.js';
import seoAuditRoutes from './seoAudit.route.js';
import geoAuditRoutes from './geoAudit.route.js';
import gbpAuditRoutes from './gbpAudit.route.js';
import subscriptionRoutes from './subscription.route.js';
import planRoutes from './plan.route.js';
import dashboardRoutes from './dashboard.route.js';

const router = Router();

// Note: Stripe webhook route is handled in app.js before express.json() middleware
// to preserve raw body for signature verification

router.use('/auth', authRoutes);
router.use('/claude', claudeRoutes);
router.use('/seo-audits', seoAuditRoutes);
router.use('/geo-audits', geoAuditRoutes);
router.use('/gbp-audits', gbpAuditRoutes);
router.use('/subscriptions', subscriptionRoutes);
router.use('/plans', planRoutes);
router.use('/dashboard', dashboardRoutes);

export default router;