import { ApiResponse, ApiError } from '../utils/index.js';
import { GBPAudit, User } from '../models/index.js';
import { emailService, gbpService, pdfService } from '../services/index.js';
import { DEFAULT_LOCALE } from '../config/index.js';

export const runAudit = async (req, res, next) => {
  try {
    const { businessName, gbpLink, locale } = req.body;
    const userId = req.user._id;
    const { creditInfo } = req;

    const searchTerm = businessName || gbpLink;
    if (!searchTerm) {
      return res.status(400).json(
        new ApiResponse(400, null, 'Business name or GBP link is required')
      );
    }

    const auditResult = await gbpService.runAudit(
      searchTerm,
      locale || DEFAULT_LOCALE
    );

    const audit = await GBPAudit.create({
      user: userId,
      businessName: searchTerm,
      gbpLink: gbpLink || null,
      locale: locale || DEFAULT_LOCALE,
      placeId: auditResult.placeId || null,
      score: auditResult.score,
      businessInfo: auditResult.businessInfo,
      checklist: auditResult.checklist,
      recommendations: auditResult.recommendations,
      raw_data: auditResult.raw,
      status: auditResult.found ? 'completed' : 'not_found',
    });

    // Decrement credits after successful audit (only if audit was found)
    if (auditResult.found && creditInfo) {
      const { subscription, userCredits } = creditInfo;

      if (subscription && subscription.usage?.gbp_audits_used < (subscription.plan_id?.limits?.gbp_audits || 0)) {
        await subscription.incrementUsage('gbp_audits', 1);
      } else if (userCredits > 0) {
        const user = await User.findById(userId);
        if (user && user.credits?.gbp_audits > 0) {
          user.credits.gbp_audits = Math.max(0, user.credits.gbp_audits - 1);
          await user.save();
        }
      }
    }

    // Send audit completion email (non-blocking) - only if found
    if (auditResult.found) {
      emailService.sendGBPAuditEmail(req.user.email, {
        audit: audit.toObject(),
        userName: req.user.name,
      });
    }


    res.status(201).json(
      new ApiResponse(201, { audit }, auditResult.found
        ? 'GBP audit completed successfully'
        : 'Business not found. Please verify the name.')
    );
  } catch (error) {
    next(error);
  }
};

export const getAuditById = async (req, res, next) => {
  try {
    const { auditId } = req.params;
    const userId = req.user._id;

    const audit = await GBPAudit.findOne({ _id: auditId, user: userId });

    if (!audit) {
      throw new ApiError(404, 'GBP audit not found');
    }

    res.json(new ApiResponse(200, { audit }, 'Audit retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

export const getUserAudits = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 10 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [audits, total] = await Promise.all([
      GBPAudit.find({ user: userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .select('-raw_data'),
      GBPAudit.countDocuments({ user: userId }),
    ]);

    res.json(
      new ApiResponse(200, {
        audits,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      }, 'GBP audits retrieved successfully')
    );
  } catch (error) {
    next(error);
  }
};

export const getAuditWithRawData = async (req, res, next) => {
  try {
    const { auditId } = req.params;
    const userId = req.user._id;

    const audit = await GBPAudit.findOne({ _id: auditId, user: userId }).lean();

    if (!audit) {
      throw new ApiError(404, 'GBP audit not found');
    }

    res.json(new ApiResponse(200, { audit }, 'Audit with raw data retrieved'));
  } catch (error) {
    next(error);
  }
};

export const deleteAudit = async (req, res, next) => {
  try {
    const { auditId } = req.params;
    const userId = req.user._id;

    const audit = await GBPAudit.findOneAndDelete({ _id: auditId, user: userId });

    if (!audit) {
      throw new ApiError(404, 'GBP audit not found');
    }

    res.json(new ApiResponse(200, null, 'GBP audit deleted successfully'));
  } catch (error) {
    next(error);
  }
};

export const downloadAuditPDF = async (req, res, next) => {
  try {
    const { auditId } = req.params;
    const userId = req.user._id;
    const { view } = req.query;

    const audit = await GBPAudit.findOne({ _id: auditId, user: userId }).lean();

    if (!audit) {
      throw new ApiError(404, 'GBP audit not found');
    }

    const pdfBuffer = pdfService.generateGBPAuditReport(audit, req.user);

    const businessSlug = audit.businessName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .substring(0, 30);
    const dateStr = new Date(audit.createdAt).toISOString().split('T')[0];
    const filename = `gbp-audit-${businessSlug}-${dateStr}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdfBuffer.byteLength);

    const disposition = view === 'true' ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    next(error);
  }
};

export const gbpAuditController = {
  runAudit,
  getAuditById,
  getUserAudits,
  getAuditWithRawData,
  deleteAudit,
  downloadAuditPDF,
};