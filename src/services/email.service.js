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

   /**
   * Format date based on locale
   */
  formatDate(date, locale = 'en') {
    if (!date) return '';
    const localeMap = {
      'en': 'en-US',
      'fr': 'fr-FR',
      'nl': 'nl-NL'
    };
    return new Date(date).toLocaleDateString(localeMap[locale] || 'en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  /**
   * Format currency based on locale
   */
  formatCurrency(amount, currency = 'USD', locale = 'en') {
    if (amount === null || amount === undefined) return '';
    const localeMap = {
      'en': 'en-US',
      'fr': 'fr-FR',
      'nl': 'nl-NL'
    };
    return new Intl.NumberFormat(localeMap[locale] || 'en-US', {
      style: 'currency',
      currency: currency.toUpperCase()
    }).format(amount);
  }

   /**
   * Get billing period translation
   */
  getBillingPeriodLabel(period, locale = 'en') {
    const periodMap = {
      'en': { 'monthly': 'month', 'yearly': 'year', 'one_time': 'one-time' },
      'fr': { 'monthly': 'mois', 'yearly': 'an', 'one_time': 'unique' },
      'nl': { 'monthly': 'maand', 'yearly': 'jaar', 'one_time': 'eenmalig' }
    };
    return periodMap[locale]?.[period] || period;
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
        // Get locale from data, or use user's preferred_locale if available
        let locale = data.locale || data.preferred_locale || DEFAULT_LOCALE;
        
        // Handle simple locale format (en, fr, nl) - convert to language code directly
        // getLanguageFromLocale expects full locale format (en-us, fr-fr, etc.)
        // For simple format, use it directly as language code
        let lang;
        if (['en', 'fr', 'nl'].includes(locale.toLowerCase())) {
            lang = locale.toLowerCase();
        } else {
            // For full locale format, use getLanguageFromLocale
            lang = this.getLanguageFromLocale(locale);
        }
        
        const t = (path, replacements = {}) => getTranslation(lang, path, replacements);
        
        const subject = t('email.welcome.subject');
        const html = this.welcomeHTML(data, lang);
        return this.send(email, subject, html);
    }

  /**
   * Send support ticket to team (internal email, uses en)
   * @param {object} data - { subject, email, message, name, userId? }
   */
  async sendSupportTicketToTeam(data = {}) {
    const { subject, email, message, name, userId } = data;
    const to = env.SUPPORT_EMAIL || env.FROM_EMAIL;
    const t = (path, replacements = {}) => getTranslation('en', path, replacements);
    const emailSubject = t('email.supportTicket.subject', { subject: subject || '(no subject)' });
    const html = this.supportTicketToTeamHTML(data);
    return this.send(to, emailSubject, html).catch((err) => {
      console.error('Failed to send support ticket email to team:', err?.message || err);
    });
  }

  supportTicketToTeamHTML(data = {}) {
    const { subject, email, message, name, userId } = data;
    const t = (path, replacements = {}) => getTranslation('en', path, replacements);
    const fromLabel = t('email.supportTicket.fromLabel');
    const emailLabel = t('email.supportTicket.emailLabel');
    const messageLabel = t('email.supportTicket.messageLabel');
    const dateLabel = t('email.supportTicket.dateLabel');
    const userIdLabel = t('email.supportTicket.userIdLabel');
    const displayName = name || '(not provided)';
    const date = new Date().toISOString();
    const userRow = userId
      ? `<tr><td style="padding:8px 0;color:#6b7280">${userIdLabel}</td><td style="padding:8px 0;color:#111827">${userId}</td></tr>`
      : '';

    return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:#1f2937;color:#fff;padding:24px;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:20px;color:#ffffff">[Serpixa] Support Request</h1>
  </div>
  <div style="background:#f8fafc;padding:24px;border-radius:0 0 8px 8px">
    <p style="color:#111827;font-weight:600;margin-bottom:16px">${subject || '(no subject)'}</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <tr><td style="padding:8px 0;color:#6b7280">${fromLabel}</td><td style="padding:8px 0;color:#111827">${displayName}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280">${emailLabel}</td><td style="padding:8px 0;color:#111827">${email}</td></tr>
      ${userRow}
      <tr><td style="padding:8px 0;color:#6b7280">${dateLabel}</td><td style="padding:8px 0;color:#111827">${date}</td></tr>
    </table>
    <p style="color:#6b7280;font-size:14px;margin-bottom:8px">${messageLabel}</p>
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;color:#374151;white-space:pre-wrap">${(message || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
  </div>
</div>`;
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
    <h1 style="margin:0;font-size:20px;color:#ffffff">${title}</h1>
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
    <h1 style="margin:0;font-size:20px;color:#ffffff">${title}</h1>
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

  welcomeHTML(data = {}, lang = 'en') {
    const name = data.userName || "there";
    const dashboardUrl = `${env.CLIENT_URL}/dashboard`;
    const t = (path, replacements = {}) => getTranslation(lang, path, replacements);

    const greeting = t('email.welcome.greeting', { name });
    const message = t('email.welcome.message');
    const buttonText = t('email.welcome.button');
    const title = t('email.welcome.subject');

    return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:#111827;color:#fff;padding:24px;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:20px;color:#ffffff">${title}</h1>
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

  /**
   * SEO Audit Email HTML Template
   */
  seoAuditHTML(audit, userName, lang = 'en') {
    const t = (path, replacements = {}) => getTranslation(lang, path, replacements);
    const name = userName || 'there';
    const viewUrl = `${env.CLIENT_URL}/dashboard/seo-audit/${audit._id}`;

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
  <h1 style="margin:0 0 8px 0;font-size:24px;color:#ffffff">📊 ${t('email.seoAudit.subject', { url: '' }).replace(' - ', '')}</h1>
  <p style="margin:0;opacity:0.9;font-size:14px;color:#ffffff">${audit.url}</p>
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
    const viewUrl = `${env.CLIENT_URL}/dashboard/gbp-audit/${audit._id}`;
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
  <h1 style="margin:0 0 8px 0;font-size:24px;color:#ffffff">🏢 ${t('email.gbpAudit.subject', { businessName: '' }).replace(' - ', '')}</h1>
  <p style="margin:0;opacity:0.9;font-size:14px;color:#ffffff">${audit.businessName}</p>
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
    const viewUrl = `${env.CLIENT_URL}/dashboard/local-seo/${audit._id}`;
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
  <h1 style="margin:0 0 8px 0;font-size:24px;color:#ffffff">📍 ${t('email.geoAudit.subject', { keyword: '' }).replace(' - ', '')}</h1>
  <p style="margin:0;opacity:0.9;font-size:14px;color:#ffffff">"${audit.keyword}" in ${location}</p>
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

  // ===== SUBSCRIPTION EMAIL METHODS (Multi-Locale) =====

  /**
   * Send subscription activated email
   * @param {string} email - User's email
   * @param {object} data - { userName, planName, plan, subscription, locale }
   */
  async sendSubscriptionActivatedEmail(email, data = {}) {
    const locale = this.getLocale(data);
    const t = (path, replacements = {}) => getTranslation(locale, path, replacements);

    const { planName } = data;
    const subject = t('email.subscription.activated.subject', { planName });
    const html = this.subscriptionActivatedHTML(data, locale);

    return this.send(email, subject, html).catch(err => {
      console.error('Failed to send subscription activated email:', err.message);
    });
  }

  /**
   * Send subscription renewed email
   */
  async sendSubscriptionRenewedEmail(email, data = {}) {
    const locale = this.getLocale(data);
    const t = (path, replacements = {}) => getTranslation(locale, path, replacements);

    const { planName } = data;
    const subject = t('email.subscription.renewed.subject', { planName });
    const html = this.subscriptionRenewedHTML(data, locale);

    return this.send(email, subject, html).catch(err => {
      console.error('Failed to send subscription renewed email:', err.message);
    });
  }

  /**
   * Send subscription cancelled email
   */
  async sendSubscriptionCancelledEmail(email, data = {}) {
    const locale = this.getLocale(data);
    const t = (path, replacements = {}) => getTranslation(locale, path, replacements);

    const subject = t('email.subscription.cancelled.subject');
    const html = this.subscriptionCancelledHTML(data, locale);

    return this.send(email, subject, html).catch(err => {
      console.error('Failed to send subscription cancelled email:', err.message);
    });
  }

  /**
   * Send refund processed email
   */
  async sendRefundProcessedEmail(email, data = {}) {
    const locale = this.getLocale(data);
    const t = (path, replacements = {}) => getTranslation(locale, path, replacements);

    const { amount, currency } = data;
    const formattedAmount = this.formatCurrency(amount, currency, locale);
    const subject = t('email.subscription.refunded.subject', { 
      amount: formattedAmount, 
      currency: currency?.toUpperCase() || 'USD' 
    });
    const html = this.refundProcessedHTML(data, locale);

    return this.send(email, subject, html).catch(err => {
      console.error('Failed to send refund processed email:', err.message);
    });
  }

  /**
   * Send payment failed email
   */
  async sendPaymentFailedEmail(email, data = {}) {
    const locale = this.getLocale(data);
    const t = (path, replacements = {}) => getTranslation(locale, path, replacements);

    const subject = t('email.subscription.paymentFailed.subject');
    const html = this.paymentFailedHTML(data, locale);

    return this.send(email, subject, html).catch(err => {
      console.error('Failed to send payment failed email:', err.message);
    });
  }

  /**
   * Send subscription plan changed email (upgrade/downgrade)
   */
  async sendSubscriptionPlanChangedEmail(email, data = {}) {
    const locale = this.getLocale(data);
    const t = (path, replacements = {}) => getTranslation(locale, path, replacements);

    const { newPlanName } = data;
    const subject = t('email.subscription.planChanged.subject', { newPlanName });
    const html = this.subscriptionPlanChangedHTML(data, locale);

    return this.send(email, subject, html).catch(err => {
      console.error('Failed to send plan changed email:', err.message);
    });
  }

  /**
   * Send addon/credit pack purchased email
   */
  async sendAddonPurchasedEmail(email, data = {}) {
    const locale = this.getLocale(data);
    const t = (path, replacements = {}) => getTranslation(locale, path, replacements);

    const { planName } = data;
    const subject = t('email.subscription.addonPurchased.subject', { planName });
    const html = this.addonPurchasedHTML(data, locale);

    return this.send(email, subject, html).catch(err => {
      console.error('Failed to send addon purchased email:', err.message);
    });
  }

  // ===== SUBSCRIPTION EMAIL HTML TEMPLATES (Multi-Locale) =====

  /**
   * Subscription Activated Email HTML
   */
  subscriptionActivatedHTML(data, locale = 'en') {
    const t = (path, replacements = {}) => getTranslation(locale, path, replacements);
    const { userName, planName, plan, subscription } = data;
    const name = userName || 'there';
    const dashboardUrl = `${env.CLIENT_URL}/dashboard`;

    const price = plan?.price ? this.formatCurrency(plan.price / 100, plan.currency || 'USD', locale) : '';
    const period = this.getBillingPeriodLabel(plan?.billing_period || 'monthly', locale);
    const nextBilling = this.formatDate(subscription?.current_period_end, locale);

    // Build credits section
    const limits = plan?.limits || {};
    const creditsHtml = `
      <div style="background:#f0fdf4;border-radius:8px;padding:16px;margin:16px 0">
        <p style="margin:0 0 12px 0;color:#166534;font-weight:600">${t('email.subscription.activated.creditsLabel')}</p>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">
          ${limits.seo_audits ? `<div style="color:#374151">✓ ${limits.seo_audits} ${t('email.subscription.activated.seoAuditsLabel')}</div>` : ''}
          ${limits.geo_audits ? `<div style="color:#374151">✓ ${limits.geo_audits} ${t('email.subscription.activated.geoAuditsLabel')}</div>` : ''}
          ${limits.gbp_audits ? `<div style="color:#374151">✓ ${limits.gbp_audits} ${t('email.subscription.activated.gbpAuditsLabel')}</div>` : ''}
          ${limits.ai_generations ? `<div style="color:#374151">✓ ${limits.ai_generations} ${t('email.subscription.activated.aiGenerationsLabel')}</div>` : ''}
        </div>
      </div>
    `;

    return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f8fafc">
  <div style="background:linear-gradient(135deg,#059669 0%,#10b981 100%);color:#fff;padding:32px;border-radius:12px 12px 0 0;text-align:center">
    <div style="font-size:48px;margin-bottom:8px">🎉</div>
    <h1 style="margin:0 0 8px 0;font-size:24px;color:#ffffff">${t('email.subscription.activated.subject', { planName })}</h1>
  </div>

  <div style="background:#fff;padding:32px;border-radius:0 0 12px 12px;box-shadow:0 4px 6px rgba(0,0,0,0.05)">
    <p style="color:#111827;font-size:16px;margin-bottom:16px">${t('email.subscription.activated.greeting', { name })}</p>
    <p style="color:#374151;margin-bottom:24px">${t('email.subscription.activated.intro', { planName })}</p>
    
    <!-- Subscription Details -->
    <div style="background:#f8fafc;border-radius:12px;padding:20px;margin-bottom:20px;border:1px solid #e5e7eb">
      <p style="margin:0 0 16px 0;color:#111827;font-weight:600">${t('email.subscription.activated.detailsLabel')}</p>
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="padding:8px 0;color:#6b7280">${t('email.subscription.activated.planLabel')}</td>
          <td style="padding:8px 0;color:#111827;font-weight:600;text-align:right">${planName}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#6b7280">${t('email.subscription.activated.priceLabel')}</td>
          <td style="padding:8px 0;color:#111827;font-weight:600;text-align:right">${price}/${period}</td>
        </tr>
        ${nextBilling ? `
        <tr>
          <td style="padding:8px 0;color:#6b7280">${t('email.subscription.activated.nextBillingLabel')}</td>
          <td style="padding:8px 0;color:#111827;text-align:right">${nextBilling}</td>
        </tr>` : ''}
      </table>
    </div>
    
    ${creditsHtml}
    
    <!-- CTA Button -->
    <p style="text-align:center;margin:32px 0">
      <a href="${dashboardUrl}" style="background:linear-gradient(135deg,#059669 0%,#047857 100%);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;box-shadow:0 4px 6px rgba(5,150,105,0.25)">${t('email.subscription.activated.getStartedButton')}</a>
    </p>
    
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0">${t('email.subscription.activated.footer')}</p>
  </div>
</div>`;
  }

  /**
   * Subscription Renewed Email HTML
   */
  subscriptionRenewedHTML(data, locale = 'en') {
    const t = (path, replacements = {}) => getTranslation(locale, path, replacements);
    const { userName, planName, amount, currency, periodStart, periodEnd } = data;
    const name = userName || 'there';
    const dashboardUrl = `${env.CLIENT_URL}/dashboard`;

    const formattedAmount = this.formatCurrency(amount, currency || 'USD', locale);
    const startDate = this.formatDate(periodStart, locale);
    const endDate = this.formatDate(periodEnd, locale);

    return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f8fafc">
  <div style="background:linear-gradient(135deg,#2563eb 0%,#3b82f6 100%);color:#fff;padding:32px;border-radius:12px 12px 0 0;text-align:center">
    <div style="font-size:48px;margin-bottom:8px">✅</div>
    <h1 style="margin:0 0 8px 0;font-size:24px;color:#ffffff">${t('email.subscription.renewed.subject', { planName })}</h1>
  </div>

  <div style="background:#fff;padding:32px;border-radius:0 0 12px 12px;box-shadow:0 4px 6px rgba(0,0,0,0.05)">
    <p style="color:#111827;font-size:16px;margin-bottom:16px">${t('email.subscription.renewed.greeting', { name })}</p>
    <p style="color:#374151;margin-bottom:24px">${t('email.subscription.renewed.intro', { planName })}</p>
    
    <!-- Renewal Details -->
    <div style="background:#f8fafc;border-radius:12px;padding:20px;margin-bottom:20px;border:1px solid #e5e7eb">
      <p style="margin:0 0 16px 0;color:#111827;font-weight:600">${t('email.subscription.renewed.detailsLabel')}</p>
      <table style="width:100%;border-collapse:collapse">
        ${formattedAmount ? `
        <tr>
          <td style="padding:8px 0;color:#6b7280">${t('email.subscription.renewed.amountLabel')}</td>
          <td style="padding:8px 0;color:#111827;font-weight:600;text-align:right">${formattedAmount}</td>
        </tr>` : ''}
        ${startDate && endDate ? `
        <tr>
          <td style="padding:8px 0;color:#6b7280">${t('email.subscription.renewed.periodLabel')}</td>
          <td style="padding:8px 0;color:#111827;text-align:right">${startDate} - ${endDate}</td>
        </tr>` : ''}
        ${endDate ? `
        <tr>
          <td style="padding:8px 0;color:#6b7280">${t('email.subscription.renewed.nextBillingLabel')}</td>
          <td style="padding:8px 0;color:#111827;text-align:right">${endDate}</td>
        </tr>` : ''}
      </table>
    </div>
    
    <!-- Credits Reset Notice -->
    <div style="background:#f0fdf4;border-radius:8px;padding:16px;margin-bottom:24px;border-left:4px solid #10b981">
      <p style="margin:0;color:#166534;font-weight:500">🔄 ${t('email.subscription.renewed.creditsResetLabel')}</p>
    </div>
    
    <!-- CTA Button -->
    <p style="text-align:center;margin:32px 0">
      <a href="${dashboardUrl}" style="background:linear-gradient(135deg,#2563eb 0%,#1d4ed8 100%);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;box-shadow:0 4px 6px rgba(37,99,235,0.25)">${t('email.subscription.renewed.viewDashboardButton')}</a>
    </p>
    
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0">${t('email.subscription.renewed.footer')}</p>
  </div>
</div>`;
  }

  /**
   * Subscription Cancelled Email HTML
   */
  subscriptionCancelledHTML(data, locale = 'en') {
    const t = (path, replacements = {}) => getTranslation(locale, path, replacements);
    const { userName, planName, immediate, endDate } = data;
    const name = userName || 'there';
    const pricingUrl = `${env.CLIENT_URL}/pricing`;

    const formattedEndDate = this.formatDate(endDate, locale);

    const messageContent = immediate 
      ? t('email.subscription.cancelled.immediateMessage')
      : t('email.subscription.cancelled.endOfPeriodMessage', { endDate: formattedEndDate });

    return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f8fafc">
  <div style="background:linear-gradient(135deg,#6b7280 0%,#9ca3af 100%);color:#fff;padding:32px;border-radius:12px 12px 0 0;text-align:center">
    <div style="font-size:48px;margin-bottom:8px">😢</div>
    <h1 style="margin:0 0 8px 0;font-size:24px;color:#ffffff">${t('email.subscription.cancelled.subject')}</h1>
  </div>

  <div style="background:#fff;padding:32px;border-radius:0 0 12px 12px;box-shadow:0 4px 6px rgba(0,0,0,0.05)">
    <p style="color:#111827;font-size:16px;margin-bottom:16px">${t('email.subscription.cancelled.greeting', { name })}</p>
    <p style="color:#374151;margin-bottom:16px">${t('email.subscription.cancelled.intro', { planName })}</p>
    <p style="color:#374151;margin-bottom:24px">${messageContent}</p>
    
    ${!immediate && formattedEndDate ? `
    <!-- Access Until -->
    <div style="background:#fef3c7;border-radius:8px;padding:16px;margin-bottom:24px;border-left:4px solid #f59e0b">
      <p style="margin:0;color:#92400e">
        <strong>${t('email.subscription.cancelled.accessUntilLabel')}:</strong> ${formattedEndDate}
      </p>
    </div>
    ` : ''}
    
    <!-- Reactivate CTA -->
    <div style="background:#f0f9ff;border-radius:12px;padding:20px;margin-bottom:24px;text-align:center;border:1px solid #bae6fd">
      <p style="margin:0 0 8px 0;color:#0369a1;font-weight:600">${t('email.subscription.cancelled.reactivateLabel')}</p>
      <p style="margin:0 0 16px 0;color:#0284c7;font-size:14px">${t('email.subscription.cancelled.reactivateMessage')}</p>
      <a href="${pricingUrl}" style="background:linear-gradient(135deg,#0ea5e9 0%,#0284c7 100%);color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${t('email.subscription.cancelled.reactivateButton')}</a>
    </div>
    
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0">${t('email.subscription.cancelled.footer')}</p>
  </div>
</div>`;
  }

  /**
   * Refund Processed Email HTML
   */
  refundProcessedHTML(data, locale = 'en') {
    const t = (path, replacements = {}) => getTranslation(locale, path, replacements);
    const { userName, amount, currency, reason, status } = data;
    const name = userName || 'there';

    const formattedAmount = this.formatCurrency(amount, currency || 'USD', locale);
    const statusText = status === 'succeeded' 
      ? t('email.subscription.refunded.statusSucceeded') 
      : t('email.subscription.refunded.statusPending');
    const statusColor = status === 'succeeded' ? '#059669' : '#d97706';

    return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f8fafc">
  <div style="background:linear-gradient(135deg,#059669 0%,#10b981 100%);color:#fff;padding:32px;border-radius:12px 12px 0 0;text-align:center">
    <div style="font-size:48px;margin-bottom:8px">💰</div>
    <h1 style="margin:0 0 8px 0;font-size:24px;color:#ffffff">${t('email.subscription.refunded.subject', { amount: formattedAmount, currency: currency?.toUpperCase() || 'USD' })}</h1>
  </div>

  <div style="background:#fff;padding:32px;border-radius:0 0 12px 12px;box-shadow:0 4px 6px rgba(0,0,0,0.05)">
    <p style="color:#111827;font-size:16px;margin-bottom:16px">${t('email.subscription.refunded.greeting', { name })}</p>
    <p style="color:#374151;margin-bottom:24px">${t('email.subscription.refunded.intro')}</p>
    
    <!-- Refund Details -->
    <div style="background:#f8fafc;border-radius:12px;padding:20px;margin-bottom:20px;border:1px solid #e5e7eb">
      <p style="margin:0 0 16px 0;color:#111827;font-weight:600">${t('email.subscription.refunded.detailsLabel')}</p>
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="padding:8px 0;color:#6b7280">${t('email.subscription.refunded.amountLabel')}</td>
          <td style="padding:8px 0;color:#059669;font-weight:700;font-size:18px;text-align:right">${formattedAmount}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#6b7280">${t('email.subscription.refunded.statusLabel')}</td>
          <td style="padding:8px 0;color:${statusColor};font-weight:600;text-align:right">${statusText}</td>
        </tr>
        ${reason ? `
        <tr>
          <td style="padding:8px 0;color:#6b7280">${t('email.subscription.refunded.reasonLabel')}</td>
          <td style="padding:8px 0;color:#374151;text-align:right">${reason}</td>
        </tr>` : ''}
      </table>
    </div>
    
    <!-- Timeframe Notice -->
    <div style="background:#eff6ff;border-radius:8px;padding:16px;margin-bottom:24px;border-left:4px solid #3b82f6">
      <p style="margin:0;color:#1e40af;font-size:14px">${t('email.subscription.refunded.timeframeMessage')}</p>
    </div>
    
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0">${t('email.subscription.refunded.footer')}</p>
  </div>
</div>`;
  }

  /**
   * Payment Failed Email HTML
   */
  paymentFailedHTML(data, locale = 'en') {
    const t = (path, replacements = {}) => getTranslation(locale, path, replacements);
    const { userName, planName } = data;
    const name = userName || 'there';
    const billingUrl = `${env.CLIENT_URL}/dashboard/billing`;

    return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f8fafc">
  <div style="background:linear-gradient(135deg,#dc2626 0%,#ef4444 100%);color:#fff;padding:32px;border-radius:12px 12px 0 0;text-align:center">
    <div style="font-size:48px;margin-bottom:8px">⚠️</div>
    <h1 style="margin:0 0 8px 0;font-size:24px;color:#ffffff">${t('email.subscription.paymentFailed.subject')}</h1>
  </div>

  <div style="background:#fff;padding:32px;border-radius:0 0 12px 12px;box-shadow:0 4px 6px rgba(0,0,0,0.05)">
    <p style="color:#111827;font-size:16px;margin-bottom:16px">${t('email.subscription.paymentFailed.greeting', { name })}</p>
    <p style="color:#374151;margin-bottom:16px">${t('email.subscription.paymentFailed.intro', { planName })}</p>
    
    <!-- Warning -->
    <div style="background:#fef2f2;border-radius:8px;padding:16px;margin-bottom:24px;border-left:4px solid #dc2626">
      <p style="margin:0;color:#991b1b;font-weight:500">${t('email.subscription.paymentFailed.warningMessage')}</p>
    </div>
    
    <!-- CTA Button -->
    <p style="text-align:center;margin:32px 0">
      <a href="${billingUrl}" style="background:linear-gradient(135deg,#dc2626 0%,#b91c1c 100%);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;box-shadow:0 4px 6px rgba(220,38,38,0.25)">${t('email.subscription.paymentFailed.updatePaymentButton')}</a>
    </p>
    
    <p style="color:#6b7280;font-size:14px;text-align:center;margin-bottom:24px">${t('email.subscription.paymentFailed.deadlineLabel')}</p>
    
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0">${t('email.subscription.paymentFailed.footer')}</p>
  </div>
</div>`;
  }

  /**
   * Addon Purchased Email HTML
   */
  addonPurchasedHTML(data, locale = 'en') {
    const t = (path, replacements = {}) => getTranslation(locale, path, replacements);
    const { userName, planName, credits, totalCredits } = data;
    const name = userName || 'there';
    const dashboardUrl = `${env.CLIENT_URL}/dashboard`;

    const creditsAdded = credits || {};
    const total = totalCredits || {};

    return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f8fafc">
  <div style="background:linear-gradient(135deg,#7c3aed 0%,#a855f7 100%);color:#fff;padding:32px;border-radius:12px 12px 0 0;text-align:center">
    <div style="font-size:48px;margin-bottom:8px">🎁</div>
    <h1 style="margin:0 0 8px 0;font-size:24px;color:#ffffff">${t('email.subscription.addonPurchased.subject', { planName })}</h1>
  </div>

  <div style="background:#fff;padding:32px;border-radius:0 0 12px 12px;box-shadow:0 4px 6px rgba(0,0,0,0.05)">
    <p style="color:#111827;font-size:16px;margin-bottom:16px">${t('email.subscription.addonPurchased.greeting', { name })}</p>
    <p style="color:#374151;margin-bottom:24px">${t('email.subscription.addonPurchased.intro')}</p>
    
    <!-- Credits Added -->
    <div style="background:#f5f3ff;border-radius:12px;padding:20px;margin-bottom:20px;border:1px solid #ddd6fe">
      <p style="margin:0 0 16px 0;color:#5b21b6;font-weight:600">${t('email.subscription.addonPurchased.creditsAddedLabel')}</p>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
        ${creditsAdded.seo_audits ? `<div style="background:#fff;padding:12px;border-radius:8px;text-align:center"><span style="font-size:24px;font-weight:700;color:#7c3aed">+${creditsAdded.seo_audits}</span><br><span style="font-size:12px;color:#6b7280">${t('email.subscription.addonPurchased.seoAuditsLabel')}</span></div>` : ''}
        ${creditsAdded.geo_audits ? `<div style="background:#fff;padding:12px;border-radius:8px;text-align:center"><span style="font-size:24px;font-weight:700;color:#7c3aed">+${creditsAdded.geo_audits}</span><br><span style="font-size:12px;color:#6b7280">${t('email.subscription.addonPurchased.geoAuditsLabel')}</span></div>` : ''}
        ${creditsAdded.gbp_audits ? `<div style="background:#fff;padding:12px;border-radius:8px;text-align:center"><span style="font-size:24px;font-weight:700;color:#7c3aed">+${creditsAdded.gbp_audits}</span><br><span style="font-size:12px;color:#6b7280">${t('email.subscription.addonPurchased.gbpAuditsLabel')}</span></div>` : ''}
        ${creditsAdded.ai_generations ? `<div style="background:#fff;padding:12px;border-radius:8px;text-align:center"><span style="font-size:24px;font-weight:700;color:#7c3aed">+${creditsAdded.ai_generations}</span><br><span style="font-size:12px;color:#6b7280">${t('email.subscription.addonPurchased.aiGenerationsLabel')}</span></div>` : ''}
      </div>
    </div>
    
    <!-- Total Credits -->
    <div style="background:#f8fafc;border-radius:12px;padding:20px;margin-bottom:20px;border:1px solid #e5e7eb">
      <p style="margin:0 0 16px 0;color:#111827;font-weight:600">${t('email.subscription.addonPurchased.totalCreditsLabel')}</p>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
        <div style="text-align:center"><span style="font-size:20px;font-weight:700;color:#111827">${total.seo_audits || 0}</span><br><span style="font-size:12px;color:#6b7280">${t('email.subscription.addonPurchased.seoAuditsLabel')}</span></div>
        <div style="text-align:center"><span style="font-size:20px;font-weight:700;color:#111827">${total.geo_audits || 0}</span><br><span style="font-size:12px;color:#6b7280">${t('email.subscription.addonPurchased.geoAuditsLabel')}</span></div>
        <div style="text-align:center"><span style="font-size:20px;font-weight:700;color:#111827">${total.gbp_audits || 0}</span><br><span style="font-size:12px;color:#6b7280">${t('email.subscription.addonPurchased.gbpAuditsLabel')}</span></div>
        <div style="text-align:center"><span style="font-size:20px;font-weight:700;color:#111827">${total.ai_generations || 0}</span><br><span style="font-size:12px;color:#6b7280">${t('email.subscription.addonPurchased.aiGenerationsLabel')}</span></div>
      </div>
    </div>
    
    <!-- CTA Button -->
    <p style="text-align:center;margin:32px 0">
      <a href="${dashboardUrl}" style="background:linear-gradient(135deg,#7c3aed 0%,#6d28d9 100%);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;box-shadow:0 4px 6px rgba(124,58,237,0.25)">${t('email.subscription.addonPurchased.useCreditsButton')}</a>
    </p>
    
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0">${t('email.subscription.addonPurchased.footer')}</p>
  </div>
</div>`;
  }
 /**
   * Subscription Plan Changed Email HTML
   */
  subscriptionPlanChangedHTML(data, locale = 'en') {
    const t = (path, replacements = {}) => getTranslation(locale, path, replacements);
    const { 
      userName, 
      previousPlanName, 
      newPlanName, 
      newPlan, 
      isUpgrade, 
      immediate 
    } = data;
    
    const name = userName || 'there';
    const dashboardUrl = `${env.CLIENT_URL}/dashboard`;

    const headerColor = isUpgrade 
      ? 'linear-gradient(135deg,#059669 0%,#10b981 100%)' 
      : 'linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%)';
    const emoji = isUpgrade ? '🚀' : '📋';
    const changeMessage = isUpgrade 
      ? t('email.subscription.planChanged.upgradeMessage')
      : t('email.subscription.planChanged.downgradeMessage');

    const limits = newPlan?.limits || {};
    const effectText = immediate 
      ? t('email.subscription.planChanged.immediateEffect')
      : t('email.subscription.planChanged.nextBillingEffect');

    return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f8fafc">
  <div style="background:${headerColor};color:#fff;padding:32px;border-radius:12px 12px 0 0;text-align:center">
    <div style="font-size:48px;margin-bottom:8px">${emoji}</div>
    <h1 style="margin:0 0 8px 0;font-size:24px;color:#ffffff">${t('email.subscription.planChanged.subject', { newPlanName })}</h1>
  </div>

  <div style="background:#fff;padding:32px;border-radius:0 0 12px 12px;box-shadow:0 4px 6px rgba(0,0,0,0.05)">
    <p style="color:#111827;font-size:16px;margin-bottom:16px">${t('email.subscription.planChanged.greeting', { name })}</p>
    <p style="color:#374151;margin-bottom:8px">${t('email.subscription.planChanged.intro')}</p>
    <p style="color:#059669;font-weight:600;margin-bottom:24px">${changeMessage}</p>
    
    <!-- Plan Change Details -->
    <div style="background:#f8fafc;border-radius:12px;padding:20px;margin-bottom:20px;border:1px solid #e5e7eb">
      <p style="margin:0 0 16px 0;color:#111827;font-weight:600">${t('email.subscription.planChanged.detailsLabel')}</p>
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="padding:8px 0;color:#6b7280">${t('email.subscription.planChanged.previousPlanLabel')}</td>
          <td style="padding:8px 0;color:#6b7280;text-align:right;text-decoration:line-through">${previousPlanName}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#6b7280">${t('email.subscription.planChanged.newPlanLabel')}</td>
          <td style="padding:8px 0;color:#059669;font-weight:700;text-align:right">${newPlanName}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#6b7280">${t('email.subscription.planChanged.effectiveLabel')}</td>
          <td style="padding:8px 0;color:#111827;text-align:right">${effectText}</td>
        </tr>
      </table>
    </div>
    
    <!-- New Credits -->
    <div style="background:#f0fdf4;border-radius:12px;padding:20px;margin-bottom:20px;border:1px solid #bbf7d0">
      <p style="margin:0 0 16px 0;color:#166534;font-weight:600">${t('email.subscription.planChanged.newCreditsLabel')}</p>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
        <div style="background:#fff;padding:12px;border-radius:8px;text-align:center">
          <span style="font-size:24px;font-weight:700;color:#059669">${limits.seo_audits || 0}</span>
          <br><span style="font-size:12px;color:#6b7280">${t('email.subscription.planChanged.seoAuditsLabel')}</span>
        </div>
        <div style="background:#fff;padding:12px;border-radius:8px;text-align:center">
          <span style="font-size:24px;font-weight:700;color:#059669">${limits.geo_audits || 0}</span>
          <br><span style="font-size:12px;color:#6b7280">${t('email.subscription.planChanged.geoAuditsLabel')}</span>
        </div>
        <div style="background:#fff;padding:12px;border-radius:8px;text-align:center">
          <span style="font-size:24px;font-weight:700;color:#059669">${limits.gbp_audits || 0}</span>
          <br><span style="font-size:12px;color:#6b7280">${t('email.subscription.planChanged.gbpAuditsLabel')}</span>
        </div>
        <div style="background:#fff;padding:12px;border-radius:8px;text-align:center">
          <span style="font-size:24px;font-weight:700;color:#059669">${limits.ai_generations || 0}</span>
          <br><span style="font-size:12px;color:#6b7280">${t('email.subscription.planChanged.aiGenerationsLabel')}</span>
        </div>
      </div>
    </div>
    
    <!-- Prorate Note -->
    <div style="background:#eff6ff;border-radius:8px;padding:12px;margin-bottom:24px;border-left:4px solid #3b82f6">
      <p style="margin:0;color:#1e40af;font-size:13px">${t('email.subscription.planChanged.prorateNote')}</p>
    </div>
    
    <!-- CTA Button -->
    <p style="text-align:center;margin:32px 0">
      <a href="${dashboardUrl}" style="background:${headerColor};color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;box-shadow:0 4px 6px rgba(0,0,0,0.15)">${t('email.subscription.planChanged.viewDashboardButton')}</a>
    </p>
    
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0">${t('email.subscription.planChanged.footer')}</p>
  </div>
</div>`;
  }

}

export const emailService = new EmailService();
export const sendEmail = (options) => emailService.send(options.to, options.subject, options.html || options.text);