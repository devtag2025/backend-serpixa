import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const SupportTicketSchema = new Schema(
  {
    subject: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 200,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 2000,
    },
    name: {
      type: String,
      trim: true,
      default: null,
    },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

SupportTicketSchema.index({ createdAt: -1 });

export const SupportTicket = model('SupportTicket', SupportTicketSchema);
