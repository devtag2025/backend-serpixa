import { ApiResponse, ApiError } from '../utils/index.js';
import { SEOAudit } from '../models/index.js';
import {  dataForSEOService, pdfService  } from '../services/index.js';




export const runAudit = async (req, res, next) => {
  try {
    const { url, keyword } = req.body;
    const userId = req.user._id;

    const auditResult = await dataForSEOService .runOnPageAudit(url, keyword);

    const audit = await SEOAudit.create({
      user: userId,
      url,
      keyword: keyword || null,
      score: auditResult.score,
      checks: auditResult.checks,
      recommendations: auditResult.recommendations,
      raw_data: auditResult.raw,
      status: 'completed',
    });

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
  
      const audit = await SEOAudit.findOne({ _id: auditId, user: userId }).lean();
  
      if (!audit) {
        throw new ApiError(404, 'Audit not found');
      }
  
      const pdfBuffer = pdfService.generateSEOAuditReport(audit, req.user);
  
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=seo-audit-${auditId}.pdf`);
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