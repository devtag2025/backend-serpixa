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

      return this.transformOnPageResult(onPageResult, url, keyword, serpResult, lang, locale);
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

      Logger.info(`[SERP Fetch] Keyword: "${keyword}", Location: ${locationName}, Language: ${languageName}, Device: ${device}`);

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
      
      const keywordVariations = this.generateKeywordVariations(keyword.trim());

      // Extract top 10 organic competitors WITH FULL DETAILS
      const competitors = organicResults
        .filter((item) => item.type === 'organic')
        .slice(0, 10)
        .map((item, index) => {
          const title = item.title || '';
          const description = item.description || '';
          
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
            // Estimate metrics from SERP preview
            estimatedTitleLength: title.length,
            estimatedDescLength: description.length,
          };
        });

      Logger.info(`[SERP Analysis] Found ${competitors.length} competitors for "${keyword}" in ${locationName}`);

      // Build comprehensive SERP benchmark with MARKET-SPECIFIC data
      const benchmark = this.buildSERPBenchmark(competitors, keyword, keywordVariations, locationName, languageName);

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
        benchmark,
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
   * Build comprehensive SERP benchmark from Top 10 competitors
   * NOW INCLUDES: Market-specific fingerprint for score differentiation
   */
  buildSERPBenchmark(competitors, keyword, keywordVariations, locationName, languageName) {
    if (!competitors || competitors.length === 0) {
      return null;
    }

    const top3 = competitors.slice(0, 3);
    const top5 = competitors.slice(0, 5);
    const top10 = competitors;

    // Keyword presence analysis
    const titleWithKeywordCount = top10.filter(c => c.keywordInTitle).length;
    const descWithKeywordCount = top10.filter(c => c.keywordInDescription).length;
    
    const top3TitleWithKeyword = top3.filter(c => c.keywordInTitle).length;
    const top5TitleWithKeyword = top5.filter(c => c.keywordInTitle).length;
    
    const top3DescWithKeyword = top3.filter(c => c.keywordInDescription).length;

    // Page type distribution
    const pageTypeCounts = top10.reduce((acc, c) => {
      if (!c.pageType) return acc;
      acc[c.pageType] = (acc[c.pageType] || 0) + 1;
      return acc;
    }, {});

    const dominantPageType = Object.entries(pageTypeCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    const pageTypeDistribution = Object.entries(pageTypeCounts)
      .map(([type, count]) => ({ type, count, percentage: (count / top10.length) * 100 }));

    // Title and description length analysis
    const titleLengths = top10.map(c => c.estimatedTitleLength || 0);
    const descLengths = top10.map(c => c.estimatedDescLength || 0);
    
    const avgTitleLength = Math.round(
      titleLengths.reduce((sum, len) => sum + len, 0) / top10.length
    );
    const avgDescLength = Math.round(
      descLengths.reduce((sum, len) => sum + len, 0) / top10.length
    );

    // =========================================================================
    // NEW: MARKET-SPECIFIC FINGERPRINT
    // This creates unique characteristics for each market that affect scoring
    // =========================================================================
    
    // 1. Domain diversity - how many unique domains in top 10
    const uniqueDomains = new Set(top10.map(c => c.domain)).size;
    
    // 2. Actual competitor URLs/domains (for logging and debugging)
    const topDomains = top10.slice(0, 5).map(c => c.domain);
    
    // 3. Title optimization spread (variance in title lengths)
    const titleLengthVariance = this.calculateVariance(titleLengths);
    
    // 4. Description optimization spread
    const descLengthVariance = this.calculateVariance(descLengths);
    
    // 5. Top 3 optimization intensity (how well-optimized are the TOP positions)
    const top3OptimizationScore = (
      (top3TitleWithKeyword / 3) * 0.5 +
      (top3DescWithKeyword / 3) * 0.3 +
      (top3.filter(c => c.pageType === dominantPageType).length / 3) * 0.2
    );
    
    // 6. SERP homogeneity (how similar are competitors to each other)
    const serpHomogeneity = this.calculateSERPHomogeneity(top10, dominantPageType);
    
    // 7. Generate a unique market hash based on actual competitor data
    const marketFingerprint = this.generateMarketFingerprint(competitors, locationName, languageName);

    const benchmark = {
      // Keyword presence metrics
      percentTitleHasKeyword: titleWithKeywordCount / top10.length,
      percentDescHasKeyword: descWithKeywordCount / top10.length,
      
      // Top performer analysis
      top3KeywordInTitle: top3TitleWithKeyword,
      top5KeywordInTitle: top5TitleWithKeyword,
      top10KeywordInTitle: titleWithKeywordCount,
      
      top3KeywordInDescription: top3DescWithKeyword,
      
      // Page type insights
      dominantPageType,
      pageTypeDistribution,
      
      // Content structure benchmarks
      avgTitleLength,
      avgDescLength,
      titleLengthVariance,
      descLengthVariance,
      
      // NEW: Market-specific metrics
      uniqueDomains,
      topDomains,
      top3OptimizationScore,
      serpHomogeneity,
      marketFingerprint,
      
      // Competitiveness indicators
      competitionLevel: this.assessCompetitionLevel({
        titleKeywordRate: titleWithKeywordCount / top10.length,
        top3Optimization: top3TitleWithKeyword / 3,
        pageTypeConsistency: (pageTypeCounts[dominantPageType] || 0) / top10.length,
        serpHomogeneity,
      }),
    };

    Logger.info(`[SERP Benchmark] Market: ${locationName}/${languageName}`);
    Logger.info(`[SERP Benchmark] ${titleWithKeywordCount}/10 have keyword in title, Dominant type: ${dominantPageType}`);
    Logger.info(`[SERP Benchmark] Top domains: ${topDomains.join(', ')}`);
    Logger.info(`[SERP Benchmark] Market fingerprint: ${marketFingerprint}`);
    Logger.info(`[SERP Benchmark] Competition: ${benchmark.competitionLevel}, Homogeneity: ${serpHomogeneity.toFixed(2)}`);

    return benchmark;
  }

  /**
   * Calculate variance of an array of numbers
   */
  calculateVariance(numbers) {
    if (numbers.length === 0) return 0;
    const mean = numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
    const squaredDiffs = numbers.map(n => Math.pow(n - mean, 2));
    return squaredDiffs.reduce((sum, d) => sum + d, 0) / numbers.length;
  }

  /**
   * Calculate how homogeneous (similar) the SERP results are
   * Higher = more similar competitors = harder to differentiate
   */
  calculateSERPHomogeneity(competitors, dominantPageType) {
    if (competitors.length === 0) return 0;
    
    let similarityScore = 0;
    
    // Page type consistency
    const sameTypeCount = competitors.filter(c => c.pageType === dominantPageType).length;
    similarityScore += (sameTypeCount / competitors.length) * 0.4;
    
    // Title length consistency (low variance = high homogeneity)
    const titleLengths = competitors.map(c => c.estimatedTitleLength);
    const titleVariance = this.calculateVariance(titleLengths);
    const normalizedTitleVariance = Math.min(titleVariance / 500, 1); // Normalize
    similarityScore += (1 - normalizedTitleVariance) * 0.3;
    
    // Keyword optimization consistency
    const kwInTitleRate = competitors.filter(c => c.keywordInTitle).length / competitors.length;
    // If all have it or none have it = homogeneous
    const kwHomogeneity = kwInTitleRate > 0.5 ? kwInTitleRate : (1 - kwInTitleRate);
    similarityScore += kwHomogeneity * 0.3;
    
    return similarityScore;
  }

  /**
   * Generate a unique fingerprint for this specific market's SERP
   * This ensures different markets produce different scores even with similar patterns
   */
  generateMarketFingerprint(competitors, locationName, languageName) {
    // Create a hash from actual competitor data
    const dataPoints = [
      locationName,
      languageName,
      ...competitors.slice(0, 5).map(c => c.domain),
      ...competitors.slice(0, 3).map(c => c.estimatedTitleLength),
    ];
    
    // Simple hash function
    let hash = 0;
    const str = dataPoints.join('|');
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    
    return Math.abs(hash).toString(16).substring(0, 8);
  }

  /**
   * Assess overall competition level
   */
  assessCompetitionLevel({ titleKeywordRate, top3Optimization, pageTypeConsistency, serpHomogeneity = 0.5 }) {
    // Factor in SERP homogeneity - more homogeneous = harder to compete
    const adjustedRate = titleKeywordRate + (serpHomogeneity * 0.1);
    
    // High competition: top results are highly optimized
    if (adjustedRate >= 0.85 && top3Optimization >= 0.9) {
      return 'very-high';
    }
    if (adjustedRate >= 0.75 && top3Optimization >= 0.67) {
      return 'high';
    }
    if (adjustedRate >= 0.5) {
      return 'medium';
    }
    if (adjustedRate >= 0.3) {
      return 'low';
    }
    return 'very-low';
  }

  /**
   * Generate keyword variations for better matching
   */
  generateKeywordVariations(keyword) {
    const variations = new Set();
    const normalized = this.normalizeForSearch(keyword);
    
    variations.add(normalized);
    
    // Add plural forms
    if (!normalized.endsWith('s')) {
      variations.add(normalized + 's');
      if (normalized.endsWith('y') && normalized.length > 2) {
        variations.add(normalized.slice(0, -1) + 'ies');
      }
    } else {
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

  transformOnPageResult(data, url, keyword, serpData = null, lang = 'en', locale = DEFAULT_LOCALE) {
    if (!data) {
      return {
        url,
        keyword,
        locale,
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

    // Compute SEO score with SERP-FIRST approach and MARKET DIFFERENTIATION
    const scoring = this.computeSEOScoreWithSERPFirst({
      pageData,
      meta,
      keywordAnalysis,
      serpData,
      checks,
      locale,
    });

    const recommendations = this.generateSERPDrivenRecommendations(
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
      locale,
      score: Math.round(scoring.total * 100) / 100,
      scoreBreakdown: {
        total: Math.round(scoring.total * 100) / 100,
        components: scoring.components,
        explanation: scoring.explanation,
        marketFactors: scoring.marketFactors, // NEW: expose market-specific factors
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
    
    const internalLinksCount = meta.internal_links_count || 0;
    const externalLinksCount = meta.external_links_count || 0;
    const imagesCount = meta.images_count || 0;
    
    const rawLoadTime = pageData.page_timing?.time_to_interactive;
    const loadTime = typeof rawLoadTime === 'number' ? rawLoadTime / 1000 : null;

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
      return 'needsImprovement';
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
        withoutAlt: 0,
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
        broken: 0,
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
    const keywordVariations = this.generateKeywordVariations(keyword);
    const apiWordCount = meta.content?.plain_text_word_count || 0;
    
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
    
    const searchableText = [allHeadings, metaDesc, metaTitle].filter(Boolean).join(' ');
    const plainText = this.normalizeForSearch(searchableText);
    
    const wordCount = apiWordCount || 0;
    
    let contentSource = 'api_word_count';
    
    if (wordCount === 0) {
      Logger.warn(`[Word Count] API returned 0 word count for analysis. This will affect scoring.`);
      contentSource = 'no_content';
    }
    
    Logger.info(`[Content Analysis] Using API word count: ${wordCount}, Searchable text length: ${plainText.length}`);

    const title = this.normalizeForSearch(meta.title || '');
    const description = this.normalizeForSearch(meta.description || '');
    const h1Values = (meta.htags?.h1 || []).map(h => this.normalizeForSearch(h));
    const h2Values = (meta.htags?.h2 || []).map(h => this.normalizeForSearch(h));
    const url = (pageData.url || '').toLowerCase();

    const inTitle = this.keywordExistsInText(keyword, title);
    const inDescription = this.keywordExistsInText(keyword, description);
    const inH1 = h1Values.some(h => this.keywordExistsInText(keyword, h));
    const inH2 = h2Values.some(h => this.keywordExistsInText(keyword, h));
    const inContent = this.keywordExistsInText(keyword, plainText);
    
    const inUrl = keywordVariations.some(variant => 
      url.includes(variant.replace(/\s+/g, '-')) || url.includes(variant.replace(/\s+/g, ''))
    );

    const { totalCount: keywordCount, foundVariations } = this.countKeywordOccurrences(keyword, plainText);
    const density = wordCount > 0 ? ((keywordCount / wordCount) * 100) : 0;

    const first100Words = plainText.split(/\s+/).slice(0, 100).join(' ');
    const inFirst100Words = this.keywordExistsInText(keyword, first100Words);

    const densityOptimal = density >= 0.5 && density <= 1.5;
    const densityStatus = 
      density === 0 ? 'poor' :
      density < 0.3 ? 'poor' :
      density >= 0.5 && density <= 1.5 ? 'good' :
      density > 3 ? 'poor' :
      'needsImprovement';

    const recommendedMin = Math.max(1, Math.round(wordCount * 0.005));
    const recommendedMax = Math.round(wordCount * 0.015);

    // SERP competitive analysis - NOW WITH MORE DETAIL
    let serpComparison = null;
    if (serpData?.benchmark) {
      const bench = serpData.benchmark;
      serpComparison = {
        competitorsWithKeywordInTitle: Math.round(bench.percentTitleHasKeyword * 100),
        competitorsWithKeywordInDesc: Math.round(bench.percentDescHasKeyword * 100),
        yourTitleHasKeyword: inTitle,
        yourDescHasKeyword: inDescription,
        titleCompetitiveness: inTitle 
          ? 'competitive' 
          : bench.percentTitleHasKeyword > 0.7 
            ? 'weak' 
            : 'moderate',
        competitionLevel: bench.competitionLevel,
        dominantPageType: bench.dominantPageType,
        // NEW: Market-specific context
        marketLocation: serpData.location,
        marketLanguage: serpData.language,
        topCompetitorDomains: bench.topDomains || [],
        serpHomogeneity: bench.serpHomogeneity,
        marketFingerprint: bench.marketFingerprint,
      };
    }

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
        density: `${density.toFixed(2)}%`,
        serpComparison,
      });
    }

    return {
      title: t(lang, 'seo.keywordAnalysis.title'),
      keyword,
      keywordVariationsFound: foundVariations,
      
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

  
  computeSEOScoreWithSERPFirst({ pageData, meta, keywordAnalysis, serpData, checks, locale }) {
    const wordCount = keywordAnalysis?.wordCount || meta.content?.plain_text_word_count || 0;
    const kw = keywordAnalysis;

    let explanation = {
      serpCompetitiveness: '',
      contentStructure: '',
      technicalOnPage: '',
      finalAdjustments: '',
    };
 
    // Track market-specific factors for transparency
    let marketFactors = {
      location: serpData?.location || 'Unknown',
      language: serpData?.language || 'Unknown',
      fingerprint: null,
      competitorDomains: [],
      adjustments: [],
    };

    // ===================================================================
    // 1. SERP COMPETITIVENESS SCORE (0-100) - Weight: 45%
    // NOW TRULY MARKET-SPECIFIC
    // ===================================================================
    let serpCompetitiveness = 0;

    if (!serpData || !serpData.benchmark || !kw) {
      // No SERP data available - use fallback scoring
      serpCompetitiveness = 50;
      explanation.serpCompetitiveness = 'No SERP data available. Cannot assess competitive position. Using neutral score.';
      
      Logger.warn(`[SERP Scoring] No SERP data for locale: ${locale}. Score will be generic.`);
    } else {
      const serpReasons = [];
      const bench = serpData.benchmark;
      const competitors = serpData.competitors || [];
      
      // Store market info
      marketFactors.fingerprint = bench.marketFingerprint;
      marketFactors.competitorDomains = bench.topDomains || [];
      
      serpReasons.push(`🌍 Market: ${serpData.location} (${serpData.language})`);
      serpReasons.push(`🔑 Market Fingerprint: ${bench.marketFingerprint}`);
      serpReasons.push(`🎯 Analyzing Top ${competitors.length} competitors for "${kw.keyword}"`);
      serpReasons.push(`📊 Competition Level: ${bench.competitionLevel.toUpperCase()}`);
      serpReasons.push(`🏢 Top domains: ${(bench.topDomains || []).slice(0, 3).join(', ')}`);

      // HARD GATE: Keyword must appear in content
      if (!kw.inContent) {
        serpCompetitiveness = 0;
        serpReasons.push(`❌ CRITICAL: Keyword not found in page content. Cannot compete without keyword presence.`);
        explanation.serpCompetitiveness = serpReasons.join('\n');
        
        return {
          total: 0,
          components: {
            serpCompetitiveness: 0,
            contentStructure: 0,
            technicalOnPage: 0,
          },
          explanation,
          marketFactors,
        };
      }

      // =====================================================================
      // MARKET-SPECIFIC SCORING
      // Compare YOUR optimization against THIS MARKET'S specific competitors
      // =====================================================================
      
      let serpPoints = 0;

      // 1. Title Optimization vs THIS MARKET'S Competitors (35 points max)
      const titleKeywordRate = bench.percentTitleHasKeyword;
      const top3TitleRate = bench.top3KeywordInTitle / 3;
      
      if (kw.inTitle) {
        // You have keyword in title - how does this compare to THIS market?
        if (titleKeywordRate >= 0.9) {
          // Very competitive market - all competitors optimized
          serpPoints += 30; // Slightly less because it's table stakes
          serpReasons.push(`✅ Keyword in title - MATCHED ${Math.round(titleKeywordRate * 100)}% of ${serpData.location} competitors (+30)`);
        } else if (titleKeywordRate >= 0.7) {
          serpPoints += 33;
          serpReasons.push(`✅ Keyword in title - competitive with ${Math.round(titleKeywordRate * 100)}% of ${serpData.location} market (+33)`);
        } else if (titleKeywordRate >= 0.5) {
          serpPoints += 35;
          serpReasons.push(`✅ Keyword in title - OUTPERFORMING ${serpData.location} average (only ${Math.round(titleKeywordRate * 100)}% have it) (+35)`);
        } else {
          serpPoints += 35;
          serpReasons.push(`✅ Keyword in title - STRONG ADVANTAGE in ${serpData.location} (only ${Math.round(titleKeywordRate * 100)}% have it) (+35)`);
        }
      } else {
        // You DON'T have keyword in title - how bad is this in THIS market?
        if (titleKeywordRate >= 0.9) {
          // Everyone has it, you don't = disaster
          serpReasons.push(`❌ CRITICAL in ${serpData.location}: ${Math.round(titleKeywordRate * 100)}% of competitors have keyword in title, you don't (0/35)`);
          marketFactors.adjustments.push(`Title keyword is essential in ${serpData.location} market`);
        } else if (titleKeywordRate >= 0.7) {
          serpReasons.push(`❌ MAJOR GAP in ${serpData.location}: ${Math.round(titleKeywordRate * 100)}% of competitors have keyword in title (0/35)`);
          marketFactors.adjustments.push(`Most ${serpData.location} competitors have keyword in title`);
        } else if (titleKeywordRate >= 0.5) {
          serpPoints += 10;
          serpReasons.push(`⚠️ Keyword not in title, ${Math.round(titleKeywordRate * 100)}% of ${serpData.location} competitors have it (+10/35)`);
        } else {
          serpPoints += 20;
          serpReasons.push(`⚠️ Keyword not in title, but only ${Math.round(titleKeywordRate * 100)}% in ${serpData.location} have it (+20/35)`);
        }
      }

      // 2. H1 Optimization vs THIS MARKET'S Top 3 (25 points max)
      if (kw.inH1) {
        if (top3TitleRate >= 0.9) {
          serpPoints += 22;
          serpReasons.push(`✅ Keyword in H1 - matched highly optimized ${serpData.location} Top 3 (+22)`);
        } else {
          serpPoints += 25;
          serpReasons.push(`✅ Keyword in H1 - strong position in ${serpData.location} (+25)`);
        }
      } else {
        if (top3TitleRate >= 0.9) {
          serpReasons.push(`❌ ${serpData.location} Top 3 are highly optimized (${bench.top3KeywordInTitle}/3), you're not (0/25)`);
          marketFactors.adjustments.push(`Top 3 in ${serpData.location} all have keyword in H1`);
        } else if (bench.top3KeywordInTitle >= 2) {
          serpPoints += 5;
          serpReasons.push(`⚠️ ${bench.top3KeywordInTitle}/3 ${serpData.location} top competitors have keyword optimized (+5/25)`);
        } else {
          serpPoints += 12;
          serpReasons.push(`⚠️ ${serpData.location} Top 3 less optimized (${bench.top3KeywordInTitle}/3), you can still compete (+12/25)`);
        }
      }

      // 3. Meta Description vs THIS MARKET (15 points max)
      const descKeywordRate = bench.percentDescHasKeyword;
      if (kw.inDescription) {
        if (descKeywordRate >= 0.8) {
          serpPoints += 13;
          serpReasons.push(`✅ Keyword in description - matched ${Math.round(descKeywordRate * 100)}% ${serpData.location} standard (+13)`);
        } else {
          serpPoints += 15;
          serpReasons.push(`✅ Keyword in description - ahead of ${serpData.location} competition (+15)`);
        }
      } else {
        if (descKeywordRate >= 0.8) {
          serpReasons.push(`⚠️ ${Math.round(descKeywordRate * 100)}% of ${serpData.location} competitors have keyword in description (0/15)`);
        } else if (descKeywordRate >= 0.5) {
          serpPoints += 5;
          serpReasons.push(`⚠️ Keyword not in description (${Math.round(descKeywordRate * 100)}% in ${serpData.location} have it) (+5/15)`);
        } else {
          serpPoints += 10;
          serpReasons.push(`⚠️ Keyword not in description, but ${serpData.location} market is less optimized (+10/15)`);
        }
      }

      // 4. Early Keyword Placement (10 points max)
      if (kw.inFirst100Words) {
        serpPoints += 10;
        serpReasons.push(`✅ Keyword in first 100 words - strong relevance signal (+10)`);
      } else {
        serpReasons.push(`⚠️ Keyword not in first 100 words (0/10)`);
      }

      // 5. Page Type Alignment with THIS MARKET (15 points max)
      const myPageType = this.classifyPageType(pageData.url || '', meta.title || '');
      const dominantType = bench.dominantPageType;
      
      if (dominantType && myPageType === dominantType) {
        serpPoints += 15;
        serpReasons.push(`✅ Page type '${myPageType}' MATCHES ${serpData.location} SERP type (+15)`);
      } else if (dominantType) {
        const distribution = bench.pageTypeDistribution?.find(d => d.type === dominantType);
        const dominance = distribution ? distribution.percentage : 0;
        
        if (dominance >= 80) {
          serpReasons.push(`❌ ${Math.round(dominance)}% of ${serpData.location} Top 10 are '${dominantType}' pages, yours is '${myPageType}' (0/15)`);
          marketFactors.adjustments.push(`${serpData.location} SERP dominated by ${dominantType} pages`);
        } else if (dominance >= 60) {
          serpPoints += 5;
          serpReasons.push(`⚠️ ${serpData.location} SERP prefers '${dominantType}' (${Math.round(dominance)}%), yours is '${myPageType}' (+5/15)`);
        } else {
          serpPoints += 10;
          serpReasons.push(`◐ ${serpData.location} SERP has mixed page types (+10)`);
        }
      } else {
        serpPoints += 10;
        serpReasons.push(`◐ ${serpData.location} SERP has diverse page types (+10)`);
      }

      // =====================================================================
      // MARKET-SPECIFIC ADJUSTMENTS
      // These create score differentiation between markets
      // =====================================================================
      
      // A. SERP Homogeneity Factor
      // Higher homogeneity = competitors are more similar = harder to differentiate
      const homogeneity = bench.serpHomogeneity || 0.5;
      if (homogeneity > 0.7 && serpPoints < 80) {
        const homogeneityPenalty = Math.round((homogeneity - 0.5) * 10);
        serpPoints -= homogeneityPenalty;
        serpReasons.push(`⚠️ ${serpData.location} SERP is highly homogeneous (${(homogeneity * 100).toFixed(0)}%) - harder to stand out (-${homogeneityPenalty})`);
        marketFactors.adjustments.push(`High SERP homogeneity in ${serpData.location}`);
      } else if (homogeneity < 0.4 && serpPoints > 40) {
        const homogeneityBonus = Math.round((0.5 - homogeneity) * 8);
        serpPoints += homogeneityBonus;
        serpReasons.push(`✅ ${serpData.location} SERP is diverse - easier to find niche (+${homogeneityBonus})`);
      }

      // B. Domain Diversity Factor
      // More unique domains = more competitive market
      const uniqueDomains = bench.uniqueDomains || 10;
      if (uniqueDomains <= 5) {
        // Few domains dominating - harder for new entrants
        serpPoints -= 5;
        serpReasons.push(`⚠️ Only ${uniqueDomains} domains in ${serpData.location} Top 10 - market concentrated (-5)`);
        marketFactors.adjustments.push(`${serpData.location} market dominated by few players`);
      } else if (uniqueDomains >= 9) {
        // High diversity - opportunity
        serpPoints += 3;
        serpReasons.push(`✅ ${uniqueDomains} unique domains in ${serpData.location} Top 10 - diverse market (+3)`);
      }

      // C. Top 3 Optimization Intensity
      // How well-optimized are the TOP positions specifically?
      const top3Score = bench.top3OptimizationScore || 0.5;
      if (top3Score > 0.8 && serpPoints > 60) {
        const top3Penalty = Math.round((top3Score - 0.5) * 15);
        serpPoints -= top3Penalty;
        serpReasons.push(`⚠️ ${serpData.location} Top 3 are exceptionally well-optimized (${(top3Score * 100).toFixed(0)}%) (-${top3Penalty})`);
        marketFactors.adjustments.push(`Intense competition in ${serpData.location} top positions`);
      }

      serpCompetitiveness = Math.max(0, Math.min(serpPoints, 100));

      // Apply competition level multiplier (market-specific)
      if (bench.competitionLevel === 'very-high' && serpCompetitiveness < 85) {
        const penalty = (85 - serpCompetitiveness) * 0.25;
        serpCompetitiveness = Math.max(0, serpCompetitiveness - penalty);
        serpReasons.push(`⚠️ VERY HIGH competition in ${serpData.location}: -${penalty.toFixed(0)} points`);
      } else if (bench.competitionLevel === 'high' && serpCompetitiveness < 70) {
        const penalty = (70 - serpCompetitiveness) * 0.15;
        serpCompetitiveness = Math.max(0, serpCompetitiveness - penalty);
        serpReasons.push(`⚠️ HIGH competition in ${serpData.location}: -${penalty.toFixed(0)} points`);
      } else if (bench.competitionLevel === 'low' && serpCompetitiveness > 50) {
        const bonus = (serpCompetitiveness - 50) * 0.1;
        serpCompetitiveness = Math.min(100, serpCompetitiveness + bonus);
        serpReasons.push(`✅ Lower competition in ${serpData.location}: +${bonus.toFixed(0)} points`);
      }

      serpReasons.push(`\n📈 SERP Competitiveness Score for ${serpData.location}: ${serpCompetitiveness.toFixed(0)}/100`);
      explanation.serpCompetitiveness = serpReasons.join('\n');
    }

    // ===================================================================
    // 2. CONTENT & STRUCTURE SCORE (0-100) - Weight: 35%
    // (This stays mostly the same as it's about YOUR page, not market)
    // ===================================================================
    let contentStructure = 0;
    const contentReasons = [];

    // Word count scoring (50% of content score)
    let lengthScore = 0;
    if (wordCount >= 2000) {
      lengthScore = 100;
      contentReasons.push(`✅ Excellent content length: ${wordCount} words (100/100)`);
    } else if (wordCount >= 1500) {
      lengthScore = 85;
      contentReasons.push(`✅ Good content length: ${wordCount} words (85/100)`);
    } else if (wordCount >= 1000) {
      lengthScore = 70;
      contentReasons.push(`◐ Moderate content length: ${wordCount} words (70/100)`);
    } else if (wordCount >= 600) {
      lengthScore = 50;
      contentReasons.push(`◐ Below average: ${wordCount} words (50/100)`);
    } else if (wordCount >= 300) {
      lengthScore = 30;
      contentReasons.push(`⚠️ Poor length: ${wordCount} words (30/100)`);
    } else {
      lengthScore = 10;
      contentReasons.push(`❌ Very poor: ${wordCount} words (10/100)`);
    }

    // Heading structure scoring (30% of content score)
    const h1Count = checks.h1?.count || 0;
    const h2Count = checks.h2?.count || 0;
    const h3Count = checks.h3?.count || 0;

    let structureScore = 0;

    if (h1Count === 1) {
      structureScore += 35;
      contentReasons.push('✅ Single H1 (+35)');
    } else if (h1Count === 0) {
      contentReasons.push('❌ Missing H1 (0/35)');
    } else {
      structureScore += 15;
      contentReasons.push(`⚠️ Multiple H1s: ${h1Count} (+15/35)`);
    }

    if (h2Count >= 5) {
      structureScore += 35;
      contentReasons.push(`✅ Strong H2 structure: ${h2Count} tags (+35)`);
    } else if (h2Count >= 3) {
      structureScore += 25;
      contentReasons.push(`✅ Good H2 structure: ${h2Count} tags (+25)`);
    } else if (h2Count >= 1) {
      structureScore += 10;
      contentReasons.push(`◐ Weak H2 structure: ${h2Count} tag(s) (+10)`);
    } else {
      contentReasons.push('❌ No H2 tags (0/35)');
    }

    if (h3Count >= 3) {
      structureScore += 30;
      contentReasons.push(`✅ Good depth: ${h3Count} H3 tags (+30)`);
    }

    structureScore = Math.min(structureScore, 100);

    // Internal linking (20% of content score)
    let linkingScore = 0;
    const internalLinks = checks.links?.internal || 0;
    const externalLinks = checks.links?.external || 0;

    if (internalLinks >= 5) {
      linkingScore += 60;
      contentReasons.push(`✅ Strong internal linking: ${internalLinks} links (+60)`);
    } else if (internalLinks >= 3) {
      linkingScore += 40;
      contentReasons.push(`◐ Moderate internal linking: ${internalLinks} links (+40)`);
    } else if (internalLinks >= 1) {
      linkingScore += 20;
      contentReasons.push(`⚠️ Weak internal linking: ${internalLinks} link(s) (+20)`);
    } else {
      contentReasons.push('❌ No internal links (0/60)');
    }

    if (externalLinks >= 2) {
      linkingScore += 40;
      contentReasons.push(`✅ Good external links: ${externalLinks} (+40)`);
    } else if (externalLinks >= 1) {
      linkingScore += 20;
      contentReasons.push(`◐ Minimal external links: ${externalLinks} (+20)`);
    } else if (wordCount > 800) {
      contentReasons.push('⚠️ No external links - missing credibility (0/40)');
    }

    linkingScore = Math.min(linkingScore, 100);

    // Combine: 50% length + 30% structure + 20% linking
    contentStructure = (lengthScore * 0.5) + (structureScore * 0.3) + (linkingScore * 0.2);
    contentReasons.push(`\n📝 Content & Structure Score: ${contentStructure.toFixed(0)}/100`);
    explanation.contentStructure = contentReasons.join('\n');

    // ===================================================================
    // 3. TECHNICAL ON-PAGE SCORE (0-100) - Weight: 20%
    // ===================================================================
    let technicalOnPage = 0;
    const techReasons = [];

    const rawOnPageScore = pageData.onpage_score || 0;
    technicalOnPage = rawOnPageScore * 100;
    techReasons.push(`Base technical score: ${technicalOnPage.toFixed(0)}/100`);

    let penalties = 0;

    // Critical technical issues
    const hasBrokenLinks = pageData.broken_links || false;
    if (hasBrokenLinks) {
      penalties += 20;
      techReasons.push('❌ Broken links detected (-20)');
    }

    if (!checks.canonical?.exists) {
      penalties += 15;
      techReasons.push('⚠️ Missing canonical tag (-15)');
    }

    const loadTime = checks.loadTime?.value;
    if (loadTime !== null) {
      if (loadTime > 5) {
        penalties += 20;
        techReasons.push(`❌ Very slow load: ${loadTime.toFixed(1)}s (-20)`);
      } else if (loadTime > 3) {
        penalties += 10;
        techReasons.push(`⚠️ Slow load: ${loadTime.toFixed(1)}s (-10)`);
      } else if (loadTime <= 2.5) {
        techReasons.push(`✅ Fast load: ${loadTime.toFixed(1)}s`);
      }
    }

    if (!checks.description?.exists) {
      penalties += 15;
      techReasons.push('⚠️ Missing meta description (-15)');
    }

    if (!checks.title?.exists) {
      penalties += 20;
      techReasons.push('❌ Missing title tag (-20)');
    }

    technicalOnPage = Math.max(0, technicalOnPage - penalties);
    if (penalties > 0) {
      techReasons.push(`Total penalties: -${penalties}`);
    }
    techReasons.push(`\n🔧 Technical On-Page Score: ${technicalOnPage.toFixed(0)}/100`);
    explanation.technicalOnPage = techReasons.join('\n');

    // ===================================================================
    // 4. CALCULATE FINAL SCORE (CLIENT'S WEIGHTS)
    // SERP: 45%, Content: 35%, Technical: 20%
    // ===================================================================
    let total = (serpCompetitiveness * 0.45) + (contentStructure * 0.35) + (technicalOnPage * 0.20);

    const adjustments = [];

    // MARKET-SPECIFIC CAPS
    if (serpData && kw) {
      const bench = serpData.benchmark;
      const location = serpData.location;
      
      // If top competitors are highly optimized and you're not competing
      if (bench.competitionLevel === 'very-high' && serpCompetitiveness < 60) {
        const cap = 45;
        if (total > cap) {
          adjustments.push(`⚠️ VERY HIGH competition in ${location} - you're significantly behind. Score capped at ${cap}.`);
          total = cap;
        }
      }

      // If all top 3 have keyword in title and you don't
      if (bench.top3KeywordInTitle === 3 && !kw.inTitle) {
        const cap = 40;
        if (total > cap) {
          adjustments.push(`⚠️ ALL ${location} Top 3 have keyword in title - critical disadvantage. Score capped at ${cap}.`);
          total = cap;
        }
      }

      // Page type mismatch in uniform SERP
      if (bench.dominantPageType) {
        const myPageType = this.classifyPageType(pageData.url || '', meta.title || '');
        const distribution = bench.pageTypeDistribution?.find(d => d.type === bench.dominantPageType);
        const dominance = distribution ? distribution.percentage : 0;
        
        if (dominance >= 80 && myPageType !== bench.dominantPageType) {
          const cap = 50;
          if (total > cap) {
            adjustments.push(`⚠️ ${Math.round(dominance)}% of ${location} Top 10 are '${bench.dominantPageType}' pages, yours is '${myPageType}'. Score capped at ${cap}.`);
            total = cap;
          }
        }
      }
    }

    // Content too short to compete (universal)
    if (wordCount < 300) {
      const cap = 30;
      if (total > cap) {
        adjustments.push(`⚠️ Insufficient content (${wordCount} words) - cannot compete. Score capped at ${cap}.`);
        total = cap;
      }
    } else if (wordCount < 500) {
      const cap = 50;
      if (total > cap) {
        adjustments.push(`⚠️ Content too short (${wordCount} words) to compete effectively. Score capped at ${cap}.`);
        total = cap;
      }
    }

    // Missing critical keyword placements (universal)
    if (kw && !kw.inTitle && !kw.inH1) {
      const cap = 35;
      if (total > cap) {
        adjustments.push(`⚠️ Keyword missing from both title AND H1 - cannot rank. Score capped at ${cap}.`);
        total = cap;
      }
    }

    explanation.finalAdjustments = adjustments.length > 0 
      ? adjustments.join('\n') 
      : `No additional caps applied. Score reflects competitive position in ${serpData?.location || 'unknown market'}.`;

    total = Math.max(0, Math.min(100, total));

    // Realistic cap - perfect scores are rare
    if (total >= 96) {
      const hasImperfections = 
        serpCompetitiveness < 95 ||
        contentStructure < 95 ||
        technicalOnPage < 95;
      
      if (hasImperfections) {
        total = Math.min(total, 93);
        if (!adjustments.some(a => a.includes('capped at 93'))) {
          adjustments.push('⚠️ Maximum realistic score: 93 (room for optimization exists)');
          explanation.finalAdjustments = adjustments.join('\n');
        }
      }
    }

    Logger.info(`[Final Score] Market: ${serpData?.location || 'N/A'}, Total: ${total.toFixed(0)}, SERP: ${serpCompetitiveness.toFixed(0)}, Content: ${contentStructure.toFixed(0)}, Technical: ${technicalOnPage.toFixed(0)}`);

    return {
      total,
      components: {
        serpCompetitiveness: Math.round(serpCompetitiveness),
        contentStructure: Math.round(contentStructure),
        technicalOnPage: Math.round(technicalOnPage),
      },
      explanation,
      marketFactors,
    };
  }

  /**
   * REVISED: Generate SERP-driven recommendations based on competitor analysis
   * NOW WITH MARKET-SPECIFIC CONTEXT
   */
  generateSERPDrivenRecommendations(checks, keywordAnalysis, keyword, serpData, pageData, meta, scoring, lang) {
    const recommendations = [];
    const wordCount = keywordAnalysis?.wordCount || meta?.content?.plain_text_word_count || 0;
    const kw = keywordAnalysis;
    const location = serpData?.location || 'your target market';
    const bench = serpData?.benchmark;

    const addRec = (priority, category, issueKey, actionKey, vars = {}) => {
      // Add location to vars for market-specific messaging
      const enrichedVars = { ...vars, location };
      
      const issue = t(lang, `seo.recommendations.${issueKey}.issue`, enrichedVars);
      const action = t(lang, `seo.recommendations.${issueKey}.action`, enrichedVars);
      
      if (issue && action && !issue.includes('.issue')) {
        const isDuplicate = recommendations.some(r => r.issue === issue);
        if (!isDuplicate) {
          recommendations.push({
            priority,
            category,
            issue,
            action,
            impact: priority === 'critical' ? 'high' : priority === 'high' ? 'high' : priority === 'medium' ? 'medium' : 'low',
            effort: ['missingTitle', 'missingDescription', 'missingH1', 'keywordNotInTitle'].includes(issueKey) ? 'easy' : 'moderate',
            marketContext: serpData ? `Based on ${location} SERP analysis` : null,
          });
        }
      }
    };

    // ===================================================================
    // CRITICAL PRIORITY - Blocking Competition
    // ===================================================================

    if (kw && !kw.inContent) {
      const variations = this.generateKeywordVariations(keyword).join('", "');
      addRec('critical', 'keyword', 'keywordNotInContent', 'keywordNotInContent', { 
        keyword,
        variations: `"${variations}"`
      });
    }

    if (!checks.title.exists) {
      addRec('critical', 'meta', 'missingTitle', 'missingTitle');
    }

    // MARKET-SPECIFIC: Title keyword recommendation
    if (kw && kw.inContent && !kw.inTitle && bench) {
      const titleRate = Math.round(bench.percentTitleHasKeyword * 100);
      if (titleRate >= 70) {
        addRec('critical', 'competitor', 'competitorTitleAdvantage', 'competitorTitleAdvantage', {
          percent: titleRate,
          keyword,
          topDomains: (bench.topDomains || []).slice(0, 3).join(', '),
        });
      } else if (titleRate >= 50) {
        addRec('high', 'keyword', 'keywordNotInTitle', 'keywordNotInTitle', { keyword });
      } else {
        addRec('medium', 'keyword', 'keywordNotInTitle', 'keywordNotInTitle', { keyword });
      }
    } else if (kw && kw.inContent && !kw.inTitle) {
      addRec('critical', 'keyword', 'keywordNotInTitle', 'keywordNotInTitle', { keyword });
    }

    if (!checks.h1.exists) {
      addRec('critical', 'content', 'missingH1', 'missingH1');
    }

    if (pageData.broken_links) {
      addRec('critical', 'technical', 'brokenLinks', 'brokenLinks', { count: 'some' });
    }

    if (wordCount < 300) {
      addRec('critical', 'content', 'veryLowWordCount', 'veryLowWordCount', { count: wordCount });
    }

    // ===================================================================
    // HIGH PRIORITY - Major Competitive Disadvantages
    // ===================================================================

    // MARKET-SPECIFIC: H1 optimization
    if (kw && kw.inContent && !kw.inH1 && bench) {
      const top3Rate = bench.top3KeywordInTitle;
      if (top3Rate >= 2) {
        addRec('high', 'competitor', 'competitorH1Advantage', 'competitorH1Advantage', {
          count: top3Rate,
          keyword,
        });
      } else {
        addRec('high', 'keyword', 'keywordNotInH1', 'keywordNotInH1', { keyword });
      }
    } else if (kw && kw.inContent && !kw.inH1) {
      addRec('high', 'keyword', 'keywordNotInH1', 'keywordNotInH1', { keyword });
    }

    // MARKET-SPECIFIC: Page type mismatch
    if (bench?.dominantPageType) {
      const myPageType = this.classifyPageType(pageData.url || '', meta.title || '');
      const dominantType = bench.dominantPageType;
      const distribution = bench.pageTypeDistribution?.find(d => d.type === dominantType);
      const dominance = distribution ? distribution.percentage : 0;

      if (myPageType !== dominantType && dominance >= 60) {
        addRec('high', 'competitor', 'pageTypeMismatch', 'pageTypeMismatch', {
          yourType: myPageType,
          dominantType: dominantType,
          percent: Math.round(dominance),
        });
      }
    }

    if (checks.h1.count > 1) {
      addRec('high', 'content', 'multipleH1', 'multipleH1', { count: checks.h1.count });
    }

    if (checks.h2.count === 0) {
      addRec('high', 'content', 'missingH2', 'missingH2');
    }

    // MARKET-SPECIFIC: Description keyword
    if (kw && !kw.inDescription && bench) {
      const descRate = Math.round(bench.percentDescHasKeyword * 100);
      if (descRate >= 70) {
        addRec('high', 'competitor', 'competitorDescAdvantage', 'competitorDescAdvantage', {
          percent: descRate,
          keyword,
        });
      } else {
        addRec('medium', 'keyword', 'keywordNotInDescription', 'keywordNotInDescription', { keyword });
      }
    } else if (kw && !kw.inDescription) {
      addRec('medium', 'keyword', 'keywordNotInDescription', 'keywordNotInDescription', { keyword });
    }

    if (wordCount >= 300 && wordCount < 800) {
      addRec('high', 'content', 'lowWordCount', 'lowWordCount', {
        count: wordCount,
        recommended: 1200,
      });
    }

    if (!checks.canonical.exists) {
      addRec('high', 'technical', 'missingCanonical', 'missingCanonical');
    }

    if (checks.loadTime.value && checks.loadTime.value > 4) {
      addRec('high', 'technical', 'slowLoadTime', 'slowLoadTime', { time: checks.loadTime.value.toFixed(1) });
    }

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
    // MEDIUM PRIORITY - Optimization Opportunities
    // ===================================================================

    if (!checks.description.exists) {
      addRec('medium', 'meta', 'missingDescription', 'missingDescription');
    }

    if (checks.title.exists) {
      const titleLen = checks.title.length;
      if (titleLen < 30) {
        addRec('medium', 'meta', 'titleTooShort', 'titleTooShort', { length: titleLen });
      } else if (titleLen < 40 || titleLen > 70) {
        addRec('medium', 'meta', 'titleNotOptimal', 'titleNotOptimal', { length: titleLen });
      }
    }

    if (checks.description.exists) {
      const descLen = checks.description.length;
      if (descLen < 120 || descLen > 170) {
        addRec('medium', 'meta', 'descriptionNotOptimal', 'descriptionNotOptimal', { length: descLen });
      }
    }

    if (kw && kw.inContent && !kw.inFirst100Words) {
      addRec('medium', 'keyword', 'keywordNotInFirst100Words', 'keywordNotInFirst100Words', { keyword });
    }

    if (checks.h2.count > 0 && checks.h2.count < 3 && wordCount > 500) {
      addRec('medium', 'content', 'fewH2', 'fewH2', { count: checks.h2.count });
    }

    if (checks.links.internal < 3) {
      addRec('medium', 'content', 'fewInternalLinks', 'fewInternalLinks', { count: checks.links.internal });
    }

    if (checks.loadTime.value && checks.loadTime.value > 3 && checks.loadTime.value <= 4) {
      addRec('medium', 'technical', 'slowLoadTime', 'slowLoadTime', { time: checks.loadTime.value.toFixed(1) });
    }

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
    // LOW PRIORITY - Nice to Have
    // ===================================================================

    if (kw && !kw.inUrl) {
      addRec('low', 'keyword', 'keywordNotInUrl', 'keywordNotInUrl', { keyword });
    }

    if (checks.links.external === 0 && wordCount > 500) {
      addRec('low', 'content', 'noExternalLinks', 'noExternalLinks');
    }

    // ===================================================================
    // SUCCESS MESSAGE (market-specific)
    // ===================================================================
    const criticalIssues = recommendations.filter(r => r.priority === 'critical').length;
    const highIssues = recommendations.filter(r => r.priority === 'high').length;

    if (criticalIssues === 0 && highIssues === 0 && scoring.total >= 70 && keyword && serpData) {
      addRec('low', 'success', 'competitivePosition', 'competitivePosition', { 
        keyword,
        location: serpData.location,
      });
    }

    // Sort by priority
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    recommendations.sort((a, b) => (priorityOrder[a.priority] || 4) - (priorityOrder[b.priority] || 4));

    Logger.info(`[Recommendations] Generated ${recommendations.length} for ${location} (${criticalIssues} critical, ${highIssues} high priority)`);

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
