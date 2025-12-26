import { Router } from 'express';
import * as adminController from '../controllers/admin.controller.js';
import { auth, authorize, validate } from '../middlewares/index.js';
import { USER_TYPES } from '../utils/enum.js';

const router = Router();

// All admin routes require authentication and admin role
router.use(auth);
router.use(authorize([USER_TYPES.ADMIN]));

// Dashboard
router.get('/dashboard/stats', adminController.getDashboardStats);
router.get(
  '/dashboard/credit-trend', 
  validate.creditTrendQuery,
  adminController.getCreditConsumptionTrend
);

// Users
router.get('/users', validate.paginationQuery, adminController.getAllUsers);
router.get('/users/:userId', validate.userIdParam, adminController.getUserById);
router.patch(
  '/users/:userId/credits', 
  validate.userIdParam, 
  validate.updateCredits, 
  adminController.updateUserCredits
);

// Audits
router.get('/audits', validate.paginationQuery, adminController.getAllAudits);

// Subscriptions
router.get('/subscriptions', validate.paginationQuery, adminController.getAllSubscriptions);

export default router;