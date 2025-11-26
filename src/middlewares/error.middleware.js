import { APP_CONFIG } from '../config/app.config.js';
import { Logger } from '../utils/logger.js';

// 404 - Not Found Handler
export const notFoundHandler = (req, res, next) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
};

// Global Error Handler (catches all errors)
export const errorHandler = (err, req, res, next) => {
  Logger.error(err.stack);

  const statusCode = err.statusCode || 500;
  
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(APP_CONFIG.NODE_ENV === 'development' && { stack: err.stack }),
  });
};