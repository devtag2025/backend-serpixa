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
   * @param {string} params.topic - Topic/Subject (required)
   * @param {string} params.language - Language code (NL, FR, EN) (optional, default: EN)
   * @param {string} params.locale - Language locale (optional, default: en-us)
   * @returns {Promise<Object>} Generated SEO content
   */
  async generateSEOContent({ keyword, topic, language = 'EN', locale = 'en-us' }) {
    if (!this.client) {
      throw new ApiError(500, 'Claude API key not configured');
    }

    if (!keyword) {
      throw new ApiError(400, 'Keyword is required');
    }

    if (!topic) {
      throw new ApiError(400, 'Topic is required');
    }

    try {
      const prompt = this.buildSEOPrompt(keyword, topic, language, locale);
      
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
      console.log('📋 Claude response:', message.content[0].text);

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
  buildSEOPrompt(keyword, topic, language, locale) {
    // Map language codes to format used in prompt (FR/NL/EN)
    const languageMap = {
      'NL': 'NL',
      'FR': 'FR',
      'EN': 'EN',
      'nl': 'NL',
      'fr': 'FR',
      'en': 'EN',
      'nl-be': 'NL',
      'nl-nl': 'NL',
      'fr-fr': 'FR',
      'fr-be': 'FR',
      'en-us': 'EN',
      'en-gb': 'EN',
    };
    
    const promptLanguage = languageMap[language?.toUpperCase()] || languageMap[locale?.toLowerCase()] || 'EN';
    const localeInstructions = this.buildLocaleInstructions(locale);

    return `Create a complete HTML page optimized SIMULTANEOUSLY for:
Google SEO (Search Engine Optimization)
LLM comprehension (Claude, ChatGPT, Perplexity)

TOPIC: ${topic}
MAIN KEYWORD: ${keyword}
in ${promptLanguage}


STRICT GUIDELINES:

📝 CONTENT:
2500-3500 words minimum
Natural and conversational tone
Accessible vocabulary (high school level)
Each technical concept simply defined
Concrete examples in each section
Everyday metaphors for complex concepts
Precise statistics and data when relevant

🏗️ STRUCTURE:
Single H1 with main keyword
Initial summary with key points
6-8 main sections (H2)
FAQ section with MINIMUM 6 questions and answers (REQUIRED - must be included in JSON response)
CTA (Call-to-Action): Create an impactful and persuasive CTA that is coherent with the generated content
Summary conclusion
Breadcrumb navigation included

🔍 TECHNICAL SEO:
Title tag 50-60 characters with keyword
Meta description 150-160 characters, engaging
Optimized URL slug (/main-keyword)
Schema.org Article + FAQPage
Complete Open Graph and Twitter Card
3-5 strategic internal links
Images with descriptive alt text

🤖 LLM OPTIMIZATION:
Boxed definitions for each concept
Structured FAQ with natural questions
Direct answers before elaboration
Autonomous and quotable sections
Comparison tables if relevant
Visible update dates (current year)
Boxed concrete examples

💻 FORMAT:
Complete semantic HTML5
Inline CSS optimized for performance
Responsive design (mobile-first)
WCAG AA accessibility
PageSpeed performance 90+

The content must be 100% original, factual, and provide real added value. No filler. No unrealistic promises. Expert but accessible tone.

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
      "question": "What is the main topic about?",
      "answer": "The answer explaining the topic..."
    },
    {
      "question": "Why is this important?",
      "answer": "The answer explaining importance..."
    },
    {
      "question": "How does it work?",
      "answer": "The answer explaining how it works..."
    },
    {
      "question": "What are the benefits?",
      "answer": "The answer explaining benefits..."
    },
    {
      "question": "Are there any risks?",
      "answer": "The answer explaining risks..."
    },
    {
      "question": "Where can I learn more?",
      "answer": "The answer explaining where to learn more..."
    }
  ],
  "cta": "...",
  "seoScore": 75,
  "keywordDensity": "1.5%",
  "wordCount": 2500
}

CRITICAL RULES:
1. Your response must start with { and end with }
2. The htmlContent field must be a SINGLE LINE string with \\n for newlines
3. Do NOT format the HTML with actual newlines - use \\n escape sequence
4. Do NOT wrap the JSON in code blocks
5. Make sure all quotes inside strings are escaped with backslash
6. Ensure word count is between 2500-3500 words
7. Include Schema.org markup, Open Graph, and Twitter Card tags in the HTML
8. Include breadcrumb navigation in the HTML
9. FAQ ARRAY IS MANDATORY AND REQUIRED: You MUST include the "faq" array in your JSON response with at least 6 FAQ items. DO NOT put FAQ only in HTML - it MUST be in the JSON "faq" array. Each FAQ item must have both "question" and "answer" fields as separate JSON objects. Example:
   "faq": [
     {"question": "Question 1?", "answer": "Answer 1"},
     {"question": "Question 2?", "answer": "Answer 2"}
   ]
10. FAQ questions should be related to the topic "${topic}" and keyword "${keyword}". Make them useful and searchable.
11. IMPORTANT: The FAQ must appear BOTH in the HTML content (for Schema.org) AND in the JSON "faq" array. Do not skip the JSON array.`;
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
    // This is a more robust approach that handles various JSON formats
    try {
      // First, try to fix the htmlContent field which often contains unescaped characters
      // Look for htmlContent field with various patterns
      const htmlContentPatterns = [
        /"htmlContent"\s*:\s*"([\s\S]*?)"\s*,\s*"faq"/,
        /"htmlContent"\s*:\s*"([\s\S]*?)"\s*,\s*"cta"/,
        /"htmlContent"\s*:\s*"([\s\S]*?)"\s*\}/,
      ];
      
      for (const pattern of htmlContentPatterns) {
        const htmlContentMatch = jsonString.match(pattern);
        if (htmlContentMatch) {
          const originalHtmlContent = htmlContentMatch[1];
          // Only fix if there are actual unescaped newlines (not already escaped)
          if (originalHtmlContent.includes('\n') && !originalHtmlContent.includes('\\n')) {
            const fixedHtmlContent = originalHtmlContent
              .replace(/\\/g, '\\\\') // Escape backslashes first
              .replace(/"/g, '\\"')   // Escape quotes
              .replace(/\n/g, '\\n')   // Escape newlines
              .replace(/\r/g, '\\r')   // Escape carriage returns
              .replace(/\t/g, '\\t');  // Escape tabs
            
            jsonString = jsonString.replace(pattern, (match, content) => {
              return match.replace(content, fixedHtmlContent);
            });
            break;
          }
        }
      }
      
      console.log('✅ JSON control characters fixed');
    } catch (fixError) {
      console.warn('⚠️ Could not auto-fix JSON:', fixError.message);
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonString);
      console.log('✅ JSON parsed successfully');
      console.log('📋 Parsed keys:', Object.keys(parsed));
      console.log('📋 FAQ in parsed object:', parsed.faq);
      console.log('📋 FAQ type:', typeof parsed.faq);
      console.log('📋 FAQ is array:', Array.isArray(parsed.faq));
      if (parsed.faq) {
        console.log('📋 FAQ length:', parsed.faq.length);
      }
    } catch (parseError) {
      console.error('❌ JSON parsing failed:', parseError.message);
      console.error('First 500 chars of JSON:', jsonString.substring(0, 500));
      
      // Last resort: try to manually parse key fields
      try {
        console.log('⚠️ Attempting manual extraction...');
        
        const htmlContent = this.extractHtmlContent(jsonString);
        const extractedFaq = this.extractFaqArray(jsonString);
        const metaTitle = this.extractJsonValue(jsonString, 'metaTitle');
        const metaDescription = this.extractJsonValue(jsonString, 'metaDescription');
        const finalFaq = extractedFaq.length > 0 ? extractedFaq : this.extractFAQFromHTML(htmlContent);
        const cta = this.extractJsonValue(jsonString, 'cta') || this.extractCTAFromHTML(htmlContent) || 'Contact us today!';
        const seoScoreValue = this.extractJsonValue(jsonString, 'seoScore');
        const calculatedScore = this.calculateSEOScore({ 
          htmlContent, 
          metaTitle, 
          metaDescription, 
          faq: finalFaq 
        }, keyword);
        
        parsed = {
          metaTitle,
          metaDescription,
          htmlContent,
          faq: finalFaq,
          cta,
          seoScore: seoScoreValue ? parseInt(seoScoreValue) || calculatedScore : calculatedScore,
          keywordDensity: this.extractJsonValue(jsonString, 'keywordDensity') || this.calculateKeywordDensity(htmlContent, keyword),
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

    // Ensure arrays exist and extract FAQ properly
    if (!Array.isArray(parsed.faq) || parsed.faq.length === 0) {
      console.warn('⚠️ FAQ not found or empty in parsed JSON, attempting extraction...');
      console.log('📋 Parsed FAQ value:', parsed.faq);
      console.log('📋 FAQ type:', typeof parsed.faq);
      
      // First try to extract from raw JSON string (might be a parsing issue)
      const extractedFromJson = this.extractFaqArray(jsonString);
      if (extractedFromJson.length > 0) {
        console.log('✅ Found FAQ in JSON string:', extractedFromJson.length, 'items');
        parsed.faq = extractedFromJson;
      } else {
        // Try to extract FAQ from HTML content
        console.log('⚠️ Trying to extract FAQ from HTML content...');
        parsed.faq = this.extractFAQFromHTML(parsed.htmlContent || '');
        if (parsed.faq.length > 0) {
          console.log('✅ Found FAQ in HTML:', parsed.faq.length, 'items');
        } else {
          console.warn('❌ No FAQ found in JSON or HTML');
        }
      }
    } else {
      console.log('✅ FAQ found in parsed JSON:', parsed.faq.length, 'items');
    }

    // Calculate word count from HTML content
    if (!parsed.wordCount || parsed.wordCount === 0) {
      const textContent = parsed.htmlContent.replace(/<[^>]*>/g, ' ');
      parsed.wordCount = textContent.split(/\s+/).filter(w => w.length > 0).length;
      console.log('📊 Calculated word count:', parsed.wordCount);
    }

    // Calculate keyword density if not provided
    let keywordDensity = parsed.keywordDensity;
    if (!keywordDensity || keywordDensity === 'N/A' || keywordDensity === '') {
      keywordDensity = this.calculateKeywordDensity(parsed.htmlContent || '', keyword);
      console.log('📊 Calculated keyword density:', keywordDensity);
    }

    // Ensure SEO score is valid
    if (!parsed.seoScore || parsed.seoScore < 0 || parsed.seoScore > 100) {
      // Calculate a basic SEO score based on content quality
      parsed.seoScore = this.calculateSEOScore(parsed, keyword);
      console.log('📊 Calculated SEO score:', parsed.seoScore);
    }

    // Ensure CTA exists
    if (!parsed.cta || parsed.cta.trim() === '') {
      parsed.cta = this.extractCTAFromHTML(parsed.htmlContent || '');
      if (!parsed.cta || parsed.cta.trim() === '') {
        parsed.cta = 'Contact us today!';
      }
    }

    const result = {
      metaTitle: parsed.metaTitle,
      metaDescription: parsed.metaDescription,
      htmlContent: parsed.htmlContent,
      faq: parsed.faq || [],
      cta: parsed.cta || 'Contact us today!',
      seoScore: parsed.seoScore || 75,
      keywordDensity: keywordDensity || 'N/A',
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

// Helper method: Extract simple JSON value (handles escaped quotes)
extractJsonValue(jsonString, key) {
  // Try multiple patterns to extract values
  const patterns = [
    new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'i'),
    new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, 'i'),
    new RegExp(`"${key}"\\s*:\\s*([^,}\\]]+)`, 'i'),
  ];
  
  for (const regex of patterns) {
    const match = jsonString.match(regex);
    if (match && match[1]) {
      return match[1].trim().replace(/^"|"$/g, '');
    }
  }
  return '';
}

// Helper method: Extract HTML content (handles newlines and various formats)
extractHtmlContent(jsonString) {
  // Try multiple patterns to find htmlContent
  const patterns = [
    /"htmlContent"\s*:\s*"([\s\S]*?)"\s*,\s*"faq"/,
    /"htmlContent"\s*:\s*"([\s\S]*?)"\s*,\s*"cta"/,
    /"htmlContent"\s*:\s*"([\s\S]*?)"\s*\}/,
    /"htmlContent"\s*:\s*"([\s\S]*?)"/,
  ];
  
  for (const pattern of patterns) {
    const match = jsonString.match(pattern);
    if (match && match[1]) {
      // Unescape the content
      return match[1]
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
  }
  return '';
}

// Helper method: Extract FAQ array from JSON string
extractFaqArray(jsonString) {
  try {
    console.log('🔍 Extracting FAQ from JSON string...');
    
    // Try multiple patterns to find FAQ array
    const patterns = [
      /"faq"\s*:\s*\[([\s\S]*?)\]\s*,/,
      /"faq"\s*:\s*\[([\s\S]*?)\]\s*\}/,
      /"faq"\s*:\s*\[([\s\S]*?)\]/,
      /"faq"\s*:\s*\[\s*([\s\S]*?)\s*\]/,
    ];

    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      const faqMatch = jsonString.match(pattern);
      if (faqMatch) {
        console.log(`✅ Found FAQ pattern ${i + 1}, attempting to parse...`);
        console.log('📋 FAQ match preview:', faqMatch[1].substring(0, 200));
        
        try {
          // Clean up the FAQ string
          let faqContent = faqMatch[1].trim();
          
          // Try to parse the FAQ array
          const faqString = '[' + faqContent + ']';
          const faqArray = JSON.parse(faqString);
          
          if (Array.isArray(faqArray)) {
            console.log(`📊 Parsed FAQ array with ${faqArray.length} items`);
            
            // Validate and normalize FAQ structure
            const validFaq = faqArray
              .filter(item => {
                if (!item) return false;
                const hasQuestion = !!(item.question || item.q || item.Question || item.Q);
                const hasAnswer = !!(item.answer || item.a || item.Answer || item.A);
                return hasQuestion && hasAnswer;
              })
              .map(item => ({
                question: item.question || item.q || item.Question || item.Q || '',
                answer: item.answer || item.a || item.Answer || item.A || ''
              }))
              .filter(item => item.question.trim() && item.answer.trim());
            
            if (validFaq.length > 0) {
              console.log(`✅ Extracted ${validFaq.length} valid FAQ items`);
              return validFaq;
            } else {
              console.warn('⚠️ FAQ array found but no valid items after filtering');
            }
          }
        } catch (parseError) {
          console.warn(`⚠️ Could not parse FAQ array with pattern ${i + 1}:`, parseError.message);
          // Try manual extraction as fallback
          const manualFaq = this.extractFAQManually(faqMatch[1]);
          if (manualFaq.length > 0) {
            console.log(`✅ Manually extracted ${manualFaq.length} FAQ items`);
            return manualFaq;
          }
          continue;
        }
      }
    }
    
    console.warn('❌ No FAQ array found in JSON string');
  } catch (e) {
    console.error('❌ Error extracting FAQ array:', e.message);
  }
  return [];
}

// Helper method: Manually extract FAQ from string
extractFAQManually(faqString) {
  const faq = [];
  try {
    // Look for question-answer pairs
    const qaPatterns = [
      /"question"\s*:\s*"([^"]+)"[\s\S]*?"answer"\s*:\s*"([^"]+)"/g,
      /"q"\s*:\s*"([^"]+)"[\s\S]*?"a"\s*:\s*"([^"]+)"/g,
      /question["\s]*:["\s]*([^",}]+)[\s\S]*?answer["\s]*:["\s]*([^",}]+)/gi,
    ];
    
    for (const pattern of qaPatterns) {
      let match;
      while ((match = pattern.exec(faqString)) !== null) {
        const question = match[1].trim();
        const answer = match[2].trim();
        if (question && answer && question.length > 5 && answer.length > 10) {
          faq.push({ question, answer });
        }
      }
      if (faq.length > 0) break;
    }
  } catch (e) {
    console.warn('Could not manually extract FAQ:', e.message);
  }
  return faq;
}

// Helper method: Extract FAQ from HTML content
extractFAQFromHTML(htmlContent) {
  const faq = [];
  try {
    console.log('🔍 Extracting FAQ from HTML content...');
    
    // First, try Schema.org FAQPage format (most common)
    const schemaOrgPattern = /<div[^>]*itemscope[^>]*itemtype=["']https?:\/\/schema\.org\/FAQPage["'][^>]*>([\s\S]*?)<\/div>/i;
    const schemaMatch = htmlContent.match(schemaOrgPattern);
    
    if (schemaMatch) {
      console.log('✅ Found Schema.org FAQPage format');
      const faqSection = schemaMatch[1];
      
      // Extract each Question-Answer pair - handle both itemprop="mainEntity" and direct Question types
      const questionPatterns = [
        /<div[^>]*itemprop=["']mainEntity["'][^>]*itemscope[^>]*itemtype=["']https?:\/\/schema\.org\/Question["'][^>]*>([\s\S]*?)<\/div>/gi,
        /<div[^>]*itemscope[^>]*itemtype=["']https?:\/\/schema\.org\/Question["'][^>]*>([\s\S]*?)<\/div>/gi,
      ];
      
      for (const questionPattern of questionPatterns) {
        let questionMatch;
        questionPattern.lastIndex = 0; // Reset regex
        
        while ((questionMatch = questionPattern.exec(faqSection)) !== null) {
          const questionBlock = questionMatch[1];
          
          // Extract question text (itemprop="name") - try multiple patterns
          const namePatterns = [
            /<h[1-6][^>]*itemprop=["']name["'][^>]*>([\s\S]*?)<\/h[1-6]>/i,
            /<[^>]*itemprop=["']name["'][^>]*>([\s\S]*?)<\/[^>]*>/i,
            /<h3[^>]*>([\s\S]*?)<\/h3>/i,
          ];
          
          let nameMatch = null;
          for (const pattern of namePatterns) {
            nameMatch = questionBlock.match(pattern);
            if (nameMatch) break;
          }
          
          // Extract answer text (itemprop="acceptedAnswer" -> itemprop="text")
          const answerPatterns = [
            /<div[^>]*itemprop=["']acceptedAnswer["'][^>]*>[\s\S]*?<div[^>]*itemprop=["']text["'][^>]*>([\s\S]*?)<\/div>/i,
            /<div[^>]*itemprop=["']text["'][^>]*>([\s\S]*?)<\/div>/i,
            /<div[^>]*itemprop=["']acceptedAnswer["'][^>]*>([\s\S]*?)<\/div>/i,
          ];
          
          let answerMatch = null;
          for (const pattern of answerPatterns) {
            answerMatch = questionBlock.match(pattern);
            if (answerMatch) break;
          }
          
          if (nameMatch && answerMatch) {
            const question = nameMatch[1].replace(/<[^>]*>/g, '').trim();
            const answer = answerMatch[1].replace(/<[^>]*>/g, '').trim();
            
            if (question && answer && question.length > 5 && answer.length > 10) {
              faq.push({ question, answer });
              console.log(`✅ Extracted FAQ: ${question.substring(0, 50)}...`);
            }
          }
        }
        
        if (faq.length > 0) break; // Stop if we found FAQs with this pattern
      }
    }
    
    // If no Schema.org FAQ found, try other patterns
    if (faq.length === 0) {
      console.log('⚠️ Schema.org FAQ not found, trying other patterns...');
      
      // Look for FAQ patterns in HTML
      const faqPatterns = [
        /<h[2-6][^>]*>.*?faq.*?<\/h[2-6]>[\s\S]*?<dl[^>]*>([\s\S]*?)<\/dl>/i,
        /<section[^>]*class="[^"]*faq[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
        /<div[^>]*class="[^"]*faq[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      ];

      for (const pattern of faqPatterns) {
        const match = htmlContent.match(pattern);
        if (match) {
          const faqSection = match[1];
          // Extract question-answer pairs
          const qaPattern = /<dt[^>]*>([\s\S]*?)<\/dt>[\s\S]*?<dd[^>]*>([\s\S]*?)<\/dd>/gi;
          let qaMatch;
          while ((qaMatch = qaPattern.exec(faqSection)) !== null) {
            const question = qaMatch[1].replace(/<[^>]*>/g, '').trim();
            const answer = qaMatch[2].replace(/<[^>]*>/g, '').trim();
            if (question && answer) {
              faq.push({ question, answer });
            }
          }
          if (faq.length > 0) break;
        }
      }
    }
    
    console.log(`📊 Extracted ${faq.length} FAQ items from HTML`);
  } catch (e) {
    console.error('❌ Error extracting FAQ from HTML:', e.message);
  }
  return faq;
}

// Helper method: Calculate keyword density
calculateKeywordDensity(htmlContent, keyword) {
  try {
    if (!htmlContent || !keyword) return 'N/A';
    
    // Strip HTML tags
    const textContent = htmlContent.replace(/<[^>]*>/g, ' ').toLowerCase();
    const keywordLower = keyword.toLowerCase();
    
    // Count total words
    const words = textContent.split(/\s+/).filter(w => w.length > 0);
    const totalWords = words.length;
    
    if (totalWords === 0) return '0%';
    
    // Count keyword occurrences (exact match)
    const keywordCount = (textContent.match(new RegExp(`\\b${keywordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')) || []).length;
    
    // Calculate density
    const density = ((keywordCount / totalWords) * 100).toFixed(2);
    return `${density}%`;
  } catch (e) {
    console.warn('Could not calculate keyword density:', e.message);
    return 'N/A';
  }
}

// Helper method: Calculate basic SEO score
calculateSEOScore(parsed, keyword) {
  let score = 50; // Base score
  
  // Check for required elements
  if (parsed.metaTitle && parsed.metaTitle.length >= 30 && parsed.metaTitle.length <= 60) score += 10;
  if (parsed.metaDescription && parsed.metaDescription.length >= 120 && parsed.metaDescription.length <= 160) score += 10;
  if (parsed.htmlContent && parsed.htmlContent.includes(`<h1`)) score += 10;
  if (parsed.htmlContent && parsed.htmlContent.match(/<h2[^>]*>/gi)?.length >= 3) score += 10;
  if (parsed.faq && Array.isArray(parsed.faq) && parsed.faq.length >= 6) score += 10;
  if (parsed.wordCount && parsed.wordCount >= 2500) score += 10;
  
  // Check keyword presence
  if (parsed.metaTitle && parsed.metaTitle.toLowerCase().includes(keyword.toLowerCase())) score += 5;
  if (parsed.htmlContent && parsed.htmlContent.toLowerCase().includes(keyword.toLowerCase())) score += 5;
  
  return Math.min(score, 100);
}

// Helper method: Extract CTA from HTML
extractCTAFromHTML(htmlContent) {
  try {
    // Look for CTA patterns
    const ctaPatterns = [
      /<a[^>]*class="[^"]*cta[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
      /<button[^>]*class="[^"]*cta[^"]*"[^>]*>([\s\S]*?)<\/button>/i,
      /<div[^>]*class="[^"]*cta[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /<section[^>]*class="[^"]*cta[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
    ];

    for (const pattern of ctaPatterns) {
      const match = htmlContent.match(pattern);
      if (match) {
        const ctaText = match[1].replace(/<[^>]*>/g, '').trim();
        if (ctaText && ctaText.length > 0) {
          return ctaText;
        }
      }
    }
  } catch (e) {
    console.warn('Could not extract CTA from HTML:', e.message);
  }
  return null;
}
}

export const claudeService = new ClaudeService();
export default claudeService;