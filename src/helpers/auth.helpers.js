import { env } from "../config/index.js";
import { USER_TYPES } from "../utils/enum.js";

export const clearAuthCookies = (res) => {
  res.clearCookie("g_state");
  res.clearCookie("g_pkce");
};


export const getCookieOptions = (maxAge, httpOnly = true, userType = 'user') => {
  let domain;
  if (env.NODE_ENV === "production") {
    // Admin users get access to all domains and regular users only to fitnessads.ai
    if (userType === USER_TYPES.ADMIN) {
      domain = ".serpixa.ai"; // Admin can access all subdomains
    } else {
      domain = "serpixa.ai"; // Regular users only main domain
    }
  } else {
    domain = undefined; // No domain restriction in development
  }

  return {
    httpOnly,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge,
    path: "/",
    domain
  };
};

export const setAuthTokens = (res, user) => {
  const accessToken = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();
  
  // Get user type for domain-specific cookie setting
  const userType = user.user_type || USER_TYPES.USER;
  
  res.cookie("accessToken", accessToken, getCookieOptions(24 * 60 * 60 * 1000, false, userType));
  res.cookie("refreshToken", refreshToken, getCookieOptions(7 * 24 * 60 * 60 * 1000, true, userType));
  
  return { accessToken };
};
