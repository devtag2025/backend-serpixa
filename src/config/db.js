import mongoose from 'mongoose';
import { APP_CONFIG } from './app.config.js';
import { Logger } from '../utils/logger.js';

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

const connectDB = async () => {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    cached.promise = mongoose.connect(APP_CONFIG.MONGODB_URI).then((mongoose) => {
      Logger.log(`MongoDB Connected: ${mongoose.connection.host}`);
      Logger.log(`Database: ${mongoose.connection.name}`);
      return mongoose;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (error) {
    cached.promise = null;
    Logger.error(`MongoDB Connection Error: ${error.message}`);
    throw error;
  }

  return cached.conn;
};

export default connectDB;
