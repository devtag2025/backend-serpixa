import axios from 'axios';
import { env, getLocaleConfig, DEFAULT_LOCALE } from '../config/index.js';
import { ApiError } from '../utils/index.js';
import { Logger } from '../utils/logger.js';
import { t } from '../locales/index.js';

class DataForSEOService {
  constructor() {
    this.login = env.DATAFORSEO_LOGIN || env.DATAFORSEO_EMAIL;
    this.password = env.DATAFORSEO_PASSWORD || env.DATAFORSEO_API_PASSWORD;
    this.baseURL = env.DATAFORSEO_API_URL || 'https://sandbox.dataforseo.com';

    if (!this.login || !this.password) {
      Logger.error('DataForSEO credentials not configured. Please set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in your .env file');
    }

    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 60000,
      auth: {
        username: this.login || '',
        password: this.password || '',
      },
    });
  }

  async runOnPageAudit(url, keyword, locale = DEFAULT_LOCALE, device = 'desktop') {
    try {
      const localeConfig = getLocaleConfig(locale);
      const lang = localeConfig.language || 'en';

      // Run on-page audit and SERP analysis in parallel
      const [onPageResult, serpResult] = await Promise.all([
        this.fetchOnPageData(url),
        keyword ? this.fetchSERPData(
          keyword,
          localeConfig.locationName,
          localeConfig.languageName,
          device
        ) : Promise.resolve(null),
      ]);

      return this.transformOnPageResult(onPageResult, url, keyword, serpResult, lang);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, `DataForSEO request failed: ${error.message}`);
    }
  }

  async fetchOnPageData(url) {
    if (!this.login || !this.password) {
      throw new ApiError(500, 'DataForSEO credentials not configured. Please set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in your .env file');
    }

    try {
      const response = await this.client.post('/v3/on_page/instant_pages', [
        {
          url,
          enable_javascript: true,
          enable_browser_rendering: true,
          // Request additional content fields
          load_resources: true,
          enable_xpath: false,
        },
      ]);

      const result = response.data;

      if (result.status_code !== 20000) {
        Logger.error('DataForSEO OnPage API error:', result.status_message, 'Code:', result.status_code);
        throw new ApiError(502, result.status_message || 'DataForSEO API error');
      }

      const task = result.tasks?.[0];
      if (!task || task.status_code !== 20000) {
        Logger.error('DataForSEO OnPage task error:', task?.status_message, 'Code:', task?.status_code);
        throw new ApiError(502, task?.status_message || 'On-page audit failed');
      }

      return task.result?.[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;

      if (error.response) {
        const statusCode = error.response.status;
        const errorMessage = error.response.data?.message || error.response.statusText || 'DataForSEO API request failed';

        if (statusCode === 401) {
          Logger.error('DataForSEO authentication failed. Please check your DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD credentials.');
          throw new ApiError(401, 'DataForSEO authentication failed. Please check your credentials in .env file');
        }

        Logger.error('DataForSEO API error response:', {
          status: statusCode,
          data: error.response.data,
        });
        throw new ApiError(statusCode, errorMessage);
      }

      Logger.error('On-page audit request failed:', error.message);
      throw new ApiError(502, `On-page audit failed: ${error.message}`);
    }
  }

  async fetchSERPData(keyword, locationName = 'United States', languageName = 'English', device = 'desktop', depth = 100) {
    if (!this.login || !this.password) {
      Logger.warn('DataForSEO credentials not configured. Skipping SERP data fetch.');
      return null;
    }

    try {
      const payload = [
        {
          keyword: keyword.trim(),
          location_name: locationName,
          language_name: languageName,
          device: device,
          depth: depth,
        },
      ];

      const response = await this.client.post('/v3/serp/google/organic/live/regular', payload);

      let result;
      if (Array.isArray(response.data)) {
        if (response.data.length === 0) {
          Logger.warn('DataForSEO SERP API returned empty array');
          return null;
        }
        result = response.data[0];
      } else if (response.data?.status_code !== undefined) {
        result = response.data;
      } else {
        Logger.error('Unexpected SERP response structure:', typeof response.data);
        return null;
      }

      if (result.status_code !== undefined && result.status_code !== 20000) {
        Logger.warn('DataForSEO SERP API error:', result.status_message, 'Code:', result.status_code);
        return null;
      }

      const tasks = result.tasks || [];
      if (tasks.length === 0) {
        return null;
      }

      const task = tasks[0];
      let serpData;

      if (Array.isArray(task.result)) {
        serpData = task.result[0];
      } else if (task.result) {
        serpData = task.result;
      } else {
        return null;
      }

      const organicResults = serpData?.items || [];
      
      // Use keyword variations for SERP matching too
      const keywordVariations = this.generateKeywordVariations(keyword.trim());

      // Extract top 10 organic competitors
      const competitors = organicResults
        .filter((item) => item.type === 'organic')
        .slice(0, 10)
        .map((item, index) => {
          const title = item.title || '';
          const description = item.description || '';
          
          // Check if any keyword variation is in title/description
          const keywordInTitle = keywordVariations.some(variant => 
            this.normalizeForSearch(title).includes(variant)
          );
          const keywordInDescription = keywordVariations.some(variant => 
            this.normalizeForSearch(description).includes(variant)
          );
          
          const pageType = this.classifyPageType(item.url || '', title);

          return {
            position: index + 1,
            title,
            url: item.url || '',
            domain: item.domain || '',
            description,
            breadcrumb: item.breadcrumb || '',
            keywordInTitle,
            keywordInDescription,
            pageType,
          };
        });

      // Build SERP benchmark based on available data
      const titleWithKeywordCount = competitors.filter(c => c.keywordInTitle).length;
      const descWithKeywordCount = competitors.filter(c => c.keywordInDescription).length;

      const percentTitleHasKeyword = competitors.length === 0 ? 0 : titleWithKeywordCount / competitors.length;
      const percentDescHasKeyword = competitors.length === 0 ? 0 : descWithKeywordCount / competitors.length;

      // Determine dominant page type in Top 10
      const pageTypeCounts = competitors.reduce((acc, c) => {
        if (!c.pageType) return acc;
        acc[c.pageType] = (acc[c.pageType] || 0) + 1;
        return acc;
      }, {});

      const dominantPageType = Object.entries(pageTypeCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || null;

      return {
        keyword,
        location: locationName,
        language: languageName,
        device,
        competitors,
        totalResults: competitors.length,
        searchInfo: {
          seResultsCount: serpData?.se_results_count || 0,
          checkUrl: serpData?.check_url || '',
          datetime: serpData?.datetime || new Date().toISOString(),
        },
        benchmark: {
          percentTitleHasKeyword,
          percentDescHasKeyword,
          dominantPageType,
          topCompetitorsAnalysis: this.analyzeTopCompetitors(competitors),
        },
      };
    } catch (error) {
      if (error.response) {
        const statusCode = error.response.status;
        if (statusCode === 401) {
          Logger.error('DataForSEO SERP authentication failed. Please check your credentials.');
        } else {
          Logger.error('DataForSEO SERP API error:', {
            status: statusCode,
            data: error.response.data,
          });
        }
      } else {
        Logger.error('SERP data fetch failed:', error.message);
      }
      return null;
    }
  }

  /**
   * Analyze patterns in top competitors
   */
  analyzeTopCompetitors(competitors) {
    if (!competitors || competitors.length === 0) return null;

    const top3 = competitors.slice(0, 3);
    const top5 = competitors.slice(0, 5);

    return {
      top3KeywordInTitle: top3.filter(c => c.keywordInTitle).length,
      top5KeywordInTitle: top5.filter(c => c.keywordInTitle).length,
      top3KeywordInDescription: top3.filter(c => c.keywordInDescription).length,
      avgTitleLength: Math.round(
        competitors.reduce((sum, c) => sum + (c.title?.length || 0), 0) / competitors.length
      ),
      avgDescriptionLength: Math.round(
        competitors.reduce((sum, c) => sum + (c.description?.length || 0), 0) / competitors.length
      ),
    };
  }

  /**
   * Extract comprehensive text content from pageData
   * Falls back to HTML parsing if plain_text_content is insufficient
   */
  extractPageContent(pageData, meta) {
    // Primary: Use DataForSEO's extracted plain text
    let primaryContent = meta.content?.plain_text_content || pageData.content?.plain_text_content || '';
    
    // Fallback: If plain_text_content is empty or very short, try HTML extraction
    if (!primaryContent || primaryContent.length < 100) {
      const html = pageData.page_content || meta.content?.html_content || '';
      if (html) {
        primaryContent = this.stripHTML(html);
        Logger.info(`Used HTML fallback for content extraction. Length: ${primaryContent.length}`);
      }
    }
    
    // Additional content sources to check
    const additionalSources = [
      meta.description,
      ...(meta.htags?.h1 || []),
      ...(meta.htags?.h2 || []),
      ...(meta.htags?.h3 || []),
    ].filter(Boolean).join(' ');
    
    // Combine all sources
    const fullContent = [primaryContent, additionalSources].filter(Boolean).join(' ');
    
    return fullContent;
  }

  /**
   * Build content from available meta fields when plain_text_content is unavailable
   */
  buildContentFromMeta(meta) {
    const parts = [];
    
    // Add title
    if (meta.title) parts.push(meta.title);
    
    // Add description
    if (meta.description) parts.push(meta.description);
    
    // Add all headings
    if (meta.htags) {
      const headings = [
        ...(meta.htags.h1 || []),
        ...(meta.htags.h2 || []),
        ...(meta.htags.h3 || []),
        ...(meta.htags.h4 || []),
        ...(meta.htags.h5 || []),
        ...(meta.htags.h6 || []),
      ];
      parts.push(...headings);
    }
    
    return parts.filter(Boolean).join(' ');
  }

  /**
   * Strip HTML tags and decode entities
   */
  stripHTML(html) {
    if (!html) return '';
    
    return html
      // Remove script and style tags with their content
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      // Remove HTML comments
      .replace(/<!--[\s\S]*?-->/g, ' ')
      // Remove all HTML tags
      .replace(/<[^>]+>/g, ' ')
      // Decode common HTML entities
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&[a-z]+;/gi, ' ')
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Generate keyword variations for better matching
   * Handles: singular/plural, with/without hyphens, accents
   */
  generateKeywordVariations(keyword) {
    const variations = new Set();
    const normalized = this.normalizeForSearch(keyword);
    
    variations.add(normalized);
    
    // Add plural forms
    if (!normalized.endsWith('s')) {
      variations.add(normalized + 's');
      // Handle words ending in 'y' -> 'ies'
      if (normalized.endsWith('y') && normalized.length > 2) {
        variations.add(normalized.slice(0, -1) + 'ies');
      }
    } else {
      // Remove 's' for singular
      variations.add(normalized.slice(0, -1));
    }
    
    // Handle hyphenated versions
    if (normalized.includes(' ')) {
      variations.add(normalized.replace(/\s+/g, '-'));
      variations.add(normalized.replace(/\s+/g, ''));
    }
    
    if (normalized.includes('-')) {
      variations.add(normalized.replace(/-/g, ' '));
      variations.add(normalized.replace(/-/g, ''));
    }
    
    return Array.from(variations);
  }

  /**
   * Check if any keyword variation exists in text
   */
  keywordExistsInText(keyword, text) {
    const variations = this.generateKeywordVariations(keyword);
    const textNorm = this.normalizeForSearch(text);
    
    return variations.some(variant => textNorm.includes(variant));
  }

  /**
   * Count all keyword variation occurrences
   */
  countKeywordOccurrences(keyword, text) {
    const variations = this.generateKeywordVariations(keyword);
    const textNorm = this.normalizeForSearch(text);
    
    let totalCount = 0;
    const foundVariations = [];
    
    for (const variant of variations) {
      const pattern = new RegExp('\\b' + this.escapeRegex(variant) + '\\b', 'gi');
      const matches = textNorm.match(pattern);
      const count = matches ? matches.length : 0;
      
      if (count > 0) {
        totalCount += count;
        foundVariations.push({ variant, count });
      }
    }
    
    return { totalCount, foundVariations };
  }

  transformOnPageResult(data, url, keyword, serpData = null, lang = 'en') {
    if (!data) {
      return {
        url,
        keyword,
        score: 0,
        checks: this.buildEmptyChecks(lang),
        keywordAnalysis: null,
        recommendations: [{
          priority: 'critical',
          category: 'technical',
          issue: t(lang, 'seo.recommendations.missingTitle.issue'),
          action: t(lang, 'seo.recommendations.missingTitle.action'),
          impact: 'high',
          effort: 'easy',
        }],
        competitors: serpData?.competitors || [],
        raw: null,
      };
    }

    const pageData = data.items?.[0] || {};
    const meta = pageData.meta || {};

    // Build comprehensive checks with translated labels
    const checks = this.buildChecks(pageData, meta, lang);
    const keywordAnalysis = keyword
      ? this.analyzeKeyword(keyword, meta, pageData, serpData, lang)
      : null;

    // Compute SEO score with transparent component breakdown
    const scoring = this.computeSEOScore({
      pageData,
      meta,
      keywordAnalysis,
      serpData,
      checks,
    });

    const recommendations = this.generateEnhancedRecommendations(
      checks,
      keywordAnalysis,
      keyword,
      serpData,
      pageData,
      meta,
      scoring,
      lang
    );

    return {
      url,
      keyword,
      score: Math.round(scoring.total * 100) / 100,
      scoreBreakdown: {
        total: Math.round(scoring.total * 100) / 100,
        components: scoring.components,
        explanation: scoring.explanation,
      },
      checks,
      keywordAnalysis,
      recommendations,
      competitors: serpData?.competitors || [],
      serpInfo: serpData
        ? {
            location: serpData.location,
            language: serpData.language,
            device: serpData.device,
            totalResults: serpData.totalResults,
            benchmark: serpData.benchmark,
            searchInfo: serpData.searchInfo,
          }
        : null,
      raw: data,
    };
  }

  buildEmptyChecks(lang) {
    return {
      title: { label: t(lang, 'seo.checks.title'), exists: false, existsLabel: t(lang, 'seo.labels.no') },
      description: { label: t(lang, 'seo.checks.description'), exists: false, existsLabel: t(lang, 'seo.labels.no') },
      h1: { label: t(lang, 'seo.checks.h1'), exists: false, existsLabel: t(lang, 'seo.labels.no'), count: 0 },
      h2: { label: t(lang, 'seo.checks.h2'), count: 0 },
      canonical: { label: t(lang, 'seo.checks.canonical'), exists: false, existsLabel: t(lang, 'seo.labels.no') },
      images: { label: t(lang, 'seo.checks.images'), total: 0, withoutAlt: 0 },
      links: { label: t(lang, 'seo.checks.links'), internal: 0, external: 0, broken: 0 },
      loadTime: { label: t(lang, 'seo.checks.loadTime'), value: null },
      wordCount: { label: t(lang, 'seo.checks.wordCount'), value: 0 },
    };
  }

  buildChecks(pageData, meta, lang) {
    const titleLength = meta.title?.length || 0;
    const descLength = meta.description?.length || 0;
    const h1Count = meta.htags?.h1?.length || 0;
    const h2Count = meta.htags?.h2?.length || 0;
    const h3Count = meta.htags?.h3?.length || 0;
    const wordCount = meta.content?.plain_text_word_count || 0;
    
    // CRITICAL FIX: Links and images data is in meta, not pageData
    const internalLinksCount = meta.internal_links_count || 0;
    const externalLinksCount = meta.external_links_count || 0;
    const imagesCount = meta.images_count || 0;
    
    // DataForSEO returns timing values in milliseconds – convert to seconds
    const rawLoadTime = pageData.page_timing?.time_to_interactive;
    const loadTime = typeof rawLoadTime === 'number' ? rawLoadTime / 1000 : null;

    // Calculate status based on best practices
    const getTitleStatus = () => {
      if (!meta.title) return 'poor';
      if (titleLength >= 50 && titleLength <= 60) return 'good';
      if (titleLength >= 40 && titleLength <= 70) return 'needsImprovement';
      return 'poor';
    };

    const getDescStatus = () => {
      if (!meta.description) return 'poor';
      if (descLength >= 140 && descLength <= 160) return 'good';
      if (descLength >= 120 && descLength <= 170) return 'needsImprovement';
      return 'poor';
    };

    const getH1Status = () => {
      if (h1Count === 1) return 'good';
      if (h1Count === 0) return 'poor';
      return 'needsImprovement'; // Multiple H1s
    };

    const getWordCountStatus = () => {
      if (wordCount >= 1500) return 'good';
      if (wordCount >= 800) return 'needsImprovement';
      return 'poor';
    };

    return {
      title: {
        label: t(lang, 'seo.checks.title'),
        exists: !!meta.title,
        existsLabel: !!meta.title ? t(lang, 'seo.labels.yes') : t(lang, 'seo.labels.no'),
        value: meta.title || null,
        length: titleLength,
        lengthLabel: t(lang, 'seo.labels.length'),
        optimal: titleLength >= 50 && titleLength <= 60,
        optimalLabel: t(lang, 'seo.labels.optimal'),
        status: getTitleStatus(),
        statusLabel: t(lang, `seo.labels.${getTitleStatus()}`),
      },
      description: {
        label: t(lang, 'seo.checks.description'),
        exists: !!meta.description,
        existsLabel: !!meta.description ? t(lang, 'seo.labels.yes') : t(lang, 'seo.labels.no'),
        value: meta.description || null,
        length: descLength,
        lengthLabel: t(lang, 'seo.labels.length'),
        optimal: descLength >= 140 && descLength <= 160,
        optimalLabel: t(lang, 'seo.labels.optimal'),
        status: getDescStatus(),
        statusLabel: t(lang, `seo.labels.${getDescStatus()}`),
      },
      h1: {
        label: t(lang, 'seo.checks.h1'),
        exists: h1Count > 0,
        existsLabel: h1Count > 0 ? t(lang, 'seo.labels.yes') : t(lang, 'seo.labels.no'),
        count: h1Count,
        countLabel: t(lang, 'seo.labels.count'),
        values: meta.htags?.h1 || [],
        status: getH1Status(),
        statusLabel: t(lang, `seo.labels.${getH1Status()}`),
      },
      h2: {
        label: t(lang, 'seo.checks.h2'),
        count: h2Count,
        countLabel: t(lang, 'seo.labels.count'),
        values: meta.htags?.h2 || [],
        status: h2Count >= 5 ? 'good' : h2Count >= 3 ? 'needsImprovement' : 'poor',
        statusLabel: t(lang, `seo.labels.${h2Count >= 5 ? 'good' : h2Count >= 3 ? 'needsImprovement' : 'poor'}`),
      },
      h3: {
        label: t(lang, 'seo.checks.h3'),
        count: h3Count,
        countLabel: t(lang, 'seo.labels.count'),
        values: meta.htags?.h3 || [],
      },
      canonical: {
        label: t(lang, 'seo.checks.canonical'),
        exists: !!meta.canonical,
        existsLabel: !!meta.canonical ? t(lang, 'seo.labels.yes') : t(lang, 'seo.labels.no'),
        value: meta.canonical || null,
        status: meta.canonical ? 'good' : 'needsImprovement',
        statusLabel: t(lang, `seo.labels.${meta.canonical ? 'good' : 'needsImprovement'}`),
      },
      images: {
        label: t(lang, 'seo.checks.images'),
        total: imagesCount,
        totalLabel: t(lang, 'seo.labels.total'),
        withoutAlt: 0, // DataForSEO instant_pages doesn't provide images_without_alt in this response structure
        withoutAltLabel: t(lang, 'seo.labels.withoutAlt'),
        status: imagesCount > 0 ? 'good' : 'needsImprovement',
        statusLabel: t(lang, `seo.labels.${imagesCount > 0 ? 'good' : 'needsImprovement'}`),
      },
      links: {
        label: t(lang, 'seo.checks.links'),
        internal: internalLinksCount,
        internalLabel: t(lang, 'seo.labels.internal'),
        external: externalLinksCount,
        externalLabel: t(lang, 'seo.labels.external'),
        broken: 0, // DataForSEO instant_pages shows broken_links as boolean, not count
        brokenLabel: t(lang, 'seo.labels.broken'),
        status: pageData.broken_links ? 'poor' : 'good',
        statusLabel: t(lang, `seo.labels.${pageData.broken_links ? 'poor' : 'good'}`),
      },
      loadTime: {
        label: t(lang, 'seo.checks.loadTime'),
        value: loadTime,
        status: loadTime !== null && loadTime < 2.5 ? 'good' : loadTime !== null && loadTime < 4 ? 'needsImprovement' : 'poor',
        statusLabel: loadTime !== null ? t(lang, `seo.labels.${loadTime < 2.5 ? 'good' : loadTime < 4 ? 'needsImprovement' : 'poor'}`) : t(lang, 'common.notAvailable'),
      },
      wordCount: {
        label: t(lang, 'seo.checks.wordCount'),
        value: wordCount,
        status: getWordCountStatus(),
        statusLabel: t(lang, `seo.labels.${getWordCountStatus()}`),
      },
    };
  }

  analyzeKeyword(keyword, meta, pageData, serpData = null, lang = 'en') {
    // Generate keyword variations for flexible matching
    const keywordVariations = this.generateKeywordVariations(keyword);
    
    // RELIABLE STRATEGY:
    // 1. ALWAYS use API's plain_text_word_count (it's reliable even though we can't see the text)
    // 2. Search for keywords in available text (headings + meta description)
    // 3. Approximate density based on keyword occurrences in headings vs total word count
    
    const apiWordCount = meta.content?.plain_text_word_count || 0;
    
    // Build searchable text from what we have (headings + meta)
    const allHeadings = [
      ...(meta.htags?.h1 || []),
      ...(meta.htags?.h2 || []),
      ...(meta.htags?.h3 || []),
      ...(meta.htags?.h4 || []),
      ...(meta.htags?.h5 || []),
      ...(meta.htags?.h6 || []),
    ].join(' ');
    
    const metaDesc = meta.description || '';
    const metaTitle = meta.title || '';
    
    // Combine all available text for keyword searching
    const searchableText = [allHeadings, metaDesc, metaTitle].filter(Boolean).join(' ');
    const plainText = this.normalizeForSearch(searchableText);
    
    // ALWAYS use API word count - it's the most reliable
    const wordCount = apiWordCount || 0;
    
    let contentSource = 'api_word_count';
    
    // Log warning if we have no word count
    if (wordCount === 0) {
      Logger.warn(`[Word Count] API returned 0 word count for analysis. This will affect scoring.`);
      contentSource = 'no_content';
    }
    
    Logger.info(`[Content Analysis] Using API word count: ${wordCount}, Searchable text length: ${plainText.length}`);

    // Normalize meta elements (for keyword position checking)
    const title = this.normalizeForSearch(meta.title || '');
    const description = this.normalizeForSearch(meta.description || '');
    const h1Values = (meta.htags?.h1 || []).map(h => this.normalizeForSearch(h));
    const h2Values = (meta.htags?.h2 || []).map(h => this.normalizeForSearch(h));
    const url = (pageData.url || '').toLowerCase();

    // Check keyword presence using variations
    const inTitle = this.keywordExistsInText(keyword, title);
    const inDescription = this.keywordExistsInText(keyword, description);
    const inH1 = h1Values.some(h => this.keywordExistsInText(keyword, h));
    const inH2 = h2Values.some(h => this.keywordExistsInText(keyword, h));
    const inContent = this.keywordExistsInText(keyword, plainText);
    
    // URL check with variations
    const inUrl = keywordVariations.some(variant => 
      url.includes(variant.replace(/\s+/g, '-')) || url.includes(variant.replace(/\s+/g, ''))
    );

    // Count all keyword variation occurrences in the content
    // NOTE: We search in plainText (body + headings) for comprehensive counting
    const { totalCount: keywordCount, foundVariations } = this.countKeywordOccurrences(keyword, plainText);
    
    // Calculate density (modern SEO: 0.3-1.5% is natural)
    const density = wordCount > 0 ? ((keywordCount / wordCount) * 100) : 0;

    // Check if keyword appears in first 100 words (important for relevance)
    const first100Words = plainText.split(/\s+/).slice(0, 100).join(' ');
    const inFirst100Words = this.keywordExistsInText(keyword, first100Words);

    // Modern density standards (relaxed from old 1-2% rule)
    const densityOptimal = density >= 0.5 && density <= 1.5;
    const densityStatus = 
      density === 0 ? 'poor' :
      density < 0.3 ? 'poor' :
      density >= 0.5 && density <= 1.5 ? 'good' :
      density > 3 ? 'poor' :
      'needsImprovement';

    // Calculate recommended occurrences (0.5-1.5% range)
    const recommendedMin = Math.max(1, Math.round(wordCount * 0.005));
    const recommendedMax = Math.round(wordCount * 0.015);

    // SERP competitive analysis
    let serpComparison = null;
    if (serpData?.benchmark) {
      const bench = serpData.benchmark;
      serpComparison = {
        competitorsWithKeywordInTitle: Math.round(bench.percentTitleHasKeyword * 100),
        competitorsWithKeywordInDesc: Math.round(bench.percentDescHasKeyword * 100),
        yourTitleHasKeyword: inTitle,
        yourDescHasKeyword: inDescription,
        titleCompetitiveness: inTitle ? 'competitive' : bench.percentTitleHasKeyword > 0.7 ? 'weak' : 'moderate',
      };
    }

    // Debug logging
    if (process.env.DEBUG_SEO_KEYWORD === '1' || !inContent) {
      Logger.info('[SEO Keyword Analysis]', {
        keyword,
        variations: keywordVariations,
        foundVariations,
        inContent,
        inTitle,
        inH1,
        inDescription,
        wordCount: wordCount,
        wordCountSource: 'api_plain_text_word_count',
        searchableTextLength: plainText.length,
        contentSource,
        density: `${density.toFixed(2)}%`,
        headingsAvailable: allHeadings.length > 0,
        contentPreview: plainText.substring(0, 200),
      });
    }

    return {
      title: t(lang, 'seo.keywordAnalysis.title'),
      keyword,
      keywordVariationsFound: foundVariations, // Show which variations were found
      
      // Presence checks
      inTitle,
      inTitleLabel: t(lang, 'seo.keywordAnalysis.inTitle'),
      inTitleValue: inTitle ? t(lang, 'common.yes') : t(lang, 'common.no'),
      
      inDescription,
      inDescriptionLabel: t(lang, 'seo.keywordAnalysis.inDescription'),
      inDescriptionValue: inDescription ? t(lang, 'common.yes') : t(lang, 'common.no'),
      
      inH1,
      inH1Label: t(lang, 'seo.keywordAnalysis.inH1'),
      inH1Value: inH1 ? t(lang, 'common.yes') : t(lang, 'common.no'),
      
      inH2,
      inH2Label: t(lang, 'seo.keywordAnalysis.inH2'),
      inH2Value: inH2 ? t(lang, 'common.yes') : t(lang, 'common.no'),
      
      inContent,
      inContentLabel: t(lang, 'seo.keywordAnalysis.inContent'),
      inContentValue: inContent ? t(lang, 'common.yes') : t(lang, 'common.no'),
      
      inUrl,
      inUrlLabel: t(lang, 'seo.keywordAnalysis.inUrl'),
      inUrlValue: inUrl ? t(lang, 'common.yes') : t(lang, 'common.no'),
      
      inFirst100Words,
      inFirst100WordsLabel: t(lang, 'seo.keywordAnalysis.inFirst100Words'),
      inFirst100WordsValue: inFirst100Words ? t(lang, 'common.yes') : t(lang, 'common.no'),
      
      // Density metrics (counts all variations)
      occurrences: keywordCount,
      occurrencesLabel: t(lang, 'seo.keywordAnalysis.occurrences'),
      
      density: parseFloat(density.toFixed(2)),
      densityLabel: t(lang, 'seo.keywordAnalysis.density'),
      densityOptimal,
      densityOptimalLabel: t(lang, 'seo.keywordAnalysis.densityOptimal'),
      densityOptimalValue: densityOptimal ? t(lang, 'common.yes') : t(lang, 'common.no'),
      densityStatus,
      densityStatusLabel: t(lang, `seo.labels.${densityStatus}`),
      
      recommendedOccurrences: `${recommendedMin}-${recommendedMax}`,
      recommendedOccurrencesLabel: t(lang, 'seo.keywordAnalysis.recommendedOccurrences'),
      
      wordCount,
      
      // SERP competitive context
      serpComparison,
    };
  }

  escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  normalizeForSearch(str) {
    return (str || '')
      .toString()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  classifyPageType(url, title) {
    const u = (url || '').toLowerCase();
    const t = (title || '').toLowerCase();

    if (u.includes('/blog/') || u.includes('/news/') || u.includes('/article/') || t.includes('blog')) {
      return 'blog';
    }
    if (u.includes('/category/') || u.includes('/categories/') || u.includes('/collection/') || t.includes('category')) {
      return 'category';
    }
    if (u.includes('/product/') || u.includes('/p/') || t.includes('buy') || t.includes('product')) {
      return 'product';
    }
    if (u.includes('/service') || t.includes('pricing') || t.includes('plans')) {
      return 'landing';
    }
    return 'other';
  }

  /**
   * Compute SEO score with transparent component breakdown
   * Returns total (0-100) and detailed component scores
   */
  computeSEOScore({ pageData, meta, keywordAnalysis, serpData, checks }) {
    // Use word count from keyword analysis (uses API count with fallback)
    // This ensures we use the same count that density was calculated against
    const wordCount = keywordAnalysis?.wordCount || meta.content?.plain_text_word_count || 0;
    const kw = keywordAnalysis;

    let explanation = {
      keywordRelevance: '',
      contentQuality: '',
      technicalHealth: '',
      finalAdjustments: '',
    };

    // ===================================================================
    // 1. KEYWORD RELEVANCE SCORE (0-100) - Weight: 40%
    // ===================================================================
    let keywordRelevance = 0;

    if (!kw) {
      keywordRelevance = 50; // No keyword provided = neutral score
      explanation.keywordRelevance = 'No target keyword provided for analysis.';
    } else {
      // HARD GATE: Keyword must appear in content
      if (!kw.inContent) {
        keywordRelevance = 0;
        const variations = this.generateKeywordVariations(kw.keyword).join(', ');
        explanation.keywordRelevance = `Target keyword "${kw.keyword}" (including variations: ${variations}) not found in page content. Page cannot rank without keyword presence.`;
        
        return {
          total: 0,
          components: {
            keywordRelevance: 0,
            contentQuality: 0,
            technicalHealth: 0,
          },
          explanation,
        };
      }

      // Build keyword relevance score from critical elements
      let kwPoints = 0;
      const reasons = [];

      // Title (most important - 30 points)
      if (kw.inTitle) {
        kwPoints += 30;
        reasons.push('✓ Keyword in title (+30)');
      } else {
        reasons.push('✗ Keyword missing from title (0/30)');
      }

      // H1 (very important - 25 points)
      if (kw.inH1) {
        kwPoints += 25;
        reasons.push('✓ Keyword in H1 (+25)');
      } else {
        reasons.push('✗ Keyword missing from H1 (0/25)');
      }

      // First 100 words (important for relevance - 20 points)
      if (kw.inFirst100Words) {
        kwPoints += 20;
        reasons.push('✓ Keyword in first 100 words (+20)');
      } else {
        reasons.push('✗ Keyword not in first 100 words (0/20)');
      }

      // Meta description (15 points)
      if (kw.inDescription) {
        kwPoints += 15;
        reasons.push('✓ Keyword in meta description (+15)');
      } else {
        reasons.push('✗ Keyword missing from meta description (0/15)');
      }

      // Keyword density (10 points max)
      const density = kw.density;
      if (density >= 1.0 && density <= 1.5) {
        kwPoints += 10;
        reasons.push(`✓ Optimal keyword density ${density.toFixed(2)}% (+10)`);
      } else if (density >= 0.8 && density < 1.0) {
        kwPoints += 8;
        reasons.push(`✓ Good keyword density ${density.toFixed(2)}% (+8)`);
      } else if (density >= 0.5 && density < 0.8) {
        kwPoints += 6;
        reasons.push(`◐ Moderate keyword density ${density.toFixed(2)}% (+6)`);
      } else if (density >= 0.3 && density < 0.5) {
        kwPoints += 4;
        reasons.push(`◐ Low keyword density ${density.toFixed(2)}% (+4)`);
      } else if (density > 0 && density < 0.3) {
        kwPoints += 1;
        reasons.push(`✗ Very low keyword density ${density.toFixed(2)}% (+1, needs significant improvement)`);
      } else if (density > 1.5 && density <= 2.5) {
        kwPoints += 7;
        reasons.push(`◐ High keyword density ${density.toFixed(2)}% (+7)`);
      } else if (density > 2.5) {
        kwPoints += 2;
        reasons.push(`✗ Excessive keyword density ${density.toFixed(2)}% (+2, keyword stuffing risk)`);
      } else {
        reasons.push(`✗ No keyword density (0/10)`);
      }

      // Show which variations were found
      if (kw.keywordVariationsFound && kw.keywordVariationsFound.length > 0) {
        const variantStr = kw.keywordVariationsFound.map(v => `"${v.variant}" (${v.count}×)`).join(', ');
        reasons.push(`Found variations: ${variantStr}`);
      }

      keywordRelevance = Math.min(kwPoints, 100);
      
      // CRITICAL: Apply immediate penalties for missing essential placements
      // These are NON-NEGOTIABLE for ranking
      if (!kw.inTitle) {
        keywordRelevance = Math.max(0, keywordRelevance - 40);
        reasons.push(`⚠ CRITICAL PENALTY: Keyword missing from title (-40 points)`);
      }
      
      if (!kw.inH1) {
        keywordRelevance = Math.max(0, keywordRelevance - 30);
        reasons.push(`⚠ CRITICAL PENALTY: Keyword missing from H1 (-30 points)`);
      }
      
      keywordRelevance = Math.max(0, keywordRelevance);
      explanation.keywordRelevance = reasons.join('\n');

      // SERP competitive context
      if (serpData?.benchmark) {
        const bench = serpData.benchmark;
        const competitorTitleRate = bench.percentTitleHasKeyword || 0;
        
        if (!kw.inTitle && competitorTitleRate >= 0.7) {
          explanation.keywordRelevance += `\n⚠ ${Math.round(competitorTitleRate * 100)}% of top competitors have keyword in title - you're at a significant disadvantage.`;
        }
      }
    }

    // ===================================================================
    // 2. CONTENT QUALITY SCORE (0-100) - Weight: 35%
    // ===================================================================
    let contentQuality = 0;
    const contentReasons = [];

    // A. Word count scoring (60% of content quality)
    let lengthScore = 0;
    if (wordCount >= 2000) {
      lengthScore = 100;
      contentReasons.push(`✓ Excellent content length: ${wordCount} words (100/100)`);
    } else if (wordCount >= 1500) {
      lengthScore = 85;
      contentReasons.push(`✓ Good content length: ${wordCount} words (85/100)`);
    } else if (wordCount >= 1000) {
      lengthScore = 70;
      contentReasons.push(`◐ Moderate content length: ${wordCount} words (70/100)`);
    } else if (wordCount >= 600) {
      lengthScore = 50;
      contentReasons.push(`◐ Below average content length: ${wordCount} words (50/100)`);
    } else if (wordCount >= 300) {
      lengthScore = 30;
      contentReasons.push(`✗ Poor content length: ${wordCount} words (30/100)`);
    } else {
      lengthScore = 10;
      contentReasons.push(`✗ Very poor content length: ${wordCount} words (10/100)`);
    }

    // B. Content structure scoring (40% of content quality)
    const h1Count = checks.h1?.count || 0;
    const h2Count = checks.h2?.count || 0;
    const h3Count = checks.h3?.count || 0;

    let structureScore = 0;
    const structureReasons = [];

    // H1 evaluation
    if (h1Count === 1) {
      structureScore += 40;
      structureReasons.push('✓ Single H1 tag (+40)');
    } else if (h1Count === 0) {
      structureReasons.push('✗ Missing H1 tag (0/40)');
    } else {
      structureScore += 20;
      structureReasons.push(`◐ Multiple H1 tags (${h1Count}) - should have only one (+20/40)`);
    }

    // H2 evaluation
    if (h2Count >= 5) {
      structureScore += 40;
      structureReasons.push(`✓ Excellent H2 structure: ${h2Count} H2 tags (+40)`);
    } else if (h2Count >= 3) {
      structureScore += 30;
      structureReasons.push(`✓ Good H2 structure: ${h2Count} H2 tags (+30)`);
    } else if (h2Count >= 1) {
      structureScore += 15;
      structureReasons.push(`◐ Minimal H2 structure: ${h2Count} H2 tag(s) (+15)`);
    } else {
      structureReasons.push('✗ No H2 tags found (0/40)');
    }

    // H3 bonus
    if (h3Count >= 3) {
      structureScore += 20;
      structureReasons.push(`✓ Good H3 depth: ${h3Count} H3 tags (+20 bonus)`);
    }

    structureScore = Math.min(structureScore, 100);
    contentReasons.push(...structureReasons);

    // Combine length and structure
    contentQuality = (lengthScore * 0.6) + (structureScore * 0.4);
    
    // Additional penalties for poor content engagement
    if (checks.links?.internal === 0) {
      contentQuality = Math.max(0, contentQuality - 10);
      contentReasons.push('✗ No internal links - poor site structure (-10)');
    } else if (checks.links?.internal < 3) {
      contentQuality = Math.max(0, contentQuality - 5);
      contentReasons.push(`◐ Only ${checks.links.internal} internal link(s) - should have 3+ (-5)`);
    }
    
    if (checks.links?.external === 0 && wordCount > 800) {
      contentQuality = Math.max(0, contentQuality - 5);
      contentReasons.push('✗ No external links - missing credibility signals (-5)');
    }
    
    explanation.contentQuality = contentReasons.join('\n');

    // ===================================================================
    // 3. TECHNICAL HEALTH SCORE (0-100) - Weight: 25%
    // ===================================================================
    let technicalHealth = 0;
    const techReasons = [];

    // Start with DataForSEO's on-page score (base score)
    const rawOnPageScore = pageData.onpage_score || 0;
    technicalHealth = rawOnPageScore * 100;
    techReasons.push(`Base technical score: ${technicalHealth.toFixed(0)}/100 (from DataForSEO)`);

    // Critical technical issues (hard penalties)
    let penalties = 0;

    // Broken links (critical) - instant_pages returns boolean
    const hasBrokenLinks = pageData.broken_links || false;
    if (hasBrokenLinks) {
      penalties += 15;
      techReasons.push('✗ Page has broken links (-15)');
    }

    // Missing canonical (important)
    if (!checks.canonical?.exists) {
      penalties += 10;
      techReasons.push('✗ Missing canonical tag (-10)');
    }

    // Page load time
    const loadTime = checks.loadTime?.value;
    if (loadTime !== null) {
      if (loadTime > 5) {
        penalties += 15;
        techReasons.push(`✗ Slow page load: ${loadTime.toFixed(1)}s (-15)`);
      } else if (loadTime > 3) {
        penalties += 8;
        techReasons.push(`◐ Moderate page load: ${loadTime.toFixed(1)}s (-8)`);
      } else if (loadTime <= 2.5) {
        techReasons.push(`✓ Fast page load: ${loadTime.toFixed(1)}s (no penalty)`);
      }
    }

    // Missing meta description (important for CTR)
    if (!checks.description?.exists) {
      penalties += 10;
      techReasons.push('✗ Missing meta description (-10)');
    }

    // Apply penalties
    technicalHealth = Math.max(0, technicalHealth - penalties);
    if (penalties > 0) {
      techReasons.push(`Total technical penalties: -${penalties}`);
    }
    techReasons.push(`Final technical health: ${technicalHealth.toFixed(0)}/100`);

    explanation.technicalHealth = techReasons.join('\n');

    // ===================================================================
    // 4. CALCULATE FINAL SCORE
    // ===================================================================
    // Weights: Keyword 40%, Content 35%, Technical 25%
    let total = (keywordRelevance * 0.40) + (contentQuality * 0.35) + (technicalHealth * 0.25);

    // Final adjustments and caps
    const adjustments = [];
    
    // EARLY CAPS - Apply immediately if critical issues exist
    // These prevent inflated scores when fundamental optimization is missing
    
    // CRITICAL: Keyword not in title = Cannot rank well
    if (kw && !kw.inTitle) {
      const cap = 50;
      if (total > cap) {
        adjustments.push(`⚠ CRITICAL: Keyword missing from title - score capped at ${cap}`);
        total = cap;
      }
    }
    
    // CRITICAL: Keyword not in H1 = Poor topical relevance
    if (kw && !kw.inH1) {
      const cap = 60;
      if (total > cap) {
        adjustments.push(`⚠ CRITICAL: Keyword missing from H1 - score capped at ${cap}`);
        total = cap;
      }
    }

    // SERP competitive disadvantage
    if (serpData?.benchmark && kw) {
      const bench = serpData.benchmark;
      const top3Analysis = bench.topCompetitorsAnalysis;
      
      if (top3Analysis) {
        // If top 3 all have keyword in title and you don't
        if (top3Analysis.top3KeywordInTitle === 3 && !kw.inTitle) {
          const cap = 45;
          if (total > cap) {
            adjustments.push(`⚠ Top 3 competitors all have keyword in title - score capped at ${cap}`);
            total = cap;
          }
        }
      }
    }

    // Insufficient content penalty
    if (wordCount < 300) {
      const cap = 35;
      if (total > cap) {
        adjustments.push(`⚠ Content too short (${wordCount} words) - score capped at ${cap}`);
        total = cap;
      }
    } else if (wordCount < 500) {
      const cap = 55;
      if (total > cap) {
        adjustments.push(`⚠ Content below minimum threshold (${wordCount} words) - score capped at ${cap}`);
        total = cap;
      }
    }

    // Missing critical keyword placements
    if (kw && !kw.inTitle && !kw.inH1 && !kw.inFirst100Words) {
      const cap = 40;
      if (total > cap) {
        adjustments.push(`⚠ Keyword missing from title, H1, and first 100 words - score capped at ${cap}`);
        total = cap;
      }
    }

    // Very weak keyword presence (incidental only)
    if (kw && kw.occurrences <= 2 && kw.density < 0.2) {
      const cap = 25;
      if (total > cap) {
        adjustments.push(`⚠ Keyword appears only ${kw.occurrences} time(s) with ${kw.density.toFixed(2)}% density - likely incidental, score capped at ${cap}`);
        total = cap;
      }
    }
    
    // Cap for very low keyword density (below 0.3%) but not incidental
    if (kw && kw.density >= 0.2 && kw.density < 0.3 && kw.occurrences > 2) {
      const cap = 75;
      if (total > cap) {
        const needed = Math.max(1, Math.round(wordCount * 0.005) - kw.occurrences);
        adjustments.push(`⚠ Very low keyword density (${kw.density.toFixed(2)}%) - needs ${needed} more mentions, score capped at ${cap}`);
        total = cap;
      }
    }
    
    // Cap for pages with no internal linking structure
    if (checks.links?.internal === 0 && checks.links?.external === 0) {
      const cap = 85;
      if (total > cap) {
        adjustments.push(`⚠ No internal or external links - poor content engagement, score capped at ${cap}`);
        total = cap;
      }
    }
    
    // Cap for poor heading structure despite good content length
    if (wordCount > 1000 && (checks.h2?.count || 0) < 3) {
      const cap = 88;
      if (total > cap) {
        adjustments.push(`⚠ Long content (${wordCount} words) with only ${checks.h2?.count || 0} H2 tags - poor structure, score capped at ${cap}`);
        total = cap;
      }
    }

    explanation.finalAdjustments = adjustments.length > 0 ? adjustments.join('\n') : 'No final adjustments applied.';

    // Ensure score is within bounds
    total = Math.max(0, Math.min(100, total));
    
    // ABSOLUTE CAP: No page is truly perfect (100/100)
    // Reserve 100 for truly exceptional pages with no issues whatsoever
    if (total >= 98) {
      // Check for any imperfections
      const hasImperfections = 
        keywordRelevance < 100 ||  // Keyword optimization not perfect
        contentQuality < 100 ||     // Content could be better
        technicalHealth < 100 ||    // Technical issues exist
        (checks.links?.internal || 0) < 5 ||  // Few internal links
        (checks.links?.external || 0) < 2 ||  // Few external links
        (checks.h2?.count || 0) < 5;          // Weak heading structure
      
      if (hasImperfections) {
        total = Math.min(total, 95);
        if (!adjustments.some(a => a.includes('capped at 95'))) {
          adjustments.push('⚠ Maximum score capped at 95 - minor optimizations still possible');
          explanation.finalAdjustments = adjustments.join('\n');
        }
      }
    }

    return {
      total,
      components: {
        keywordRelevance: Math.round(keywordRelevance),
        contentQuality: Math.round(contentQuality),
        technicalHealth: Math.round(technicalHealth),
      },
      explanation,
    };
  }

  generateEnhancedRecommendations(checks, keywordAnalysis, keyword, serpData, pageData, meta, scoring, lang) {
    const recommendations = [];
    const wordCount = keywordAnalysis?.wordCount || meta?.content?.plain_text_word_count || 0;
    const kw = keywordAnalysis;

    // Helper to add recommendation without duplication
    const addRec = (priority, category, issueKey, actionKey, vars = {}) => {
      const issue = t(lang, `seo.recommendations.${issueKey}.issue`, vars);
      const action = t(lang, `seo.recommendations.${issueKey}.action`, vars);
      
      if (issue && action && !issue.includes('.issue')) {
        // Check for duplicates
        const isDuplicate = recommendations.some(r => r.issue === issue);
        if (!isDuplicate) {
          recommendations.push({
            priority,
            category,
            issue,
            action,
            impact: priority === 'critical' ? 'high' : priority === 'high' ? 'high' : priority === 'medium' ? 'medium' : 'low',
            effort: ['missingTitle', 'missingDescription', 'missingH1', 'missingCanonical', 'keywordNotInTitle'].includes(issueKey) ? 'easy' : 'moderate',
          });
        }
      }
    };

    // ===================================================================
    // CRITICAL PRIORITY (Must fix immediately)
    // ===================================================================

    // Keyword not in content (show first if applicable)
    if (kw && !kw.inContent) {
      // Include info about variations checked
      const variations = this.generateKeywordVariations(keyword).join('", "');
      addRec('critical', 'keyword', 'keywordNotInContent', 'keywordNotInContent', { 
        keyword,
        variations: `"${variations}"`
      });
    }

    // Missing title tag
    if (!checks.title.exists) {
      addRec('critical', 'meta', 'missingTitle', 'missingTitle');
    }

    // Keyword not in title (when keyword IS in content)
    if (kw && kw.inContent && !kw.inTitle) {
      addRec('critical', 'keyword', 'keywordNotInTitle', 'keywordNotInTitle', { keyword });
    }

    // Missing H1
    if (!checks.h1.exists) {
      addRec('critical', 'content', 'missingH1', 'missingH1');
    }

    // Broken links
    if (pageData.broken_links) {
      addRec('critical', 'technical', 'brokenLinks', 'brokenLinks', { count: 'some' });
    }

    // Very low word count
    if (wordCount < 300) {
      addRec('critical', 'content', 'veryLowWordCount', 'veryLowWordCount', { count: wordCount });
    }

    // Missing meta description
    if (!checks.description.exists) {
      addRec('critical', 'meta', 'missingDescription', 'missingDescription');
    }

    // ===================================================================
    // HIGH PRIORITY (Important for ranking)
    // ===================================================================

    // Keyword not in H1 (when in content and title)
    if (kw && kw.inContent && !kw.inH1) {
      addRec('high', 'keyword', 'keywordNotInH1', 'keywordNotInH1', { keyword });
    }

    // Multiple H1 tags
    if (checks.h1.count > 1) {
      addRec('high', 'content', 'multipleH1', 'multipleH1', { count: checks.h1.count });
    }

    // Missing H2 structure
    if (checks.h2.count === 0) {
      addRec('high', 'content', 'missingH2', 'missingH2');
    }

    // Keyword not in meta description
    if (kw && !kw.inDescription) {
      addRec('high', 'keyword', 'keywordNotInDescription', 'keywordNotInDescription', { keyword });
    }

    // Low word count (compared to minimum standards)
    if (wordCount >= 300 && wordCount < 800) {
      addRec('high', 'content', 'lowWordCount', 'lowWordCount', {
        count: wordCount,
        recommended: 1200,
      });
    }

    // Missing canonical tag
    if (!checks.canonical.exists) {
      addRec('high', 'technical', 'missingCanonical', 'missingCanonical');
    }

    // Slow page load
    if (checks.loadTime.value && checks.loadTime.value > 4) {
      addRec('high', 'technical', 'slowLoadTime', 'slowLoadTime', { time: checks.loadTime.value.toFixed(1) });
    }

    // Very low keyword density (when keyword is in content)
    if (kw && kw.inContent && kw.density < 0.5) {
      const needed = Math.max(1, Math.round(wordCount * 0.008) - kw.occurrences);
      addRec('high', 'keyword', 'keywordDensityLow', 'keywordDensityLow', {
        density: kw.density.toFixed(2),
        occurrences: kw.occurrences,
        wordCount,
        recommended: needed,
        keyword,
      });
    }

    // ===================================================================
    // MEDIUM PRIORITY (Should improve)
    // ===================================================================

    // Title length not optimal
    if (checks.title.exists) {
      const titleLen = checks.title.length;
      if (titleLen < 30) {
        addRec('medium', 'meta', 'titleTooShort', 'titleTooShort', { length: titleLen });
      } else if (titleLen < 40 || titleLen > 70) {
        addRec('medium', 'meta', 'titleNotOptimal', 'titleNotOptimal', { length: titleLen });
      }
    }

    // Description length not optimal
    if (checks.description.exists) {
      const descLen = checks.description.length;
      if (descLen < 120 || descLen > 170) {
        addRec('medium', 'meta', 'descriptionNotOptimal', 'descriptionNotOptimal', { length: descLen });
      }
    }

    // Keyword not in first 100 words
    if (kw && kw.inContent && !kw.inFirst100Words) {
      addRec('medium', 'keyword', 'keywordNotInFirst100Words', 'keywordNotInFirst100Words', { keyword });
    }

    // Few H2 tags
    if (checks.h2.count > 0 && checks.h2.count < 3 && wordCount > 500) {
      addRec('medium', 'content', 'fewH2', 'fewH2', { count: checks.h2.count });
    }

    // Few internal links
    if (checks.links.internal < 3) {
      addRec('medium', 'content', 'fewInternalLinks', 'fewInternalLinks', { count: checks.links.internal });
    }

    // Moderate page load time
    if (checks.loadTime.value && checks.loadTime.value > 3 && checks.loadTime.value <= 4) {
      addRec('medium', 'technical', 'slowLoadTime', 'slowLoadTime', { time: checks.loadTime.value.toFixed(1) });
    }

    // High keyword density (potential over-optimization)
    if (kw && kw.density > 3) {
      const recommended = Math.round(wordCount * 0.015);
      addRec('medium', 'keyword', 'keywordDensityHigh', 'keywordDensityHigh', {
        density: kw.density.toFixed(2),
        occurrences: kw.occurrences,
        recommended,
        keyword,
      });
    }

    // ===================================================================
    // LOW PRIORITY (Nice to have)
    // ===================================================================

    // Keyword not in URL
    if (kw && !kw.inUrl) {
      addRec('low', 'keyword', 'keywordNotInUrl', 'keywordNotInUrl', { keyword });
    }

    // No external links (for credibility)
    if (checks.links.external === 0 && wordCount > 500) {
      addRec('low', 'content', 'noExternalLinks', 'noExternalLinks');
    }

    // ===================================================================
    // SERP COMPETITIVE INSIGHTS
    // ===================================================================
    if (serpData && serpData.competitors && serpData.competitors.length > 0 && kw) {
      const bench = serpData.benchmark;
      
      // Alert if most competitors have keyword in title but you don't
      if (bench.percentTitleHasKeyword >= 0.7 && !kw.inTitle) {
        addRec('high', 'competitor', 'competitorTitleAdvantage', 'competitorTitleAdvantage', {
          percent: Math.round(bench.percentTitleHasKeyword * 100),
          keyword,
        });
      }

      // General competitor analysis recommendation
      if (recommendations.filter(r => r.priority === 'critical' || r.priority === 'high').length <= 2) {
        addRec('medium', 'competitor', 'competitorAnalysis', 'competitorAnalysis', {
          count: serpData.competitors.length,
          keyword,
        });
      }
    }

    // ===================================================================
    // SUCCESS MESSAGE (if page is well optimized)
    // ===================================================================
    const criticalIssues = recommendations.filter(r => r.priority === 'critical').length;
    const highIssues = recommendations.filter(r => r.priority === 'high').length;

    if (criticalIssues === 0 && highIssues === 0 && scoring.total >= 70 && keyword) {
      addRec('low', 'success', 'excellentOptimization', 'excellentOptimization', { keyword });
    }

    // Sort by priority
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    recommendations.sort((a, b) => (priorityOrder[a.priority] || 4) - (priorityOrder[b.priority] || 4));

    return recommendations;
  }

  extractDomain(url) {
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return url;
    }
  }
}

export const dataForSEOService = new DataForSEOService();