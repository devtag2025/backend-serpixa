import { User, Subscription, SEOAudit, GBPAudit, GeoAudit } from '../models/index.js';
import { ApiError, paginate } from '../utils/index.js';

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
    // Total users
    User.countDocuments({ user_type: 'user' }),
    
    // Users created last month
    User.countDocuments({
      user_type: 'user',
      createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd }
    }),
    
    // Users created this month
    User.countDocuments({
      user_type: 'user',
      createdAt: { $gte: currentMonthStart, $lte: currentMonthEnd }
    }),
    
    // Active subscriptions
    Subscription.countDocuments({
      status: { $in: ['active', 'trial', 'lifetime'] }
    }),
    
    // Active subscriptions last month
    Subscription.countDocuments({
      status: { $in: ['active', 'trial', 'lifetime'] },
      createdAt: { $lte: lastMonthEnd }
    }),
    
    // Today's audits
    SEOAudit.countDocuments({ createdAt: { $gte: todayStart, $lte: todayEnd } }),
    GeoAudit.countDocuments({ createdAt: { $gte: todayStart, $lte: todayEnd } }),
    GBPAudit.countDocuments({ createdAt: { $gte: todayStart, $lte: todayEnd } }),
    getAIGenerationsCount(todayStart, todayEnd),
    
    // Yesterday's audits
    SEOAudit.countDocuments({ createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd } }),
    GeoAudit.countDocuments({ createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd } }),
    GBPAudit.countDocuments({ createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd } }),
    getAIGenerationsCount(yesterdayStart, yesterdayEnd),
  ]);

  // Calculate percentage changes
  const userGrowth = calculatePercentageChange(usersLastMonth, usersThisMonth);
  const subscriptionGrowth = calculatePercentageChange(
    activeSubscriptionsLastMonth, 
    activeSubscriptions
  );
  
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
  let groupFormat;
  let labels = [];

  if (period === '1year') {
    startDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    groupFormat = { year: '$year', month: '$month' };
    
    // Generate last 12 months labels
    for (let i = 11; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      labels.push(date.toLocaleString('default', { month: 'short' }));
    }
  } else {
    // Default to 7 days
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 6);
    startDate.setHours(0, 0, 0, 0);
    groupFormat = { year: '$year', month: '$month', day: '$day' };
    
    // Generate last 7 days labels
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      labels.push(date.toLocaleString('default', { weekday: 'short' }));
    }
  }

  const aggregationPipeline = [
    {
      $match: {
        createdAt: { $gte: startDate }
      }
    },
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

  // Process data into consistent format
  const processedData = processTrendData(
    { seo: seoTrend, geo: geoTrend, gbp: gbpTrend },
    startDate,
    period,
    labels
  );

  return {
    period,
    labels,
    datasets: processedData
  };
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

  // Search by name or email
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } }
    ];
  }

  // Filter by email verification status
  if (status === 'verified') {
    query.is_email_verified = true;
  } else if (status === 'unverified') {
    query.is_email_verified = false;
  }

  const result = await paginate(User, query, {
    page,
    limit,
    sort,
    order,
    select: 'name email is_email_verified credits createdAt stripe_customer_id'
  });

  // Attach subscription info to each user
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

  const subscription = await Subscription.findOne({
    user_id: userId,
    status: { $in: ['active', 'trial', 'lifetime'] }
  }).populate('plan_id');

  const [seoCount, geoCount, gbpCount] = await Promise.all([
    SEOAudit.countDocuments({ user: userId }),
    GeoAudit.countDocuments({ user: userId }),
    GBPAudit.countDocuments({ user: userId }),
  ]);

  return {
    user: user.toObject(),
    subscription,
    auditCounts: {
      seo: seoCount,
      geo: geoCount,
      gbp: gbpCount
    }
  };
};

/**
 * Update user credits
 */
export const updateUserCredits = async (userId, credits) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const updateFields = {};
  
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

  return updatedUser;
};

/**
 * Get all audits with pagination
 */
export const getAllAudits = async (options = {}) => {
  const {
    page = 1,
    limit = 20,
    type = 'all', // 'seo', 'geo', 'gbp', or 'all'
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
      gbpQuery.$or = [
        { businessName: { $regex: search, $options: 'i' } }
      ];
    }
    results.gbp = await paginate(GBPAudit, gbpQuery, {
      page, limit, sort, order,
      select: 'businessName score status createdAt user',
      populate: populateOptions
    });
  }

  if (type !== 'all') {
    return results[type];
  }

  return results;
};

/**
 * Get all subscriptions with pagination
 */
export const getAllSubscriptions = async (options = {}) => {
  const {
    page = 1,
    limit = 20,
    status = '',
    sort = 'createdAt',
    order = 'desc'
  } = options;

  let query = {};
  if (status) {
    query.status = status;
  }

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

// Helper functions
const calculatePercentageChange = (previous, current) => {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return Number((((current - previous) / previous) * 100).toFixed(1));
};

const getAIGenerationsCount = async (startDate, endDate) => {
  // Sum AI generations from subscriptions usage within date range
  const result = await Subscription.aggregate([
    {
      $match: {
        'usage.last_reset': { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$usage.ai_generations_used' }
      }
    }
  ]);
  return result[0]?.total || 0;
};

const processTrendData = (rawData, startDate, period, labels) => {
  const datasets = {
    seo: new Array(labels.length).fill(0),
    geo: new Array(labels.length).fill(0),
    gbp: new Array(labels.length).fill(0),
    ai: new Array(labels.length).fill(0) // Placeholder for AI data
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

export const adminService = {
  getDashboardStats,
  getCreditConsumptionTrend,
  getAllUsers,
  getUserById,
  updateUserCredits,
  getAllAudits,
  getAllSubscriptions
};