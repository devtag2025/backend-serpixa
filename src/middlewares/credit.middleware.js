// middlewares/credit.middleware.js
import { ApiError, ApiResponse } from '../utils/index.js';
import { User, Subscription } from '../models/index.js';
import { enums } from '../utils/index.js';

/**
 * Middleware to check if user has available credits for a specific audit type
 * @param {string} creditType - Type of credit to check: 'seo_audits', 'geo_audits', 'gbp_audits', 'ai_generations'
 */
export const checkCredit = (creditType) => {
  return async (req, res, next) => {
    try {
      const userId = req.user._id;

      // Get user with credits
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

      // Calculate available credits
      let availableCredits = 0;
      let totalLimit = 0;
      let used = 0;

      // Get user's addon credits (one-time purchases)
      const userCredits = user.credits?.[creditType] || 0;

      // Get subscription limits and usage
      if (subscription?.plan_id && subscription.isActive()) {
        const planLimits = subscription.plan_id.limits || {};
        const subscriptionLimit = planLimits[creditType] || 0;
        const usageKey = `${creditType}_used`;
        const subscriptionUsed = subscription.usage?.[usageKey] || 0;

        totalLimit = subscriptionLimit;
        used = subscriptionUsed;
        const subscriptionAvailable = Math.max(0, subscriptionLimit - subscriptionUsed);
        
        // Total available = addon credits + subscription available
        availableCredits = userCredits + subscriptionAvailable;
      } else {
        // No active subscription, only addon credits available
        availableCredits = userCredits;
      }

      // Check if user has available credits
      if (availableCredits <= 0) {
        const creditTypeNames = {
          seo_audits: 'SEO Audits',
          geo_audits: 'GEO Audits',
          gbp_audits: 'GBP Audits',
          ai_generations: 'AI Generations'
        };

        const creditName = creditTypeNames[creditType] || creditType;
        
        return res.status(403).json(
          new ApiResponse(403, {
            credit_type: creditType,
            available: availableCredits,
            used: used,
            limit: totalLimit,
            addon_credits: userCredits
          }, `Insufficient ${creditName} credits. Please upgrade your plan or purchase addon credits.`)
        );
      }

      // Attach credit info to request for use in controller
      req.creditInfo = {
        creditType,
        availableCredits,
        userCredits,
        subscriptionLimit: totalLimit,
        subscriptionUsed: used,
        subscription
      };

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Middleware to check if user has active subscription
 */
export const requireSubscription = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const subscription = await Subscription.findOne({
      user_id: userId,
      status: { $in: [enums.SUBSCRIPTION_STATUS.ACTIVE, enums.SUBSCRIPTION_STATUS.TRIAL, enums.SUBSCRIPTION_STATUS.LIFETIME] }
    }).populate('plan_id');

    if (!subscription || !subscription.isActive()) {
      return res.status(403).json(
        new ApiResponse(403, null, 'Active subscription required. Please subscribe to a plan.')
      );
    }

    req.subscription = subscription;
    next();
  } catch (error) {
    next(error);
  }
};

