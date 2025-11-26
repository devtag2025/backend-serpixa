import { ApiError } from "../utils/ApiError.js";

export const authorizeRoles = (allowedRoles) => {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.user_type)) {
      throw new ApiError(403, "Forbidden – insufficient permissions");
    }
    next();
  };
};
