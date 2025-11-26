import sgMail from "@sendgrid/mail";

import { emailConfig, env } from "../config/index.js";

class EmailService {
    async sendPasswordResetEmail(email, resetToken, data = {}) {
        const subject = "Reset your password";
        const html = this.passwordResetHTML(resetToken, data);
        return this.send(email, subject, html);
    }

    async sendEmailVerification(email, verificationToken, data = {}) {
        const subject = "Verify your email";
        const html = this.emailVerificationHTML(verificationToken, data);
        return this.send(email, subject, html);
    }

    async sendWelcomeEmail(email, data = {}) {
        const subject = "Welcome to Fitness Ad Campaign";
        const html = this.welcomeHTML(data);
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


    passwordResetHTML(resetToken, data = {}) {
        const resetUrl = `${env.CLIENT_URL}/reset-password?token=${encodeURIComponent(resetToken)}`;
        const name = data.userName || "there";
        return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:#1f2937;color:#fff;padding:24px;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:20px">Reset your password</h1>
  </div>
  <div style="background:#f8fafc;padding:24px;border-radius:0 0 8px 8px">
    <p style="color:#111827">Hi ${name},</p>
    <p style="color:#374151">Click the button below to reset your password.</p>
    <p style="text-align:center;margin:20px 0">
      <a href="${resetUrl}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none">Reset Password</a>
    </p>
    <p style="font-size:13px;color:#6b7280">This link expires in 1 hour.</p>
  </div>
</div>`;
    }

    emailVerificationHTML(verificationToken, data = {}) {
        const url = `${env.CLIENT_URL}/verify-email?token=${encodeURIComponent(verificationToken)}`;
        const name = data.userName || "there";
        return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:#2563eb;color:#fff;padding:24px;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:20px">Verify your email</h1>
  </div>
  <div style="background:#f8fafc;padding:24px;border-radius:0 0 8px 8px">
    <p style="color:#111827">Hi ${name},</p>
    <p style="color:#374151">Click the button below to verify your email.</p>
    <p style="text-align:center;margin:20px 0">
      <a href="${url}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none">Verify Email</a>
    </p>
    <p style="font-size:13px;color:#6b7280">This link expires in 24 hours.</p>
  </div>
</div>`;
    }

    welcomeHTML(data = {}) {
        const name = data.userName || "there";
        const dashboardUrl = `${env.CLIENT_URL}/dashboard`;
        return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:#111827;color:#fff;padding:24px;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:20px">Welcome to Fitness Ad Campaign</h1>
  </div>
  <div style="background:#f8fafc;padding:24px;border-radius:0 0 8px 8px">
    <p style="color:#111827">Hi ${name},</p>
    <p style="color:#374151">Your account is ready. You can now create and manage fitness advertising campaigns.</p>
    <p style="text-align:center;margin:20px 0">
      <a href="${dashboardUrl}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none">Go to Dashboard</a>
    </p>
  </div>
</div>`;
    }

}

export const emailService = new EmailService();
export const sendEmail = (options) => emailService.send(options.to, options.subject, options.html || options.text);