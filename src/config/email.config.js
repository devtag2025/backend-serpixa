// config/email.js
import sgMail from "@sendgrid/mail";
import { env } from "./env.config.js";
import { Logger } from "../utils/logger.js";

// Set SendGrid API key
if (env.SENDGRID_API_KEY) {
  sgMail.setApiKey(env.SENDGRID_API_KEY);
} else {
  Logger.warn('SENDGRID_API_KEY not configured. Email sending will fail.');
}

export const emailConfig = {
  from: {
    name: env.FROM_NAME || 'Serpixa',
    address: env.FROM_EMAIL || 'info@serpixa.eu',
  },

  settings: {
    maxRetries: 3,
    retryDelay: 5000,
  },
};
