import { ApiResponse } from '../utils/index.js';
import { adminService } from '../services/admin.service.js';

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
 * @desc    Get credit consumption trend
 * @route   GET /api/v1/admin/dashboard/credit-trend
 * @access  Admin
 */
export const getCreditConsumptionTrend = async (req, res, next) => {
  try {
    // Use validatedQuery if available, otherwise fallback to req.query
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
    // Use validatedQuery if available, otherwise fallback to req.query
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
    const updatedUser = await adminService.updateUserCredits(userId, credits);
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
    // Use validatedQuery if available, otherwise fallback to req.query
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
    // Use validatedQuery if available, otherwise fallback to req.query
    const options = req.validatedQuery || req.query;
    const result = await adminService.getAllSubscriptions(options);
    res.json(new ApiResponse(200, result, 'Subscriptions retrieved successfully'));
  } catch (error) {
    next(error);
  }
};