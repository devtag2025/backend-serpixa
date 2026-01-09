import { ApiResponse } from '../utils/index.js';
import { adminService } from '../services/admin.service.js';

// ============================================
// EXISTING CONTROLLERS
// ============================================

/**
 * @desc    Get admin dashboard statistics
 * @route   GET /api/v1/admin/dashboard/stats
 * @access  Admin
 */
export const getDashboardStats = async (req, res, next) => {
  try {
    const stats = await adminService.getDashboardStats();
    res.json(new ApiResponse(200, stats, 'Dashboard stats retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get AI content generation statistics
 * @route   GET /api/v1/admin/dashboard/ai-content-stats
 * @access  Admin
 */
export const getAIContentStats = async (req, res, next) => {
  try {
    const stats = await adminService.getAIContentStats();
    res.json(new ApiResponse(200, stats, 'AI content stats retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get recent platform activity for dashboard
 * @route   GET /api/v1/admin/dashboard/recent-activity
 * @access  Admin
 */
export const getDashboardRecentActivity = async (req, res, next) => {
  try {
    const { limit = 15 } = req.query;
    const activities = await adminService.getDashboardRecentActivity(parseInt(limit));
    res.json(new ApiResponse(200, activities, 'Recent activity retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get user statistics
 * @route   GET /api/v1/admin/users/stats
 * @access  Admin
 */
export const getUserStats = async (req, res, next) => {
  try {
    const stats = await adminService.getUserStats();
    res.json(new ApiResponse(200, stats, 'User stats retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get audit statistics
 * @route   GET /api/v1/admin/audits/stats
 * @access  Admin
 */
export const getAuditStats = async (req, res, next) => {
  try {
    const stats = await adminService.getAuditStats();
    res.json(new ApiResponse(200, stats, 'Audit stats retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get subscription statistics
 * @route   GET /api/v1/admin/subscriptions/stats
 * @access  Admin
 */
export const getSubscriptionStats = async (req, res, next) => {
  try {
    const stats = await adminService.getSubscriptionStats();
    res.json(new ApiResponse(200, stats, 'Subscription stats retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get credit consumption trend
 * @route   GET /api/v1/admin/dashboard/credit-trend
 * @access  Admin
 */
export const getCreditConsumptionTrend = async (req, res, next) => {
  try {
    const { period = '7days' } = req.validatedQuery || req.query;
    const trendData = await adminService.getCreditConsumptionTrend(period);
    res.json(new ApiResponse(200, trendData, 'Credit trend retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all users with pagination
 * @route   GET /api/v1/admin/users
 * @access  Admin
 */
export const getAllUsers = async (req, res, next) => {
  try {
    const options = req.validatedQuery || req.query;
    const result = await adminService.getAllUsers(options);
    res.json(new ApiResponse(200, result, 'Users retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get single user details
 * @route   GET /api/v1/admin/users/:userId
 * @access  Admin
 */
export const getUserById = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const result = await adminService.getUserById(userId);
    res.json(new ApiResponse(200, result, 'User retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update user credits
 * @route   PATCH /api/v1/admin/users/:userId/credits
 * @access  Admin
 */
export const updateUserCredits = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const credits = req.body;
    const adminId = req.user._id;
    const updatedUser = await adminService.updateUserCredits(userId, credits, adminId);
    res.json(new ApiResponse(200, updatedUser, 'User credits updated successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all audits with pagination
 * @route   GET /api/v1/admin/audits
 * @access  Admin
 */
export const getAllAudits = async (req, res, next) => {
  try {
    const options = req.validatedQuery || req.query;
    const result = await adminService.getAllAudits(options);
    res.json(new ApiResponse(200, result, 'Audits retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all subscriptions with pagination
 * @route   GET /api/v1/admin/subscriptions
 * @access  Admin
 */
export const getAllSubscriptions = async (req, res, next) => {
  try {
    const options = req.validatedQuery || req.query;
    const result = await adminService.getAllSubscriptions(options);
    res.json(new ApiResponse(200, result, 'Subscriptions retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

// ============================================
// NEW CONTROLLERS
// ============================================

/**
 * @desc    Suspend a user account
 * @route   POST /api/v1/admin/users/:userId/suspend
 * @access  Admin
 */
export const suspendUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;
    const adminId = req.user._id;
    const result = await adminService.suspendUser(userId, reason, adminId);
    res.json(new ApiResponse(200, result, 'User suspended successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Reactivate a suspended user
 * @route   POST /api/v1/admin/users/:userId/reactivate
 * @access  Admin
 */
export const reactivateUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const adminId = req.user._id;
    const result = await adminService.reactivateUser(userId, adminId);
    res.json(new ApiResponse(200, result, 'User reactivated successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get user activity logs
 * @route   GET /api/v1/admin/users/:userId/activity
 * @access  Admin
 */
export const getUserActivityLogs = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const options = req.validatedQuery || req.query;
    const result = await adminService.getUserActivityLogs(userId, options);
    res.json(new ApiResponse(200, result, 'Activity logs retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Cancel a subscription
 * @route   POST /api/v1/admin/subscriptions/:subscriptionId/cancel
 * @access  Admin
 */
export const cancelSubscription = async (req, res, next) => {
  try {
    const { subscriptionId } = req.params;
    const { immediate = false } = req.body;
    const adminId = req.user._id;
    const result = await adminService.cancelUserSubscription(subscriptionId, adminId, immediate);
    res.json(new ApiResponse(200, result, 'Subscription cancelled successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Process a refund
 * @route   POST /api/v1/admin/subscriptions/:subscriptionId/refund
 * @access  Admin
 */
export const processRefund = async (req, res, next) => {
  try {
    const { subscriptionId } = req.params;
    const { amount, reason } = req.body;
    const adminId = req.user._id;
    const result = await adminService.processRefund(subscriptionId, amount, reason, adminId);
    res.json(new ApiResponse(200, result, 'Refund processed successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get global platform analytics
 * @route   GET /api/v1/admin/analytics
 * @access  Admin
 */
export const getGlobalAnalytics = async (req, res, next) => {
  try {
    const result = await adminService.getGlobalAnalytics();
    res.json(new ApiResponse(200, result, 'Analytics retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get system settings
 * @route   GET /api/v1/admin/settings
 * @access  Admin
 */
export const getSystemSettings = async (req, res, next) => {
  try {
    const result = await adminService.getSystemSettings();
    res.json(new ApiResponse(200, result, 'Settings retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update a system setting
 * @route   PATCH /api/v1/admin/settings
 * @access  Admin
 */
export const updateSystemSettings = async (req, res, next) => {
  try {
    const { key, value } = req.body;
    const adminId = req.user._id;
    const result = await adminService.updateSystemSettings(key, value, adminId);
    res.json(new ApiResponse(200, result, 'Setting updated successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Export report data
 * @route   GET /api/v1/admin/reports/export
 * @access  Admin
 */
export const exportReport = async (req, res, next) => {
  try {
    const { type, startDate, endDate, format = 'json' } = req.validatedQuery || req.query;
    const result = await adminService.exportReport(type, { startDate, endDate, format });
    
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=${type}-report-${Date.now()}.csv`);
      return res.send(result);
    }
    
    res.json(new ApiResponse(200, result, 'Report exported successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * Change user subscription plan (upgrade/downgrade)
 * POST /api/v1/admin/subscriptions/:subscriptionId/change-plan
 */
export const changeSubscriptionPlan = async (req, res, next) => {
  try {
    const { subscriptionId } = req.params;
    const { newPlanId, immediate = true, resetUsage = false } = req.body;

    const result = await adminService.changeUserSubscription(
      subscriptionId,
      newPlanId,
      req.user._id,
      { immediate, resetUsage }
    );

    res.json(new ApiResponse(200, result, result.message));
  } catch (error) {
    next(error);
  }
};