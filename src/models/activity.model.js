import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const ActivityLogSchema = new Schema({
  user_id: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  action: {
    type: String,
    required: true,
    enum: [
      'login',
      'logout',
      'password_change',
      'profile_update',
      'subscription_created',
      'subscription_cancelled',
      'subscription_upgraded',
      'audit_seo_created',
      'audit_geo_created',
      'audit_gbp_created',
      'ai_generation',
      'credits_purchased',
      'credits_adjusted',
      'account_suspended',
      'account_reactivated'
    ],
    index: true
  },
  details: {
    type: Schema.Types.Mixed,
    default: {}
  },
  ip_address: {
    type: String
  },
  user_agent: {
    type: String
  },
  performed_by: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null // null means self, otherwise admin who performed action
  }
}, {
  timestamps: true,
  versionKey: false
});

// Index for efficient queries
ActivityLogSchema.index({ user_id: 1, createdAt: -1 });
ActivityLogSchema.index({ action: 1, createdAt: -1 });

// Static method to log activity
ActivityLogSchema.statics.log = async function(data) {
  return this.create(data);
};

// Static method to get recent activity for user
ActivityLogSchema.statics.getRecentByUser = async function(userId, limit = 50) {
  return this.find({ user_id: userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
};

export const ActivityLog = model('ActivityLog', ActivityLogSchema);