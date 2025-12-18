import { Plan, Subscription, User } from '../models/index.js';
import { paginate } from '../utils/index.js';

class PlanService {

  async getPlans(activeOnly = false) {
    const filter = activeOnly ? { is_active: true } : {};
    return Plan.find(filter).sort({ sort_order: 1, createdAt: -1 });
  }

  async getPlanById(planId) {
    const plan = await Plan.findById(planId);
    if (!plan) throw new Error('Plan not found');
    return plan;
  }

  async createPlan(data) {
    const exists = await Plan.findOne({ name: data.name });
    if (exists) throw new Error('Plan name already exists');
    
    return Plan.create({ ...data, sort_order: data.sort_order || 0 });
  }

  async updatePlan(planId, data) {
    const { stripe_product_id, stripe_price_id, ...updates } = data;
    const plan = await Plan.findByIdAndUpdate(planId, updates, { new: true });
    if (!plan) throw new Error('Plan not found');
    return plan;
  }

  async deletePlan(planId) {
    const activeCount = await Subscription.countDocuments({
      plan_id: planId,
      status: { $in: ['active', 'trial'] }
    });
    
    if (activeCount > 0) throw new Error('Plan has active subscriptions');
    
    return Plan.findByIdAndDelete(planId);
  }

 
  async getSubscriptions(query = {}, options = {}) {
    const filter = this._buildSubscriptionFilter(query);
    return paginate(Subscription, filter, {
      ...options,
      populate: [
        { path: 'user_id', select: 'name email createdAt' },
        { path: 'plan_id', select: 'name price billing_period' }
      ],
      sort: options.sort || 'createdAt',
      order: options.order || 'desc'
    });
  }

  async updateUserSubscription(userId, { plan_id, status, expires_at }) {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    let subscription = await Subscription.findOne({
      user_id: userId,
      status: { $in: ['active', 'trial', 'lifetime'] }
    });

    const updates = {};
    if (plan_id) updates.plan_id = plan_id;
    if (status) updates.status = status;
    if (expires_at) updates.current_period_end = new Date(expires_at);

    if (subscription) {
      Object.assign(subscription, updates);
      await subscription.save();
    } else if (plan_id) {
      subscription = await Subscription.create({
        user_id: userId,
        plan_id,
        stripe_customer_id: user.stripe_customer_id || 'manual',
        status: status || 'active',
        ...updates
      });
    }

    return { user, subscription };
  }

  _buildSubscriptionFilter(query) {
    const filter = {};
    if (query.status) filter.status = query.status;
    if (query.plan_id) filter.plan_id = query.plan_id;
    return filter;
  }
}

export const planService = new PlanService();



