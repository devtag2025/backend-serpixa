import { User, Subscription, SEOAudit, GBPAudit, GeoAudit, Plan, Settings, ActivityLog } from '../models/index.js';
import { ApiError, paginate } from '../utils/index.js';
import Stripe from 'stripe';
import { env } from '../config/index.js';

const stripe = new Stripe(env.STRIPE_SECRET_KEY);


/**
 * Get dashboard statistics
 */
export const getDashboardStats = async () => {
  const now = new Date();
  
  // Today's date range
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  
  // Yesterday's date range
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const yesterdayEnd = new Date(todayEnd);
  yesterdayEnd.setDate(yesterdayEnd.getDate() - 1);
  
  // Current month date range
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  
  // Last month date range
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

  const [
    totalUsers,
    usersLastMonth,
    usersThisMonth,
    activeSubscriptions,
    activeSubscriptionsLastMonth,
    
    // Today's credits consumed
    seoAuditsToday,
    geoAuditsToday,
    gbpAuditsToday,
    aiGenerationsToday,
    
    // Yesterday's credits consumed
    seoAuditsYesterday,
    geoAuditsYesterday,
    gbpAuditsYesterday,
    aiGenerationsYesterday,
  ] = await Promise.all([
    User.countDocuments({ user_type: 'user' }),
    User.countDocuments({
      user_type: 'user',
      createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd }
    }),
    User.countDocuments({
      user_type: 'user',
      createdAt: { $gte: currentMonthStart, $lte: currentMonthEnd }
    }),
    Subscription.countDocuments({
      status: { $in: ['active', 'trial', 'lifetime'] }
    }),
    Subscription.countDocuments({
      status: { $in: ['active', 'trial', 'lifetime'] },
      createdAt: { $lte: lastMonthEnd }
    }),
    SEOAudit.countDocuments({ createdAt: { $gte: todayStart, $lte: todayEnd } }),
    GeoAudit.countDocuments({ createdAt: { $gte: todayStart, $lte: todayEnd } }),
    GBPAudit.countDocuments({ createdAt: { $gte: todayStart, $lte: todayEnd } }),
    getAIGenerationsCount(todayStart, todayEnd),
    SEOAudit.countDocuments({ createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd } }),
    GeoAudit.countDocuments({ createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd } }),
    GBPAudit.countDocuments({ createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd } }),
    getAIGenerationsCount(yesterdayStart, yesterdayEnd),
  ]);

  const userGrowth = calculatePercentageChange(usersLastMonth, usersThisMonth);
  const subscriptionGrowth = calculatePercentageChange(activeSubscriptionsLastMonth, activeSubscriptions);
  
  const creditsToday = seoAuditsToday + geoAuditsToday + gbpAuditsToday + aiGenerationsToday;
  const creditsYesterday = seoAuditsYesterday + geoAuditsYesterday + gbpAuditsYesterday + aiGenerationsYesterday;
  const creditsChange = calculatePercentageChange(creditsYesterday, creditsToday);

  return {
    totalUsers: {
      count: totalUsers,
      growth: userGrowth,
      comparison: 'vs last month'
    },
    activeSubscriptions: {
      count: activeSubscriptions,
      growth: subscriptionGrowth,
      comparison: 'vs last month'
    },
    creditsConsumedToday: {
      count: creditsToday,
      change: creditsChange,
      comparison: 'vs yesterday',
      breakdown: {
        seo: seoAuditsToday,
        geo: geoAuditsToday,
        gbp: gbpAuditsToday,
        ai: aiGenerationsToday
      }
    }
  };
};

/**
 * Get credit consumption trend data
 */
