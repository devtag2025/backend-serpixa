// models/subscription.model.js
import mongoose from 'mongoose';
import { enums } from '../utils/index.js';

const { Schema, model } = mongoose;

const SubscriptionSchema = new Schema({
  user_id: { 
    type: Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true 
  },
  plan_id: { 
    type: Schema.Types.ObjectId, 
    ref: 'Plan', 
    required: true 
  },
  
  // Stripe references
  stripe_customer_id: { type: String, required: true, index: true },
  stripe_subscription_id: String, // null for one-time payments
  stripe_payment_intent_id: String, // for one-time payments
  
  // Subscription details
  status: {
    type: String,
    enum: enums.getSubscriptionStatusArray(),
    required: true,
    index: true
  },
  
  // Periods
  current_period_start: Date,
  current_period_end: Date,
  trial_end: Date,
  
  // Cancellation
  cancel_at_period_end: { type: Boolean, default: false },
  canceled_at: Date,
  
  // Usage tracking
  usage: {
    searches_performed: { type: Number, default: 0 },
    api_calls_made: { type: Number, default: 0 },
    seo_audits_used: { type: Number, default: 0 },
    geo_audits_used: { type: Number, default: 0 },
    gbp_audits_used: { type: Number, default: 0 },
    ai_generations_used: { type: Number, default: 0 },
    last_reset: { type: Date, default: Date.now }
  }
}, { 
  timestamps: true,
  versionKey: false 
});

// Instance methods
SubscriptionSchema.methods.isActive = function() {
  if (this.status === enums.SUBSCRIPTION_STATUS.LIFETIME) return true;
  if (this.status === enums.SUBSCRIPTION_STATUS.ACTIVE) return true;
  if (this.status === enums.SUBSCRIPTION_STATUS.TRIAL && this.trial_end && this.trial_end > new Date()) return true;
  return false;
};

SubscriptionSchema.methods.canPerformSearch = function(planLimits) {
  if (!this.isActive()) return false;
  
  // Reset monthly counter if needed
  const now = new Date();
  const lastReset = this.usage.last_reset;
  if (now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear()) {
    this.usage.searches_performed = 0;
    this.usage.api_calls_made = 0;
    this.usage.last_reset = now;
    this.save();
  }
  
  // Check limits
  if (planLimits?.searches_per_month && this.usage.searches_performed >= planLimits.searches_per_month) {
    return false;
  }
  
  return true;
};

SubscriptionSchema.methods.incrementUsage = async function(creditType, amount = 1) {
  const usageKey = `${creditType}_used`;
  if (this.usage[usageKey] !== undefined) {
    this.usage[usageKey] = (this.usage[usageKey] || 0) + amount;
  } else if (creditType === 'search') {
    this.usage.searches_performed += amount;
  } else if (creditType === 'api_call') {
    this.usage.api_calls_made += amount;
  }
  return this.save();
};

SubscriptionSchema.methods.resetMonthlyUsage = async function() {
  const now = new Date();
  const lastReset = this.usage.last_reset;

  if (now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear()) {
    this.usage.seo_audits_used = 0;
    this.usage.geo_audits_used = 0;
    this.usage.gbp_audits_used = 0;
    this.usage.ai_generations_used = 0;
    this.usage.searches_performed = 0;
    this.usage.api_calls_made = 0;
    this.usage.last_reset = now;
    await this.save();
    return true;
  }
  return false;
};

// Compound indexes
SubscriptionSchema.index({ user_id: 1, status: 1 });

export const Subscription = model('Subscription', SubscriptionSchema);


