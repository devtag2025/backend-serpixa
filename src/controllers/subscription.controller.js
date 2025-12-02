import { stripeService, planService } from '../services/index.js';
import { ApiResponse } from '../utils/index.js';

export const createCheckout = async (req, res, next) => {
  try {
    const { plan_id } = req.body;
    const userId = req.user._id;

    const result = await stripeService.createCheckout(userId, plan_id);
    res.json(new ApiResponse(200, result, "Checkout session created"));
  } catch (error) {
    next(error);
  }
};

export const createPortalSession = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const result = await stripeService.createPortal(userId);
    res.json(new ApiResponse(200, result, "Portal session created"));
  } catch (error) {
    next(error);
  }
};

export const getCurrentSubscription = async (req, res, next) => {
  try {
    const user = req.user;
    const subscription = await user.getCurrentSubscription();

    if (!subscription) {
      return res.json(new ApiResponse(200, {
        status: 'none',
        plan: null,
        can_perform_search: false,
        trial_available: true
      }, "No active subscription"));
    }

    const response = {
      status: subscription.status,
      plan: {
        name: subscription.plan_id.name,
        features: subscription.plan_id.features,
        limits: subscription.plan_id.limits,
        price: subscription.plan_id.price,
        billing_period: subscription.plan_id.billing_period
      },
      current_period_end: subscription.current_period_end,
      trial_end: subscription.trial_end,
      cancel_at_period_end: subscription.cancel_at_period_end,
      usage: subscription.usage,
      can_perform_search: subscription.canPerformSearch(subscription.plan_id.limits)
    };

    res.json(new ApiResponse(200, response, "Current subscription retrieved"));
  } catch (error) {
    next(error);
  }
};

