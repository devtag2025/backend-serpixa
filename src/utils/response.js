/**
 * Standardized API Response Templates
 */

// Success Response
export const ApiResponse = (res, code, message, data = null) => {
  return res.status(code).json({
    success: true,
    message,
    data,
  });
};

// Error Response
export const ApiError = (res, code, message, errors = null) => {
  return res.status(code).json({
    success: false,
    message,
    ...(errors && { errors }),
  });
};
