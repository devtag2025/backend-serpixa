import { planService } from '../services/index.js';
import { ApiResponse } from '../utils/index.js';

// ===== PLAN MANAGEMENT =====

export const getPlans = async (req, res, next) => {
  try {
    const activeOnly = req.query.active === 'true';
    const plans = await planService.getPlans(activeOnly);
    res.json(new ApiResponse(200, plans, "Plans retrieved successfully"));
  } catch (error) {
    next(error);
  }
};

export const getPlanById = async (req, res, next) => {
  try {
    const { planId } = req.params;
    const plan = await planService.getPlanById(planId);
    res.json(new ApiResponse(200, plan, "Plan retrieved successfully"));
  } catch (error) {
    next(error);
  }
};

export const createPlan = async (req, res, next) => {
  try {
    const plan = await planService.createPlan(req.body);
    res.json(new ApiResponse(201, plan, "Plan created successfully"));
  } catch (error) {
    next(error);
  }
};

export const updatePlan = async (req, res, next) => {
  try {
    const { planId } = req.params;
    const plan = await planService.updatePlan(planId, req.body);
    res.json(new ApiResponse(200, plan, "Plan updated successfully"));
  } catch (error) {
    next(error);
  }
};

export const deletePlan = async (req, res, next) => {
  try {
    const { planId } = req.params;
    const plan = await planService.deletePlan(planId);
    res.json(new ApiResponse(200, plan, "Plan deactivated successfully"));
  } catch (error) {
    next(error);
  }
};

// ===== SUBSCRIPTION ANALYTICS =====

export const getSubscriptions = async (req, res, next) => {
  try {
    const { page = 1, limit = 50, status, plan_id, sort, order } = req.query;

    const query = {};
    if (status) query.status = status;
    if (plan_id) query.plan_id = plan_id;

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort,
      order
    };

    const result = await planService.getSubscriptions(query, options);
    res.json(new ApiResponse(200, result, "Subscriptions retrieved successfully"));
  } catch (error) {
    next(error);
  }
};

export const getAnalytics = async (req, res, next) => {
  try {
    const analytics = await planService.getAnalytics();
    res.json(new ApiResponse(200, analytics, "Analytics retrieved successfully"));
  } catch (error) {
    next(error);
  }
};

// ===== USER MANAGEMENT =====

export const updateUserSubscription = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { plan_id, status, expires_at } = req.body;

    const result = await planService.updateUserSubscription(userId, {
      plan_id,
      status,
      expires_at
    });

    const response = {
      user: {
        id: result.user._id,
        email: result.user.email,
        name: result.user.name
      },
      subscription: {
        id: result.subscription?._id,
        status: result.subscription?.status,
        plan_id: result.subscription?.plan_id,
        current_period_end: result.subscription?.current_period_end
      }
    };

    res.json(new ApiResponse(200, response, "User subscription updated successfully"));
  } catch (error) {
    next(error);
  }
};

