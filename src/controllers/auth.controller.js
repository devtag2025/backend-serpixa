import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

import { env } from '../config/index.js';
import { ApiResponse, ApiError, paginate, getLocaleFromRequest } from '../utils/index.js';
import { User } from '../models/index.js';
import { emailService } from '../services/index.js';
import { setAuthTokens } from '../helpers/index.js';

export const signup = async (req, res, next) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json(new ApiResponse(400, null, "Email and password required"));
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json(new ApiResponse(409, null, "User already exists"));
    }

    const user = new User({
      email,
      password,
      name,
    });

    const emailToken = user.generateEmailVerificationToken();
    await user.save();

    // Get locale from request
    const locale = getLocaleFromRequest(req);

    // Best-effort email sending; don't block signup in development if email fails
    try {
      await emailService.sendEmailVerification(email, emailToken, { 
        userName: name,
        locale: locale 
      });
    } catch (err) {
      if (env.NODE_ENV === 'development') {
        // Log and continue so local testing works even without valid email credentials
        console.error('Email verification send failed:', err.message || err);
      } else {
        throw err;
      }
    }

    res.status(201).json(
      new ApiResponse(201, { userId: user._id }, 'User created successfully')
    );
  } catch (error) {
    next(error);
  }
};

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json(new ApiResponse(400, null, "Email and password required"));
    }

    const user = await User.findOne({ email });
    if (!user || !user.password) {
      return res.status(401).json(new ApiResponse(400, null, "Invalid credentials"));
    }

    if (!user || !await user.isPasswordCorrect(password)) {
      return res.status(401).json(new ApiResponse(401, null, "Invalid credentials"));
    }

    if (!user.is_email_verified) {
      return res.status(403).json(new ApiResponse(403, null, "Please verify your email first"));
    }
  
    if (user.is_suspended) {
      return res.status(403).json(new ApiResponse(403, null, "Your account has been suspended. Please contact support."));
    }

    const { accessToken } = setAuthTokens(res, user);

    res.json(new ApiResponse(200, { user, accessToken }, "Login successful"));
  } catch (error) {
    next(error);
  }
};

export const verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json(new ApiResponse(400, null, "Verification token required"));
    }

    const decoded = jwt.verify(token, env.EMAIL_VERIFICATION_SECRET);
    const user = await User.findById(decoded._id);

    if (!user || user.email_verification_token !== token) {
      return res.status(400).json(new ApiResponse(400, null, "Invalid or expired token"));
    }

    user.is_email_verified = true;
    user.email_verification_token = undefined;
    user.email_verification_expires = undefined;
    await user.save();

    // Send welcome email after successful verification
    const locale = getLocaleFromRequest(req);
    try {
      await emailService.sendWelcomeEmail(user.email, {
        userName: user.name,
        locale: locale
      });
    } catch (err) {
      // Don't fail verification if welcome email fails
      if (env.NODE_ENV === 'development') {
        console.error('Welcome email send failed:', err.message || err);
      }
    }

    res.json(new ApiResponse(200, null, "Email verified successfully"));
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(400).json(new ApiResponse(400, null, "Verification token expired"));
    }
    next(error);
  }
};

export const resendVerification = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json(new ApiResponse(400, null, "Email is required"));
    }

    const user = await User.findOne({ email });
    if (!user) {
      // Don’t reveal existence
      return res.json(new ApiResponse(200, null, "If an account exists, a verification email was sent"));
    }

    if (user.is_email_verified) {
      return res.status(400).json(new ApiResponse(400, null, "Email is already verified"));
    }

    const emailToken = user.generateEmailVerificationToken();
    await user.save();

    // Get locale from request
    const locale = getLocaleFromRequest(req);

    try {
      await emailService.sendEmailVerification(email, emailToken, {
        userName: user.name,
        locale: locale
      });
    } catch (err) {
      if (env.NODE_ENV === 'development') {
        console.error('Resend verification email failed:', err.message || err);
      } else {
        throw err;
      }
    }

    res.json(new ApiResponse(200, null, 'Verification email sent if the account exists'));
  } catch (error) {
    next(error);
  }
};