export const getCreditConsumptionTrend = async (period = '7days') => {
  const now = new Date();
  let startDate;
  let labels = [];

  if (period === '1year') {
    startDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    for (let i = 11; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      labels.push(date.toLocaleString('default', { month: 'short' }));
    }
  } else {
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 6);
    startDate.setHours(0, 0, 0, 0);
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      labels.push(date.toLocaleString('default', { weekday: 'short' }));
    }
  }

  const aggregationPipeline = [
    { $match: { createdAt: { $gte: startDate } } },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          ...(period === '7days' ? { day: { $dayOfMonth: '$createdAt' } } : {})
        },
        count: { $sum: 1 }
      }
    },
    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
  ];

  const [seoTrend, geoTrend, gbpTrend] = await Promise.all([
    SEOAudit.aggregate(aggregationPipeline),
    GeoAudit.aggregate(aggregationPipeline),
    GBPAudit.aggregate(aggregationPipeline),
  ]);

  const processedData = processTrendData(
    { seo: seoTrend, geo: geoTrend, gbp: gbpTrend },
    startDate,
    period,
    labels
  );

  return { period, labels, datasets: processedData };
};

/**
 * Get all users with pagination and filters
 */
export const getAllUsers = async (options = {}) => {
  const { 
    page = 1, 
    limit = 20, 
    search = '', 
    status = '',
    sort = 'createdAt',
    order = 'desc'
  } = options;

  let query = { user_type: 'user' };

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } }
    ];
  }

  if (status === 'verified') {
    query.is_email_verified = true;
  } else if (status === 'unverified') {
    query.is_email_verified = false;
  } else if (status === 'suspended') {
    query.is_suspended = true;
  } else if (status === 'active') {
    query.is_suspended = { $ne: true };
    query.is_email_verified = true;
  }

  const result = await paginate(User, query, {
    page,
    limit,
    sort,
    order,
    select: 'name email is_email_verified is_suspended credits createdAt stripe_customer_id'
  });

  const userIds = result.data.map(u => u._id);
  const subscriptions = await Subscription.find({
    user_id: { $in: userIds },
    status: { $in: ['active', 'trial', 'lifetime'] }
  }).populate('plan_id', 'name').lean();

  const subMap = new Map(subscriptions.map(s => [s.user_id.toString(), s]));

  result.data = result.data.map(user => ({
    ...user,
    subscription: subMap.get(user._id.toString()) || null
  }));

  return result;
};

/**
 * Get single user details
 */
export const getUserById = async (userId) => {
  const user = await User.findById(userId).select('-password -refresh_token_enc');
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const [subscription, seoCount, geoCount, gbpCount, recentActivity] = await Promise.all([
    Subscription.findOne({
      user_id: userId,
      status: { $in: ['active', 'trial', 'lifetime'] }
    }).populate('plan_id'),
    SEOAudit.countDocuments({ user: userId }),
    GeoAudit.countDocuments({ user: userId }),
    GBPAudit.countDocuments({ user: userId }),
    ActivityLog.getRecentByUser(userId, 20)
  ]);

  return {
    user: user.toObject(),
    subscription,
    auditCounts: { seo: seoCount, geo: geoCount, gbp: gbpCount },
    recentActivity
  };
};

/**
 * Update user credits
 */
export const updateUserCredits = async (userId, credits, adminId = null) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const updateFields = {};
  const oldCredits = { ...user.credits };
  
  if (credits.seo_audits !== undefined) {
    updateFields['credits.seo_audits'] = Math.max(0, credits.seo_audits);
  }
  if (credits.geo_audits !== undefined) {
    updateFields['credits.geo_audits'] = Math.max(0, credits.geo_audits);
  }
  if (credits.gbp_audits !== undefined) {
    updateFields['credits.gbp_audits'] = Math.max(0, credits.gbp_audits);
  }
  if (credits.ai_generations !== undefined) {
    updateFields['credits.ai_generations'] = Math.max(0, credits.ai_generations);
  }

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { $set: updateFields },
    { new: true }
  ).select('name email credits');

  // Log activity
  await ActivityLog.log({
    user_id: userId,
    action: 'credits_adjusted',
    details: { oldCredits, newCredits: updatedUser.credits },
    performed_by: adminId
  });

  return updatedUser;
};

/**
 * Get all audits with pagination
 */
