// models/plan.model.js
import mongoose from 'mongoose';
import { enums } from '../utils/index.js';

const { Schema, model } = mongoose;

const PlanSchema = new Schema({
  name: { type: String, required: true, unique: true },
  description: { type: String },
  price: { type: Number, required: true }, // In smallest currency unit (e.g., cents/pence)
  currency: { type: String, default: 'USD' },
  billing_period: {
    type: String,
    enum: enums.getBillingPeriodsArray(),
    required: true
  },

  // Stripe IDs (set directly from existing Stripe prices)
  stripe_product_id: { type: String },
  stripe_price_id: { type: String, required: true },

  // Plan type
  plan_type: {
    type: String,
    enum: ['subscription', 'addon'],
    required: true,
    default: 'subscription'
  },

  // Plan limits & features
  features: { type: [String], default: [] },
  limits: {
    searches_per_month: { type: Number, default: 0 },
    api_calls_per_month: { type: Number, default: 0 },
    seo_audits: { type: Number, default: 0 },
    geo_audits: { type: Number, default: 0 },
    gbp_audits: { type: Number, default: 0 },
    ai_generations: { type: Number, default: 0 },
  },

  // Credits for addon plans
  credits: {
    seo_audits: { type: Number, default: 0 },
    geo_audits: { type: Number, default: 0 },
    gbp_audits: { type: Number, default: 0 },
    ai_generations: { type: Number, default: 0 },
  },

  // Admin controls
  is_active: { type: Boolean, default: true },
  sort_order: { type: Number, default: 0 },

  // Special flags
  is_popular: { type: Boolean, default: false }
}, {
  timestamps: true,
  versionKey: false
});

// Index for faster lookups (sparse allows multiple nulls)
PlanSchema.index({ stripe_price_id: 1 }, { unique: true, sparse: true });
PlanSchema.index({ plan_type: 1, is_active: 1 });

export const Plan = model('Plan', PlanSchema);

