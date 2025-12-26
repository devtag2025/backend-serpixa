import mongoose from 'mongoose';
import { env } from './index.js';
import { Logger } from '../utils/index.js';

// Cache connection for serverless
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

const connectDB = async () => {
  // Return cached connection if available
  if (cached.conn) {
    return cached.conn;
  }

  // Create new connection if not cached
  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
    };

    cached.promise = mongoose.connect(env.MONGO_URI, opts).then((mongoose) => {
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
    throw error; // Don't exit, just throw for serverless
  }

  return cached.conn;
};

export default connectDB;
