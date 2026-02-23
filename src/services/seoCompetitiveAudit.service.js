/**
 * SEO Competitive Audit Service
 * Competitive SEO analysis using SERP benchmark, page audit, and score calculation
 * Returns recommendations in SEO audit format with fr/en/nl locale strings
 */

import axios from 'axios';
import { env } from '../config/index.js';
import { getLocaleConfig, DEFAULT_LOCALE } from '../config/index.js';
import { t } from '../locales/index.js';
import { ApiError } from '../utils/index.js';
import { Logger } from '../utils/logger.js';
import { seoAuditAIService } from './seoAuditAI.service.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS & CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const LOCALE_TO_LOCATION_CODE = {
  en: 2840,      // United States
  en_us: 2840,
  en_gb: 2826,   // United Kingdom
  fr_fr: 2250,   // France
  fr_be: 2056,   // Belgium
  nl_be: 2056,
  nl_nl: 2528,   // Netherlands
};

const SCORING_WEIGHTS = {
  serpSimilarity: 0.45,
  contentQuality: 0.35,
  onPageHealth: 0.20,
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableError(error) {
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') return true;
  const retryableStatusCodes = [408, 429, 500, 502, 503, 504];
  if (error.response && retryableStatusCodes.includes(error.response.status)) return true;
  return false;
}

async function retry(fn, options = {}) {
  const { maxRetries = 3, delay = 2000, backoff = 2, shouldRetry = isRetryableError } = options;
  let lastError;
  let currentDelay = delay;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries - 1 || !shouldRetry(error)) {
        Logger.error(`Max retries reached: ${error.message}`);
        throw error;
      }
      Logger.warn(`Attempt ${attempt + 1}/${maxRetries} failed: ${error.message}. Retrying in ${currentDelay}ms...`);
      await sleep(currentDelay);
      currentDelay *= backoff;
    }
  }
  throw lastError;
}

function createSERPBenchmark(data) {
  return {
    medianContentLength: data.medianContentLength || 0,
    avgContentLength: data.avgContentLength || 0,
    keywordInTitleRatio: data.keywordInTitleRatio || 0,
    keywordInH1Ratio: data.keywordInH1Ratio || 0,
    medianH2Count: data.medianH2Count || 0,
    medianH3Count: data.medianH3Count || 0,
    avgHeadingCount: data.avgHeadingCount || 0,
    dominantPageType: data.dominantPageType || 'other',
    urls: data.urls || [],
  };
}

function createPageAnalysis(data) {
  return {
    contentLength: data.contentLength || 0,
    keywordInTitle: data.keywordInTitle || false,
    keywordInH1: data.keywordInH1 || false,
    h1Count: data.h1Count || 0,
    h2Count: data.h2Count || 0,
    h3Count: data.h3Count || 0,
    pageType: data.pageType || 'other',
    hasNoindex: data.hasNoindex || false,
    hasCanonicalIssue: data.hasCanonicalIssue || false,
    titleLength: data.titleLength || 0,
    metaDescriptionLength: data.metaDescriptionLength || 0,
    hasMetaDescription: data.hasMetaDescription || false,
    title: data.title,
    metaDescription: data.metaDescription,
    wordCount: data.wordCount,
  };
}

