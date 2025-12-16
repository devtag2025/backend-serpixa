// models/plan.model.js
import mongoose from 'mongoose';
import stripe from 'stripe';
import { env } from '../config/index.js';
import { enums } from '../utils/index.js';

const { Schema, model } = mongoose;

const PlanSchema = new Schema({
  name: { type: String, required: true, unique: true },
  description: String,
  price: { type: Number, required: true }, // In smallest currency unit (e.g., cents/pence)
  currency: { type: String, default: 'EUR' },
  billing_period: {
    type: String,
    enum: enums.getBillingPeriodsArray(),
    required: true
  },

  // Stripe IDs (auto-created)
  stripe_product_id: String,
  stripe_price_id: String,

  // Plan limits & features
  features: [String],
  limits: {
    searches_per_month: Number,
    api_calls_per_month: Number,
   
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

// Auto-create Stripe product & price on save
PlanSchema.pre('save', async function (next) {

  // Skip Stripe creation if no secret key is configured
  if (!env.STRIPE_SECRET_KEY) {
    console.warn('STRIPE_SECRET_KEY not configured, skipping Stripe product/price creation');
    this.stripe_product_id = `dev_product_${this._id}`;
    this.stripe_price_id = `dev_price_${this._id}`;
    return next();
  }

  try {
    const stripeClient = stripe(env.STRIPE_SECRET_KEY);

    // Create/update Stripe product
    if (!this.stripe_product_id) {
      const product = await stripeClient.products.create({
        name: this.name,
        description: this.description,
        metadata: { plan_id: this._id.toString() }
      });
      this.stripe_product_id = product.id;
    }

    // Create Stripe price
    const priceData = {
      product: this.stripe_product_id,
      unit_amount: this.price,
      currency: this.currency.toLowerCase(),
      metadata: { plan_id: this._id.toString() }
    };

    if (this.billing_period === enums.BILLING_PERIODS.ONE_TIME) {
      // One-time payment
    } else {
      priceData.recurring = {
        interval: this.billing_period === enums.BILLING_PERIODS.YEARLY ? 'year' : 'month'
      };
    }

    const price = await stripeClient.prices.create(priceData);
    this.stripe_price_id = price.id;

  } catch (error) {
    console.error('Stripe plan creation error:', error);
    // Set dev values instead of failing
    this.stripe_product_id = `dev_product_${this._id}`;
    this.stripe_price_id = `dev_price_${this._id}`;
  }

  next();
});

export const Plan = model('Plan', PlanSchema);


