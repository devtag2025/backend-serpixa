import { ApiResponse } from '../utils/index.js';
import { createSupportTicket } from '../services/support.service.js';

/**
 * @desc    Submit a support request (creates ticket and notifies team)
 * @route   POST /api/v1/support
 * @access  Private (auth required)
 */
export const submitSupportRequest = async (req, res, next) => {
  try {
    const { subject, email, message, name } = req.body;
    const userId = req.user?._id?.toString() || null;

    const ticket = await createSupportTicket(
      { subject, email, message, name },
      userId
    );

    res
      .status(201)
      .json(
        new ApiResponse(201, { ticketId: ticket._id }, 'Support request submitted successfully')
      );
  } catch (error) {
    next(error);
  }
};
