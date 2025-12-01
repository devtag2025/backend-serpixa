import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const RecommendationSchema = new Schema({
  priority: { type: String, enum: ['high', 'medium', 'low'] },
  issue: { type: String },
  action: { type: String },
}, { _id: false });

const SEOAuditSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    url: {
      type: String,
      required: true,
    },
    keyword: {
      type: String,
      required: true,
    },
    score: {
      type: Number,
      default: 0,
    },
    checks: {
      type: Schema.Types.Mixed,
      default: {},
    },
    recommendations: {
      type: [RecommendationSchema],
      default: [],
    },
    competitors: {
      type: [{
        position: Number,
        title: String,
        url: String,
        domain: String,
        description: String,
        breadcrumb: String,
      }],
      default: [],
    },
    serpInfo: {
      type: Schema.Types.Mixed,
      default: null,
    },
    raw_data: {
      type: Schema.Types.Mixed,
      default: null,
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed'],
      default: 'completed',
    },
    error_message: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(doc, ret) {
        delete ret.raw_data;
        return ret;
      },
    },
  }
);

SEOAuditSchema.index({ user: 1, createdAt: -1 });
SEOAuditSchema.index({ url: 1, createdAt: -1 });

export const SEOAudit = model('SEOAudit', SEOAuditSchema);