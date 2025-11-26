import mongoose from 'mongoose';
import { APP_CONFIG } from './app.config.js';
import { Logger } from '../utils/logger.js';

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(APP_CONFIG.MONGODB_URI);
    Logger.log(`MongoDB Connected: ${conn.connection.host}`);
    Logger.log(`Database: ${conn.connection.name}`);
  } catch (error) {
    Logger.error(`MongoDB Connection Error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
