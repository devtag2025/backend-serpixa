import { stripeService, planService } from '../services/index.js';
import { ApiResponse, ApiError, enums } from '../utils/index.js';
import { Plan, Subscription, User } from '../models/index.js';

export const createCheckout = async (req, res, next) => {
  try {
    const { price_id } = req.body;
    const userId = req.user._id;

    if (!price_id) {
      return res.status(400).json(
        new ApiResponse(400, null, "price_id is required")
      );
    }

    const result = await stripeService.createCheckout(userId, price_id);
    res.json(new ApiResponse(200, result, "Checkout session created"));
  } catch (error) {
    next(error);
  }
};

export const getCheckoutSession = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user._id;

    if (!sessionId) {
      return res.status(400).json(
        new ApiResponse(400, null, "session_id is required")
      );
    }

    const result = await stripeService.getCheckoutSession(sessionId, userId);
    res.json(new ApiResponse(200, result, "Checkout session retrieved"));
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
        id: subscription.plan_id._id,
        name: subscription.plan_id.name,
        description: subscription.plan_id.description,
        features: subscription.plan_id.features,
        limits: subscription.plan_id.limits,
        price: subscription.plan_id.price,
        currency: subscription.plan_id.currency,
        billing_period: subscription.plan_id.billing_period,
        stripe_price_id: subscription.plan_id.stripe_price_id,
      },
      current_period_start: subscription.current_period_start,
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

export const getAvailablePlans = async (req, res, next) => {
  try {
    const { type } = req.query; // 'subscription' or 'addon' or undefined for all
    
    const query = { is_active: true };
    if (type && ['subscription', 'addon'].includes(type)) {
      query.plan_type = type;
    }

    const plans = await Plan.find(query)
      .sort({ sort_order: 1, price: 1 })
      .select('-__v')
      .lean();

    // Format plans for frontend
    const formattedPlans = plans.map(plan => ({
      id: plan._id,
      name: plan.name,
      description: plan.description,
      price: plan.price,
      currency: plan.currency,
      billing_period: plan.billing_period,
      plan_type: plan.plan_type,
      stripe_price_id: plan.stripe_price_id,
      features: plan.features,
      limits: plan.limits,
      credits: plan.credits,
      is_popular: plan.is_popular,
    }));

    res.json(new ApiResponse(200, { plans: formattedPlans }, "Plans retrieved successfully"));
  } catch (error) {
    next(error);
  }
};

export const getCredits = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);
    
    if (!user) {
      throw new ApiError(404, 'User not found');
    }

    // Get active subscription
    const subscription = await Subscription.findOne({
      user_id: userId,
      status: { $in: [enums.SUBSCRIPTION_STATUS.ACTIVE, enums.SUBSCRIPTION_STATUS.TRIAL, enums.SUBSCRIPTION_STATUS.LIFETIME] }
    }).populate('plan_id');

    // Reset monthly usage if needed
    if (subscription) {
      await subscription.resetMonthlyUsage();
    }

    // Calculate available credits for each type
    const calculateCredits = (creditType) => {
      const userCredits = user.credits?.[creditType] || 0;
      let subscriptionLimit = 0;
      let subscriptionUsed = 0;

      if (subscription?.plan_id) {
        const planLimits = subscription.plan_id.limits || {};
        subscriptionLimit = planLimits[creditType] || 0;
        const usageKey = `${creditType}_used`;
        subscriptionUsed = subscription.usage?.[usageKey] || 0;
      }

      const subscriptionAvailable = Math.max(0, subscriptionLimit - subscriptionUsed);
      const totalRemaining = userCredits + subscriptionAvailable;
      const totalLimit = subscriptionLimit; // Total limit from subscription (addons are unlimited)

      return {
        total_remaining: totalRemaining,
        total_limit: totalLimit,
        used: subscriptionUsed,
        addon_credits: userCredits,
        subscription_available: subscriptionAvailable,
      };
    };

    const credits = {
      seo_audits: calculateCredits('seo_audits'),
      geo_audits: calculateCredits('geo_audits'),
      gbp_audits: calculateCredits('gbp_audits'),
      ai_generations: calculateCredits('ai_generations'),
      subscription: subscription ? {
        plan_name: subscription.plan_id?.name || 'Unknown',
        plan_id: subscription.plan_id?._id,
        status: subscription.status,
        current_period_end: subscription.current_period_end,
      } : null,
    };

    res.json(new ApiResponse(200, credits, "Credits retrieved successfully"));
  } catch (error) {
    next(error);
  }
};



