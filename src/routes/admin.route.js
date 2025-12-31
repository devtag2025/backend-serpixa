import { Router } from 'express';
import * as adminController from '../controllers/admin.controller.js';
import { auth, authorize, validate } from '../middlewares/index.js';
import { USER_TYPES } from '../utils/enum.js';
import rateLimit from 'express-rate-limit';

const sensitiveActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each admin to 10 requests per windowMs
  message: { success: false, message: 'Too many requests, please try again later.' }
});

const router = Router();

// All admin routes require authentication and admin role
router.use(auth);
router.use(authorize([USER_TYPES.ADMIN]));

// ============================================
// DASHBOARD
// ============================================
router.get('/dashboard/stats', adminController.getDashboardStats);
router.get('/dashboard/credit-trend', validate.creditTrendQuery, adminController.getCreditConsumptionTrend);

// ============================================
// USERS
// ============================================
router.get('/users', validate.paginationQuery, adminController.getAllUsers);
router.get('/users/:userId', validate.userIdParam, adminController.getUserById);
router.get('/users/:userId/activity', validate.userIdParam, validate.paginationQuery, adminController.getUserActivityLogs);
router.patch('/users/:userId/credits', validate.userIdParam, validate.updateCredits, adminController.updateUserCredits);
router.post('/users/:userId/suspend', validate.userIdParam, validate.suspendUser, adminController.suspendUser);
router.post('/users/:userId/reactivate', validate.userIdParam, adminController.reactivateUser);

// ============================================
// AUDITS
// ============================================
router.get('/audits', validate.paginationQuery, adminController.getAllAudits);

// ============================================
// SUBSCRIPTIONS & BILLING
// ============================================
router.get('/subscriptions', validate.paginationQuery, adminController.getAllSubscriptions);
router.post('/subscriptions/:subscriptionId/cancel', validate.subscriptionIdParam, validate.cancelSubscription, adminController.cancelSubscription);
router.post('/subscriptions/:subscriptionId/refund', sensitiveActionLimiter, validate.subscriptionIdParam, validate.processRefund, adminController.processRefund);
router.post('/subscriptions/:subscriptionId/change-plan', validate.subscriptionIdParam, validate.changeSubscriptionPlan, adminController.changeSubscriptionPlan);

// ============================================
// ANALYTICS & REPORTS
// ============================================
router.get('/analytics', adminController.getGlobalAnalytics);
router.get('/reports/export', validate.exportReportQuery, adminController.exportReport);

// ============================================
// SYSTEM SETTINGS
// ============================================
router.get('/settings', adminController.getSystemSettings);
router.patch('/settings', validate.updateSetting, adminController.updateSystemSettings);

export default router;