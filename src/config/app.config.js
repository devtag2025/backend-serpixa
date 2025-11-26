import 'dotenv/config';

export const APP_CONFIG = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  APP_PORT: process.env.PORT || 5000,
  MONGODB_URI: process.env.MONGODB_URI,
};
