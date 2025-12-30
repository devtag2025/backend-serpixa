import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const SettingsSchema = new Schema({
  key: { 
    type: String, 
    required: true, 
    unique: true,
    index: true 
  },
  value: { 
    type: Schema.Types.Mixed, 
    required: true 
  },
  category: {
    type: String,
    enum: ['general', 'localization', 'credits', 'cache', 'notifications'],
    default: 'general'
  },
  description: { 
    type: String 
  },
  is_sensitive: {
    type: Boolean,
    default: false
  },
  updated_by: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  versionKey: false
});

// Static method to get setting by key
SettingsSchema.statics.getSetting = async function(key, defaultValue = null) {
  const setting = await this.findOne({ key });
  return setting?.value ?? defaultValue;
};

// Static method to set setting
SettingsSchema.statics.setSetting = async function(key, value, options = {}) {
  return this.findOneAndUpdate(
    { key },
    { 
      key,
      value,
      ...options,
      updatedAt: new Date()
    },
    { upsert: true, new: true }
  );
};

// Static method to get all settings by category
SettingsSchema.statics.getByCategory = async function(category) {
  return this.find({ category }).lean();
};

export const Settings = model('Settings', SettingsSchema);