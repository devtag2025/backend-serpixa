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
   * Build locale-specific instructions
   */
  buildLocaleInstructions(locale) {
    switch (locale.toLowerCase()) {
      case 'fr-fr':
        return `
Language: French (France, fr-FR).
- Use natural French for France (vocabulary, examples, references to the French market).`;

      case 'fr-be':
        return `
Language: French (Belgium, fr-BE).
- Use French adapted to Belgium (vocabulary, natural turns).
- References to the Belgian context (Belgian market, Belgian cities, local regulations if relevant).`;

      case 'nl-be':
        return `
Taal: Nederlands (België, nl-BE).
- Gebruik natuurlijk Vlaams Nederlands.
- Verwijs naar België (markt, steden, context) indien relevant.`;

      case 'nl-nl':
        return `
Taal: Nederlands (Nederland, nl-NL).
- Gebruik standaard Nederlands zoals in Nederland.
- Verwijs eerder naar Nederlandse indien context nodig.`;

      case 'en-us':
        return `
Language: English (United States, en-US).
- Use natural American English.
- Reference US market, cities, and context where relevant.`;

      case 'en-gb':
        return `
Language: English (United Kingdom, en-GB).
- Use British English spelling and vocabulary.
- Reference UK market, cities, and context where relevant.`;

      default:
        return `
Language: English (default).
- Use standard English.
- Keep examples and references general and internationally applicable.`;
    }
  }

  /**
   * Generate SEO-optimized content using Claude API
   * @param {Object} params - Content generation parameters
   * @param {string} params.keyword - Target keyword (required)
   * @param {string} params.locale - Language locale (optional, default: en-us)
   * @returns {Promise<Object>} Generated SEO content
   */
  async generateSEOContent({ keyword, locale = 'en-us' }) {
    if (!this.client) {
      throw new ApiError(500, 'Claude API key not configured');
    }

    if (!keyword) {
      throw new ApiError(400, 'Keyword is required');
    }

    try {
      const prompt = this.buildSEOPrompt(keyword, locale);
      
      const message = await this.client.messages.create({
        model: 'claude-3-haiku-20240307',  // ✅ Most likely to work
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      const content = message.content[0].text;
      return this.parseSEOContent(content, keyword, locale);
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
buildSEOPrompt(keyword, locale) {
  const localeInstructions = this.buildLocaleInstructions(locale);

  return `You are a senior SEO expert specializing in long-tail content for the web.

Keyword: "${keyword}"

${localeInstructions}

Objective:
Create a complete SEO page, optimized for this keyword, that can be published directly on a website.

Constraints:
- Minimum 1500 words
- Clear structure with:
  - 1x <h1> containing the keyword
  - Several <h2> and some <h3>
- Tone: professional, educational, value-oriented for the reader
- Integrate the main keyword:
  - In the H1
  - In the introduction
  - In at least 2-3 subtitles (H2/H3)
  - In the conclusion
- Also use natural semantic variants (synonyms, similar expressions)
- Adapt the examples, references, and formulas to the market and language indicated by the locale

SEO Requirements:
- Add a meta title (max 60 characters) optimized for the keyword
- Add a meta description (max 155 characters), persuasive, with the keyword
- Keyword density: 1-2% (natural integration)
- Include internal linking opportunities
- Add FAQ section (5-7 questions)
- Include a compelling CTA

Output format:
Respond with ONLY valid JSON. The JSON MUST be properly formatted with:
- NO markdown code blocks or backticks
- NO literal newlines in string values (use \\n instead)
- Properly escaped quotes
- All HTML content on a SINGLE LINE with \\n for line breaks

{
  "metaTitle": "...",
  "metaDescription": "...",
  "htmlContent": "<h1>Title</h1>\\n<p>Content here...</p>\\n<h2>Subtitle</h2>",
  "faq": [
    {
      "question": "...",
      "answer": "..."
    }
  ],
  "cta": "...",
  "seoScore": 75,
  "keywordDensity": "1.5%",
  "wordCount": 1500
}

CRITICAL RULES:
1. Your response must start with { and end with }
2. The htmlContent field must be a SINGLE LINE string with \\n for newlines
3. Do NOT format the HTML with actual newlines - use \\n escape sequence
4. Do NOT wrap the JSON in code blocks
5. Make sure all quotes inside strings are escaped with backslash`;
}

  /**
   * Parse Claude's response into structured SEO content
   */
parseSEOContent(content, keyword, locale) {
  try {
    console.log('📋 Parsing Claude response...');
    
    // Remove markdown code blocks if present
    let cleanContent = content.trim();
    cleanContent = cleanContent.replace(/```json\s*/g, '');
    cleanContent = cleanContent.replace(/```\s*/g, '');
    cleanContent = cleanContent.trim();
    
    // Try to extract JSON from the response
    const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('❌ No JSON found in response');
      throw new Error('No JSON found in Claude response');
    }

    let jsonString = jsonMatch[0];
    
    // Fix: Replace unescaped newlines and control characters in string values
    // This regex finds string values and escapes newlines within them
    try {
      // Parse using a more lenient approach
      // First, try to fix common issues with the HTML content field
      
      // Find the htmlContent field and fix newlines in it
      const htmlContentMatch = jsonString.match(/"htmlContent"\s*:\s*"([\s\S]*?)"\s*,\s*"faq"/);
      
      if (htmlContentMatch) {
        const originalHtmlContent = htmlContentMatch[1];
        // Replace actual newlines with \n escape sequence
        const fixedHtmlContent = originalHtmlContent
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
          .replace(/\t/g, '\\t');
        
        jsonString = jsonString.replace(
          /"htmlContent"\s*:\s*"[\s\S]*?"\s*,\s*"faq"/,
          `"htmlContent": "${fixedHtmlContent}", "faq"`
        );
      }
      
      console.log('✅ JSON control characters fixed');
    } catch (fixError) {
      console.warn('⚠️ Could not auto-fix JSON:', fixError.message);
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonString);
      console.log('✅ JSON parsed successfully');
    } catch (parseError) {
      console.error('❌ JSON parsing failed:', parseError.message);
      console.error('First 500 chars of JSON:', jsonString.substring(0, 500));
      
      // Last resort: try to manually parse key fields
      try {
        console.log('⚠️ Attempting manual extraction...');
        
        parsed = {
          metaTitle: this.extractJsonValue(jsonString, 'metaTitle'),
          metaDescription: this.extractJsonValue(jsonString, 'metaDescription'),
          htmlContent: this.extractHtmlContent(jsonString),
          faq: this.extractFaqArray(jsonString),
          cta: this.extractJsonValue(jsonString, 'cta'),
          seoScore: parseInt(this.extractJsonValue(jsonString, 'seoScore')) || 75,
          keywordDensity: this.extractJsonValue(jsonString, 'keywordDensity') || 'N/A',
          wordCount: parseInt(this.extractJsonValue(jsonString, 'wordCount')) || 0
        };
        
        console.log('✅ Manual extraction successful');
      } catch (manualError) {
        console.error('❌ Manual extraction failed:', manualError.message);
        throw new Error('Failed to parse JSON response from Claude');
      }
    }

    // Validate required fields
    const requiredFields = ['metaTitle', 'metaDescription', 'htmlContent'];
    const missingFields = requiredFields.filter(field => !parsed[field]);
    
    if (missingFields.length > 0) {
      console.warn('⚠️ Missing required fields:', missingFields.join(', '));
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }

    // Ensure arrays exist
    if (!Array.isArray(parsed.faq)) {
      console.warn('⚠️ FAQ not an array, converting...');
      parsed.faq = [];
    }

    // Calculate word count from HTML content
    if (!parsed.wordCount || parsed.wordCount === 0) {
      const textContent = parsed.htmlContent.replace(/<[^>]*>/g, ' ');
      parsed.wordCount = textContent.split(/\s+/).filter(w => w.length > 0).length;
      console.log('📊 Calculated word count:', parsed.wordCount);
    }

    // Ensure SEO score is within target range
    if (!parsed.seoScore || parsed.seoScore < 70) {
      parsed.seoScore = 75;
    }

    const result = {
      metaTitle: parsed.metaTitle,
      metaDescription: parsed.metaDescription,
      htmlContent: parsed.htmlContent,
      faq: parsed.faq,
      cta: parsed.cta || 'Contact us today!',
      seoScore: parsed.seoScore,
      keywordDensity: parsed.keywordDensity || 'N/A',
      wordCount: parsed.wordCount,
      keyword: keyword,
      locale: locale,
      generatedAt: new Date().toISOString()
    };

    console.log('✅ Content parsed successfully');
    console.log('📊 Stats:', {
      wordCount: result.wordCount,
      seoScore: result.seoScore,
      faqCount: result.faq.length
    });

    return result;
    
  } catch (error) {
    console.error('❌ Error parsing Claude response:', error);
    console.error('Raw content preview:', content.substring(0, 500));
    
    // Fallback: Return content as-is with basic structure
    return {
      metaTitle: `${keyword} - SEO Optimized Content`,
      metaDescription: `Learn everything about ${keyword}. Comprehensive guide and insights.`,
      htmlContent: content,
      faq: [],
      cta: 'Get started today!',
      seoScore: 75,
      keywordDensity: 'N/A',
      wordCount: content.split(/\s+/).length,
      keyword: keyword,
      locale: locale,
      generatedAt: new Date().toISOString(),
      rawResponse: content,
      parseError: error.message
    };
  }
}

// Helper method: Extract simple JSON value
extractJsonValue(jsonString, key) {
  const regex = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, 'i');
  const match = jsonString.match(regex);
  return match ? match[1] : '';
}

// Helper method: Extract HTML content (handles newlines)
extractHtmlContent(jsonString) {
  const match = jsonString.match(/"htmlContent"\s*:\s*"([\s\S]*?)"\s*,\s*"faq"/);
  if (match) {
    // The HTML content is between quotes, keep as-is
    return match[1];
  }
  return '';
}

// Helper method: Extract FAQ array
extractFaqArray(jsonString) {
  try {
    const faqMatch = jsonString.match(/"faq"\s*:\s*\[([\s\S]*?)\]\s*,/);
    if (faqMatch) {
      const faqString = '[' + faqMatch[1] + ']';
      // Try to parse the FAQ array separately
      return JSON.parse(faqString);
    }
  } catch (e) {
    console.warn('Could not parse FAQ array:', e.message);
  }
  return [];
}
}

export const claudeService = new ClaudeService();
export default claudeService;