export const getAllAudits = async (options = {}) => {
  const {
    page = 1,
    limit = 20,
    type = 'all',
    search = '',
    sort = 'createdAt',
    order = 'desc',
    userId = null
  } = options;

  const results = { seo: null, geo: null, gbp: null };
  const baseQuery = userId ? { user: userId } : {};
  const populateOptions = [{ path: 'user', select: 'name email' }];

  if (type === 'all' || type === 'seo') {
    let seoQuery = { ...baseQuery };
    if (search) {
      seoQuery.$or = [
        { url: { $regex: search, $options: 'i' } },
        { keyword: { $regex: search, $options: 'i' } }
      ];
    }
    results.seo = await paginate(SEOAudit, seoQuery, {
      page, limit, sort, order,
      select: 'url keyword score status createdAt user',
      populate: populateOptions
    });
  }

  if (type === 'all' || type === 'geo') {
    let geoQuery = { ...baseQuery };
    if (search) {
      geoQuery.$or = [
        { businessName: { $regex: search, $options: 'i' } },
        { location: { $regex: search, $options: 'i' } },
        { keyword: { $regex: search, $options: 'i' } }
      ];
    }
    results.geo = await paginate(GeoAudit, geoQuery, {
      page, limit, sort, order,
      select: 'businessName location keyword localVisibilityScore status createdAt user',
      populate: populateOptions
    });
  }

  if (type === 'all' || type === 'gbp') {
    let gbpQuery = { ...baseQuery };
    if (search) {
      gbpQuery.$or = [{ businessName: { $regex: search, $options: 'i' } }];
    }
    results.gbp = await paginate(GBPAudit, gbpQuery, {
      page, limit, sort, order,
      select: 'businessName score status createdAt user',
      populate: populateOptions
    });
  }

  if (type !== 'all') return results[type];
  return results;
};

/**
 * Get all subscriptions with pagination
 */
export const getAllSubscriptions = async (options = {}) => {
  const { page = 1, limit = 20, status = '', sort = 'createdAt', order = 'desc' } = options;

  let query = {};
  if (status) query.status = status;

  return paginate(Subscription, query, {
    page,
    limit,
    sort,
    order,
    populate: [
      { path: 'user_id', select: 'name email' },
      { path: 'plan_id', select: 'name billing_period price' }
    ]
  });
};



/**
 * Suspend a user account
 */
export const suspendUser = async (userId, reason, adminId) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  if (user.user_type === 'admin') {
    throw new ApiError(403, 'Cannot suspend admin users');
  }

  user.is_suspended = true;
  user.suspended_at = new Date();
  user.suspension_reason = reason;
  await user.save();

  // Log activity
  await ActivityLog.log({
    user_id: userId,
    action: 'account_suspended',
    details: { reason },
    performed_by: adminId
  });

  return { message: 'User suspended successfully', user: { _id: user._id, email: user.email, is_suspended: true } };
};

/**
 * Reactivate a suspended user account
 */
export const reactivateUser = async (userId, adminId) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  user.is_suspended = false;
  user.suspended_at = null;
  user.suspension_reason = null;
  await user.save();

  await ActivityLog.log({
    user_id: userId,
    action: 'account_reactivated',
    details: {},
    performed_by: adminId
  });

  return { message: 'User reactivated successfully', user: { _id: user._id, email: user.email, is_suspended: false } };
};

/**
 * Get user activity logs
 */
export const getUserActivityLogs = async (userId, options = {}) => {
  const { page = 1, limit = 50 } = options;

  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  return paginate(ActivityLog, { user_id: userId }, {
    page,
    limit,
    sort: 'createdAt',
    order: 'desc',
    populate: [{ path: 'performed_by', select: 'name email' }]
  });
};

/**
 * Cancel user subscription (admin action)
 */
