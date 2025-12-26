import Joi from "joi";

// Helper function to validate request body
const validateRequest = (schema) => (req, res, next) => {
  // Check if req.body exists
  if (!req.body) {
    return res.status(400).json({
      success: false,
      message: "Validation error",
      error: "Request body is required",
    });
  }

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
const keyword = Joi.string().max(100).optional().allow('', null);
const mongoId = Joi.string().regex(/^[a-fA-F0-9]{24}$/).required().messages({
  'string.pattern.base': 'Invalid ID format',
});
const locale = Joi.string().max(10).optional().messages({
  'string.max': 'Locale must be less than 10 characters',
});

// Auth validations
const registerUser = validateRequest(Joi.object({
  name: name.required(),
  email,
  password,
  confirmPassword: confirmPassword('password'),
  referral_code: Joi.string().optional().allow('', null),
  locale
}));

const loginUser = validateRequest(Joi.object({
  email,
  password: Joi.string().required()
}));

const forgotPassword = validateRequest(Joi.object({ 
  email,
  locale
}));

const resetPassword = validateRequest(Joi.object({
  token,
  password,
  confirmPassword: confirmPassword('password'),
  locale
}));

const verifyEmailToken = validateParams(Joi.object({ token }));

const resendVerification = validateRequest(Joi.object({ 
  email,
  locale
}));

const updateProfile = validateRequest(Joi.object({
  name: name.optional(),
  email: email.optional()
}).min(1));

const changePassword = validateRequest(Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: password,
  confirmPassword: confirmPassword('newPassword')
}));

const runSEOAudit = validateRequest(Joi.object({
  url,
  keyword,
  locale: Joi.string().max(10).optional(),
  device: Joi.string().valid('desktop', 'mobile', 'tablet').optional(),
}));

const auditIdParam = validateParams(Joi.object({
  auditId: mongoId,
}));
// SERP validations


// GBP Audit validations
const runGBPAudit = validateRequest(Joi.object({
  businessName: Joi.string().min(2).max(200).optional(),
  gbpLink: Joi.string().uri().optional(),
  locale: Joi.string().max(10).optional(),
}).or('businessName', 'gbpLink').messages({
  'object.missing': 'Either businessName or gbpLink is required',
}));

const gbpAuditIdParam = validateParams(Joi.object({
  auditId: mongoId,
}));

// Geo Audit validations
const runGeoAudit = validateRequest(Joi.object({
  keyword: Joi.string().min(1).max(200).required().messages({
    'any.required': 'Keyword is required',
    'string.empty': 'Keyword cannot be empty',
  }),
  city: Joi.string().min(1).max(200).required().messages({
    'any.required': 'City is required',
    'string.empty': 'City cannot be empty',
  }),
  country: Joi.string().min(1).max(200).required().messages({
    'any.required': 'Country is required',
    'string.empty': 'Country cannot be empty',
  }),
  googleDomain: Joi.string().max(100).optional().messages({
    'string.max': 'Google domain must be less than 100 characters',
  }),
  language: Joi.string().length(2).optional().messages({
    'string.length': 'Language must be a 2-character code (e.g., "fr", "en", "nl")',
  }),
  businessName: Joi.string().min(1).max(200).optional(),
  locale: Joi.string().max(10).optional(),
}));

// Checkout validations
const createCheckout = validateRequest(Joi.object({
  price_id: Joi.string().required().messages({
    'any.required': 'price_id is required',
    'string.empty': 'price_id cannot be empty',
  }),
}));

// Admin validations
const userIdParam = validateParams(Joi.object({
  userId: Joi.string().regex(/^[a-fA-F0-9]{24}$/).required().messages({
    'string.pattern.base': 'Invalid user ID format',
  }),
}));

const updateCredits = validateRequest(Joi.object({
  seo_audits: Joi.number().integer().min(0).optional(),
  geo_audits: Joi.number().integer().min(0).optional(),
  gbp_audits: Joi.number().integer().min(0).optional(),
  ai_generations: Joi.number().integer().min(0).optional(),
}).min(1).messages({
  'object.min': 'At least one credit type must be provided',
}));

const creditTrendQuery = (req, res, next) => {
  const schema = Joi.object({
    period: Joi.string().valid('7days', '1year').optional().default('7days'),
  });
  
  const { error, value } = schema.validate(req.query);
  if (error) {
    return res.status(400).json({
      success: false,
      message: "Validation error",
      error: error.details[0].message,
    });
  }
  
  req.validatedQuery = value;
  next();
};

const paginationQuery = (req, res, next) => {
  const schema = Joi.object({
    page: Joi.number().integer().min(1).optional().default(1),
    limit: Joi.number().integer().min(1).max(100).optional().default(20),
    search: Joi.string().max(200).optional().allow(''),
    status: Joi.string().optional().allow(''),
    type: Joi.string().valid('seo', 'geo', 'gbp', 'all').optional().default('all'),
    sort: Joi.string().optional().default('createdAt'),
    order: Joi.string().valid('asc', 'desc').optional().default('desc'),
    userId: Joi.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  });
  
  const { error, value } = schema.validate(req.query);
  if (error) {
    return res.status(400).json({
      success: false,
      message: "Validation error",
      error: error.details[0].message,
    });
  }
  
  // Store validated values in a separate property instead of overwriting req.query
  req.validatedQuery = value;
  next();
};

// AI Content validations
const generateAIContent = validateRequest(Joi.object({
  keyword: Joi.string().min(1).max(200).required().messages({
    'any.required': 'Keyword is required',
    'string.empty': 'Keyword cannot be empty',
  }),
  locale: Joi.string().valid('en-us', 'en-gb', 'fr-fr', 'fr-be', 'nl-nl', 'nl-be').optional(),
}));

const aiContentIdParam = validateParams(Joi.object({
  contentId: mongoId,
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
  
  // GBP Audit
  runGBPAudit,
  gbpAuditIdParam,

  // Geo Audit
  runGeoAudit,

  // Checkout
  createCheckout,

  // Admin
  userIdParam,
  updateCredits,
  creditTrendQuery,
  paginationQuery,

  // AI Content
  generateAIContent,
  aiContentIdParam,
}