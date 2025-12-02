import { Router } from 'express';
import express from 'express';
import authRoutes from './auth.route.js';
import claudeRoutes from './claude.route.js';
import seoAuditRoutes from './seoAudit.route.js';
import gbpAuditRoutes from './gbpAudit.route.js';
import subscriptionRoutes from './subscription.route.js';
import planRoutes from './plan.route.js';
import { handleStripeWebhook } from '../controllers/webhook.controller.js';

const router = Router();

router.post('/webhooks/stripe', express.raw({ type: "application/json" }), handleStripeWebhook);

router.use('/auth', authRoutes);
router.use('/claude', claudeRoutes);
router.use('/seo-audits', seoAuditRoutes);
router.use('/gbp-audits', gbpAuditRoutes);
router.use('/subscriptions', subscriptionRoutes);
router.use('/plans', planRoutes);

export default router;