export const cancelUserSubscription = async (subscriptionId, adminId, immediate = false) => {
  const subscription = await Subscription.findById(subscriptionId).populate('user_id', 'name email');
  if (!subscription) {
    throw new ApiError(404, 'Subscription not found');
  }

  // Cancel in Stripe if exists
  if (subscription.stripe_subscription_id) {
    try {
      if (immediate) {
        await stripe.subscriptions.cancel(subscription.stripe_subscription_id);
      } else {
        await stripe.subscriptions.update(subscription.stripe_subscription_id, {
          cancel_at_period_end: true
        });
      }
    } catch (error) {
      console.error('Stripe cancellation error:', error.message);
    }
  }

  // Update subscription in DB
  subscription.status = immediate ? 'canceled' : subscription.status;
  subscription.cancel_at_period_end = !immediate;
  subscription.canceled_at = new Date();
  await subscription.save();

  await ActivityLog.log({
    user_id: subscription.user_id._id,
    action: 'subscription_cancelled',
    details: { subscription_id: subscriptionId, immediate },
    performed_by: adminId
  });

  return subscription;
};

/**
 * Process refund for a subscription
 */
export const processRefund = async (subscriptionId, amount, reason, adminId) => {
  const subscription = await Subscription.findById(subscriptionId).populate('user_id', 'name email stripe_customer_id');
  if (!subscription) {
    throw new ApiError(404, 'Subscription not found');
  }

  if (!subscription.stripe_subscription_id && !subscription.stripe_payment_intent_id) {
    throw new ApiError(400, 'No Stripe payment found for this subscription');
  }

  let refund;
  try {
    // Get the latest invoice for the subscription
    if (subscription.stripe_subscription_id) {
      const invoices = await stripe.invoices.list({
        subscription: subscription.stripe_subscription_id,
        limit: 1
      });

      if (invoices.data.length === 0 || !invoices.data[0].payment_intent) {
        throw new ApiError(400, 'No payment found to refund');
      }

      refund = await stripe.refunds.create({
        payment_intent: invoices.data[0].payment_intent,
        amount: amount ? Math.round(amount * 100) : undefined, // Convert to cents if partial
        reason: 'requested_by_customer',
        metadata: { admin_reason: reason, admin_id: adminId.toString() }
      });
    } else if (subscription.stripe_payment_intent_id) {
      refund = await stripe.refunds.create({
        payment_intent: subscription.stripe_payment_intent_id,
        amount: amount ? Math.round(amount * 100) : undefined,
        reason: 'requested_by_customer',
        metadata: { admin_reason: reason, admin_id: adminId.toString() }
      });
    }
  } catch (error) {
    throw new ApiError(400, `Refund failed: ${error.message}`);
  }

  await ActivityLog.log({
    user_id: subscription.user_id._id,
    action: 'subscription_cancelled',
    details: { 
      subscription_id: subscriptionId, 
      refund_id: refund?.id,
      amount: refund?.amount / 100,
      reason 
    },
    performed_by: adminId
  });

  return { 
    message: 'Refund processed successfully',
    refund: {
      id: refund.id,
      amount: refund.amount / 100,
      status: refund.status,
      currency: refund.currency
    }
  };
};

/**
 * Get global platform analytics
 */
