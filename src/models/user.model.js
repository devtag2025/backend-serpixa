// models/user.model.js
import mongoose from 'mongoose';
import { encrypt, decrypt, enums } from '../utils/index.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from "../config/index.js";


const { Schema, model } = mongoose;

const UserSchema = new Schema(
  {
    // Basic user info
    email: { type: String, required: true, unique: true, lowercase: true },
    name: { type: String },
    picture: { type: String },
    user_type: {
      type: String,
      enum: enums.getUserTypesArray(),
      default: "user",
      index: true
    },

    // Auth fields
    password: { type: String, required: true },
    is_email_verified: { type: Boolean, default: false },
    email_verification_token: { type: String, index: true },
    email_verification_expires: { type: Date },
    reset_password_token: { type: String },
    reset_password_expires: { type: Date },
    refresh_token_enc: { type: String },

      // Suspension fields (add these)
    is_suspended: { type: Boolean, default: false, index: true },
    suspended_at: { type: Date, default: null },
    suspension_reason: { type: String, default: null },
    
    // Stripe
    stripe_customer_id: { type: String, index: true },
    
    // Credits for addon purchases
    credits: {
      seo_audits: { type: Number, default: 0 },
      geo_audits: { type: Number, default: 0 },
      gbp_audits: { type: Number, default: 0 },
      ai_generations: { type: Number, default: 0 },
    },
  },
  {
    timestamps: true, 
    versionKey: false,
    toJSON: {
      transform(doc, ret) {
        delete ret.password;
        delete ret.email_verification_token;
        delete ret.reset_password_token;
        delete ret.facebook_access_token_enc;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      transform(doc, ret) {
        delete ret.password;
        delete ret.email_verification_token;
        delete ret.reset_password_token;
        delete ret.facebook_access_token_enc;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Transient fields (not persisted)
UserSchema.virtual('_refresh_token_plain');

// Token Methods
UserSchema.methods.setRefreshToken = function (token) {
  this._refresh_token_plain = token;
};

UserSchema.methods.getRefreshToken = function () {
  if (this._refresh_token_plain) return this._refresh_token_plain;
  if (!this.refresh_token_enc) return undefined;
  try {
    return decrypt(this.refresh_token_enc);
  } catch {
    return undefined;
  }
};

UserSchema.methods.isPasswordCorrect = async function (password) {
  return await bcrypt.compare(password, this.password);
};

UserSchema.methods.generateAccessToken = function () {
  return jwt.sign(
    {
      _id: this._id,
      email: this.email,
      name: this.name,
      user_type: this.user_type,
    },
    env.ACCESS_TOKEN_SECRET,
    {
      expiresIn: env.ACCESS_TOKEN_EXPIRY || "15m",
    }
  );
};

UserSchema.methods.generateRefreshToken = function () {
  return jwt.sign(
    { _id: this._id },
    env.REFRESH_TOKEN_SECRET,
    {
      expiresIn: env.REFRESH_TOKEN_EXPIRY || "7d",
    }
  );
};

UserSchema.methods.generateEmailVerificationToken = function () {
  const token = jwt.sign(
    { _id: this._id, email: this.email },
    env.EMAIL_VERIFICATION_SECRET,
    { expiresIn: "24h" }
  );
  this.email_verification_token = token;
  this.email_verification_expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return token;
};

// virtual field for caching
UserSchema.virtual('_cached_subscription');

// Optimize the getCurrentSubscription method
UserSchema.methods.getCurrentSubscription = async function() {
  if (this._cached_subscription) return this._cached_subscription;
  
  const { Subscription } = await import('./index.js');
  this._cached_subscription = await Subscription.findOne({
    user_id: this._id,
    status: { $in: [enums.SUBSCRIPTION_STATUS.TRIAL, enums.SUBSCRIPTION_STATUS.ACTIVE, enums.SUBSCRIPTION_STATUS.LIFETIME] }
  }).populate('plan_id');
  
  return this._cached_subscription;
};

UserSchema.methods.hasActiveSubscription = async function() {
  const subscription = await this.getCurrentSubscription();
  return subscription?.isActive() || false;
};

UserSchema.methods.hasFeature = async function(feature) {
  const subscription = await this.getCurrentSubscription();
  if (!subscription?.isActive()) return false;
  
  const features = {
    basic_analytics: ['basic', 'advanced'],
    advanced_analytics: ['advanced'],
    api_access: subscription.plan_id?.features?.includes('api_access') || false
  };
  
  if (typeof features[feature] === 'boolean') return features[feature];
  return features[feature]?.includes(subscription.plan_id?.limits?.analytics_level);
};

UserSchema.methods.canPerformSearch = async function() {
  const subscription = await this.getCurrentSubscription();
  if (!subscription) return false;
  
  return subscription.canPerformSearch(subscription.plan_id?.limits);
};

UserSchema.methods.incrementUsage = async function(type = 'search') {
  const subscription = await this.getCurrentSubscription();
  if (subscription) {
    await subscription.incrementUsage(type);
  }
};

//  mongoDB Hooks 
UserSchema.pre('save', function () {
  if (this._refresh_token_plain) {
    this.refresh_token_enc = encrypt(this._refresh_token_plain);
    this._refresh_token_plain = undefined;
  }
});

UserSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

export const User = model('User', UserSchema);