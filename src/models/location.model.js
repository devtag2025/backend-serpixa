import mongoose from 'mongoose';

const LocationSchema = new mongoose.Schema(
  {
    locationCode: {
      type: Number,
      required: true,
      index: true,
    },
    locationName: {
      type: String,
      required: true,
      trim: true,
    },
    locationNameParent: {
      type: String,
      trim: true,
    },
    countryIsoCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    locationType: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    // Optional: raw object from DataForSEO for debugging / future fields
    raw: {
      type: Object,
    },
  },
  {
    timestamps: true,
  }
);

LocationSchema.index({ countryIsoCode: 1, locationCode: 1 }, { unique: true });
LocationSchema.index({ countryIsoCode: 1, locationName: 1 });

export const Location = mongoose.model('Location', LocationSchema);

