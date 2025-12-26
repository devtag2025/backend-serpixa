import mongoose from 'mongoose';
import { env } from './index.js';
import { Logger } from '../utils/index.js';

<<<<<<< Updated upstream
=======
// Cache connection for serverless
>>>>>>> Stashed changes
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

const connectDB = async () => {
<<<<<<< Updated upstream
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

=======
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

>>>>>>> Stashed changes
  return cached.conn;
};

export default connectDB;
