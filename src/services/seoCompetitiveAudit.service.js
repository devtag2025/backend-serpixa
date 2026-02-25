/**
 * SEO Competitive Audit Service - AI-Powered
 * Simplified approach: Send all data to AI, let it analyze and score
 */

import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/index.js';
import { getLocaleConfig, DEFAULT_LOCALE } from '../config/index.js';
import { ApiError } from '../utils/index.js';
import { Logger } from '../utils/logger.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS & CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const AUDIT_AI_MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 8192;

const LOCALE_TO_LOCATION_CODE = {
  en: 2840,
  en_us: 2840,
  en_gb: 2826,
  fr_fr: 2250,
  fr_be: 2056,
  nl_be: 2056,
  nl_nl: 2528,
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function getLocationCode(locale) {
  const normalized = (locale || DEFAULT_LOCALE).toLowerCase().replace('-', '_');
  return LOCALE_TO_LOCATION_CODE[normalized] ?? 2840;
}

function getLanguageCode(locale) {
  const config = getLocaleConfig(locale || DEFAULT_LOCALE);
  return config?.languageCode || config?.language || 'en';
}

function getLanguageInstructions(locale) {
  const normalized = (locale || 'en').toLowerCase().replace('-', '_');
  const config = getLocaleConfig(normalized);
  const lang = config?.languageCode || config?.language || 'en';
  const locationName = config?.locationName || '';

  if (lang === 'fr') {
    return { language: 'French', instruction: `Output all text in French. Location: ${locationName || 'France/Belgium'}.` };
  }
  if (lang === 'nl') {
    return { language: 'Dutch', instruction: `Output all text in Dutch. Location: ${locationName || 'Netherlands/Belgium'}.` };
  }
  return { language: 'English', instruction: 'Output all text in English.' };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retry(fn, maxRetries = 3, delay = 2000) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        Logger.warn(`Attempt ${attempt + 1}/${maxRetries} failed: ${error.message}. Retrying...`);
        await sleep(delay * (attempt + 1));
      }
    }
  }
  throw lastError;
}

// ═══════════════════════════════════════════════════════════════════════════
// DATAFORSEO CLIENT
// ═══════════════════════════════════════════════════════════════════════════

class DataForSEOClient {
  constructor(login, password, baseUrl) {
    this.baseUrl = baseUrl;
    this.auth = Buffer.from(`${login}:${password}`).toString('base64');
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Authorization': `Basic ${this.auth}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    });
  }

  async request(endpoint, payload) {
    return retry(async () => {
      const response = await this.client.post(endpoint, payload);
      if (response.data.tasks?.[0]?.status_code !== 20000) {
        throw new Error(`DataForSEO Error: ${response.data.tasks?.[0]?.status_message}`);
      }
      return response.data;
    });
  }

  async getSerpResults(keyword, locationCode, languageCode = 'en', depth = 10) {
    const endpoint = '/serp/google/organic/live/advanced';
    const payload = [{
      keyword,
      location_code: locationCode,
      language_code: languageCode,
      device: 'desktop',
      depth,
    }];
    Logger.info(`Fetching SERP for: "${keyword}" (location: ${locationCode})`);
    return this.request(endpoint, payload);
  }

