import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const RecommendationSchema = new Schema({
  priority: { type: String, enum: ['high', 'medium', 'low'] },
  issue: { type: String },
  action: { type: String },
}, { _id: false });

const CompetitorSchema = new Schema({
  position: { type: Number },
  name: { type: String },
  rating: { type: Number },
  reviews: { type: Number },
  distance: { type: String },
  address: { type: String },
  phone: { type: String },
  website: { type: String },
  category: { type: String },
  placeId: { type: String },
}, { _id: false });

const GeoAuditSchema = new Schema(
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
    location: {
      type: String,
      required: true,
    },
    keyword: {
      type: String,
      required: true,
    },
    localVisibilityScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    businessInfo: {
      name: { type: String, default: null },
      address: { type: String, default: null },
      phone: { type: String, default: null },
      website: { type: String, default: null },
      rating: { type: Number, default: null },
      reviews: { type: Number, default: 0 },
      category: { type: String, default: null },
      placeId: { type: String, default: null },
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
    },
    competitors: {
      type: [CompetitorSchema],
      default: [],
    },
    recommendations: {
      type: [RecommendationSchema],
      default: [],
    },
    napIssues: {
      nameConsistency: { type: Boolean, default: true },
      addressConsistency: { type: Boolean, default: true },
      phoneConsistency: { type: Boolean, default: true },
      issues: { type: [String], default: [] },
    },
    citationIssues: {
      missingCitations: { type: [String], default: [] },
      inconsistentData: { type: [String], default: [] },
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

GeoAuditSchema.index({ user: 1, createdAt: -1 });
GeoAuditSchema.index({ businessName: 'text' });
GeoAuditSchema.index({ location: 1 });

export const GeoAudit = model('GeoAudit', GeoAuditSchema);

