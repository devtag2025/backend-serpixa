import { ApiResponse, ApiError } from '../utils/index.js';
import { User, Subscription, SEOAudit, GBPAudit, GeoAudit } from '../models/index.js';

export const getCredits = async (req, res, next) => {
  try {
    const userId = req.user._id;

    // Get user with addon credits
    const user = await User.findById(userId).select('credits');
    if (!user) {
      throw new ApiError(404, 'User not found');
    }

    // Get active subscription with plan details
    const subscription = await Subscription.findOne({
      user_id: userId,
      status: { $in: ['active', 'trial', 'lifetime'] },
    }).populate('plan_id');

    if (!subscription || !subscription.plan_id) {
      return res.json(
        new ApiResponse(200, {
          hasActiveSubscription: false,
          credits: {
            seo: { available: 0, used: 0, remaining: 0, percentageUsed: 0 },
            geo: { available: 0, used: 0, remaining: 0, percentageUsed: 0 },
            gbp: { available: 0, used: 0, remaining: 0, percentageUsed: 0 },
            ai: { available: 0, used: 0, remaining: 0, percentageUsed: 0 },
          },
        }, 'No active subscription')
      );
    }

    // Check and reset monthly usage if needed
    await subscription.resetMonthlyUsage();

    const planLimits = subscription.plan_id.limits || {};
    const userCredits = user.credits || {};
    const usage = subscription.usage || {};

    // Calculate credits for each type
    const calculateCredit = (limitKey, usageKey, addonKey) => {
      const planLimit = planLimits[limitKey] || 0;
      const addonCredits = userCredits[addonKey] || 0;
      const available = planLimit + addonCredits;
      const used = usage[usageKey] || 0;
      const remaining = Math.max(0, available - used);
      const percentageUsed = available > 0 ? Math.round((used / available) * 100) : 0;

      return { available, used, remaining, percentageUsed };
    };

    const credits = {
      seo: calculateCredit('seo_audits', 'seo_audits_used', 'seo_audits'),
      geo: calculateCredit('geo_audits', 'geo_audits_used', 'geo_audits'),
      gbp: calculateCredit('gbp_audits', 'gbp_audits_used', 'gbp_audits'),
      ai: calculateCredit('ai_generations', 'ai_generations_used', 'ai_generations'),
    };

    res.json(
      new ApiResponse(200, {
        hasActiveSubscription: true,
        plan: {
          name: subscription.plan_id.name,
          billingPeriod: subscription.plan_id.billing_period,
        },
        subscription: {
          status: subscription.status,
          currentPeriodEnd: subscription.current_period_end,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        },
        credits,
        lastReset: usage.last_reset,
      }, 'Credits retrieved successfully')
    );
  } catch (error) {
    next(error);
  }
};

export const getStats = async (req, res, next) => {
  try {
    const userId = req.user._id;

    // Get today's date range
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // Fetch all audit counts and recent audits in parallel
    const [
      seoTotal,
      geoTotal,
      gbpTotal,
      seoCompleted,
      geoCompleted,
      gbpCompleted,
      recentSEOAudits,
      recentGEOAudits,
      recentGBPAudits,
    ] = await Promise.all([
      // Total counts
      SEOAudit.countDocuments({ user: userId }),
      GeoAudit.countDocuments({ user: userId }),
      GBPAudit.countDocuments({ user: userId }),
      // Completed counts
      SEOAudit.countDocuments({ user: userId, status: 'completed' }),
      GeoAudit.countDocuments({ user: userId, status: 'completed' }),
      GBPAudit.countDocuments({ user: userId, status: 'completed' }),
      // Recent audits (today)
      SEOAudit.find({
        user: userId,
        createdAt: { $gte: todayStart, $lte: todayEnd },
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('url keyword status createdAt')
        .lean(),
      GeoAudit.find({
        user: userId,
        createdAt: { $gte: todayStart, $lte: todayEnd },
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('keyword city country status createdAt')
        .lean(),
      GBPAudit.find({
        user: userId,
        createdAt: { $gte: todayStart, $lte: todayEnd },
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('businessName status createdAt')
        .lean(),
    ]);

    // Calculate totals
    const totalAudits = seoTotal + geoTotal + gbpTotal;
    const totalCompleted = seoCompleted + geoCompleted + gbpCompleted;
    const successRate = totalAudits > 0 ? Math.round((totalCompleted / totalAudits) * 100) : 100;

    // Combine and format recent audits
    const recentAudits = [
      ...recentSEOAudits.map((audit) => ({
        id: audit._id,
        type: 'seo',
        name: audit.keyword || 'SEO Audit',
        displayName: `SEO Audit`,
        status: audit.status,
        createdAt: audit.createdAt,
      })),
      ...recentGEOAudits.map((audit) => ({
        id: audit._id,
        type: 'geo',
        name: audit.keyword || 'GEO Audit',
        displayName: `GEO Audit`,
        status: audit.status,
        createdAt: audit.createdAt,
      })),
      ...recentGBPAudits.map((audit) => ({
        id: audit._id,
        type: 'gbp',
        name: audit.businessName || 'GBP Audit',
        displayName: `GBP Audit`,
        status: audit.status,
        createdAt: audit.createdAt,
      })),
    ]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10);

    res.json(
      new ApiResponse(200, {
        overview: {
          totalAudits,
          successRate,
        },
        recentAudits,
        breakdown: {
          seo: { total: seoTotal, completed: seoCompleted },
          geo: { total: geoTotal, completed: geoCompleted },
          gbp: { total: gbpTotal, completed: gbpCompleted },
        },
      }, 'Dashboard stats retrieved successfully')
    );
  } catch (error) {
    next(error);
  }
};

export const dashboardController = {
  getCredits,
  getStats,
};