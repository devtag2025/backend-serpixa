import { ApiResponse, ApiError } from '../utils/index.js';
import { claudeService } from '../services/index.js';

/**
 * Generate AI-powered SEO content optimization
 */
export const optimizeContent = async (req, res, next) => {
  try {
    const { keyword, locale = 'en-us' } = req.body;

    // Validate keyword
    if (!keyword || keyword.trim().length === 0) {
      return res.status(400).json(
        new ApiResponse(400, null, 'Keyword is required')
      );
    }

    // Validate locale (optional)
    const supportedLocales = ['fr-fr', 'fr-be', 'nl-be', 'nl-nl', 'en-us', 'en-gb'];
    const normalizedLocale = locale.toLowerCase();
    
    if (!supportedLocales.includes(normalizedLocale)) {
      console.warn(`Unsupported locale: ${locale}. Using default (en-us).`);
    }

    // Generate SEO content using Claude
    const optimizedContent = await claudeService.generateSEOContent({
      keyword: keyword.trim(),
      locale: normalizedLocale
    });

    res.status(200).json(
      new ApiResponse(
        200,
        {
          content: optimizedContent,
          input: {
            keyword: keyword.trim(),
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