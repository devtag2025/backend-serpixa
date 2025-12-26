import sgMail from "@sendgrid/mail";

import { emailConfig, env, getLocaleConfig } from "../config/index.js";
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

  /**
 * Get language code from audit locale
 */
  getLanguageFromLocale(locale) {
    const config = getLocaleConfig(locale);
    return config?.language || 'en';
  }

  /**
   * Send SEO Audit completion email
   */
  async sendSEOAuditEmail(email, data = {}) {
    const { audit, userName } = data;
    const locale = audit?.locale || DEFAULT_LOCALE;
    const lang = this.getLanguageFromLocale(locale);
    const t = (path, replacements = {}) => getTranslation(lang, path, replacements);

    const subject = t('email.seoAudit.subject', { url: audit.url });
    const html = this.seoAuditHTML(audit, userName, lang);

    return this.send(email, subject, html).catch(err => {
      // Log error but don't throw - email is non-critical
      console.error('Failed to send SEO audit email:', err.message);
    });
  }

  /**
   * Send GBP Audit completion email
   */
  async sendGBPAuditEmail(email, data = {}) {
    const { audit, userName } = data;
    const locale = audit?.locale || DEFAULT_LOCALE;
    const lang = this.getLanguageFromLocale(locale);
    const t = (path, replacements = {}) => getTranslation(lang, path, replacements);

    const subject = t('email.gbpAudit.subject', { businessName: audit.businessName });
    const html = this.gbpAuditHTML(audit, userName, lang);

    return this.send(email, subject, html).catch(err => {
      console.error('Failed to send GBP audit email:', err.message);
    });
  }

  /**
   * Send GEO Audit completion email
   */
  async sendGeoAuditEmail(email, data = {}) {
    const { audit, userName } = data;
    const locale = audit?.locale || DEFAULT_LOCALE;
    const lang = this.getLanguageFromLocale(locale);
    const t = (path, replacements = {}) => getTranslation(lang, path, replacements);

    const subject = t('email.geoAudit.subject', { keyword: audit.keyword });
    const html = this.geoAuditHTML(audit, userName, lang);

    return this.send(email, subject, html).catch(err => {
      console.error('Failed to send GEO audit email:', err.message);
    });
  }

  /**
   * SEO Audit Email HTML Template
   */
  seoAuditHTML(audit, userName, lang = 'en') {
    const t = (path, replacements = {}) => getTranslation(lang, path, replacements);
    const name = userName || 'there';
    const viewUrl = `${env.CLIENT_URL}/dashboard/seo-audits/${audit._id}`;

    // Get top 3 critical/high priority recommendations
    const topIssues = (audit.recommendations || [])
      .filter(r => r.priority === 'critical' || r.priority === 'high')
      .slice(0, 3);

    const issuesHtml = topIssues.length > 0
      ? topIssues.map(r => `<li style="margin-bottom:8px;color:#374151">${r.issue}</li>`).join('')
      : `<li style="color:#059669">${t('email.seoAudit.noIssues')}</li>`;

    const scoreColor = audit.score >= 80 ? '#059669' : audit.score >= 50 ? '#d97706' : '#dc2626';

    return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f8fafc">
<div style="background:linear-gradient(135deg,#1e40af 0%,#3b82f6 100%);color:#fff;padding:32px;border-radius:12px 12px 0 0;text-align:center">
  <h1 style="margin:0 0 8px 0;font-size:24px">📊 ${t('email.seoAudit.subject', { url: '' }).replace(' - ', '')}</h1>
  <p style="margin:0;opacity:0.9;font-size:14px">${audit.url}</p>
</div>

<div style="background:#fff;padding:32px;border-radius:0 0 12px 12px;box-shadow:0 4px 6px rgba(0,0,0,0.05)">
  <p style="color:#111827;font-size:16px;margin-bottom:24px">${t('email.seoAudit.greeting', { name })}</p>
  <p style="color:#374151;margin-bottom:24px">${t('email.seoAudit.intro', { url: audit.url })}</p>
  
  <!-- Score Card -->
  <div style="background:#f8fafc;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;border:1px solid #e5e7eb">
    <p style="margin:0 0 8px 0;color:#6b7280;font-size:14px;text-transform:uppercase;letter-spacing:1px">${t('email.seoAudit.scoreLabel')}</p>
    <p style="margin:0;font-size:48px;font-weight:bold;color:${scoreColor}">${audit.score}<span style="font-size:24px;color:#9ca3af">/100</span></p>
  </div>

  <!-- Keyword -->
  <div style="background:#eff6ff;border-radius:8px;padding:16px;margin-bottom:24px;border-left:4px solid #3b82f6">
    <p style="margin:0;color:#1e40af;font-size:14px"><strong>${t('email.seoAudit.keywordLabel')}:</strong> ${audit.keyword}</p>
  </div>
  
  <!-- Top Issues -->
  <div style="margin-bottom:24px">
    <p style="color:#111827;font-weight:600;margin-bottom:12px">${t('email.seoAudit.topIssuesLabel')}:</p>
    <ul style="margin:0;padding-left:20px">${issuesHtml}</ul>
  </div>
  
  <!-- CTA Button -->
  <p style="text-align:center;margin:32px 0">
    <a href="${viewUrl}" style="background:linear-gradient(135deg,#2563eb 0%,#1d4ed8 100%);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;box-shadow:0 4px 6px rgba(37,99,235,0.25)">${t('email.seoAudit.viewButton')}</a>
  </p>
  
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0">${t('email.seoAudit.footer')}</p>
</div>
</div>`;
  }

  /**
   * GBP Audit Email HTML Template
   */
  gbpAuditHTML(audit, userName, lang = 'en') {
    const t = (path, replacements = {}) => getTranslation(lang, path, replacements);
    const name = userName || 'there';
    const viewUrl = `${env.CLIENT_URL}/dashboard/gbp-audits/${audit._id}`;
    const isFound = audit.status === 'completed';

    const topIssues = (audit.recommendations || [])
      .filter(r => r.priority === 'critical' || r.priority === 'high')
      .slice(0, 3);

    const issuesHtml = topIssues.length > 0
      ? topIssues.map(r => `<li style="margin-bottom:8px;color:#374151">${r.issue}</li>`).join('')
      : `<li style="color:#059669">${t('email.gbpAudit.noIssues')}</li>`;

    const scoreColor = audit.score >= 80 ? '#059669' : audit.score >= 50 ? '#d97706' : '#dc2626';
    const statusText = isFound ? t('email.gbpAudit.statusFound') : t('email.gbpAudit.statusNotFound');
    const statusColor = isFound ? '#059669' : '#dc2626';

    return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f8fafc">
<div style="background:linear-gradient(135deg,#059669 0%,#10b981 100%);color:#fff;padding:32px;border-radius:12px 12px 0 0;text-align:center">
  <h1 style="margin:0 0 8px 0;font-size:24px">🏢 ${t('email.gbpAudit.subject', { businessName: '' }).replace(' - ', '')}</h1>
  <p style="margin:0;opacity:0.9;font-size:14px">${audit.businessName}</p>
</div>

<div style="background:#fff;padding:32px;border-radius:0 0 12px 12px;box-shadow:0 4px 6px rgba(0,0,0,0.05)">
  <p style="color:#111827;font-size:16px;margin-bottom:24px">${t('email.gbpAudit.greeting', { name })}</p>
  <p style="color:#374151;margin-bottom:24px">${t('email.gbpAudit.intro', { businessName: audit.businessName })}</p>
  
  <!-- Score & Status -->
  <div style="display:flex;gap:16px;margin-bottom:24px">
    <div style="flex:1;background:#f8fafc;border-radius:12px;padding:20px;text-align:center;border:1px solid #e5e7eb">
      <p style="margin:0 0 4px 0;color:#6b7280;font-size:12px;text-transform:uppercase">${t('email.gbpAudit.scoreLabel')}</p>
      <p style="margin:0;font-size:36px;font-weight:bold;color:${scoreColor}">${audit.score}%</p>
    </div>
    <div style="flex:1;background:#f8fafc;border-radius:12px;padding:20px;text-align:center;border:1px solid #e5e7eb">
      <p style="margin:0 0 4px 0;color:#6b7280;font-size:12px;text-transform:uppercase">${t('email.gbpAudit.statusLabel')}</p>
      <p style="margin:0;font-size:16px;font-weight:bold;color:${statusColor}">${statusText}</p>
    </div>
  </div>
  
  <!-- Top Issues -->
  <div style="margin-bottom:24px">
    <p style="color:#111827;font-weight:600;margin-bottom:12px">${t('email.gbpAudit.topIssuesLabel')}:</p>
    <ul style="margin:0;padding-left:20px">${issuesHtml}</ul>
  </div>
  
  <!-- CTA Button -->
  <p style="text-align:center;margin:32px 0">
    <a href="${viewUrl}" style="background:linear-gradient(135deg,#059669 0%,#047857 100%);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;box-shadow:0 4px 6px rgba(5,150,105,0.25)">${t('email.gbpAudit.viewButton')}</a>
  </p>
  
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0">${t('email.gbpAudit.footer')}</p>
</div>
</div>`;
  }

  /**
   * GEO Audit Email HTML Template
   */
  geoAuditHTML(audit, userName, lang = 'en') {
    const t = (path, replacements = {}) => getTranslation(lang, path, replacements);
    const name = userName || 'there';
    const viewUrl = `${env.CLIENT_URL}/dashboard/geo-audits/${audit._id}`;
    const location = audit.location || 'your area';

    const topIssues = (audit.recommendations || [])
      .filter(r => r.priority === 'critical' || r.priority === 'high')
      .slice(0, 3);

    const issuesHtml = topIssues.length > 0
      ? topIssues.map(r => `<li style="margin-bottom:8px;color:#374151">${r.issue}</li>`).join('')
      : `<li style="color:#059669">${t('email.geoAudit.noIssues')}</li>`;

    const score = audit.localVisibilityScore || 0;
    const scoreColor = score >= 80 ? '#059669' : score >= 50 ? '#d97706' : '#dc2626';
    const competitorCount = (audit.competitors || []).length;

    return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f8fafc">
<div style="background:linear-gradient(135deg,#7c3aed 0%,#a855f7 100%);color:#fff;padding:32px;border-radius:12px 12px 0 0;text-align:center">
  <h1 style="margin:0 0 8px 0;font-size:24px">📍 ${t('email.geoAudit.subject', { keyword: '' }).replace(' - ', '')}</h1>
  <p style="margin:0;opacity:0.9;font-size:14px">"${audit.keyword}" in ${location}</p>
</div>

<div style="background:#fff;padding:32px;border-radius:0 0 12px 12px;box-shadow:0 4px 6px rgba(0,0,0,0.05)">
  <p style="color:#111827;font-size:16px;margin-bottom:24px">${t('email.geoAudit.greeting', { name })}</p>
  <p style="color:#374151;margin-bottom:24px">${t('email.geoAudit.intro', { keyword: audit.keyword, location })}</p>
  
  <!-- Score & Competitors -->
  <div style="display:flex;gap:16px;margin-bottom:24px">
    <div style="flex:1;background:#f8fafc;border-radius:12px;padding:20px;text-align:center;border:1px solid #e5e7eb">
      <p style="margin:0 0 4px 0;color:#6b7280;font-size:12px;text-transform:uppercase">${t('email.geoAudit.scoreLabel')}</p>
      <p style="margin:0;font-size:36px;font-weight:bold;color:${scoreColor}">${score}%</p>
    </div>
    <div style="flex:1;background:#f8fafc;border-radius:12px;padding:20px;text-align:center;border:1px solid #e5e7eb">
      <p style="margin:0 0 4px 0;color:#6b7280;font-size:12px;text-transform:uppercase">${t('email.geoAudit.competitorsLabel')}</p>
      <p style="margin:0;font-size:36px;font-weight:bold;color:#6366f1">${competitorCount}</p>
    </div>
  </div>
  
  <!-- Top Issues -->
  <div style="margin-bottom:24px">
    <p style="color:#111827;font-weight:600;margin-bottom:12px">${t('email.geoAudit.topIssuesLabel')}:</p>
    <ul style="margin:0;padding-left:20px">${issuesHtml}</ul>
  </div>
  
  <!-- CTA Button -->
  <p style="text-align:center;margin:32px 0">
    <a href="${viewUrl}" style="background:linear-gradient(135deg,#7c3aed 0%,#6d28d9 100%);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;box-shadow:0 4px 6px rgba(124,58,237,0.25)">${t('email.geoAudit.viewButton')}</a>
  </p>
  
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0">${t('email.geoAudit.footer')}</p>
</div>
</div>`;
  }



}

export const emailService = new EmailService();
export const sendEmail = (options) => emailService.send(options.to, options.subject, options.html || options.text);