import { APP_CONFIG } from '../config/app.config.js';

export class Logger {
  static log(...args) {
    if (APP_CONFIG.NODE_ENV === 'development') {
      console.log('[LOG]', ...args);
    }
  }

  static error(...args) {
    if (APP_CONFIG.NODE_ENV === 'development') {
      console.error('[ERROR]', ...args);
    }
  }

  static warn(...args) {
    if (APP_CONFIG.NODE_ENV === 'development') {
      console.warn('[WARN]', ...args);
    }
  }
}
