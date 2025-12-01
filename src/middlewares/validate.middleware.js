import Joi from "joi";

// Helper function to validate request body
const validateRequest = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: "Validation error",
      error: error.details[0].message,
    });
  }
  next();
};

// Helper function to validate params
const validateParams = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.params);
  if (error) {
    return res.status(400).json({
      success: false,
      message: "Validation error", 
      error: error.details[0].message,
    });
  }
  next();
};

// Common schemas
const email = Joi.string().email().required();
const password = Joi.string().min(6).max(128).required();
const name = Joi.string().min(2).max(100);
const token = Joi.string().required();
const confirmPassword = (ref) => Joi.string().valid(Joi.ref(ref)).required().messages({ 'any.only': 'Passwords do not match' });

const url = Joi.string().uri().required().messages({
  'string.uri': 'Please provide a valid URL',
  'any.required': 'URL is required',
});
const keyword = Joi.string().min(1).max(500).required().messages({
  'string.empty': 'Keyword cannot be empty',
  'string.max': 'Keyword must not exceed 500 characters',
  'any.required': 'Keyword is required',
});
const mongoId = Joi.string().regex(/^[a-fA-F0-9]{24}$/).required().messages({
  'string.pattern.base': 'Invalid ID format',
});

// Auth validations
const registerUser = validateRequest(Joi.object({
  name: name.required(),
  email,
  password,
  confirmPassword: confirmPassword('password'),
  referral_code: Joi.string().optional().allow('', null)
}));

const loginUser = validateRequest(Joi.object({
  email,
  password: Joi.string().required()
}));

const forgotPassword = validateRequest(Joi.object({ email }));

const resetPassword = validateRequest(Joi.object({
  token,
  password,
  confirmPassword: confirmPassword('password')
}));

const verifyEmailToken = validateParams(Joi.object({ token }));

const resendVerification = validateRequest(Joi.object({ email }));

const updateProfile = validateRequest(Joi.object({
  name: name.optional(),
  email: email.optional()
}).min(1));

const changePassword = validateRequest(Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: password,
  confirmPassword: confirmPassword('newPassword')
}));

// SEO Audit validation
const runSEOAudit = validateRequest(Joi.object({
  url,
  keyword,
  locationName: Joi.string().min(1).max(100).optional().default('United States'),
  languageName: Joi.string().min(1).max(100).optional().default('English'),
  device: Joi.string().valid('desktop', 'mobile', 'tablet').optional().default('desktop'),
}));

const auditIdParam = validateParams(Joi.object({
  auditId: mongoId,
}));

export const validate = {
  // Auth
  registerUser,
  loginUser,
  forgotPassword,
  resetPassword,
  verifyEmailToken,
  resendVerification,
  updateProfile,
  changePassword,
  // SEO Audit
  runSEOAudit,
  auditIdParam,
}