function detectPageType(url, title = '', content = '') {
  const urlLower = url.toLowerCase();
  if (/\/(blog|article|post|news|actualite)\//i.test(urlLower)) return 'blog';
  if (/\/(category|categories|categorie|collection)\//i.test(urlLower)) return 'category';
  if (/\/(product|produit|item|p)\//i.test(urlLower)) return 'product';
  if (/\/(service|services)\//i.test(urlLower)) return 'service';
  try {
    const pathSegments = new URL(url).pathname.split('/').filter(s => s.length > 0);
    if (pathSegments.length <= 1) return 'landing';
  } catch {}
  return 'other';
}

function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

function findMostFrequent(arr) {
  const counts = {};
  arr.forEach(item => { counts[item] = (counts[item] || 0) + 1; });
  let maxCount = 0, maxItem = 'other';
  for (const [item, count] of Object.entries(counts)) {
    if (count > maxCount) { maxCount = count; maxItem = item; }
  }
  return maxItem;
}

function translateRecommendations(structured, lang, keyword = '') {
  const langKey = ['fr', 'nl'].includes(lang) ? lang : 'en';
  return structured.map((rec) => {
    const vars = { ...(rec.vars || {}), keyword };
    let issue = rec.issue;
    let action = rec.action;
    if (rec.localeKey) {
      const issuePath = `seo.recommendations.${rec.localeKey}.issue`;
      const actionPath = `seo.recommendations.${rec.localeKey}.action`;
      const translatedIssue = t(langKey, issuePath, vars);
      const translatedAction = t(langKey, actionPath, vars);
      if (translatedIssue !== issuePath) issue = translatedIssue;
      if (translatedAction !== actionPath) action = translatedAction;
    }
    // Map to impact enum expected by SEOAudit model
    // Model supports: 'high', 'medium', 'low'
    let impactLevel;
    switch (rec.priority) {
      case 'critical':
      case 'high':
        impactLevel = 'high';
        break;
      case 'medium':
        impactLevel = 'medium';
        break;
      case 'low':
      default:
        impactLevel = 'low';
        break;
    }
    return {
      priority: rec.priority,
      category: rec.category,
      issue,
      action,
      impact: impactLevel,
      effort: rec.priority === 'low' ? 'easy' : rec.priority === 'critical' ? 'difficult' : 'moderate',
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// DATA FOR SEO CLIENT
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
        const statusCode = response.data.tasks?.[0]?.status_code;
        const statusMessage = response.data.tasks?.[0]?.status_message;
        throw new Error(`DataForSEO Error ${statusCode}: ${statusMessage}`);
      }
      return response.data;
    }, { maxRetries: 3, delay: 2000, shouldRetry: isRetryableError });
  }

  async getSerpResults(keyword, locationCode, languageCode = 'fr', options = {}) {
    const endpoint = '/serp/google/organic/live/advanced';
    const payload = [{
      keyword,
      location_code: locationCode,
      language_code: languageCode,
      device: options.device || 'desktop',
      os: options.os || 'windows',
      depth: options.depth || 10,
    }];
    Logger.info(`Fetching SERP results for: "${keyword}" (location: ${locationCode})`);
    return this.request(endpoint, payload);
  }

  async getOnPageAnalysis(url, options = {}) {
    const endpoint = '/on_page/instant_pages';
    const payload = [{
      url,
      enable_javascript: options.enableJavascript !== false,
      custom_js: options.customJs || null,
    }];
    Logger.info(`Analyzing page: ${url}`);
    return this.request(endpoint, payload);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SERP ANALYZER
// ═══════════════════════════════════════════════════════════════════════════

class SERPAnalyzer {
  constructor(client) {
    this.client = client;
  }

  async buildSerpBenchmark(keyword, locationCode = 2056, languageCode = 'fr') {
    Logger.info(`🔍 Fetching SERP results for: "${keyword}" (location: ${locationCode})`);

    const serpData = await this.client.getSerpResults(keyword, locationCode, languageCode);
    if (!serpData.tasks?.[0]?.result?.[0]?.items) {
      throw new Error('No SERP results found');
    }

    const items = serpData.tasks[0].result[0].items;
    const organicResults = items.filter(item => item.type === 'organic').slice(0, 10);
    Logger.info(`✅ Found ${organicResults.length} organic results`);

    const analyses = [];
    const urls = [];

    for (let i = 0; i < organicResults.length; i++) {
      const result = organicResults[i];
      const url = result.url;
      if (!url) continue;

      Logger.info(`  📄 Analyzing #${i + 1}: ${url.substring(0, 60)}...`);

      try {
        const onPageData = await this.client.getOnPageAnalysis(url);
        if (onPageData.tasks?.[0]?.result?.[0]?.items?.[0]) {
          const item = onPageData.tasks[0].result[0].items[0];
          const meta = item.meta || {};
          const content = meta.content || {};
          const htags = meta.htags || {};
          const title = meta.title || '';
          const h1Tags = htags.h1 || [];
          const h2Tags = htags.h2 || [];
          const h3Tags = htags.h3 || [];
          const plainTextSize = content.plain_text_size || 0;
          const wordCount = content.plain_text_word_count || 0;
          const keywordLower = keyword.toLowerCase();

          analyses.push({
            contentLength: plainTextSize,
            wordCount: wordCount,
            keywordInTitle: title.toLowerCase().includes(keywordLower),
            keywordInH1: h1Tags.some(h1 => h1.toLowerCase().includes(keywordLower)),
            h1Count: h1Tags.length,
            h2Count: h2Tags.length,
            h3Count: h3Tags.length,
            title: title,
            pageType: detectPageType(url, title, ''),
          });
          urls.push(url);
          Logger.info(`    ✓ ${wordCount} words, ${h1Tags.length} H1, ${h2Tags.length} H2`);
        }
      } catch (error) {
        Logger.warn(`  ⚠️ Error analyzing ${url}: ${error.message}`);
        continue;
      }
    }

    if (analyses.length === 0) {
      throw new Error('No pages could be analyzed');
    }

    const contentLengths = analyses.map(a => a.contentLength);
    const h2Counts = analyses.map(a => a.h2Count);
    const h3Counts = analyses.map(a => a.h3Count);
    const headingCounts = analyses.map(a => a.h2Count + a.h3Count);
    const keywordInTitleCount = analyses.filter(a => a.keywordInTitle).length;
    const keywordInH1Count = analyses.filter(a => a.keywordInH1).length;
    const pageTypes = analyses.map(a => a.pageType);
    const dominantType = findMostFrequent(pageTypes);

    const benchmark = createSERPBenchmark({
      medianContentLength: Math.round(median(contentLengths)),
      avgContentLength: mean(contentLengths),
      keywordInTitleRatio: keywordInTitleCount / analyses.length,
      keywordInH1Ratio: keywordInH1Count / analyses.length,
      medianH2Count: Math.round(median(h2Counts)),
      medianH3Count: Math.round(median(h3Counts)),
      avgHeadingCount: mean(headingCounts),
      dominantPageType: dominantType,
      urls,
    });
    benchmark.competitorSummaries = analyses.map((a, i) => ({
      rank: i + 1,
      url: urls[i] || '',
      contentLength: a.contentLength,
      wordCount: a.wordCount,
      h1Count: a.h1Count,
      h2Count: a.h2Count,
      h3Count: a.h3Count,
      keywordInTitle: a.keywordInTitle,
      keywordInH1: a.keywordInH1,
      pageType: a.pageType,
      title: (a.title || '').substring(0, 200),
    }));

    Logger.info('\n📊 SERP Benchmark created:');
    Logger.info(`  - Median content: ${benchmark.medianContentLength} chars`);
    Logger.info(`  - Keyword in title: ${(benchmark.keywordInTitleRatio * 100).toFixed(0)}%`);
    Logger.info(`  - Keyword in H1: ${(benchmark.keywordInH1Ratio * 100).toFixed(0)}%`);
    Logger.info(`  - Dominant page type: ${benchmark.dominantPageType}`);

    return benchmark;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE AUDITOR
// ═══════════════════════════════════════════════════════════════════════════

class PageAuditor {
  constructor(client) {
    this.client = client;
  }

  async auditPage(url, keyword) {
    Logger.info(`\n🔎 Auditing page: ${url}`);

    const onPageData = await this.client.getOnPageAnalysis(url);
    if (!onPageData.tasks?.[0]?.result?.[0]?.items?.[0]) {
      throw new Error('No on-page data found');
    }

    const item = onPageData.tasks[0].result[0].items[0];
    const meta = item.meta || {};
    const content = meta.content || {};
    const htags = meta.htags || {};
    const title = meta.title || '';
    const metaDescription = meta.description || '';
    const h1Tags = htags.h1 || [];
    const h2Tags = htags.h2 || [];
    const h3Tags = htags.h3 || [];
    const plainTextSize = content.plain_text_size || 0;
    const plainTextWordCount = content.plain_text_word_count || 0;
    const keywordLower = keyword.toLowerCase();
    const keywordInH1 = h1Tags.some(h1 => (typeof h1 === 'string' ? h1 : '').toLowerCase().includes(keywordLower));
    const keywordInH2 = h2Tags.some(h2 => (typeof h2 === 'string' ? h2 : '').toLowerCase().includes(keywordLower));
    const pageType = detectPageType(url, title, '');
    const rawChecks = item.checks || {};
    const hasNoindex = !meta.follow;
    const canonical = meta.canonical || '';
    let hasCanonicalIssue = false;
    try {
      if (canonical && canonical !== url) {
        const canonicalUrl = new URL(canonical);
        const pageUrl = new URL(url);
        const norm = (p) => (p || '').replace(/\/+$/, '') || '/';
        const canonPath = norm(canonicalUrl.pathname);
        const pagePath = norm(pageUrl.pathname);
        hasCanonicalIssue = canonPath !== pagePath || canonicalUrl.hostname !== pageUrl.hostname;
      }
    } catch {}

    const analysis = createPageAnalysis({
      contentLength: plainTextSize,
      keywordInTitle: title.toLowerCase().includes(keywordLower),
      keywordInH1: keywordInH1,
      h1Count: h1Tags.length,
      h2Count: h2Tags.length,
      h3Count: h3Tags.length,
      pageType,
      hasNoindex,
      hasCanonicalIssue,
      titleLength: meta.title_length || title.length,
      metaDescriptionLength: meta.description_length || metaDescription.length,
      hasMetaDescription: !rawChecks.no_description && !!metaDescription,
      title,
      metaDescription,
      wordCount: plainTextWordCount,
    });

    // Frontend On-Page Analysis shape: title, description, h1, images, links, canonical
    const imagesCount = meta.images_count ?? 0;
    const internalLinks = meta.internal_links_count ?? 0;
    const externalLinks = meta.external_links_count ?? 0;
    const checks = {
      title: {
        exists: !!title,
        value: title || null,
        length: meta.title_length ?? (title ? String(title).length : 0),
      },
      description: {
        exists: !!metaDescription,
        value: metaDescription || null,
        length: meta.description_length ?? (metaDescription ? String(metaDescription).length : 0),
      },
      h1: {
        exists: h1Tags.length > 0,
        count: h1Tags.length,
        values: h1Tags.map(h => (typeof h === 'string' ? h : String(h))),
      },
      images: {
        total: imagesCount,
        withoutAlt: rawChecks.no_image_alt ? (typeof meta.images_count === 'number' ? meta.images_count : 1) : 0,
      },
      links: {
        internal: internalLinks,
        external: externalLinks,
        broken: rawChecks.broken_links ? 1 : 0,
      },
      canonical: {
        exists: !!canonical,
        value: canonical || null,
      },
    };

    Logger.info('✅ Page audited:');
    Logger.info(`  - Content: ${analysis.contentLength} chars / ${analysis.wordCount} words`);
    Logger.info(`  - H1: ${h1Tags.length} tags ${h1Tags.length > 0 ? `("${h1Tags[0]?.substring(0, 50)}...")` : '(MISSING!)'}`);
    Logger.info(`  - H2: ${h2Tags.length} tags`);
    Logger.info(`  - H3: ${h3Tags.length} tags`);
    Logger.info(`  - Keyword in title: ${analysis.keywordInTitle}`);
    Logger.info(`  - Keyword in H1: ${analysis.keywordInH1}`);
    Logger.info(`  - Keyword in H2: ${keywordInH2}`);
    Logger.info(`  - Page type: ${analysis.pageType}`);

    const rawItemSnapshot = buildRawItemSnapshot(item, url, keyword);
    return { analysis, checks, rawItemSnapshot };
  }
}

/** Returns true if the target keyword (or all its words) appears in title, meta description, or any H1/H2/H3. */
function isKeywordFoundOnPage(keyword, rawItemSnapshot) {
  if (!keyword || typeof keyword !== 'string' || !rawItemSnapshot) {
    return true;
  }
  const kw = keyword.trim().toLowerCase();
  if (!kw) return true;

  const meta = rawItemSnapshot.meta || {};
  const htags = rawItemSnapshot.htags || {};
  const exactPhrase = (text) => (typeof text === 'string' ? text : '').toLowerCase().includes(kw);
  const words = kw.split(/\s+/).filter(Boolean);
  const allWordsPresent = (text) => {
    const t = (typeof text === 'string' ? text : '').toLowerCase();
    return words.length > 0 && words.every((w) => t.includes(w));
  };
  const containsKw = (text) => exactPhrase(text) || (words.length > 1 && allWordsPresent(text));

  if (containsKw(meta.title) || containsKw(meta.description)) return true;
  const h1 = (htags.h1 || []);
  const h2 = (htags.h2 || []);
  const h3 = (htags.h3 || []);
  for (const t of h1) if (containsKw(t)) return true;
  for (const t of h2) if (containsKw(t)) return true;
  for (const t of h3) if (containsKw(t)) return true;
  return false;
}

/** Build a compact DataForSEO snapshot for the AI (no huge content). */
function buildRawItemSnapshot(item, url, keyword) {
  const meta = item.meta || {};
  const content = meta.content || {};
  const htags = meta.htags || {};
  const trunc = (s, max = 300) => (typeof s === 'string' ? s : '').substring(0, max);
  return {
    url,
    keyword,
    meta: {
      title: trunc(meta.title, 400),
      description: trunc(meta.description, 500),
      canonical: meta.canonical || '',
      title_length: meta.title_length ?? 0,
      description_length: meta.description_length ?? 0,
      internal_links_count: meta.internal_links_count ?? 0,
      external_links_count: meta.external_links_count ?? 0,
      images_count: meta.images_count ?? 0,
      follow: meta.follow !== false,
    },
    content: {
      plain_text_size: content.plain_text_size ?? 0,
      plain_text_word_count: content.plain_text_word_count ?? 0,
    },
    htags: {
      h1: (htags.h1 || []).slice(0, 5).map((h) => trunc(String(h), 200)),
      h2: (htags.h2 || []).slice(0, 15).map((h) => trunc(String(h), 150)),
      h3: (htags.h3 || []).slice(0, 20).map((h) => trunc(String(h), 100)),
      h1Count: (htags.h1 || []).length,
      h2Count: (htags.h2 || []).length,
      h3Count: (htags.h3 || []).length,
    },
    checks: {
      no_description: !!(item.checks && item.checks.no_description),
      no_title: !!(item.checks && item.checks.no_title),
      no_h1_tag: !!(item.checks && item.checks.no_h1_tag),
      broken_links: !!(item.checks && item.checks.broken_links),
      no_image_alt: !!(item.checks && item.checks.no_image_alt),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SEO SCORE CALCULATOR - Gap-Based Analysis (Production Ready)
// Score = 100 - sum(competitive_gaps); every point has a recommendation.
// ═══════════════════════════════════════════════════════════════════════════

class SEOScoreCalculator {
  calculateScore(page, benchmark) {
    const vPage = this.validatePageData(page);
    const vBenchmark = this.validateBenchmarkData(benchmark);
    const gaps = this.analyzeCompetitiveGaps(vPage, vBenchmark);
    const serpScore = this.calcComponent(gaps, 'serp');
    const contentScore = this.calcComponent(gaps, 'content');
    const onPageScore = this.calcComponent(gaps, 'onpage');
    const weights = SCORING_WEIGHTS;
    const finalScore =
      serpScore * weights.serpSimilarity +
      contentScore * weights.contentQuality +
      onPageScore * weights.onPageHealth;
    const recommendations = this.buildOutput(gaps, vPage, vBenchmark, finalScore, serpScore, contentScore, onPageScore);
    const result = {
      finalScore: this.round(finalScore),
      serpSimilarity: this.round(serpScore),
      contentQuality: this.round(contentScore),
      onPageHealth: this.round(onPageScore),
      recommendations,
    };
    this.logResults(result, gaps);
    return result;
  }

  validatePageData(page) {
    if (!page || typeof page !== 'object') page = {};
    return {
      contentLength: this.toInt(page.contentLength, 0),
      wordCount: this.toInt(page.wordCount, 0),
      keywordInTitle: Boolean(page.keywordInTitle),
      keywordInH1: Boolean(page.keywordInH1),
      h1Count: this.toInt(page.h1Count, 0),
      h2Count: this.toInt(page.h2Count, 0),
      h3Count: this.toInt(page.h3Count, 0),
      pageType: this.toStr(page.pageType, 'other'),
      titleLength: this.toInt(page.titleLength, 0),
      metaDescriptionLength: this.toInt(page.metaDescriptionLength, 0),
      hasMetaDescription: Boolean(page.hasMetaDescription),
      hasNoindex: Boolean(page.hasNoindex),
      hasCanonicalIssue: Boolean(page.hasCanonicalIssue),
    };
  }

  validateBenchmarkData(benchmark) {
    if (!benchmark || typeof benchmark !== 'object') benchmark = {};
    return {
      medianContentLength: this.toInt(benchmark.medianContentLength, 1),
      avgContentLength: this.toInt(benchmark.avgContentLength, 1),
      keywordInTitleRatio: this.toRatio(benchmark.keywordInTitleRatio, 0),
      keywordInH1Ratio: this.toRatio(benchmark.keywordInH1Ratio, 0),
      medianH2Count: this.toInt(benchmark.medianH2Count, 1),
      medianH3Count: this.toInt(benchmark.medianH3Count, 0),
      avgHeadingCount: this.toInt(benchmark.avgHeadingCount, 1),
      dominantPageType: this.toStr(benchmark.dominantPageType, 'other'),
      urls: Array.isArray(benchmark.urls) ? benchmark.urls : [],
    };
  }

  analyzeCompetitiveGaps(page, benchmark) {
    const gaps = [];
    const m = this.calcMetrics(page, benchmark);

    if (page.hasNoindex) {
      gaps.push({
        id: 'noindex', category: 'onpage', severity: 'CRITICAL', points: 85,
        title: 'Page Blocked from Indexing',
        issue: 'Your page has a noindex directive preventing search engine indexing.',
        vsCompetitors: 'All Top 10 competitors are indexed and visible in search.',
        recommendation: 'Remove the noindex meta tag or X-Robots-Tag header immediately.',
        effort: 'Low', impact: 'Critical', timeframe: 'Immediate'
      });
    }
    if (page.titleLength === 0) {
      gaps.push({
        id: 'no_title', category: 'onpage', severity: 'CRITICAL', points: 25,
        title: 'Missing Title Tag',
        issue: 'Your page has no title tag.',
        vsCompetitors: '100% of Top 10 have title tags.',
        recommendation: 'Add a <title> tag (50-60 chars) with your target keyword.',
        effort: 'Low', impact: 'Critical', timeframe: 'Immediate'
      });
    }
    if (page.h1Count === 0) {
      gaps.push({
        id: 'no_h1', category: 'content', severity: 'CRITICAL', points: 20,
        title: 'Missing H1 Heading',
        issue: 'Your page has no H1 heading.',
        vsCompetitors: '100% of Top 10 have H1 headings.',
        recommendation: 'Add one H1 tag with your target keyword at the top of content.',
        effort: 'Low', impact: 'Critical', timeframe: 'Immediate'
      });
    }
    if (page.contentLength < 100) {
      gaps.push({
        id: 'no_content', category: 'serp', severity: 'CRITICAL', points: 40,
        title: 'No Meaningful Content',
        issue: 'Your page has virtually no content.',
        vsCompetitors: `Top 10 have median ${m.medianWordCount.toLocaleString()} words.`,
        recommendation: 'Add substantial content covering your topic comprehensively.',
        effort: 'High', impact: 'Critical', timeframe: '1-2 weeks'
      });
    }

    if (page.contentLength >= 100) {
      if (m.contentRatio < 0.4) {
        gaps.push({
          id: 'content_severe', category: 'serp', severity: 'HIGH', points: 35,
          title: 'Content Severely Below Competitors',
          issue: `Your content (${m.wordCount.toLocaleString()} words) is ${m.contentPctBelow}% shorter than Top 10 median (${m.medianWordCount.toLocaleString()} words).`,
          vsCompetitors: `Need ~${m.wordDiff.toLocaleString()} more words to match.`,
          recommendation: 'Significantly expand content. Analyze competitors for missing topics.',
          effort: 'High', impact: 'High', timeframe: '1-2 weeks'
        });
      } else if (m.contentRatio < 0.6) {
        gaps.push({
          id: 'content_very_short', category: 'serp', severity: 'HIGH', points: 25,
          title: 'Content Well Below Competitors',
          issue: `Your content is ${m.contentPctBelow}% below the Top 10 median.`,
          vsCompetitors: `Gap of ${m.wordDiff.toLocaleString()} words.`,
          recommendation: `Add ${m.wordDiff.toLocaleString()} words covering topics competitors address.`,
          effort: 'High', impact: 'High', timeframe: '1-2 weeks'
        });
      } else if (m.contentRatio < 0.75) {
        gaps.push({
          id: 'content_short', category: 'serp', severity: 'MEDIUM', points: 15,
          title: 'Content Below Competitor Average',
          issue: `Your content is ${m.contentPctBelow}% shorter than the median.`,
          vsCompetitors: `Adding ${m.wordDiff.toLocaleString()} words would match competitors.`,
          recommendation: 'Expand with additional sections, FAQs, or examples.',
          effort: 'Medium', impact: 'Medium', timeframe: '3-7 days'
        });
      } else if (m.contentRatio < 0.9) {
        gaps.push({
          id: 'content_slightly_short', category: 'serp', severity: 'LOW', points: 8,
          title: 'Content Slightly Below Competitors',
          issue: `Your content is ${m.contentPctBelow}% below median - close but not matching.`,
          vsCompetitors: `Only ${m.wordDiff.toLocaleString()} words short.`,
          recommendation: 'Consider adding FAQ or expanding existing sections.',
          effort: 'Low', impact: 'Low', timeframe: '1-3 days'
        });
      } else if (m.contentRatio < 0.97) {
        gaps.push({
          id: 'content_near', category: 'serp', severity: 'LOW', points: 3,
          title: 'Content Nearly Matches Competitors',
          issue: `Content within ${m.contentPctBelow}% of median.`,
          vsCompetitors: `Just ${m.wordDiff.toLocaleString()} words below median.`,
          recommendation: 'Minor expansion could give you an edge.',
          effort: 'Low', impact: 'Low', timeframe: '1 day'
        });
      }
    }

    if (!page.keywordInTitle && page.titleLength > 0) {
      if (m.kwTitlePct >= 70) {
        gaps.push({
          id: 'no_kw_title_high', category: 'serp', severity: 'HIGH', points: 15,
          title: 'Keyword Missing from Title (Critical Pattern)',
          issue: 'Your title does not contain the target keyword.',
          vsCompetitors: `${m.kwTitlePct}% of Top 10 include it - strong ranking pattern.`,
          recommendation: 'Rewrite title to include keyword near the beginning.',
          effort: 'Low', impact: 'High', timeframe: 'Same day'
        });
      } else if (m.kwTitlePct >= 50) {
        gaps.push({
          id: 'no_kw_title_med', category: 'serp', severity: 'MEDIUM', points: 10,
          title: 'Keyword Missing from Title',
          issue: 'Title does not contain target keyword.',
          vsCompetitors: `${m.kwTitlePct}% of Top 10 include it.`,
          recommendation: 'Consider adding keyword to title.',
          effort: 'Low', impact: 'Medium', timeframe: 'Same day'
        });
      } else if (m.kwTitlePct >= 30) {
        gaps.push({
          id: 'no_kw_title_low', category: 'serp', severity: 'LOW', points: 5,
          title: 'Keyword Not in Title (Optional)',
          issue: 'Title does not contain exact keyword.',
          vsCompetitors: `Only ${m.kwTitlePct}% of Top 10 include it - weak pattern.`,
          recommendation: 'May help but not critical for this query.',
          effort: 'Low', impact: 'Low', timeframe: 'When convenient'
        });
      }
    }

    if (!page.keywordInH1 && page.h1Count > 0) {
      if (m.kwH1Pct >= 70) {
        gaps.push({
          id: 'no_kw_h1_high', category: 'serp', severity: 'HIGH', points: 12,
          title: 'Keyword Missing from H1 (Critical Pattern)',
          issue: 'Your H1 does not contain the target keyword.',
          vsCompetitors: `${m.kwH1Pct}% of Top 10 include it - strong pattern.`,
          recommendation: 'Update H1 to include keyword naturally.',
          effort: 'Low', impact: 'High', timeframe: 'Same day'
        });
      } else if (m.kwH1Pct >= 50) {
        gaps.push({
          id: 'no_kw_h1_med', category: 'serp', severity: 'MEDIUM', points: 8,
          title: 'Keyword Missing from H1',
          issue: 'H1 does not contain target keyword.',
          vsCompetitors: `${m.kwH1Pct}% of Top 10 include it.`,
          recommendation: 'Consider updating H1 to include keyword.',
          effort: 'Low', impact: 'Medium', timeframe: 'Same day'
        });
      } else if (m.kwH1Pct >= 30) {
        gaps.push({
          id: 'no_kw_h1_low', category: 'serp', severity: 'LOW', points: 4,
          title: 'Keyword Not in H1 (Optional)',
          issue: 'H1 does not contain exact keyword.',
          vsCompetitors: `Only ${m.kwH1Pct}% include it - weak pattern.`,
          recommendation: 'May provide slight benefit.',
          effort: 'Low', impact: 'Low', timeframe: 'When convenient'
        });
      }
    }

    if (page.h1Count > 1) {
      gaps.push({
        id: 'multiple_h1', category: 'content', severity: 'MEDIUM', points: 10,
        title: 'Multiple H1 Tags Detected',
        issue: `Your page has ${page.h1Count} H1 tags. Best practice is one.`,
        vsCompetitors: 'Proper pages use single H1 for topic clarity.',
        recommendation: `Keep one H1 with keyword. Convert ${page.h1Count - 1} others to H2.`,
        effort: 'Low', impact: 'Medium', timeframe: 'Same day'
      });
    }

    if (page.h2Count === 0 && page.h1Count > 0 && page.contentLength > 500) {
      gaps.push({
        id: 'no_h2', category: 'content', severity: 'HIGH', points: 15,
        title: 'No Content Structure (Missing H2)',
        issue: 'Your page has no H2 subheadings.',
        vsCompetitors: `Top 10 use median ${benchmark.medianH2Count} H2 headings.`,
        recommendation: `Add ${benchmark.medianH2Count}+ H2 subheadings for clear sections.`,
        effort: 'Medium', impact: 'High', timeframe: '1-2 days'
      });
    } else if (page.h2Count > 0 && m.h2Ratio < 0.4) {
      gaps.push({
        id: 'very_few_h2', category: 'content', severity: 'MEDIUM', points: 10,
        title: 'Weak Content Structure',
        issue: `You have ${page.h2Count} H2 vs ${benchmark.medianH2Count} median.`,
        vsCompetitors: `Competitors use ${Math.round((1 / m.h2Ratio - 1) * 100)}% more H2s.`,
        recommendation: `Add ${m.h2Diff} more H2 subheadings.`,
        effort: 'Medium', impact: 'Medium', timeframe: '1-2 days'
      });
    } else if (page.h2Count > 0 && m.h2Ratio < 0.7) {
      gaps.push({
        id: 'few_h2', category: 'content', severity: 'LOW', points: 5,
        title: 'Content Structure Below Competitors',
        issue: `You have ${page.h2Count} H2 vs ${benchmark.medianH2Count} median.`,
        vsCompetitors: `Adding ${m.h2Diff} H2s would match competitors.`,
        recommendation: 'Consider adding more subheadings.',
        effort: 'Low', impact: 'Low', timeframe: '1-2 days'
      });
    }

    if (page.titleLength > 70) {
      gaps.push({
        id: 'title_long', category: 'onpage', severity: 'LOW', points: 5,
        title: 'Title Tag Too Long',
        issue: `Title is ${page.titleLength} chars. Google shows 50-60.`,
        vsCompetitors: 'Your title will be truncated in search results.',
        recommendation: `Shorten to 50-60 chars (remove ~${page.titleLength - 60}).`,
        effort: 'Low', impact: 'Low', timeframe: 'Same day'
      });
    } else if (page.titleLength > 0 && page.titleLength < 25) {
      gaps.push({
        id: 'title_short', category: 'onpage', severity: 'LOW', points: 5,
        title: 'Title Tag Too Short',
        issue: `Title is only ${page.titleLength} chars.`,
        vsCompetitors: 'Not using full SERP space (50-60 optimal).',
        recommendation: 'Expand to 50-60 chars with keyword-rich copy.',
        effort: 'Low', impact: 'Low', timeframe: 'Same day'
      });
    }

    if (!page.hasMetaDescription) {
      gaps.push({
        id: 'no_meta', category: 'onpage', severity: 'MEDIUM', points: 10,
        title: 'Missing Meta Description',
        issue: 'Your page has no meta description.',
        vsCompetitors: 'All Top 10 have meta descriptions.',
        recommendation: 'Add compelling meta (145-160 chars) with keyword and CTA.',
        effort: 'Low', impact: 'Medium', timeframe: 'Same day'
      });
    } else if (page.metaDescriptionLength > 170) {
      gaps.push({
        id: 'meta_long', category: 'onpage', severity: 'LOW', points: 3,
        title: 'Meta Description Truncated',
        issue: `Meta is ${page.metaDescriptionLength} chars (145-160 recommended).`,
        vsCompetitors: 'Your snippet may be cut off.',
        recommendation: `Trim to 145-160 chars (remove ~${page.metaDescriptionLength - 160}).`,
        effort: 'Low', impact: 'Low', timeframe: 'Same day'
      });
    } else if (page.metaDescriptionLength < 80 && page.metaDescriptionLength > 0) {
      gaps.push({
        id: 'meta_short', category: 'onpage', severity: 'LOW', points: 3,
        title: 'Meta Description Too Short',
        issue: `Meta is only ${page.metaDescriptionLength} chars.`,
        vsCompetitors: 'Not using full snippet space (145-160 optimal).',
        recommendation: 'Expand to 145-160 chars with compelling copy.',
        effort: 'Low', impact: 'Low', timeframe: 'Same day'
      });
    }

    if (page.hasCanonicalIssue) {
      gaps.push({
        id: 'canonical', category: 'onpage', severity: 'MEDIUM', points: 10,
        title: 'Canonical URL Mismatch',
        issue: 'Canonical tag points to different URL.',
        vsCompetitors: 'May cause indexing issues.',
        recommendation: 'Ensure canonical points to correct URL.',
        effort: 'Low', impact: 'Medium', timeframe: 'Same day'
      });
    }

    if (page.pageType !== benchmark.dominantPageType && benchmark.dominantPageType !== 'other') {
      gaps.push({
        id: 'page_type', category: 'serp', severity: 'LOW', points: 5,
        title: 'Content Format Differs from Top 10',
        issue: `Your page is '${page.pageType}', Top 10 is mostly '${benchmark.dominantPageType}'.`,
        vsCompetitors: 'Dominant format suggests user preference.',
        recommendation: 'Analyze if your format serves user intent.',
        effort: 'High', impact: 'Medium', timeframe: '1-2 weeks'
      });
    }

    return gaps;
  }

  calcMetrics(page, benchmark) {
    const wordCount = page.wordCount > 0 ? page.wordCount : Math.round(page.contentLength / 5);
    const medianWordCount = Math.round(benchmark.medianContentLength / 5);
    const contentRatio = benchmark.medianContentLength > 0 ? page.contentLength / benchmark.medianContentLength : 1;
    const h2Ratio = benchmark.medianH2Count > 0 ? page.h2Count / benchmark.medianH2Count : 1;
    return {
      wordCount,
      medianWordCount,
      wordDiff: medianWordCount - wordCount,
      contentRatio,
      contentPctBelow: Math.round((1 - contentRatio) * 100),
      h2Ratio,
      h2Diff: benchmark.medianH2Count - page.h2Count,
      kwTitlePct: Math.round(benchmark.keywordInTitleRatio * 100),
      kwH1Pct: Math.round(benchmark.keywordInH1Ratio * 100),
    };
  }

  calcComponent(gaps, category) {
    const catGaps = gaps.filter(g => g.category === category);
    const deduction = catGaps.reduce((sum, g) => sum + g.points, 0);
    return Math.max(0, Math.min(100, 100 - deduction));
  }

  buildOutput(gaps, page, benchmark, finalScore, serpScore, contentScore, onPageScore) {
    const m = this.calcMetrics(page, benchmark);
    const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    const sortedGaps = [...gaps].sort((a, b) => {
      if (order[a.severity] !== order[b.severity]) return order[a.severity] - order[b.severity];
      return b.points - a.points;
    });
    const counts = {
      total: gaps.length,
      critical: gaps.filter(g => g.severity === 'CRITICAL').length,
      high: gaps.filter(g => g.severity === 'HIGH').length,
      medium: gaps.filter(g => g.severity === 'MEDIUM').length,
      low: gaps.filter(g => g.severity === 'LOW').length,
    };
    let grade, gradeLabel, summaryText;
    if (counts.critical > 0) {
      grade = 'F'; gradeLabel = 'CRITICAL ISSUES';
      summaryText = `${counts.critical} critical issue(s) blocking ranking potential. Fix immediately.`;
    } else if (finalScore >= 95) {
      grade = 'A+'; gradeLabel = 'EXCEPTIONAL';
      summaryText = counts.total === 0 ? 'No competitive gaps found.' : `Excellent with ${counts.total} minor optimization(s).`;
    } else if (finalScore >= 90) {
      grade = 'A'; gradeLabel = 'EXCELLENT';
      summaryText = `Highly competitive. ${counts.total} minor gap(s) available.`;
    } else if (finalScore >= 80) {
      grade = 'B'; gradeLabel = 'GOOD';
      summaryText = `Competitive with ${counts.total} gap(s). ${counts.high > 0 ? counts.high + ' high-priority.' : ''}`;
    } else if (finalScore >= 70) {
      grade = 'C'; gradeLabel = 'AVERAGE';
      summaryText = `${counts.total} gap(s) vs Top 10. Improvements needed.`;
    } else if (finalScore >= 50) {
      grade = 'D'; gradeLabel = 'BELOW AVERAGE';
      summaryText = `Significant gaps. ${counts.high} high-priority issues.`;
    } else {
      grade = 'F'; gradeLabel = 'NEEDS WORK';
      summaryText = 'Major competitive disadvantages on multiple factors.';
    }
    const strengths = [];
    if (m.contentRatio >= 1.5) {
      strengths.push({ category: 'Content Depth', title: 'Exceptional Content Length', description: `${m.wordCount.toLocaleString()} words (${Math.round((m.contentRatio - 1) * 100)}% above median)`, status: 'EXCEEDS' });
    } else if (m.contentRatio >= 1.0) {
      strengths.push({ category: 'Content Depth', title: 'Competitive Content Length', description: `${m.wordCount.toLocaleString()} words (meets/exceeds median)`, status: 'MATCHES' });
    } else if (m.contentRatio >= 0.97) {
      strengths.push({ category: 'Content Depth', title: 'Content On Target', description: 'Within 3% of median', status: 'MATCHES' });
    }
    if (page.keywordInTitle && page.titleLength > 0) {
      strengths.push({ category: 'Keyword', title: 'Keyword in Title', description: 'Target keyword in title tag', status: 'OPTIMIZED' });
    }
    if (page.keywordInH1 && page.h1Count === 1) {
      strengths.push({ category: 'Keyword', title: 'Keyword in H1', description: 'Target keyword in main heading', status: 'OPTIMIZED' });
    }
    if (page.h1Count === 1) {
      strengths.push({ category: 'Structure', title: 'Proper H1 Usage', description: 'Single H1 tag', status: 'CORRECT' });
    }
    if (m.h2Ratio >= 1.0 && page.h2Count > 0) {
      strengths.push({ category: 'Structure', title: m.h2Ratio >= 1.5 ? 'Excellent Heading Structure' : 'Good Heading Structure', description: `${page.h2Count} H2 subheadings`, status: m.h2Ratio >= 1.5 ? 'EXCEEDS' : 'MATCHES' });
    }
    if (page.titleLength >= 45 && page.titleLength <= 60) {
      strengths.push({ category: 'Meta', title: 'Optimal Title Length', description: `${page.titleLength} chars`, status: 'OPTIMAL' });
    }
    if (page.hasMetaDescription && page.metaDescriptionLength >= 130 && page.metaDescriptionLength <= 160) {
      strengths.push({ category: 'Meta', title: 'Optimal Meta Description', description: `${page.metaDescriptionLength} chars`, status: 'OPTIMAL' });
    }
    if (page.pageType === benchmark.dominantPageType) {
      strengths.push({ category: 'Intent', title: 'Aligned Content Format', description: `'${page.pageType}' matches Top 10`, status: 'ALIGNED' });
    }
    if (!page.hasNoindex) {
      strengths.push({ category: 'Technical', title: 'Page Indexable', description: 'No noindex directive', status: 'CORRECT' });
    }
    const opportunities = [];
    if (finalScore >= 50) {
      opportunities.push({ category: 'Content', title: 'Content gap analysis', description: 'Review Top 10 pages for subtopics and questions you might be missing.', potential: 'Align with full user intent.' });
      opportunities.push({ category: 'Internal Linking', title: 'Strengthen internal links', description: 'Link to this page from related, high-authority pages on your site.', potential: 'Better crawl and topical signals.' });
    }
    if (finalScore >= 70) {
      opportunities.push({ category: 'SERP Features', title: 'Target Featured Snippets', description: 'Add definition paragraphs, FAQs, or lists for position zero.', potential: 'Significant visibility increase.' });
      opportunities.push({ category: 'Structured Data', title: 'Implement Schema', description: 'Add Article, FAQ, or HowTo schema.', potential: '20-30% CTR improvement.' });
    }
    if (finalScore >= 80) {
      opportunities.push({ category: 'Authority', title: 'Build Content Cluster', description: 'Create supporting articles linking to this page.', potential: 'Topical authority and more traffic.' });
      opportunities.push({ category: 'Links', title: 'Competitor Backlinks', description: 'Find sites linking to Top 10 competitors.', potential: 'Quality backlinks boost rankings.' });
    }
    const benchmarkData = {
      metrics: [
        { name: 'Content Length', yours: `${m.wordCount.toLocaleString()} words`, topTen: `${m.medianWordCount.toLocaleString()} words`, diff: m.contentRatio >= 1 ? `+${Math.round((m.contentRatio - 1) * 100)}%` : `-${m.contentPctBelow}%`, status: m.contentRatio >= 1 ? 'PASS' : m.contentRatio >= 0.9 ? 'CLOSE' : 'GAP', gap: m.contentRatio < 1 ? `Need ${m.wordDiff.toLocaleString()} words` : null },
        { name: 'H2 Headings', yours: page.h2Count.toString(), topTen: benchmark.medianH2Count.toString(), diff: m.h2Ratio >= 1 ? `+${Math.round((m.h2Ratio - 1) * 100)}%` : `-${Math.round((1 - m.h2Ratio) * 100)}%`, status: m.h2Ratio >= 1 ? 'PASS' : m.h2Ratio >= 0.7 ? 'CLOSE' : 'GAP', gap: m.h2Ratio < 1 ? `Need ${m.h2Diff} more` : null },
        { name: 'Keyword in Title', yours: page.keywordInTitle ? 'Yes' : 'No', topTen: `${m.kwTitlePct}% have it`, status: page.keywordInTitle ? 'PASS' : m.kwTitlePct >= 50 ? 'GAP' : 'OPTIONAL', gap: !page.keywordInTitle && m.kwTitlePct >= 50 ? 'Add keyword' : null },
        { name: 'Keyword in H1', yours: page.keywordInH1 ? 'Yes' : 'No', topTen: `${m.kwH1Pct}% have it`, status: page.keywordInH1 ? 'PASS' : m.kwH1Pct >= 50 ? 'GAP' : 'OPTIONAL', gap: !page.keywordInH1 && m.kwH1Pct >= 50 ? 'Add keyword' : null },
        { name: 'Meta Description', yours: page.hasMetaDescription ? `${page.metaDescriptionLength} chars` : 'Missing', topTen: 'All have it', status: page.hasMetaDescription ? (page.metaDescriptionLength >= 130 && page.metaDescriptionLength <= 160 ? 'PASS' : 'CLOSE') : 'GAP', gap: !page.hasMetaDescription ? 'Add meta' : null },
        { name: 'Content Format', yours: page.pageType, topTen: benchmark.dominantPageType, status: page.pageType === benchmark.dominantPageType ? 'PASS' : 'DIFFERENT', gap: page.pageType !== benchmark.dominantPageType ? 'Consider alignment' : null }
      ],
      competitors: benchmark.urls.slice(0, 10).map((url, i) => {
        try { return { rank: i + 1, domain: new URL(url).hostname.replace('www.', ''), url }; }
        catch { return { rank: i + 1, domain: url.substring(0, 50), url }; }
      }),
      totalAnalyzed: benchmark.urls.length
    };
    return {
      summary: { grade, gradeLabel, finalScore: this.round(finalScore), summaryText, gapCounts: counts, scoreBreakdown: { serpSimilarity: { score: serpScore, weight: 45 }, contentQuality: { score: contentScore, weight: 35 }, onPageHealth: { score: onPageScore, weight: 20 } } },
      gaps: sortedGaps.map(g => ({ severity: g.severity, points: g.points, title: g.title, issue: g.issue, vsCompetitors: g.vsCompetitors, recommendation: g.recommendation, effort: g.effort, impact: g.impact, timeframe: g.timeframe })),
      strengths,
      opportunities,
      benchmark: benchmarkData
    };
  }

  toInt(v, d) { const n = parseInt(v, 10); return isNaN(n) || n < 0 ? d : n; }
  toRatio(v, d) { const n = parseFloat(v); if (isNaN(n)) return d; return n > 1 ? Math.min(1, n / 100) : Math.max(0, Math.min(1, n)); }
  toStr(v, d) { return typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : d; }
  round(n) { return Math.round(n * 10) / 10; }
  logResults(result, gaps) {
    Logger.info('\n🎯 SEO Competitive Analysis:');
    Logger.info(`   Score: ${result.finalScore}/100 | SERP: ${result.serpSimilarity} | Content: ${result.contentQuality} | OnPage: ${result.onPageHealth}`);
    Logger.info(`   Gaps: ${gaps.length} (${gaps.filter(g => g.severity === 'CRITICAL').length} critical, ${gaps.filter(g => g.severity === 'HIGH').length} high)`);
  }
}

/** Map gap-based recommendations to audit model format. Includes context (vs competitors) so the UI can show why each item matters. */
function gapsToAuditRecommendations(gaps) {
  const impactMap = { Critical: 'high', High: 'high', Medium: 'medium', Low: 'low' };
  const effortMap = { Low: 'easy', Medium: 'moderate', High: 'difficult' };
  return (gaps || []).map(g => ({
    priority: (g.severity || 'low').toLowerCase(),
    category: g.category === 'serp' ? 'SERP' : g.category === 'onpage' ? 'On-Page' : 'Content',
    issue: g.issue || g.title || '',
    action: g.recommendation || '',
    impact: impactMap[g.impact] || 'medium',
    effort: effortMap[g.effort] || 'moderate',
    context: g.vsCompetitors || '',
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SERVICE FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/** Maximum SEO score (excellent case). Reserve 100 for theoretical perfection; real audits cap at 95. */
const SEO_SCORE_MAX = 95;

/**
 * Compute SEO score from applied gaps using the same formula as SEOScoreCalculator.
 * Capped at SEO_SCORE_MAX (95) so excellent pages show 95, not 100.
 * More sensitive: prefer calculator score when available, apply deductions for opportunities.
 * @param {Array<{ category: string, points: number }>} gaps - appliedGaps
 * @param {number} calculatorScore - Original score from SEOScoreCalculator (for fallback when gaps=0)
 * @param {number} opportunityCount - Number of opportunities (for sensitivity adjustment)
 * @returns {number} 0-95
 */
function computeScoreFromGaps(gaps, calculatorScore = null, opportunityCount = 0) {
  if (!Array.isArray(gaps) || gaps.length === 0) {
    // No gaps detected: use calculator score if available and it's reasonable
    if (calculatorScore !== null) {
      const capped = Math.min(SEO_SCORE_MAX, Math.round(calculatorScore));
      // If calculator says 100 but there are opportunities, apply deduction (1-2 points per opportunity, max 8 points)
      if (capped >= SEO_SCORE_MAX && opportunityCount > 0) {
        const opportunityDeduction = Math.min(8, opportunityCount * 1.5);
        return Math.max(87, SEO_SCORE_MAX - Math.round(opportunityDeduction));
      }
      return capped;
    }
    // Fallback: if no calculator score and opportunities exist, apply deduction
    if (opportunityCount > 0) {
      const opportunityDeduction = Math.min(8, opportunityCount * 1.5);
      return Math.max(87, SEO_SCORE_MAX - Math.round(opportunityDeduction));
    }
    return SEO_SCORE_MAX;
  }
  // Compute from gaps using the formula
  const sumByCategory = (cat) => gaps.filter((g) => g.category === cat).reduce((s, g) => s + (g.points || 0), 0);
  const serpDed = sumByCategory('serp');
  const contentDed = sumByCategory('content');
  const onpageDed = sumByCategory('onpage');
  const serpScore = Math.max(0, Math.min(100, 100 - serpDed));
  const contentScore = Math.max(0, Math.min(100, 100 - contentDed));
  const onpageScore = Math.max(0, Math.min(100, 100 - onpageDed));
  const final = serpScore * 0.45 + contentScore * 0.35 + onpageScore * 0.2;
  const computed = Math.round(final);
  // Cap at 95, but if calculator score is lower, prefer that (more conservative)
  if (calculatorScore !== null && calculatorScore < computed) {
    return Math.min(SEO_SCORE_MAX, Math.round(calculatorScore));
  }
  return Math.min(SEO_SCORE_MAX, computed);
}

/**
 * Run SEO audit using competitive analysis pipeline.
 * Returns same shape as dataForSEOService.runOnPageAudit for drop-in replacement.
 *
 * @param {string} url - Page URL to audit
 * @param {string} keyword - Target keyword
 * @param {string} [locale] - Locale (en, fr_fr, fr_be, nl_be, etc.)
 * @param {string} [device] - desktop | mobile
 * @returns {Promise<{ score: number, checks: Object, keywordAnalysis: Object, recommendations: Array, competitors: Array, serpInfo: Object }>}
 */
async function runCompetitiveAudit(url, keyword, locale = DEFAULT_LOCALE, device = 'desktop') {
  const login = env.DATAFORSEO_LOGIN || env.DATAFORSEO_EMAIL;
  const password = env.DATAFORSEO_PASSWORD || env.DATAFORSEO_API_PASSWORD;
  if (!login || !password) {
    throw new ApiError(500, 'DataForSEO credentials not configured. Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in .env');
  }

  const baseUrl = (env.DATAFORSEO_API_URL || 'https://sandbox.dataforseo.com').replace(/\/v3\/?$/, '') + '/v3';
  const locationCode = getLocationCode(locale);
  const languageCode = getLanguageCode(locale);

  const client = new DataForSEOClient(login, password, baseUrl);
  const serpAnalyzer = new SERPAnalyzer(client);
  const pageAuditor = new PageAuditor(client);
  const scoreCalculator = new SEOScoreCalculator();

  Logger.info(`[SEO Competitive Audit] Starting for ${url} keyword "${keyword}" locale=${locale} (location=${locationCode}, lang=${languageCode})`);

  const [benchmark, auditPageResult] = await Promise.all([
    serpAnalyzer.buildSerpBenchmark(keyword, locationCode, languageCode),
    pageAuditor.auditPage(url, keyword),
  ]);

  const pageAnalysis = auditPageResult.analysis;
  const pageChecks = auditPageResult.checks || {};
  const rawItemSnapshot = auditPageResult.rawItemSnapshot || null;

  const scoreResult = scoreCalculator.calculateScore(pageAnalysis, benchmark);
  const gaps = scoreResult.recommendations?.gaps || [];
  const strengths = scoreResult.recommendations?.strengths || [];
  const opportunities = scoreResult.recommendations?.opportunities || [];

  const gapRecs = gapsToAuditRecommendations(gaps);
  const opportunityRecs = (opportunities || []).map((opp) => ({
    priority: 'low',
    category: opp.category || 'Growth',
    issue: opp.title || '',
    action: [opp.description, opp.potential].filter(Boolean).join(' '),
    impact: 'medium',
    effort: 'moderate',
    context: 'Next-level optimization to outpace competitors.',
  }));
  const recommendations = [...gapRecs, ...opportunityRecs];

  // Log for debugging: show what gaps were detected
  Logger.info(`[SEO Competitive Audit] Gaps detected: ${gaps.length} (${gaps.map(g => `${g.id}:${g.points}`).join(', ') || 'none'}), Calculator score: ${scoreResult.finalScore}`);

  const competitors = (benchmark.urls || []).slice(0, 10).map((u, i) => {
    let domain = '';
    try {
      domain = new URL(u).hostname.replace('www.', '');
    } catch {
      domain = u;
    }
    return {
      position: i + 1,
      title: domain,
      url: u,
      domain,
      description: '',
      breadcrumb: '',
    };
  });

  const localeConfig = getLocaleConfig(locale);
  const summary = scoreResult.recommendations?.summary || {};
  const locationName = localeConfig?.locationName || locale;
  const scoreSummary =
    `Your score is based on comparing your page to the top 10 results for "${keyword}" in ${locationName}. ` +
    (summary.summaryText || (gaps.length === 0 ? 'No competitive gaps found.' : `${gaps.length} gap(s) to address.`));

  const checks = {
    ...pageChecks,
    scoreSummary,
    strengths,
    opportunities,
    serpSimilarity: scoreResult.serpSimilarity,
    contentQuality: scoreResult.contentQuality,
    onPageHealth: scoreResult.onPageHealth,
    pageAnalysis: {
      contentLength: pageAnalysis.contentLength,
      wordCount: pageAnalysis.wordCount,
      keywordInTitle: pageAnalysis.keywordInTitle,
      keywordInH1: pageAnalysis.keywordInH1,
      h1Count: pageAnalysis.h1Count,
      h2Count: pageAnalysis.h2Count,
      h3Count: pageAnalysis.h3Count,
      pageType: pageAnalysis.pageType,
      titleLength: pageAnalysis.titleLength,
      hasMetaDescription: pageAnalysis.hasMetaDescription,
      hasNoindex: pageAnalysis.hasNoindex,
    },
    benchmark: {
      medianContentLength: benchmark.medianContentLength,
      medianH2Count: benchmark.medianH2Count,
      keywordInTitleRatio: benchmark.keywordInTitleRatio,
      keywordInH1Ratio: benchmark.keywordInH1Ratio,
      dominantPageType: benchmark.dominantPageType,
    },
  };

  const keywordAnalysis = {
    keyword,
    location: localeConfig?.locationName || locale,
    language: languageCode,
    competitorCount: competitors.length,
  };

  const serpInfo = {
    keyword,
    locationCode,
    languageCode,
    location: localeConfig?.locationName || locale,
    language: localeConfig?.languageName || languageCode,
    device: device || 'desktop',
    competitorUrls: benchmark.urls || [],
    medianContentLength: benchmark.medianContentLength,
    dominantPageType: benchmark.dominantPageType,
  };

  let finalScore = Math.min(SEO_SCORE_MAX, Math.round(scoreResult.finalScore));
  let finalRecommendations = recommendations;
  let finalChecks = checks;

  const keywordFoundOnPage = isKeywordFoundOnPage(keyword, rawItemSnapshot);

  if (rawItemSnapshot && benchmark.competitorSummaries?.length) {
    try {
      const competitorDomains = (benchmark.urls || []).slice(0, 10).map((u) => {
        try {
          return new URL(u).hostname.replace(/^www\./, '');
        } catch {
          return u;
        }
      });
      const appliedGaps = gaps.map((g) => ({
        id: g.id,
        category: g.category,
        points: g.points,
        severity: g.severity,
        title: g.title,
        issue: g.issue,
        recommendation: g.recommendation,
        vsCompetitors: g.vsCompetitors,
      }));
      const scoringFormula = {
        componentWeights: { serp: 0.45, content: 0.35, onpage: 0.2 },
        componentRule: 'For each category (serp, content, onpage), sum the "points" of appliedGaps in that category. ComponentScore = max(0, min(100, 100 - categoryPoints)).',
        finalRule: 'finalScore = round(serpScore * 0.45 + contentScore * 0.35 + onpageScore * 0.20).',
      };
      const aiPayload = {
        auditedPage: rawItemSnapshot,
        competitorSummaries: benchmark.competitorSummaries,
        competitorDomains,
        benchmark: {
          medianContentLength: benchmark.medianContentLength,
          medianH2Count: benchmark.medianH2Count,
          keywordInTitleRatio: benchmark.keywordInTitleRatio,
          keywordInH1Ratio: benchmark.keywordInH1Ratio,
          dominantPageType: benchmark.dominantPageType,
        },
        pageForScoring: {
          contentLength: pageAnalysis.contentLength,
          wordCount: pageAnalysis.wordCount,
          titleLength: pageAnalysis.titleLength,
          h1Count: pageAnalysis.h1Count,
          h2Count: pageAnalysis.h2Count,
          keywordInTitle: pageAnalysis.keywordInTitle,
          keywordInH1: pageAnalysis.keywordInH1,
          hasMetaDescription: pageAnalysis.hasMetaDescription,
          metaDescriptionLength: pageAnalysis.metaDescriptionLength ?? 0,
          hasNoindex: pageAnalysis.hasNoindex,
          hasCanonicalIssue: pageAnalysis.hasCanonicalIssue,
          pageType: pageAnalysis.pageType,
        },
        appliedGaps,
        scoringFormula,
        keyword,
        locationName: localeConfig?.locationName || locale,
        locale,
        locationDisplayName: localeConfig?.displayName || localeConfig?.locationName || locale,
        keywordFoundOnPage,
      };
      const aiResult = await seoAuditAIService.analyzeAuditFromData(aiPayload, locale);
      if (Array.isArray(aiResult.recommendations)) {
        finalRecommendations = aiResult.recommendations.length ? aiResult.recommendations : finalRecommendations;
        // Always compute score from appliedGaps so it matches the number of issues (no 100 with 6 recommendations).
        // Pass calculator score and opportunity count for more sensitive scoring when gaps=0.
        if (keywordFoundOnPage) {
          finalScore = computeScoreFromGaps(appliedGaps, scoreResult.finalScore, opportunities.length);
        }
        if (aiResult.scoreSummary) finalChecks = { ...finalChecks, scoreSummary: aiResult.scoreSummary };
        if (aiResult.strengths?.length) finalChecks = { ...finalChecks, strengths: aiResult.strengths };
        Logger.info(`[SEO Competitive Audit] Score ${finalScore} from formula (${appliedGaps.length} gaps, ${opportunities.length} opportunities, calculator: ${scoreResult.finalScore}), AI recommendations for ${locale}.`);
      } else {
        const enhancePayload = { score: finalScore, keyword, locationName: localeConfig?.locationName || locale, scoreSummary, gapsCount: gapRecs.length, recommendations, strengths };
        const enhanced = await seoAuditAIService.enhanceAuditWithAI(enhancePayload, locale);
        if (enhanced.score !== undefined) finalScore = Math.min(SEO_SCORE_MAX, Math.round(enhanced.score));
        if (enhanced.recommendations?.length) finalRecommendations = enhanced.recommendations;
        if (enhanced.scoreSummary) finalChecks = { ...finalChecks, scoreSummary: enhanced.scoreSummary };
        if (enhanced.strengths?.length) finalChecks = { ...finalChecks, strengths: enhanced.strengths };
      }
    } catch (err) {
      Logger.warn('[SEO Competitive Audit] AI analysis skipped, using gap-based result:', err.message);
    }
  } else {
    try {
      const enhancePayload = { score: finalScore, keyword, locationName: localeConfig?.locationName || locale, scoreSummary, gapsCount: gapRecs.length, recommendations, strengths };
      const enhanced = await seoAuditAIService.enhanceAuditWithAI(enhancePayload, locale);
      if (enhanced.score !== undefined) finalScore = Math.min(SEO_SCORE_MAX, Math.round(enhanced.score));
      if (enhanced.recommendations?.length) finalRecommendations = enhanced.recommendations;
      if (enhanced.scoreSummary) finalChecks = { ...finalChecks, scoreSummary: enhanced.scoreSummary };
      if (enhanced.strengths?.length) finalChecks = { ...finalChecks, strengths: enhanced.strengths };
    } catch (err) {
      Logger.warn('[SEO Competitive Audit] AI enhancement skipped:', err.message);
    }
  }

  if (!keywordFoundOnPage) {
    const hasKeywordRec = finalRecommendations.some(
      (r) => (r.issue || '').toLowerCase().includes('keyword not found') || (r.category || '').toLowerCase() === 'keyword'
    );
    if (!hasKeywordRec) {
      const keywordNotFoundRec = {
        priority: 'critical',
        category: 'Keyword',
        issue: 'Target keyword not found on page',
        action: 'Add the target keyword to the page (e.g. in the title, H1, or main content) so the page is relevant for this search. Currently the page does not target this keyword in title, meta description, or headings.',
        impact: 'high',
        effort: 'moderate',
        context: `Your page has no mention of "${keyword}" in the title, meta description, or H1/H2/H3. Adding it can improve relevance and rankings. Your score above reflects how your page compares to the top 10.`,
      };
      finalRecommendations = [keywordNotFoundRec, ...finalRecommendations];
    } else {
      const keywordRecIndex = finalRecommendations.findIndex(
        (r) => (r.issue || '').toLowerCase().includes('keyword not found') || ((r.category || '').toLowerCase() === 'keyword' && (r.priority || '').toLowerCase() === 'critical')
      );
      if (keywordRecIndex > 0) {
        const [keywordRec] = finalRecommendations.splice(keywordRecIndex, 1);
        finalRecommendations = [keywordRec, ...finalRecommendations];
      }
    }
    const locationName = localeConfig?.locationName || locale;
    if (!finalChecks.scoreSummary) {
      finalChecks = {
        ...finalChecks,
        scoreSummary: `The target keyword "${keyword}" was not found in your title, meta description, or headings. Consider adding it for better relevance. Your score reflects your page's comparison to the top 10 in ${locationName}.`,
      };
    }
    Logger.info(`[SEO Competitive Audit] Keyword "${keyword}" not found on page — critical recommendation added; score kept consistent (${finalScore}).`);
  }

  return {
    score: finalScore,
    checks: finalChecks,
    keywordAnalysis,
    recommendations: finalRecommendations,
    competitors,
    serpInfo,
    raw: { pageAnalysis, benchmark, scoreResult },
  };
}

export const seoCompetitiveAuditService = {
  runCompetitiveAudit,
  getLocationCode,
  getLanguageCode,
  translateRecommendations,
};

export default seoCompetitiveAuditService;
