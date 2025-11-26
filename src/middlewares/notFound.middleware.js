import { ApiError } from '../utils/response.js';

export const notFoundHandler = (req, res) => {
  return ApiError(res, 404, `Route not found: ${req.method} ${req.originalUrl}`);
};

