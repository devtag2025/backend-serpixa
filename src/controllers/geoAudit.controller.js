import { ApiResponse, ApiError } from '../utils/index.js';
import { GeoAudit, User } from '../models/index.js';
import { geoAuditService, pdfService } from '../services/index.js';

export const runAudit = async (req, res, next) => {
  try {
    const { keyword, city, country, googleDomain, language, businessName } = req.body;
    const userId = req.user._id;
    const { creditInfo } = req;

    if (!keyword) {
      return res.status(400).json(
        new ApiResponse(400, null, 'Keyword is required for geo audit')
      );
    }

    if (!city) {
      return res.status(400).json(
        new ApiResponse(400, null, 'City is required for geo audit')
      );
    }

    if (!country) {
      return res.status(400).json(
        new ApiResponse(400, null, 'Country is required for geo audit')
      );
    }

    const auditResult = await geoAuditService.runGeoAudit(
      keyword,
      city,
      country,
      googleDomain || null,
      language || null
    );

    const audit = await GeoAudit.create({
      user: userId,
      businessName: businessName || keyword, // Store provided businessName or keyword
      location: auditResult.location,
      keyword: auditResult.keyword,
      localVisibilityScore: auditResult.localVisibilityScore,
      competitors: auditResult.competitors || [],
      recommendations: auditResult.recommendations || [],
      napIssues: auditResult.napIssues || {
        nameConsistency: true,
        addressConsistency: true,
        phoneConsistency: true,
        issues: [],
      },
      citationIssues: auditResult.citationIssues || {
        missingCitations: [],
        inconsistentData: [],
      },
      raw_data: auditResult.raw,
      status: 'completed',
    });

    // Decrement credits after successful audit
    if (creditInfo) {
      const { subscription, userCredits } = creditInfo;

      if (subscription && subscription.usage?.geo_audits_used < (subscription.plan_id?.limits?.geo_audits || 0)) {
        await subscription.incrementUsage('geo_audits', 1);
      } else if (userCredits > 0) {
        const user = await User.findById(userId);
        if (user && user.credits?.geo_audits > 0) {
          user.credits.geo_audits = Math.max(0, user.credits.geo_audits - 1);
          await user.save();
        }
      }
    }

    res.status(201).json(
      new ApiResponse(201, { audit }, 'Geo audit completed successfully')
    );
  } catch (error) {
    next(error);
  }
};

export const getAuditById = async (req, res, next) => {
  try {
    const { auditId } = req.params;
    const userId = req.user._id;

    const audit = await GeoAudit.findOne({ _id: auditId, user: userId });

    if (!audit) {
      throw new ApiError(404, 'Geo audit not found');
    }

    res.json(new ApiResponse(200, { audit }, 'Geo audit retrieved successfully'));
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
      GeoAudit.find({ user: userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .select('-raw_data'),
      GeoAudit.countDocuments({ user: userId }),
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
      }, 'Geo audits retrieved successfully')
    );
  } catch (error) {
    next(error);
  }
};

export const getAuditWithRawData = async (req, res, next) => {
  try {
    const { auditId } = req.params;
    const userId = req.user._id;

    const audit = await GeoAudit.findOne({ _id: auditId, user: userId }).lean();

    if (!audit) {
      throw new ApiError(404, 'Geo audit not found');
    }

    res.json(new ApiResponse(200, { audit }, 'Geo audit with raw data retrieved'));
  } catch (error) {
    next(error);
  }
};

export const deleteAudit = async (req, res, next) => {
  try {
    const { auditId } = req.params;
    const userId = req.user._id;

    const audit = await GeoAudit.findOneAndDelete({ _id: auditId, user: userId });

    if (!audit) {
      throw new ApiError(404, 'Geo audit not found');
    }

    res.json(new ApiResponse(200, null, 'Geo audit deleted successfully'));
  } catch (error) {
    next(error);
  }
};

export const downloadAuditPDF = async (req, res, next) => {
  try {
    const { auditId } = req.params;
    const userId = req.user._id;
    const { view } = req.query;

    const audit = await GeoAudit.findOne({ _id: auditId, user: userId }).lean();

    if (!audit) {
      throw new ApiError(404, 'Geo audit not found');
    }

    const pdfBuffer = pdfService.generateGeoAuditReport(audit, req.user);

    const businessSlug = audit.businessName
      ? audit.businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 30)
      : 'business';
    const keywordSlug = audit.keyword
      ? audit.keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 20)
      : 'audit';
    const dateStr = new Date(audit.createdAt).toISOString().split('T')[0];
    const filename = `geo-audit-${businessSlug}-${keywordSlug}-${dateStr}.pdf`;

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

export const geoAuditController = {
  runAudit,
  getAuditById,
  getUserAudits,
  getAuditWithRawData,
  deleteAudit,
  downloadAuditPDF,
};