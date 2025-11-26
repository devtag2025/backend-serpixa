import jwt from 'jsonwebtoken';
import { ApiError } from '../utils/index.js';
import { User } from '../models/index.js';
import { env } from '../config/index.js';
import { setAuthTokens } from '../helpers/index.js';

export const auth = async (req, res, next) => {
  const token = req.cookies?.accessToken || (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.split(" ")[1] : null);
  if (!token) return next(new ApiError(401, "Unauthorized – no token provided"));

  try {
    const { _id } = jwt.verify(token, env.ACCESS_TOKEN_SECRET);
    req.user = await User.findById(_id).select("-password");
    if (!req.user) throw new ApiError(401, "User not found");
    return next();
  } catch (err) {
    if (err?.name !== "TokenExpiredError") return next(new ApiError(401, "Invalid access token"));

    try {
      const refreshToken = req.cookies?.refreshToken;
      if (!refreshToken) return next(new ApiError(401, "No refresh token provided"));
      const { _id } = jwt.verify(refreshToken, env.REFRESH_TOKEN_SECRET);
      req.user = await User.findById(_id).select("-password");
      if (!req.user) throw new ApiError(401, "User not found");
      setAuthTokens(res, req.user); // rotate tokens
      return next();
    } catch {
      return next(new ApiError(401, "Invalid or expired refresh token"));
    }
  }
};
