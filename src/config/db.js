import mongoose from 'mongoose';
import { env } from './index.js';
import { Logger } from '../utils/index.js';

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
    const conn = await mongoose.connect(env.MONGO_URI);
    Logger.log(`MongoDB Connected: ${conn.connection.host}`);
    Logger.log(`Database: ${conn.connection.name}`);
  } catch (error) {
    cached.promise = null;
    Logger.error(`MongoDB Connection Error: ${error.message}`);
    throw error;
  }

  return cached.conn;
};

export default connectDB;
