// config/email.js
import sgMail from "@sendgrid/mail";
import { env } from "./env.config.js";

sgMail.setApiKey(env.SENDGRID_API_KEY);

export const emailConfig = {
  from: {
    name: env.FROM_NAME,
    address: env.FROM_EMAIL,
  },

  settings: {
    maxRetries: 3,
    retryDelay: 5000,
  },
};
