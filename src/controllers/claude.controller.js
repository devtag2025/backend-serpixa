import { ApiResponse, ApiError } from '../utils/index.js';
import { claudeService } from '../services/index.js';
import { User } from '../models/index.js';

/**
 * Generate AI-powered SEO content optimization
 */
export const optimizeContent = async (req, res, next) => {
  try {
    const { keyword, locale = 'en-us' } = req.body;
    const userId = req.user._id;
    const { creditInfo } = req; // From credit middleware

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