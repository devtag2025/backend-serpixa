import { ApiResponse, ApiError } from '../utils/index.js';
import { claudeService } from '../services/index.js';

/**
 * Generate AI-powered SEO content optimization
 */
export const optimizeContent = async (req, res, next) => {
  try {
    const { url, keyword } = req.body;

    if (!url && !keyword) {
      return res.status(400).json(
        new ApiResponse(400, null, 'Either URL or keyword must be provided')
      );
    }

    // If URL is provided, extract content (optional enhancement)
    let urlData = null;
    if (url) {
      try {
        urlData = await claudeService.extractContentFromURL(url);
      } catch (error) {
        // Continue even if URL extraction fails
        console.warn('URL extraction warning:', error.message);
      }
    }

    // Generate SEO content using Claude
    const optimizedContent = await claudeService.generateSEOContent({
      url,
      keyword
    });

    res.status(200).json(
      new ApiResponse(
        200,
        {
          content: optimizedContent,
          input: {
            url: url || null,
            keyword: keyword || null
          }
        },
        'SEO content generated successfully'
      )
    );
  } catch (error) {
    next(error);
  }
};