export const getGlobalAnalytics = async () => {
  const now = new Date();
  const last30Days = new Date(now);
  last30Days.setDate(last30Days.getDate() - 30);

  const [
    // Total counts
    totalUsers,
    totalSubscriptions,
    totalSEOAudits,
    totalGEOAudits,
    totalGBPAudits,
    
    // Last 30 days
    newUsersLast30Days,
    auditsLast30Days,
    
    // By plan breakdown
    subscriptionsByPlan,
    
    // Most active users
    mostActiveUsers,
    
    // Revenue (from Stripe)
    revenueData
  ] = await Promise.all([
    User.countDocuments({ user_type: 'user' }),
    Subscription.countDocuments({ status: { $in: ['active', 'trial', 'lifetime'] } }),
    SEOAudit.countDocuments(),
    GeoAudit.countDocuments(),
    GBPAudit.countDocuments(),
    User.countDocuments({ user_type: 'user', createdAt: { $gte: last30Days } }),
    Promise.all([
      SEOAudit.countDocuments({ createdAt: { $gte: last30Days } }),
      GeoAudit.countDocuments({ createdAt: { $gte: last30Days } }),
      GBPAudit.countDocuments({ createdAt: { $gte: last30Days } })
    ]),
    Subscription.aggregate([
      { $match: { status: { $in: ['active', 'trial', 'lifetime'] } } },
      { $group: { _id: '$plan_id', count: { $sum: 1 } } },
      { $lookup: { from: 'plans', localField: '_id', foreignField: '_id', as: 'plan' } },
      { $unwind: '$plan' },
      { $project: { planName: '$plan.name', count: 1 } }
    ]),
    SEOAudit.aggregate([
      { $group: { _id: '$user', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $project: { name: '$user.name', email: '$user.email', auditCount: '$count' } }
    ]),
    getStripeRevenue()
  ]);

  return {
    overview: {
      totalUsers,
      totalSubscriptions,
      totalAudits: {
        seo: totalSEOAudits,
        geo: totalGEOAudits,
        gbp: totalGBPAudits,
        total: totalSEOAudits + totalGEOAudits + totalGBPAudits
      }
    },
    last30Days: {
      newUsers: newUsersLast30Days,
      audits: {
        seo: auditsLast30Days[0],
        geo: auditsLast30Days[1],
        gbp: auditsLast30Days[2],
        total: auditsLast30Days.reduce((a, b) => a + b, 0)
      }
    },
    subscriptionsByPlan,
    mostActiveUsers,
    revenue: revenueData
  };
};

/**
 * Get Stripe revenue data
 */
const getStripeRevenue = async () => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    
    const [thisMonth, lastMonth] = await Promise.all([
      stripe.balanceTransactions.list({
        created: { gte: Math.floor(startOfMonth.getTime() / 1000) },
        limit: 100
      }),
      stripe.balanceTransactions.list({
        created: { 
          gte: Math.floor(startOfLastMonth.getTime() / 1000),
          lt: Math.floor(startOfMonth.getTime() / 1000)
        },
        limit: 100
      })
    ]);

    const thisMonthRevenue = thisMonth.data.reduce((sum, t) => sum + (t.net || 0), 0) / 100;
    const lastMonthRevenue = lastMonth.data.reduce((sum, t) => sum + (t.net || 0), 0) / 100;

    return {
      thisMonth: thisMonthRevenue,
      lastMonth: lastMonthRevenue,
      growth: calculatePercentageChange(lastMonthRevenue, thisMonthRevenue)
    };
  } catch (error) {
    console.error('Error fetching Stripe revenue:', error.message);
    return { thisMonth: 0, lastMonth: 0, growth: 0 };
  }
};

/**
 * Get system settings
 */
export const getSystemSettings = async () => {
  const settings = await Settings.find().lean();
  
  // Group by category
  const grouped = settings.reduce((acc, setting) => {
    const category = setting.category || 'general';
    if (!acc[category]) acc[category] = [];
    
    // Mask sensitive values
    const value = setting.is_sensitive ? '********' : setting.value;
    acc[category].push({ ...setting, value });
    
    return acc;
  }, {});

  // Add API status info (masked)
  const apiStatus = {
    stripe: { configured: !!env.STRIPE_SECRET_KEY, key: maskApiKey(env.STRIPE_SECRET_KEY) },
    sendgrid: { configured: !!env.SENDGRID_API_KEY, key: maskApiKey(env.SENDGRID_API_KEY) },
    dataforseo: { configured: !!env.DATAFORSEO_LOGIN, login: env.DATAFORSEO_LOGIN },
    claude: { configured: !!env.CLAUDE_API_KEY, key: maskApiKey(env.CLAUDE_API_KEY) }
  };

  return { settings: grouped, apiStatus };
};

/**
 * Update system settings
 */
export const updateSystemSettings = async (key, value, adminId) => {
  const setting = await Settings.setSetting(key, value, { updated_by: adminId });
  return setting;
};

/**
 * Export report data
 */
