import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const FAQSchema = new Schema({
  question: { type: String, required: true },
  answer: { type: String, required: true },
}, { _id: false });

const AIContentSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    keyword: {
      type: String,
      required: true,
      index: true,
    },
    locale: {
      type: String,
      required: true,
      enum: ['en-us', 'en-gb', 'fr-fr', 'fr-be', 'nl-nl', 'nl-be'],
      default: 'en-us',
    },
    metaTitle: {
      type: String,
      required: true,
    },
    metaDescription: {
      type: String,
      required: true,
    },
    htmlContent: {
      type: String,
      required: true,
    },
    faq: {
      type: [FAQSchema],
      default: [],
    },
    cta: {
      type: String,
      default: null,
    },
    seoScore: {
      type: Number,
      default: 75,
      min: 0,
      max: 100,
    },
    keywordDensity: {
      type: String,
      default: 'N/A',
    },
    wordCount: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['completed', 'failed'],
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
  }
);

AIContentSchema.index({ user: 1, createdAt: -1 });
AIContentSchema.index({ keyword: 1, createdAt: -1 });

export const AIContent = model('AIContent', AIContentSchema);