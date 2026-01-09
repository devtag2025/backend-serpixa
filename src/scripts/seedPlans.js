import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { Plan } from '../models/index.js';
import { enums } from '../utils/index.js';
import { env } from '../config/index.js';
import { Logger } from '../utils/index.js';

dotenv.config();

const plansData = [
  // Subscription Plans
  {
    name: 'Starter Plan',
    description: 'Perfect for getting started with SEO audits',
    price: 1999, // $19.99 in cents
    currency: 'USD',
    billing_period: enums.BILLING_PERIODS.MONTHLY,
    stripe_price_id: 'price_1SEAEPARwLtnMWsCAhLU5QZD',
    plan_type: 'subscription',
    limits: {
      seo_audits: 30,
      geo_audits: 10,
      gbp_audits: 5,
      ai_generations: 0,
    },
    features: ['SEO Audits', 'GEO Audits', 'GBP Audits'],
    is_active: true,
    sort_order: 1,
    is_popular: false,
  },
  {
    name: 'Premium Plan',
    description: 'Advanced features with more audits and AI generations',
    price: 4999, // $49.99 in cents
    currency: 'USD',
    billing_period: enums.BILLING_PERIODS.MONTHLY,
    stripe_price_id: 'price_1SEAF6ARwLtnMWsCkqGwvqLc',
    plan_type: 'subscription',
    limits: {
      seo_audits: 120,
      geo_audits: 40,
      gbp_audits: 20,
      ai_generations: 50,
    },
    features: ['SEO Audits', 'GEO Audits', 'GBP Audits', 'AI Generations'],
    is_active: true,
    sort_order: 2,
    is_popular: true,
  },
  // Addon Plans (One-time purchases)
  {
    name: 'Extra 10 SEO Audits',
    description: 'One-time purchase of 10 additional SEO audits',
    price: 500, // €5.00 in cents
    currency: 'EUR',
    billing_period: enums.BILLING_PERIODS.ONE_TIME,
    stripe_price_id: 'price_1SEAHDARwLtnMWsCunuOdJTG',
    plan_type: 'addon',
    credits: {
      seo_audits: 10,
      geo_audits: 0,
      gbp_audits: 0,
      ai_generations: 0,
    },
    features: ['Additional SEO Audits'],
    is_active: true,
    sort_order: 10,
    is_popular: false,
  },
  {
    name: 'Extra 10 Local SEO Audits',
    description: 'One-time purchase of 10 additional Local SEO audits',
    price: 500, // €5.00 in cents
    currency: 'EUR',
    billing_period: enums.BILLING_PERIODS.ONE_TIME,
    stripe_price_id: 'price_1SEAI3ARwLtnMWsChwregnfz',
    plan_type: 'addon',
    credits: {
      seo_audits: 0,
      geo_audits: 10,
      gbp_audits: 0,
      ai_generations: 0,
    },
    features: ['Additional Local SEO Audits'],
    is_active: true,
    sort_order: 11,
    is_popular: false,
  },
  {
    name: 'Extra 5 GBP Audits',
    description: 'One-time purchase of 5 additional GBP audits',
    price: 500, // €5.00 in cents
    currency: 'EUR',
    billing_period: enums.BILLING_PERIODS.ONE_TIME,
    stripe_price_id: 'price_1SEAIuARwLtnMWsCM7UJxjcY',
    plan_type: 'addon',
    credits: {
      seo_audits: 0,
      geo_audits: 0,
      gbp_audits: 5,
      ai_generations: 0,
    },
    features: ['Additional GBP Audits'],
    is_active: true,
    sort_order: 12,
    is_popular: false,
  },
  {
    name: 'Extra 50 AI Generations',
    description: 'One-time purchase of 50 additional AI generations',
    price: 1499, // €14.99 in cents
    currency: 'EUR',
    billing_period: enums.BILLING_PERIODS.ONE_TIME,
    stripe_price_id: 'price_1SEAJjARwLtnMWsCuNI05fYL',
    plan_type: 'addon',
    credits: {
      seo_audits: 0,
      geo_audits: 0,
      gbp_audits: 0,
      ai_generations: 50,
    },
    features: ['Additional AI Generations'],
    is_active: true,
    sort_order: 13,
    is_popular: false,
  },
];

const seedPlans = async () => {
  try {
    // Connect to database
    await mongoose.connect(env.MONGO_URI);
    Logger.log('Connected to database');

    // Clear existing plans (optional - comment out if you want to keep existing)
    // await Plan.deleteMany({});
    // console.log('Cleared existing plans');

    // Upsert plans (update if exists, create if not)
    for (const planData of plansData) {
      const plan = await Plan.findOneAndUpdate(
        { stripe_price_id: planData.stripe_price_id },
        planData,
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      Logger.log(`✓ ${plan.name} - ${plan.plan_type} (${plan.stripe_price_id})`);
    }

    Logger.log('\n✅ Plans seeded successfully!');
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    Logger.error('❌ Error seeding plans:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
};

seedPlans();

