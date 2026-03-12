import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const ContactSubmissionSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    website: {
      type: String,
      trim: true,
      default: null,
      maxlength: 500,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 5000,
    },
    locale: {
      type: String,
      enum: ['en', 'fr', 'nl'],
      default: 'en',
    },
    status: {
      type: String,
      enum: ['new', 'read', 'replied'],
      default: 'new',
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

ContactSubmissionSchema.index({ createdAt: -1 });
ContactSubmissionSchema.index({ email: 1, createdAt: -1 });

export const ContactSubmission = model('ContactSubmission', ContactSubmissionSchema);
