import { env } from '../config/index.js';

export class Logger {
  static log(...args) {
    if (env.NODE_ENV === 'development') {
      console.log('[LOG]', ...args);
    }
  }

  static error(...args) {
    // Always log errors, not just in development
    console.error('[ERROR]', ...args);
  }

  static warn(...args) {
    if (env.NODE_ENV === 'development') {
      console.warn('[WARN]', ...args);
    }
  }
}
