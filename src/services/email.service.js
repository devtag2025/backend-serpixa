import sgMail from "@sendgrid/mail";

import { emailConfig, env } from "../config/index.js";
import { getTranslation } from "../locales/index.js";
import { DEFAULT_LOCALE } from "../config/index.js";

class EmailService {
    /**
     * Get locale from data or default to 'en'
     */
    getLocale(data = {}) {
        return data.locale || data.language || DEFAULT_LOCALE;
    }

    async sendPasswordResetEmail(email, resetToken, data = {}) {
        const locale = this.getLocale(data);
        const t = (path, replacements = {}) => getTranslation(locale, path, replacements);
        
        const subject = t('email.passwordReset.subject');
        const html = this.passwordResetHTML(resetToken, data, locale);
        return this.send(email, subject, html);
    }

    async sendEmailVerification(email, verificationToken, data = {}) {
        const locale = this.getLocale(data);
        const t = (path, replacements = {}) => getTranslation(locale, path, replacements);
        
        const subject = t('email.emailVerification.subject');
        const html = this.emailVerificationHTML(verificationToken, data, locale);
        return this.send(email, subject, html);
    }

    async sendWelcomeEmail(email, data = {}) {
        const locale = this.getLocale(data);
        const t = (path, replacements = {}) => getTranslation(locale, path, replacements);
        
        const subject = t('email.welcome.subject');
        const html = this.welcomeHTML(data, locale);
        return this.send(email, subject, html);
    }

    async send(to, subject, html, retries = 0) {
        const maxRetries = emailConfig?.settings?.maxRetries ?? 3;
        const retryDelayMs = emailConfig?.settings?.retryDelay ?? 5000;

        const msg = {
            to,
            from: {
                name: emailConfig.from.name,
                email: emailConfig.from.address,
            },
            subject,
            html,
        };

        try {
            const result = await sgMail.send(msg);
            return result;
        } catch (err) {
            if (retries < maxRetries) {
                await new Promise((r) => setTimeout(r, retryDelayMs));
                return this.send(to, subject, html, retries + 1);
            }
            throw err;
        }
    }


    passwordResetHTML(resetToken, data = {}, locale = 'en') {
        const resetUrl = `${env.CLIENT_URL}/reset-password?token=${encodeURIComponent(resetToken)}`;
        const name = data.userName || "there";
        const t = (path, replacements = {}) => getTranslation(locale, path, replacements);
        
        const greeting = t('email.passwordReset.greeting', { name });
        const message = t('email.passwordReset.message');
        const buttonText = t('email.passwordReset.button');
        const expiry = t('email.passwordReset.expiry');
        const title = t('email.passwordReset.subject');
        
        return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:#1f2937;color:#fff;padding:24px;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:20px">${title}</h1>
  </div>
  <div style="background:#f8fafc;padding:24px;border-radius:0 0 8px 8px">
    <p style="color:#111827">${greeting}</p>
    <p style="color:#374151">${message}</p>
    <p style="text-align:center;margin:20px 0">
      <a href="${resetUrl}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none">${buttonText}</a>
    </p>
    <p style="font-size:13px;color:#6b7280">${expiry}</p>
  </div>
</div>`;
    }

    emailVerificationHTML(verificationToken, data = {}, locale = 'en') {
        const url = `${env.CLIENT_URL}/verify-email?token=${encodeURIComponent(verificationToken)}`;
        const name = data.userName || "there";
        const t = (path, replacements = {}) => getTranslation(locale, path, replacements);
        
        const greeting = t('email.emailVerification.greeting', { name });
        const message = t('email.emailVerification.message');
        const buttonText = t('email.emailVerification.button');
        const expiry = t('email.emailVerification.expiry');
        const title = t('email.emailVerification.subject');
        
        return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:#2563eb;color:#fff;padding:24px;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:20px">${title}</h1>
  </div>
  <div style="background:#f8fafc;padding:24px;border-radius:0 0 8px 8px">
    <p style="color:#111827">${greeting}</p>
    <p style="color:#374151">${message}</p>
    <p style="text-align:center;margin:20px 0">
      <a href="${url}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none">${buttonText}</a>
    </p>
    <p style="font-size:13px;color:#6b7280">${expiry}</p>
  </div>
</div>`;
    }

    welcomeHTML(data = {}, locale = 'en') {
        const name = data.userName || "there";
        const dashboardUrl = `${env.CLIENT_URL}/dashboard`;
        const t = (path, replacements = {}) => getTranslation(locale, path, replacements);
        
        const greeting = t('email.welcome.greeting', { name });
        const message = t('email.welcome.message');
        const buttonText = t('email.welcome.button');
        const title = t('email.welcome.subject');
        
        return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:#111827;color:#fff;padding:24px;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:20px">${title}</h1>
  </div>
  <div style="background:#f8fafc;padding:24px;border-radius:0 0 8px 8px">
    <p style="color:#111827">${greeting}</p>
    <p style="color:#374151">${message}</p>
    <p style="text-align:center;margin:20px 0">
      <a href="${dashboardUrl}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none">${buttonText}</a>
    </p>
  </div>
</div>`;
    }

}

export const emailService = new EmailService();
export const sendEmail = (options) => emailService.send(options.to, options.subject, options.html || options.text);