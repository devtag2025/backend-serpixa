import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const RecommendationSchema = new Schema({
  priority: { type: String, enum: ['high', 'medium', 'low'] },
  issue: { type: String },
  action: { type: String },
}, { _id: false });

const ChecklistItemSchema = new Schema({
  field: { type: String },
  label: { type: String },
  completed: { type: Boolean, default: false },
  value: { type: Schema.Types.Mixed, default: null },
}, { _id: false });

const GBPAuditSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    businessName: {
      type: String,
      required: true,
    },
    gbpLink: {
      type: String,
      default: null,
    },
    locale: {
      type: String,
      default: 'en',
    },
    placeId: {
      type: String,
      default: null,
      index: true,
    },
    score: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    businessInfo: {
      name: { type: String, default: null },
      address: { type: String, default: null },
      addressComponents: { type: Schema.Types.Mixed, default: null },
      phone: { type: String, default: null },
      website: { type: String, default: null },
      category: { type: String, default: null },
      additionalCategories: { type: [String], default: [] },
      description: { type: String, default: null },
      hours: { type: Schema.Types.Mixed, default: null },
      rating: { type: Number, default: null },
      reviewCount: { type: Number, default: 0 },
      priceLevel: { type: String, default: null },
      attributes: { type: Schema.Types.Mixed, default: null },  // Changed from [String]
      photos: { type: Number, default: 0 },
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
    },
    checklist: {
      type: [ChecklistItemSchema],
      default: [],
    },
    recommendations: {
      type: [RecommendationSchema],
      default: [],
    },
    raw_data: {
      type: Schema.Types.Mixed,
      default: null,
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'not_found'],
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

GBPAuditSchema.index({ user: 1, createdAt: -1 });
GBPAuditSchema.index({ businessName: 'text' });

export const GBPAudit = model('GBPAudit', GBPAuditSchema);