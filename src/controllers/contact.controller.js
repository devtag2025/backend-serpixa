import { ApiResponse } from '../utils/index.js';
import { submitContact } from '../services/contact.service.js';

/**
 * @desc    Submit contact form (public)
 * @route   POST /api/v1/contact
 * @access  Public
 */
export const submitContactForm = async (req, res, next) => {
  try {
    const { name, email, website, message, locale } = req.body;

    const submission = await submitContact({
      name,
      email,
      website: website || null,
      message,
      locale: locale || 'en',
    });

    res.status(201).json(
      new ApiResponse(201, { id: submission._id }, 'Thank you for your message. We will get back to you soon.')
    );
  } catch (error) {
    if (error.name === 'ValidationError' && error.errors) {
      const friendly = {
        name: 'Name must be at least 2 characters',
        email: 'Please provide a valid email address',
        message: 'Message must be at least 10 characters',
        website: 'Website is invalid',
      };
      const errors = {};
      Object.keys(error.errors).forEach((path) => {
        const field = path.replace(/\.\d+$/, '');
        errors[field] = friendly[field] || 'Invalid value';
      });
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: Object.keys(errors).length ? errors : { form: 'Invalid submission data' },
      });
    }
    next(error);
  }
};
