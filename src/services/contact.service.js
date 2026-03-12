import { ContactSubmission } from '../models/index.js';
import { emailService } from './email.service.js';
import { ApiError } from '../utils/index.js';

/**
 * Process contact form submission: store in DB, send confirmation to user, notify team.
 * Payload is already validated by middleware; this is a safety layer for DB constraints.
 * @param {object} payload - { name, email, website?, message, locale? }
 * @returns {Promise<object>} The created contact submission
 */
export const submitContact = async (payload) => {
  const { name, email, website, message, locale = 'en' } = payload;

  let submission;
  try {
    submission = await ContactSubmission.create({
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      website: website ? String(website).trim() : null,
      message: String(message).trim(),
      locale: ['en', 'fr', 'nl'].includes(locale) ? locale : 'en',
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      throw err;
    }
    throw new ApiError(500, 'Failed to save contact request. Please try again.');
  }

  const lang = submission.locale;

  try {
    await emailService.sendContactConfirmation(email, {
      name: submission.name,
      locale: lang,
    });
  } catch (emailErr) {
    console.error('[Contact] Failed to send confirmation email:', emailErr?.message || emailErr);
  }

  try {
    await emailService.sendContactNotificationToTeam({
      name: submission.name,
      email: submission.email,
      website: submission.website || undefined,
      message: submission.message,
    });
  } catch (emailErr) {
    console.error('[Contact] Failed to send notification to team:', emailErr?.message || emailErr);
  }

  return submission;
};