export const exportReport = async (type, options = {}) => {
  const { startDate, endDate, format = 'json' } = options;
  
  let query = {};
  if (startDate && endDate) {
    query.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };
  }

  let data;
  switch (type) {
    case 'users':
      data = await User.find({ ...query, user_type: 'user' })
        .select('name email is_email_verified credits createdAt')
        .lean();
      break;
    case 'subscriptions':
      data = await Subscription.find(query)
        .populate('user_id', 'name email')
        .populate('plan_id', 'name price')
        .lean();
      break;
    case 'audits':
      const [seo, geo, gbp] = await Promise.all([
        SEOAudit.find(query).populate('user', 'name email').select('url keyword score createdAt').lean(),
        GeoAudit.find(query).populate('user', 'name email').select('businessName location score createdAt').lean(),
        GBPAudit.find(query).populate('user', 'name email').select('businessName score createdAt').lean()
      ]);
      data = { seo, geo, gbp };
      break;
    default:
      throw new ApiError(400, 'Invalid report type');
  }

  if (format === 'csv') {
    return convertToCSV(data, type);
  }

  return data;
};



const calculatePercentageChange = (previous, current) => {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Number((((current - previous) / previous) * 100).toFixed(1));
};

const getAIGenerationsCount = async (startDate, endDate) => {
  const result = await Subscription.aggregate([
    { $match: { 'usage.last_reset': { $gte: startDate, $lte: endDate } } },
    { $group: { _id: null, total: { $sum: '$usage.ai_generations_used' } } }
  ]);
  return result[0]?.total || 0;
};

const processTrendData = (rawData, startDate, period, labels) => {
  const datasets = {
    seo: new Array(labels.length).fill(0),
    geo: new Array(labels.length).fill(0),
    gbp: new Array(labels.length).fill(0),
    ai: new Array(labels.length).fill(0)
  };

  const now = new Date();

  Object.entries(rawData).forEach(([type, data]) => {
    data.forEach(item => {
      let index;
      if (period === '1year') {
        const monthDiff = (now.getFullYear() - item._id.year) * 12 + (now.getMonth() + 1 - item._id.month);
        index = 11 - monthDiff;
      } else {
        const itemDate = new Date(item._id.year, item._id.month - 1, item._id.day);
        const dayDiff = Math.floor((now - itemDate) / (1000 * 60 * 60 * 24));
        index = 6 - dayDiff;
      }
      
      if (index >= 0 && index < labels.length) {
        datasets[type][index] = item.count;
      }
    });
  });

  return datasets;
};

const maskApiKey = (key) => {
  if (!key) return null;
  if (key.length <= 8) return '****';
  return key.substring(0, 4) + '****' + key.substring(key.length - 4);
};

const convertToCSV = (data, type) => {
  if (type === 'audits') {
    // Handle nested audit data
    const rows = [];
    ['seo', 'geo', 'gbp'].forEach(auditType => {
      data[auditType]?.forEach(item => {
        rows.push({
          type: auditType.toUpperCase(),
          user: item.user?.email || 'N/A',
          name: item.businessName || item.url || 'N/A',
          score: item.score || item.localVisibilityScore || 0,
          createdAt: item.createdAt
        });
      });
    });
    data = rows;
  }

  if (!Array.isArray(data) || data.length === 0) {
    return '';
  }

  const headers = Object.keys(data[0]);
  const csvRows = [headers.join(',')];

  data.forEach(row => {
    const values = headers.map(header => {
      const val = row[header];
      if (val === null || val === undefined) return '';
      if (typeof val === 'object') return JSON.stringify(val).replace(/"/g, '""');
      return String(val).replace(/"/g, '""');
    });
    csvRows.push(values.map(v => `"${v}"`).join(','));
  });

  return csvRows.join('\n');
};



export const adminService = {

  getDashboardStats,
  getCreditConsumptionTrend,
  getAllUsers,
  getUserById,
  updateUserCredits,
  getAllAudits,
  getAllSubscriptions,
  

  suspendUser,
  reactivateUser,
  getUserActivityLogs,
  cancelUserSubscription,
  processRefund,
  getGlobalAnalytics,
  getSystemSettings,
  updateSystemSettings,
  exportReport
};