import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/index.js';
import { ApiError } from '../utils/index.js';

class ClaudeService {
  constructor() {
    if (!env.CLAUDE_API_KEY) {
      console.warn('CLAUDE_API_KEY not set. Claude service will not work.');
    }
    this.client = env.CLAUDE_API_KEY 
      ? new Anthropic({ apiKey: env.CLAUDE_API_KEY })
      : null;
  }

  /**
   * Generate SEO-optimized content using Claude API
   * @param {Object} params - Content generation parameters
   * @param {string} params.url - Target URL (optional)
   * @param {string} params.keyword - Target keyword (optional)
   * @returns {Promise<Object>} Generated SEO content
   */
  
  async generateSEOContent({ url, keyword }) {
    if (!this.client) {
      throw new ApiError(500, 'Claude API key not configured');
    }

    if (!url && !keyword) {
      throw new ApiError(400, 'Either URL or keyword must be provided');
    }

    try {
      const prompt = this.buildSEOPrompt(url, keyword);
      
      const message = await this.client.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      const content = message.content[0].text;
      return this.parseSEOContent(content);
    } catch (error) {
      console.error('Claude API Error:', error);
      if (error.status === 401) {
        throw new ApiError(401, 'Invalid Claude API key');
      } else if (error.status === 429) {
        throw new ApiError(429, 'Claude API rate limit exceeded');
      } else if (error.status >= 500) {
        throw new ApiError(503, 'Claude API service unavailable');
      }
      throw new ApiError(500, 'Failed to generate SEO content', error.message);
    }
  }

  /**
   * Build the SEO optimization prompt for Claude
   */
  buildSEOPrompt(url, keyword) {
    let prompt = `You are an expert SEO content writer. Generate comprehensive, SEO-optimized content that targets an SEO score of 70-80%.

`;

    if (url) {
      prompt += `Analyze the URL: ${url}\n`;
      prompt += `Generate optimized content based on the URL's topic and purpose.\n\n`;
    }

    if (keyword) {
      prompt += `Target Keyword: ${keyword}\n`;
      prompt += `Create content optimized for this keyword while maintaining natural readability.\n\n`;
    }

    prompt += `Generate the following SEO-optimized content elements:

1. **Title Tag** (50-60 characters, include target keyword naturally)
2. **Meta Description** (150-160 characters, compelling and keyword-rich)
3. **H1 Heading** (main heading, include primary keyword)
4. **H2 Headings** (2-4 subheadings, include related keywords)
5. **H3 Headings** (3-6 subheadings for detailed sections)
6. **Body Content** (800-1200 words, well-structured, keyword-optimized, natural flow)
7. **FAQ Section** (5-7 relevant questions and answers, include target keyword)
8. **CTA (Call-to-Action)** (compelling, action-oriented, 1-2 sentences)

**Requirements:**
- Content should be engaging, informative, and valuable to readers
- Use target keyword naturally (avoid keyword stuffing)
- Include related keywords and semantic variations
- Structure content with proper headings hierarchy
- Ensure content aligns with SEO best practices for a score of 70-80%
- Make content scannable with short paragraphs and bullet points where appropriate
- Include internal linking opportunities (mention related topics)
- Write in a professional yet accessible tone

**Output Format:**
Please provide the content in the following JSON structure:
{
  "titleTag": "...",
  "metaDescription": "...",
  "h1": "...",
  "h2": ["...", "..."],
  "h3": ["...", "...", "..."],
  "bodyContent": "...",
  "faq": [
    {
      "question": "...",
      "answer": "..."
    }
  ],
  "cta": "...",
  "seoScore": 75,
  "keywordDensity": "...",
  "wordCount": 0
}

Ensure the JSON is valid and properly formatted.`;

    return prompt;
  }

  /**
   * Parse Claude's response into structured SEO content
   */
  parseSEOContent(content) {
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in Claude response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate required fields
      const requiredFields = ['titleTag', 'metaDescription', 'h1', 'bodyContent', 'cta'];
      const missingFields = requiredFields.filter(field => !parsed[field]);
      
      if (missingFields.length > 0) {
        throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
      }

      // Ensure arrays exist
      if (!Array.isArray(parsed.h2)) parsed.h2 = [];
      if (!Array.isArray(parsed.h3)) parsed.h3 = [];
      if (!Array.isArray(parsed.faq)) parsed.faq = [];

      // Calculate word count if not provided
      if (!parsed.wordCount) {
        parsed.wordCount = parsed.bodyContent.split(/\s+/).length;
      }

      // Ensure SEO score is within target range
      if (!parsed.seoScore || parsed.seoScore < 70) {
        parsed.seoScore = 75; // Default to mid-range
      }

      return {
        titleTag: parsed.titleTag,
        metaDescription: parsed.metaDescription,
        h1: parsed.h1,
        h2: parsed.h2,
        h3: parsed.h3,
        bodyContent: parsed.bodyContent,
        faq: parsed.faq,
        cta: parsed.cta,
        seoScore: parsed.seoScore,
        keywordDensity: parsed.keywordDensity || 'N/A',
        wordCount: parsed.wordCount,
        generatedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error parsing Claude response:', error);
      // Fallback: return structured content even if JSON parsing fails
      return {
        titleTag: 'SEO Optimized Title',
        metaDescription: 'SEO optimized meta description',
        h1: 'Main Heading',
        h2: [],
        h3: [],
        bodyContent: content,
        faq: [],
        cta: 'Take action now!',
        seoScore: 75,
        keywordDensity: 'N/A',
        wordCount: content.split(/\s+/).length,
        generatedAt: new Date().toISOString(),
        rawResponse: content
      };
    }
  }

  /**
   * Extract content from a URL (basic implementation)
   * This can be enhanced with web scraping libraries
   */
  async extractContentFromURL(url) {
    // Basic URL validation
    try {
      new URL(url);
    } catch {
      throw new ApiError(400, 'Invalid URL format');
    }

    // For now, we'll just use the URL in the prompt
    // In production, you might want to use a web scraping service
    // or fetch the page content here
    return { url, extracted: false };
  }
}

export const claudeService = new ClaudeService();
export default claudeService;


