import mongoose from 'mongoose';
import { env } from './index.js';
import { Logger } from '../utils/index.js';

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(env.MONGO_URI);
    Logger.log(`MongoDB Connected: ${conn.connection.host}`);
    Logger.log(`Database: ${conn.connection.name}`);
  } catch (error) {
    Logger.error(`MongoDB Connection Error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
