import { SupportTicket } from '../models/index.js';
import { emailService } from './email.service.js';

/**
 * Create a support ticket and notify the team via email.
 * @param {object} payload - { subject, email, message, name? }
 * @param {string} [userId] - req.user._id when authenticated
 * @returns {Promise<object>} The created ticket
 */
export const createSupportTicket = async (payload, userId = null) => {
  const { subject, email, message, name } = payload;

  const ticket = await SupportTicket.create({
    subject,
    email,
    message,
    name: name || null,
    user_id: userId || null,
  });

  await emailService.sendSupportTicketToTeam({
    subject,
    email,
    message,
    name: name || null,
    userId: userId ? userId.toString() : null,
  });

  return ticket;
};
