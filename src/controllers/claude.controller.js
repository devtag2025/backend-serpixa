import { ApiResponse, ApiError } from '../utils/index.js';
import { claudeService, pdfService } from '../services/index.js';
import { User } from '../models/index.js';
import { AIContent } from '../models/index.js';

/**
 * Generate AI-powered SEO content optimization
 */
export const optimizeContent = async (req, res, next) => {
  try {
    const { keyword, topic, language, locale } = req.body;
    const userId = req.user._id;
    const { creditInfo } = req; // From credit middleware

    // Validate keyword
    if (!keyword || keyword.trim().length === 0) {
      return res.status(400).json(
        new ApiResponse(400, null, 'Keyword is required')
      );
    }

    // Validate topic
    if (!topic || topic.trim().length === 0) {
      return res.status(400).json(
        new ApiResponse(400, null, 'Topic is required')
      );
    }

    // Validate and normalize language (NL, FR, EN)
    const supportedLanguages = ['NL', 'FR', 'EN', 'nl', 'fr', 'en'];
    const normalizedLanguage = language ? language.toUpperCase() : null;
    
    if (normalizedLanguage && !supportedLanguages.includes(normalizedLanguage)) {
      console.warn(`Unsupported language: ${language}. Using EN as default.`);
    }

    // Derive locale from language if locale is not provided
    let finalLocale = locale;
    if (!finalLocale && normalizedLanguage) {
      // Map language to default locale
      const languageToLocaleMap = {
        'NL': 'nl-nl',
        'FR': 'fr-fr',
        'EN': 'en-us',
      };
      finalLocale = languageToLocaleMap[normalizedLanguage] || 'en-us';
    } else if (!finalLocale) {
      finalLocale = 'en-us'; // Default fallback
    }

    // Validate locale
    const supportedLocales = ['fr-fr', 'fr-be', 'nl-be', 'nl-nl', 'en-us', 'en-gb'];
    let normalizedLocale = finalLocale.toLowerCase();
    
    if (!supportedLocales.includes(normalizedLocale)) {
      console.warn(`Unsupported locale: ${finalLocale}. Using default (en-us).`);
      finalLocale = 'en-us';
      normalizedLocale = 'en-us';
    }

    // Generate SEO content using Claude
    const optimizedContent = await claudeService.generateSEOContent({
      keyword: keyword.trim(),
      topic: topic.trim(),
      language: normalizedLanguage || 'EN',
      locale: normalizedLocale
    });

    // Decrement credits after successful generation
    if (creditInfo) {
      const { subscription, userCredits } = creditInfo;
      
      // Try to use subscription credits first, then addon credits
      if (subscription && subscription.usage?.ai_generations_used < (subscription.plan_id?.limits?.ai_generations || 0)) {
        // Use subscription credit
        await subscription.incrementUsage('ai_generations', 1);
      } else if (userCredits > 0) {
        // Use addon credit
        const user = await User.findById(userId);
        if (user && user.credits?.ai_generations > 0) {
          user.credits.ai_generations = Math.max(0, user.credits.ai_generations - 1);
          await user.save();
        }
      }
    }

    // Save content to database
    const aiContent = await AIContent.create({
      user: userId,
      keyword: keyword.trim(),
      topic: topic.trim(),
      language: normalizedLanguage || 'EN',
      locale: normalizedLocale,
      metaTitle: optimizedContent.metaTitle,
      metaDescription: optimizedContent.metaDescription,
      htmlContent: optimizedContent.htmlContent,
      faq: optimizedContent.faq || [],
      cta: optimizedContent.cta || null,
      seoScore: optimizedContent.seoScore || 75,
      keywordDensity: optimizedContent.keywordDensity || 'N/A',
      wordCount: optimizedContent.wordCount || 0,
      status: 'completed',
    });

    res.status(201).json(
      new ApiResponse(
        201,
        {
          content: aiContent,
          input: {
            keyword: keyword.trim(),
            topic: topic.trim(),
            language: normalizedLanguage || 'EN',
            locale: normalizedLocale
          }
        },
        'SEO content generated successfully'
      )
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Get AI content by ID
 */
export const getContentById = async (req, res, next) => {
  try {
    const { contentId } = req.params;
    const userId = req.user._id;

    const content = await AIContent.findOne({ _id: contentId, user: userId });

    if (!content) {
      throw new ApiError(404, 'Content not found');
    }

    res.json(new ApiResponse(200, { content }, 'Content retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * Get user's AI content list
 */
export const getUserContent = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 10, keyword } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const query = { user: userId };

    // Optional keyword filter
    if (keyword && keyword.trim()) {
      query.keyword = { $regex: keyword.trim(), $options: 'i' };
    }

    const [contents, total] = await Promise.all([
      AIContent.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      AIContent.countDocuments(query),
    ]);

    res.json(
      new ApiResponse(200, {
        contents,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      }, 'Content retrieved successfully')
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Delete AI content
 */
export const deleteContent = async (req, res, next) => {
  try {
    const { contentId } = req.params;
    const userId = req.user._id;

    const content = await AIContent.findOneAndDelete({ _id: contentId, user: userId });

    if (!content) {
      throw new ApiError(404, 'Content not found');
    }

    res.json(new ApiResponse(200, null, 'Content deleted successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * Download AI content PDF
 */
export const downloadContentPDF = async (req, res, next) => {
  try {
    const { contentId } = req.params;
    const userId = req.user._id;
    const { view } = req.query;

    const content = await AIContent.findOne({ _id: contentId, user: userId }).lean();

    if (!content) {
      throw new ApiError(404, 'Content not found');
    }

    const pdfBuffer = pdfService.generateAIContentReport(content, req.user);

    const keywordSlug = content.keyword
      ? content.keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 20)
      : 'content';
    const topicSlug = content.topic
      ? content.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 20)
      : 'topic';
    const dateStr = new Date(content.createdAt).toISOString().split('T')[0];
    const filename = `ai-content-${topicSlug}-${keywordSlug}-${dateStr}.pdf`;

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

export const claudeController = {
  optimizeContent,
  getContentById,
  getUserContent,
  deleteContent,
  downloadContentPDF,
};