export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json(new ApiResponse(400, null, "Email required"));
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.json(new ApiResponse(200, null, "If email exists, reset link sent"));
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.reset_password_token = resetToken;
    user.reset_password_expires = new Date(Date.now() + 3600000);
    await user.save();

    // Get locale from request
    const locale = getLocaleFromRequest(req);

    try {
      await emailService.sendPasswordResetEmail(email, resetToken, {
        userName: user.name,
        locale: locale
      });
    } catch (err) {
      if (env.NODE_ENV === 'development') {
        console.error('Password reset email failed:', err.message || err);
      } else {
        throw err;
      }
    }

    res.json(new ApiResponse(200, null, "If email exists, reset link sent"));
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (req, res, next) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json(new ApiResponse(400, null, "Token and password required"));
    }

    const user = await User.findOne({
      reset_password_token: token,
      reset_password_expires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json(new ApiResponse(400, null, "Invalid or expired reset token"));
    }

    user.password = password;
    user.reset_password_token = undefined;
    user.reset_password_expires = undefined;
    await user.save();

    res.json(new ApiResponse(200, null, "Password reset successful"));
  } catch (error) {
    next(error);
  }
};

export const getProfile = async (req, res, next) => {
  try {
    // Fetch the complete user document
    const user = await User.findById(req.user._id).exec();

    if (!user) {
      return res.status(404).json(new ApiResponse(404, null, "User not found"));
    };
    
    // Convert Mongoose document to plain JS object
    const userObj = user.toObject();

    // Send clean response
    res.json(
      new ApiResponse(
        200,
        {
          user
        },
        "Profile retrieved successfully"
      )
    );
  } catch (error) {
    console.error("Error fetching profile:", error);
    next(error);
  }
};


export const getClearCookieOptions = () => ({
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  domain: env.NODE_ENV === "production" ? ".fitnessads.ai" : undefined,
});

export const logout = async (req, res, next) => {
  try {
    const clearOptions = getClearCookieOptions();

    res.clearCookie("accessToken", clearOptions);
    res.clearCookie("refreshToken", clearOptions);
    res.clearCookie("g_state", clearOptions);
    res.clearCookie("g_pkce", clearOptions);

    res.json(new ApiResponse(200, null, "Logged out successfully"));
  } catch (error) {
    next(error);
  }
};

export const updateProfile = async (req, res, next) => {
  try {
    const { name, email } = req.body;
    const user = await User.findById(req.user.id);

    if (email && email !== user.email) {
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json(new ApiResponse(400, null, "Email already exists"));
      }
    }

    if (name) user.name = name;
    if (email) user.email = email;
    await user.save();

    const { password, refreshToken, ...userResponse } = user.toObject();
    res.json(new ApiResponse(200, userResponse, "Profile updated"));
  } catch (error) {
    next(error);
  }
};

export const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id);

    if (!(await user.isPasswordCorrect(currentPassword))) {
      return res.status(400).json(new ApiResponse(400, null, "Current password incorrect"));
    }

    const isSame = await bcrypt.compare(newPassword, user.password);
    if (isSame) {
      return res.status(400).json(new ApiResponse(400, null, "New password must be different"));
    }

    user.password = newPassword;
    await user.save();

    res.json(new ApiResponse(200, null, "Password changed"));
  } catch (error) {
    next(error);
  }
};

export const getAllUsers = async (req, res, next) => {
  try {
    const { page, limit, search, role, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    // Build query
    const query = { _id: { $ne: req.user._id } };

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    if (role) {
      query.role = role;
    }

    // Use pagination utility
    const result = await paginate(User, query, {
      page,
      limit,
      sort: sortBy,
      order: sortOrder,
      select: '-password -refresh_tokens -email_verification_token -password_reset_token'
    });

    res.json(new ApiResponse(200, {
      users: result.data,
      pagination: {
        currentPage: result.pagination.page,
        totalPages: result.pagination.pages,
        totalUsers: result.pagination.total,
        hasNextPage: result.pagination.hasNext,
        hasPrevPage: result.pagination.hasPrev,
        limit: result.pagination.limit
      }
    }, "Users retrieved successfully"));
  } catch (error) {
    next(error);
  }
};

export const deleteUser = async (req, res, next) => {
  try {
    const { userId } = req.params;

    if (req.user._id.toString() !== userId && req.user.user_type !== 'admin') {
      return res.status(403).json(new ApiResponse(403, null, "You can only delete your own account"));
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json(new ApiResponse(404, null, "User not found"));
    }

    const deletedCounts = await deleteUserData(userId);

    const result = {
      success: true,
      message: 'User account and all associated data deleted successfully',
      deletedCounts,
      deletedAt: new Date().toISOString()
    };

    res.json(new ApiResponse(200, result, "User account deleted successfully"));
  } catch (error) {
    next(new ApiError(500, 'Failed to delete user account', error.message));
  }
};