  async getOnPageAnalysis(url) {
    const endpoint = '/on_page/instant_pages';
    const payload = [{
      url,
      enable_javascript: true,
      enable_browser_rendering: true,
      load_resources: true,
    }];
    Logger.info(`Analyzing page: ${url}`);
    return this.request(endpoint, payload);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DATA EXTRACTION HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function extractPageData(onPageResult, url) {
  const item = onPageResult?.tasks?.[0]?.result?.[0]?.items?.[0];
  if (!item) return null;

  const meta = item.meta || {};
  const content = meta.content || {};
  const htags = meta.htags || {};
  const checks = item.checks || {};

  return {
    url,
    statusCode: item.status_code,
    title: meta.title || '',
    titleLength: meta.title_length || 0,
    description: meta.description || '',
    descriptionLength: meta.description_length || 0,
    canonical: meta.canonical || '',
    h1Tags: htags.h1 || [],
    h2Tags: htags.h2 || [],
    h3Tags: htags.h3 || [],
    wordCount: content.plain_text_word_count || 0,
    contentSize: content.plain_text_size || 0,
    imagesCount: meta.images_count || 0,
    internalLinksCount: meta.internal_links_count || 0,
    externalLinksCount: meta.external_links_count || 0,
    isIndexable: meta.follow !== false && !checks.no_index,
    hasNoindex: checks.no_index || false,
    missingAltImages: checks.no_image_alt || false,
    missingTitle: checks.no_title || false,
    missingDescription: checks.no_description || false,
    missingH1: checks.no_h1_tag || false,
    onPageScore: item.onpage_score || 0,
    loadTime: item.page_timing?.dom_complete || 0,
    checks,
  };
}

function extractCompetitorData(serpResult, keyword) {
  const items = serpResult?.tasks?.[0]?.result?.[0]?.items || [];
  const organicResults = items.filter(item => item.type === 'organic').slice(0, 10);

  return organicResults.map((result, index) => ({
    position: index + 1,
    url: result.url,
    domain: result.domain,
    title: result.title || '',
    description: result.description || '',
    breadcrumb: result.breadcrumb || '',
  }));
}

async function fetchCompetitorDetails(client, competitors, keyword) {
  const details = [];

  for (const competitor of competitors.slice(0, 10)) {
    try {
      const onPageData = await client.getOnPageAnalysis(competitor.url);
      const pageData = extractPageData(onPageData, competitor.url);

      if (pageData) {
        details.push({
          position: competitor.position,
          url: competitor.url,
          domain: competitor.domain,
          title: pageData.title,
          wordCount: pageData.wordCount,
          h1Count: pageData.h1Tags.length,
          h2Count: pageData.h2Tags.length,
          h3Count: pageData.h3Tags.length,
          h1Tags: pageData.h1Tags.slice(0, 3),
          h2Tags: pageData.h2Tags.slice(0, 5),
          hasKeywordInTitle: pageData.title.toLowerCase().includes(keyword.toLowerCase()),
          hasKeywordInH1: pageData.h1Tags.some(h => h.toLowerCase().includes(keyword.toLowerCase())),
        });
        Logger.info(`  ✓ #${competitor.position}: ${competitor.domain} - ${pageData.wordCount} words`);
      }
    } catch (error) {
      Logger.warn(`  ✗ Failed to analyze ${competitor.url}: ${error.message}`);
    }
  }

  return details;
}

// ═══════════════════════════════════════════════════════════════════════════
// AI-POWERED SEO ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

async function analyzeWithAI(auditData, locale = 'en') {
  const apiKey = env.AUDIT_AI_API_KEY || env.CLAUDE_API_KEY;
  if (!apiKey) {
    throw new ApiError(500, 'AI API key not configured. Set AUDIT_AI_API_KEY or CLAUDE_API_KEY.');
  }

  const { language, instruction } = getLanguageInstructions(locale);
  const localeConfig = getLocaleConfig(locale);
  const locationName = localeConfig?.locationName || locale;

  const systemPrompt = `You are an expert SEO analyst. You will receive:
1. Raw on-page data for the AUDITED PAGE
2. Raw on-page data for TOP 10 COMPETITORS from Google SERP
3. Target KEYWORD and MARKET location

Your job is to analyze whether the audited page can realistically compete with the Top 10 for this keyword.

## ANALYSIS STEPS (in order):

### STEP 1: TOPIC RELEVANCE CHECK (CRITICAL - DO THIS FIRST)
- Does the audited page's content ACTUALLY target the keyword?
- Compare the page's title, H1, H2s, and description against the keyword
- Compare against what competitors are talking about
- A plumbing page CANNOT rank for "walking shoes" - different topics entirely

Topic Relevance Score:
- 0-10%: Complete mismatch (page is about totally different topic)
- 10-25%: Severe mismatch (barely related)
- 25-40%: Low relevance (partially related but not focused)
- 40-70%: Moderate relevance (related but could be stronger)
- 70-100%: Good relevance (page properly targets keyword)

### STEP 2: COMPETITIVE GAP ANALYSIS (only if topic is relevant)
Compare audited page vs Top 10 median/average:
- Content length (word count)
- Heading structure (H1, H2, H3 counts)
- Keyword placement (in title, H1, H2)
- Meta description presence and quality
- Technical issues (noindex, missing elements)

### STEP 3: CALCULATE SCORE
The score answers: "Can this page realistically rank in Top 10 for this keyword?"

Score Guidelines:
- 0-15: Topic mismatch OR critical technical issues (noindex, no content)
- 15-30: Severe topic mismatch OR major content gaps (>70% below competitors)
- 30-50: Low relevance OR significant gaps (50-70% below competitors)
- 50-70: Moderate gaps (25-50% below competitors)
- 70-85: Minor gaps (within 25% of competitors)
- 85-95: Competitive (matches or exceeds competitors)
- Max score is 95 (never give 100)

### STEP 4: GENERATE OUTPUT

${instruction}

## OUTPUT FORMAT (strict JSON):
{
  "score": <number 0-95>,
  "topicRelevance": {
    "score": <number 0-100>,
    "isRelevant": <boolean - true if score >= 40>,
    "reason": "<explanation of topic match/mismatch>"
  },
  "scoreSummary": "<2-3 sentences explaining the score, mention topic mismatch if applicable>",
  "componentScores": {
    "serpSimilarity": <number 0-100>,
    "contentQuality": <number 0-100>,
    "onPageHealth": <number 0-100>
  },
  "recommendations": [
    {
      "priority": "critical|high|medium|low",
      "category": "<Topic Relevance|Content|Structure|Keywords|Technical|Meta>",
      "issue": "<what's wrong>",
      "action": "<what to do>",
      "impact": "high|medium|low",
      "effort": "easy|moderate|difficult",
      "context": "<comparison to competitors or market context>"
    }
  ],
  "strengths": [
    {
      "category": "<string>",
      "title": "<string>",
      "description": "<string>"
    }
  ],
  "competitorBenchmark": {
    "medianWordCount": <number>,
    "medianH2Count": <number>,
    "keywordInTitlePercent": <number 0-100>,
    "keywordInH1Percent": <number 0-100>
  }
}

## CRITICAL RULES:
1. If topic relevance < 40%, score MUST be below 40 and first recommendation MUST be about topic mismatch
2. If page has noindex, score MUST be below 15
3. If page has no content (<100 words), score MUST be below 20
4. Recommendations must be actionable and specific
5. Always compare against the actual competitor data provided
6. Be direct about problems - don't sugarcoat topic mismatches`;

  const userPrompt = `Analyze this SEO audit for the keyword "${auditData.keyword}" in ${locationName}.

## AUDITED PAGE DATA:
${JSON.stringify(auditData.auditedPage, null, 2)}

## TOP 10 COMPETITOR DATA:
${JSON.stringify(auditData.competitors, null, 2)}

## BASIC COMPETITOR INFO (from SERP):
${JSON.stringify(auditData.serpCompetitors, null, 2)}

Analyze thoroughly:
1. First check if the audited page topic matches "${auditData.keyword}"
2. Then compare against competitors
3. Calculate realistic score
4. Provide actionable recommendations in ${language}

Return ONLY the JSON object, no other text.`;

  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: AUDIT_AI_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = message.content?.[0]?.text?.trim() || '';
  if (!text) {
    throw new Error('AI returned empty response');
  }

  // Parse JSON response
  const jsonStr = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  const result = JSON.parse(jsonStr);

  // Validate and enforce rules
  if (result.topicRelevance && !result.topicRelevance.isRelevant && result.score > 40) {
    Logger.warn(`[AI Audit] Enforcing max score 40 for topic mismatch (AI returned ${result.score})`);
    result.score = Math.min(40, result.score);
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SERVICE FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run AI-powered SEO competitive audit
 * @param {string} url - Page URL to audit
 * @param {string} keyword - Target keyword
 * @param {string} locale - Locale (en, fr_fr, fr_be, nl_be, etc.)
 * @param {string} device - desktop | mobile
 * @returns {Promise<Object>} Audit result
 */
async function runCompetitiveAudit(url, keyword, locale = DEFAULT_LOCALE, device = 'desktop') {
  const login = env.DATAFORSEO_LOGIN || env.DATAFORSEO_EMAIL;
  const password = env.DATAFORSEO_PASSWORD || env.DATAFORSEO_API_PASSWORD;
  if (!login || !password) {
    throw new ApiError(500, 'DataForSEO credentials not configured.');
  }

  const baseUrl = (env.DATAFORSEO_API_URL || 'https://api.dataforseo.com').replace(/\/v3\/?$/, '') + '/v3';
  const locationCode = getLocationCode(locale);
  const languageCode = getLanguageCode(locale);
  const localeConfig = getLocaleConfig(locale);

  Logger.info(`[SEO Audit] Starting for ${url}`);
  Logger.info(`[SEO Audit] Keyword: "${keyword}" | Location: ${locationCode} | Language: ${languageCode}`);

  const client = new DataForSEOClient(login, password, baseUrl);

  // Step 1: Fetch SERP results and audit page in parallel
  const [serpResult, auditPageResult] = await Promise.all([
    client.getSerpResults(keyword, locationCode, languageCode),
    client.getOnPageAnalysis(url),
  ]);

  // Step 2: Extract data
  const auditedPage = extractPageData(auditPageResult, url);
  if (!auditedPage) {
    throw new ApiError(400, 'Could not analyze the provided URL');
  }

  const serpCompetitors = extractCompetitorData(serpResult, keyword);
  Logger.info(`[SEO Audit] Found ${serpCompetitors.length} competitors in SERP`);

  // Step 3: Fetch detailed competitor data
  Logger.info(`[SEO Audit] Analyzing competitor pages...`);
  const competitorDetails = await fetchCompetitorDetails(client, serpCompetitors, keyword);
  Logger.info(`[SEO Audit] Successfully analyzed ${competitorDetails.length} competitors`);

  // Step 4: Send everything to AI for analysis
  Logger.info(`[SEO Audit] Running AI analysis...`);
  const aiResult = await analyzeWithAI({
    keyword,
    locale,
    locationName: localeConfig?.locationName || locale,
    auditedPage,
    competitors: competitorDetails,
    serpCompetitors,
  }, locale);

  Logger.info(`[SEO Audit] Complete - Score: ${aiResult.score}/100 | Topic Relevance: ${aiResult.topicRelevance?.score}%`);

  // Step 5: Format response
  const response = {
    score: aiResult.score,
    checks: {
      title: {
        exists: !!auditedPage.title,
        value: auditedPage.title,
        length: auditedPage.titleLength,
      },
      description: {
        exists: !!auditedPage.description,
        value: auditedPage.description,
        length: auditedPage.descriptionLength,
      },
      h1: {
        exists: auditedPage.h1Tags.length > 0,
        count: auditedPage.h1Tags.length,
        values: auditedPage.h1Tags,
      },
      images: {
        total: auditedPage.imagesCount,
        withoutAlt: auditedPage.missingAltImages ? auditedPage.imagesCount : 0,
      },
      links: {
        internal: auditedPage.internalLinksCount,
        external: auditedPage.externalLinksCount,
      },
      canonical: {
        exists: !!auditedPage.canonical,
        value: auditedPage.canonical,
      },
      // AI-generated insights
      scoreSummary: aiResult.scoreSummary,
      topicRelevance: aiResult.topicRelevance,
      componentScores: aiResult.componentScores,
      strengths: aiResult.strengths || [],
      competitorBenchmark: aiResult.competitorBenchmark,
      pageAnalysis: {
        wordCount: auditedPage.wordCount,
        h1Count: auditedPage.h1Tags.length,
        h2Count: auditedPage.h2Tags.length,
        h3Count: auditedPage.h3Tags.length,
        isIndexable: auditedPage.isIndexable,
      },
    },
    keywordAnalysis: {
      keyword,
      location: localeConfig?.locationName || locale,
      language: languageCode,
      competitorCount: competitorDetails.length,
      topicRelevance: aiResult.topicRelevance?.score || 0,
      isTopicRelevant: aiResult.topicRelevance?.isRelevant || false,
    },
    recommendations: aiResult.recommendations || [],
    competitors: serpCompetitors.map((c, i) => ({
      position: c.position,
      url: c.url,
      domain: c.domain,
      title: c.title,
      description: c.description,
      // Add detailed data if available
      ...(competitorDetails.find(d => d.url === c.url) || {}),
    })),
    serpInfo: {
      keyword,
      locationCode,
      languageCode,
      location: localeConfig?.locationName || locale,
      device,
      competitorUrls: serpCompetitors.map(c => c.url),
    },
    raw: {
      auditedPage,
      competitorDetails,
      aiResult,
    },
  };

  return response;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export const seoCompetitiveAuditService = {
  runCompetitiveAudit,
  getLocationCode,
  getLanguageCode,
};

export default seoCompetitiveAuditService;
