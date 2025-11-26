import 'dotenv/config';

import app from './app.js';
import connectDB from './config/db.js';
import { env } from './config/index.js';
import { Logger } from './utils/index.js';

const PORT = env.PORT;

// Graceful shutdown handler
const gracefulShutdown = (signal) => {
  Logger.log(`${signal} received. Shutting down gracefully...`);
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
const startServer = async () => {
  try {
    await connectDB();

    const server = app.listen(PORT, () => {
      Logger.log(`Server running on http://localhost:${PORT}`);
      Logger.log(`Environment: ${env.NODE_ENV}`);
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        Logger.error(`Port ${PORT} is already in use`);
        process.exit(1);
      }
      throw error;
    });
  } catch (error) {
    Logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
