import { ApiResponse, ApiError } from '../utils/index.js';
import { SEOAudit, User } from '../models/index.js';
import { dataForSEOService, pdfService } from '../services/index.js';
import { getLocaleConfig, DEFAULT_LOCALE } from '../config/index.js';

export const runAudit = async (req, res, next) => {
  try {
    const { url, keyword, locale, device } = req.body;
    const userId = req.user._id;
    const { creditInfo } = req;

    if (!keyword) {
      return res.status(400).json(
        new ApiResponse(400, null, 'Keyword is required for SEO audit')
      );
    }

    // Get locale config for API parameters
    const localeConfig = getLocaleConfig(locale || DEFAULT_LOCALE);

    const auditResult = await dataForSEOService.runOnPageAudit(
      url,
      keyword,
      locale || DEFAULT_LOCALE,
      device || 'desktop'
    );

    const audit = await SEOAudit.create({
      user: userId,
      url,
      keyword,
      locale: locale || DEFAULT_LOCALE,
      score: auditResult.score,
      checks: auditResult.checks,
      keywordAnalysis: auditResult.keywordAnalysis,
      recommendations: auditResult.recommendations,
      competitors: auditResult.competitors || [],
      serpInfo: auditResult.serpInfo || null,
      raw_data: auditResult.raw,
      status: 'completed',
    });

    // Decrement credits after successful audit
    if (creditInfo) {
      const { subscription, userCredits } = creditInfo;

      if (subscription && subscription.usage?.seo_audits_used < (subscription.plan_id?.limits?.seo_audits || 0)) {
        await subscription.incrementUsage('seo_audits', 1);
      } else if (userCredits > 0) {
        const user = await User.findById(userId);
        if (user && user.credits?.seo_audits > 0) {
          user.credits.seo_audits = Math.max(0, user.credits.seo_audits - 1);
          await user.save();
        }
      }
    }

    res.status(201).json(
      new ApiResponse(201, { audit }, 'SEO audit completed successfully')
    );
  } catch (error) {
    next(error);
  }
};

export const getAuditById = async (req, res, next) => {
  try {
    const { auditId } = req.params;
    const userId = req.user._id;

    const audit = await SEOAudit.findOne({ _id: auditId, user: userId });

    if (!audit) {
      throw new ApiError(404, 'Audit not found');
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
      SEOAudit.find({ user: userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .select('-raw_data'),
      SEOAudit.countDocuments({ user: userId }),
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
      }, 'Audits retrieved successfully')
    );
  } catch (error) {
    next(error);
  }
};

export const getAuditWithRawData = async (req, res, next) => {
  try {
    const { auditId } = req.params;
    const userId = req.user._id;

    const audit = await SEOAudit.findOne({ _id: auditId, user: userId }).lean();

    if (!audit) {
      throw new ApiError(404, 'Audit not found');
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

    const audit = await SEOAudit.findOneAndDelete({ _id: auditId, user: userId });

    if (!audit) {
      throw new ApiError(404, 'Audit not found');
    }

    res.json(new ApiResponse(200, null, 'Audit deleted successfully'));
  } catch (error) {
    next(error);
  }
};

export const downloadAuditPDF = async (req, res, next) => {
  try {
    const { auditId } = req.params;
    const userId = req.user._id;
    const { view } = req.query;

    const audit = await SEOAudit.findOne({ _id: auditId, user: userId }).lean();

    if (!audit) {
      throw new ApiError(404, 'Audit not found');
    }

    const pdfBuffer = pdfService.generateSEOAuditReport(audit, req.user);

    let urlDomain = 'website';
    try {
      if (audit.url) {
        urlDomain = new URL(audit.url).hostname.replace('www.', '').replace(/[^a-z0-9.-]/gi, '-');
      }
    } catch (e) {
      urlDomain = 'website';
    }

    const keywordSlug = audit.keyword
      ? audit.keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 30)
      : 'audit';
    const dateStr = new Date(audit.createdAt).toISOString().split('T')[0];
    const filename = `seo-audit-${urlDomain}-${keywordSlug}-${dateStr}.pdf`;

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

export const seoAuditController = {
  runAudit,
  getAuditById,
  getUserAudits,
  getAuditWithRawData,
  deleteAudit,
  downloadAuditPDF,
};