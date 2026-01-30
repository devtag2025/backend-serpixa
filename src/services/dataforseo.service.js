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

      const normalizedKeyword = keyword.trim().toLowerCase();

      const competitors = organicResults
        .filter((item) => item.type === 'organic')
        .slice(0, 10)
        .map((item, index) => {
          const title = item.title || '';
          const description = item.description || '';

          // Very rough content length estimate from snippet (no extra API calls)
          const estimatedWordCount =
            (description.split(/\s+/).filter(Boolean).length || 0) * 15;

          const keywordInTitle = title.toLowerCase().includes(normalizedKeyword);

          const pageType = this.classifyPageType(item.url || '', title);

          return {
            position: index + 1,
            title,
            url: item.url || '',
            domain: item.domain || '',
            description,
            breadcrumb: item.breadcrumb || '',
            estimatedWordCount,
            keywordInTitle,
            pageType,
          };
        });

      // Build simple SERP benchmark for this keyword (Top 10)
      const wordCounts = competitors.map((c) => c.estimatedWordCount || 0);
      const avgWordCount = Math.round(
        wordCounts.reduce((sum, v) => sum + v, 0) / Math.max(wordCounts.length, 1)
      );

      const sortedWordCounts = [...wordCounts].sort((a, b) => a - b);
      const medianWordCount =
        sortedWordCounts.length === 0
          ? 0
          : sortedWordCounts.length % 2 === 1
          ? sortedWordCounts[(sortedWordCounts.length - 1) / 2]
          : Math.round(
              (sortedWordCounts[sortedWordCounts.length / 2 - 1] +
                sortedWordCounts[sortedWordCounts.length / 2]) /
                2
            );

      const titleWithKeywordCount = competitors.filter(
        (c) => c.keywordInTitle
      ).length;

      const percentTitleHasKeyword =
        competitors.length === 0
          ? 0
          : titleWithKeywordCount / competitors.length;

      // Very rough dominant page type in Top 10
      const pageTypeCounts = competitors.reduce((acc, c) => {
        if (!c.pageType) return acc;
        acc[c.pageType] = (acc[c.pageType] || 0) + 1;
        return acc;
      }, {});

      const dominantPageType =
        Object.entries(pageTypeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ||
        null;

      return {
        keyword,
        location: locationName,
        language: languageName,
        device,
        competitors,
        totalResults: competitors.length,
        avgCompetitorWordCount: Math.max(avgWordCount, 1200), // Minimum estimate (kept for backwards compat)
        searchInfo: {
          seResultsCount: serpData?.se_results_count || 0,
          checkUrl: serpData?.check_url || '',
          datetime: serpData?.datetime || new Date().toISOString(),
        },
        benchmark: {
          avgWordCount,
          medianWordCount,
          percentTitleHasKeyword,
          dominantPageType,
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

    // Compute new SEO score based on SERP benchmark, content & technical health
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
      lang
    );

    return {
      url,
      keyword,
      score: Math.round(scoring.total * 100) / 100,
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
            avgCompetitorWordCount: serpData.avgCompetitorWordCount,
            benchmark: serpData.benchmark || null,
            searchInfo: serpData.searchInfo,
            componentScores: scoring.components,
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
    // DataForSEO returns timing values in milliseconds – convert to seconds
    const rawLoadTime = pageData.page_timing?.time_to_interactive;
    const loadTime =
      typeof rawLoadTime === 'number' ? rawLoadTime / 1000 : null;

    // Calculate status based on best practices
    const getTitleStatus = () => {
      if (!meta.title) return 'poor';
      if (titleLength >= 50 && titleLength <= 60) return 'good';
      if (titleLength >= 30 && titleLength <= 70) return 'needsImprovement';
      return 'poor';
    };

    const getDescStatus = () => {
      if (!meta.description) return 'poor';
      if (descLength >= 150 && descLength <= 160) return 'good';
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
      if (wordCount >= 600) return 'needsImprovement';
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
        optimal: descLength >= 150 && descLength <= 160,
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
        status: h2Count >= 3 ? 'good' : h2Count > 0 ? 'needsImprovement' : 'poor',
        statusLabel: t(lang, `seo.labels.${h2Count >= 3 ? 'good' : h2Count > 0 ? 'needsImprovement' : 'poor'}`),
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
        total: pageData.images?.images_count || 0,
        totalLabel: t(lang, 'seo.labels.total'),
        withoutAlt: pageData.images?.images_without_alt || 0,
        withoutAltLabel: t(lang, 'seo.labels.withoutAlt'),
        status: (pageData.images?.images_without_alt || 0) === 0 ? 'good' : 'needsImprovement',
        statusLabel: t(lang, `seo.labels.${(pageData.images?.images_without_alt || 0) === 0 ? 'good' : 'needsImprovement'}`),
      },
      links: {
        label: t(lang, 'seo.checks.links'),
        internal: pageData.links?.internal?.count || 0,
        internalLabel: t(lang, 'seo.labels.internal'),
        external: pageData.links?.external?.count || 0,
        externalLabel: t(lang, 'seo.labels.external'),
        broken: pageData.links?.broken?.count || 0,
        brokenLabel: t(lang, 'seo.labels.broken'),
        status: (pageData.links?.broken?.count || 0) === 0 ? 'good' : 'poor',
        statusLabel: t(lang, `seo.labels.${(pageData.links?.broken?.count || 0) === 0 ? 'good' : 'poor'}`),
      },
      loadTime: {
        label: t(lang, 'seo.checks.loadTime'),
        value: loadTime,
        status: loadTime !== null && loadTime < 3 ? 'good' : loadTime !== null && loadTime < 5 ? 'needsImprovement' : 'poor',
        statusLabel: loadTime !== null ? t(lang, `seo.labels.${loadTime < 3 ? 'good' : loadTime < 5 ? 'needsImprovement' : 'poor'}`) : t(lang, 'common.notAvailable'),
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
    // Normalize keyword and content (lowercase + remove accents) to reduce false negatives
    const keywordNorm = this.normalizeForSearch(keyword);
    const title = this.normalizeForSearch(meta.title || '');
    const description = this.normalizeForSearch(meta.description || '');
    const h1Values = (meta.htags?.h1 || []).map((h) => this.normalizeForSearch(h));
    const h2Values = (meta.htags?.h2 || []).map((h) => this.normalizeForSearch(h));
    const plainText = this.normalizeForSearch(
      meta.content?.plain_text_content || ''
    );
    const url = (pageData.url || '').toLowerCase();

    // Count keyword occurrences
    const keywordPattern = new RegExp(this.escapeRegex(keywordNorm), 'g');
    const keywordCount = (plainText.match(keywordPattern) || []).length;
    const wordCount = meta.content?.plain_text_word_count || 1;
    const density = ((keywordCount / wordCount) * 100);

    // Check positions
    const inTitle = title.includes(keywordNorm);
    const inDescription = description.includes(keywordNorm);
    const inH1 = h1Values.some((h) => h.includes(keywordNorm));
    const inH2 = h2Values.some((h) => h.includes(keywordNorm));
    const inContent = plainText.includes(keywordNorm);
    const inUrl =
      url.includes(keywordNorm.replace(/\s+/g, '-')) ||
      url.includes(keywordNorm.replace(/\s+/g, ''));

    // Check if keyword is in first 100 words
    const first100Words = plainText.split(/\s+/).slice(0, 100).join(' ');
    const inFirst100Words = first100Words.includes(keywordNorm);

    // Density analysis
    const densityOptimal = density >= 1 && density <= 2;
    const densityStatus = density < 0.5 ? 'poor' : density > 3 ? 'poor' : density >= 1 && density <= 2 ? 'good' : 'needsImprovement';

    // Calculate recommended occurrences
    const recommendedMin = Math.max(1, Math.round(wordCount * 0.01));
    const recommendedMax = Math.round(wordCount * 0.02);

    // Competitor comparison
    const competitorAvgWordCount = serpData?.avgCompetitorWordCount || 1200;

    return {
      title: t(lang, 'seo.keywordAnalysis.title'),
      keyword,
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
      competitorAvgWordCount,
      competitorAvgWordCountLabel: t(lang, 'seo.keywordAnalysis.competitorAvgWordCount'),
      wordCount,
    };
  }

  escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  normalizeForSearch(str) {
    return (str || '')
      .toString()
      .toLowerCase()
      // Remove accents/diacritics
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  classifyPageType(url, title) {
    const u = (url || '').toLowerCase();
    const t = (title || '').toLowerCase();

    if (u.includes('/blog/') || u.includes('/news/') || t.includes('blog')) {
      return 'blog';
    }
    if (
      u.includes('/category/') ||
      u.includes('/categories/') ||
      u.includes('/collection/') ||
      t.includes('category')
    ) {
      return 'category';
    }
    if (
      u.includes('/product/') ||
      u.includes('/services/') ||
      u.includes('/service/') ||
      t.includes('pricing')
    ) {
      return 'landing';
    }
    return 'other';
  }

  /**
   * Compute overall SEO score using SERP benchmark, content/structure and technical health.
   * Returns total (0-100) and component scores so UI can explain the result.
   */
  computeSEOScore({ pageData, meta, keywordAnalysis, serpData, checks }) {
    const wordCount = meta.content?.plain_text_word_count || 0;

    const benchmark = serpData?.benchmark || null;

    // --- SERP Competitiveness (0-100) ---
    let serpSimilarity = 0;
    if (benchmark) {
      const medianWC = benchmark.medianWordCount || benchmark.avgWordCount || 0;

      // Content length vs SERP median
      let lengthScore = 0;
      if (medianWC > 0) {
        const ratio = wordCount / medianWC;
        if (ratio >= 1) {
          lengthScore = 100;
        } else if (ratio >= 0.7) {
          // Between 70% and 100% of median → 60–100
          lengthScore = 60 + ((ratio - 0.7) / 0.3) * 40;
        } else {
          // Below 70% → up to 60 but strongly penalized
          lengthScore = Math.max(10, (ratio / 0.7) * 60);
        }
      }

      // Keyword usage in key elements vs SERP
      let keywordScore = 0;
      if (keywordAnalysis) {
        const serpTitleRate = benchmark.percentTitleHasKeyword || 0;
        // If most competitors have keyword in title, missing it is a strong penalty
        if (serpTitleRate >= 0.7) {
          keywordScore = keywordAnalysis.inTitle ? 100 : 25;
        } else {
          keywordScore = keywordAnalysis.inTitle ? 100 : 60;
        }

        // Bonus for keyword also appearing in H1 and first 100 words
        if (keywordAnalysis.inH1) keywordScore += 10;
        if (keywordAnalysis.inFirst100Words) keywordScore += 10;
        keywordScore = Math.min(keywordScore, 100);
      }

      // Heading structure vs simple best practice (we don't have SERP headings)
      const h2Count = checks.h2?.count || 0;
      const h3Count = checks.h3?.count || 0;
      let structureScore = 0;
      if (h2Count >= 4 && h3Count >= 2) structureScore = 100;
      else if (h2Count >= 2) structureScore = 70;
      else if (h2Count > 0) structureScore = 50;
      else structureScore = 20;

      // Very rough page type alignment
      let pageTypeScore = 70;
      const dominantType = benchmark.dominantPageType;
      const pageType = this.classifyPageType(pageData.url || '', meta.title || '');
      if (dominantType && pageType) {
        pageTypeScore = dominantType === pageType ? 100 : 60;
      }

      serpSimilarity =
        (lengthScore * 0.5 +
          keywordScore * 0.25 +
          structureScore * 0.15 +
          pageTypeScore * 0.1);
    }

    serpSimilarity = Math.max(0, Math.min(100, serpSimilarity));

    // --- Content & Structure Quality (0-100) ---
    let contentQuality = 0;
    const h2Count = checks.h2?.count || 0;
    const h3Count = checks.h3?.count || 0;

    // Base on word count alone if no SERP data
    let baseContentScore = 50;
    if (wordCount >= 2000) baseContentScore = 95;
    else if (wordCount >= 1500) baseContentScore = 85;
    else if (wordCount >= 800) baseContentScore = 70;
    else if (wordCount >= 400) baseContentScore = 50;
    else baseContentScore = 30;

    // Heading richness
    let headingScore = 50;
    if (h2Count >= 6) headingScore = 95;
    else if (h2Count >= 3) headingScore = 80;
    else if (h2Count >= 1) headingScore = 60;
    else headingScore = 30;

    // Keyword placement
    let keywordPlacementScore = 50;
    if (keywordAnalysis) {
      let pts = 0;
      if (keywordAnalysis.inTitle) pts += 30;
      if (keywordAnalysis.inH1) pts += 25;
      if (keywordAnalysis.inDescription) pts += 15;
      if (keywordAnalysis.inContent) pts += 20;
      if (keywordAnalysis.inFirst100Words) pts += 10;
      keywordPlacementScore = Math.min(pts, 100);
    }

    contentQuality =
      baseContentScore * 0.4 +
      headingScore * 0.3 +
      keywordPlacementScore * 0.3;

    contentQuality = Math.max(0, Math.min(100, contentQuality));

    // --- Technical On‑Page Health (0-100) ---
    const rawOnPageScore = pageData.onpage_score || 0; // 0–1 from DataForSEO
    let onPageHealth = Math.max(0, Math.min(100, rawOnPageScore * 100));

    // Adjust for critical technical issues
    if (checks.links?.broken > 0) {
      onPageHealth -= 15;
    }
    if (!checks.canonical?.exists) {
      onPageHealth -= 10;
    }
    if (checks.loadTime?.value && checks.loadTime.value > 5) {
      onPageHealth -= 10;
    }
    onPageHealth = Math.max(0, Math.min(100, onPageHealth));

    // --- Final weighted SEO score ---
    // SERP competitiveness: 45%, Content & structure: 35%, Technical: 20%
    let total =
      serpSimilarity * 0.45 + contentQuality * 0.35 + onPageHealth * 0.2;

    // Important rule: if content is far below SERP standard, cap the total score
    if (benchmark && benchmark.medianWordCount > 0) {
      const ratio = wordCount / benchmark.medianWordCount;
      if (ratio < 0.5) {
        total = Math.min(total, 55);
      } else if (ratio < 0.7) {
        total = Math.min(total, 70);
      }
    }

    total = Math.max(0, Math.min(100, total));

    return {
      total,
      components: {
        serpSimilarity: Math.round(serpSimilarity),
        contentQuality: Math.round(contentQuality),
        onPageHealth: Math.round(onPageHealth),
      },
    };
  }

  generateEnhancedRecommendations(checks, keywordAnalysis, keyword, serpData, pageData, meta, lang) {
    const recommendations = [];
    const wordCount = meta?.content?.plain_text_word_count || 0;

    // Helper to add recommendation
    const addRec = (priority, category, issueKey, actionKey, vars = {}) => {
      const issue = t(lang, `seo.recommendations.${issueKey}.issue`, vars);
      const action = t(lang, `seo.recommendations.${issueKey}.action`, vars);
      if (issue && action && !issue.includes('.issue')) {
        recommendations.push({
          priority,
          category,
          issue,
          action,
          impact: priority === 'critical' || priority === 'high' ? 'high' : priority === 'medium' ? 'medium' : 'low',
          effort: ['missingTitle', 'missingDescription', 'missingH1', 'missingCanonical'].includes(issueKey) ? 'easy' : 'moderate',
        });
      }
    };

    // === CRITICAL: Title Tag ===
    if (!checks.title.exists) {
      addRec('critical', 'meta', 'missingTitle', 'missingTitle');
    } else {
      const titleLen = checks.title.length;
      if (titleLen < 30) {
        addRec('high', 'meta', 'titleTooShort', 'titleTooShort', { length: titleLen });
      } else if (titleLen < 50 || titleLen > 60) {
        addRec('medium', 'meta', 'titleNotOptimal', 'titleNotOptimal', { length: titleLen });
      }
    }

    // === CRITICAL: Meta Description ===
    if (!checks.description.exists) {
      addRec('critical', 'meta', 'missingDescription', 'missingDescription');
    } else {
      const descLen = checks.description.length;
      if (descLen < 120 || descLen > 170) {
        addRec('medium', 'meta', 'descriptionNotOptimal', 'descriptionNotOptimal', { length: descLen });
      }
    }

    // === CRITICAL: H1 Tag ===
    if (!checks.h1.exists) {
      addRec('critical', 'content', 'missingH1', 'missingH1');
    } else if (checks.h1.count > 1) {
      addRec('high', 'content', 'multipleH1', 'multipleH1', { count: checks.h1.count });
    }

    // === HIGH: H2 Structure ===
    if (checks.h2.count === 0) {
      addRec('high', 'content', 'missingH2', 'missingH2');
    } else if (checks.h2.count < 3 && wordCount > 500) {
      addRec('medium', 'content', 'fewH2', 'fewH2', { count: checks.h2.count });
    }

    // === HIGH: Canonical Tag ===
    if (!checks.canonical.exists) {
      addRec('high', 'technical', 'missingCanonical', 'missingCanonical');
    }

    // === HIGH: Images Alt Text ===
    if (checks.images.withoutAlt > 0) {
      addRec('high', 'content', 'imagesNoAlt', 'imagesNoAlt', { count: checks.images.withoutAlt });
    }

    // === CRITICAL: Broken Links ===
    if (checks.links.broken > 0) {
      addRec('critical', 'technical', 'brokenLinks', 'brokenLinks', { count: checks.links.broken });
    }

    // === MEDIUM: Internal Linking ===
    if (checks.links.internal < 3) {
      addRec('medium', 'content', 'fewInternalLinks', 'fewInternalLinks', { count: checks.links.internal });
    }

    // === LOW: External Links ===
    if (checks.links.external === 0 && wordCount > 500) {
      addRec('low', 'content', 'noExternalLinks', 'noExternalLinks');
    }

    // === HIGH: Word Count ===
    const competitorAvgWordCount = serpData?.avgCompetitorWordCount || 1200;
    if (wordCount < 300) {
      addRec('critical', 'content', 'veryLowWordCount', 'veryLowWordCount', { count: wordCount });
    } else if (wordCount < competitorAvgWordCount * 0.7) {
      addRec('high', 'content', 'lowWordCount', 'lowWordCount', {
        count: wordCount,
        recommended: Math.round(competitorAvgWordCount * 0.8),
        competitorAvg: competitorAvgWordCount,
      });
    }

    // === HIGH: Page Load Time ===
    if (checks.loadTime.value && checks.loadTime.value > 3) {
      addRec('high', 'technical', 'slowLoadTime', 'slowLoadTime', { time: checks.loadTime.value.toFixed(1) });
    }

    // === KEYWORD-SPECIFIC RECOMMENDATIONS ===
    if (keywordAnalysis && keyword) {
      // Keyword in Title
      if (!keywordAnalysis.inTitle) {
        addRec('critical', 'keyword', 'keywordNotInTitle', 'keywordNotInTitle', { keyword });
      }

      // Keyword in Description
      if (!keywordAnalysis.inDescription) {
        addRec('high', 'keyword', 'keywordNotInDescription', 'keywordNotInDescription', { keyword });
      }

      // Keyword in H1
      if (!keywordAnalysis.inH1) {
        addRec('high', 'keyword', 'keywordNotInH1', 'keywordNotInH1', { keyword });
      }

      // Keyword in Content
      if (!keywordAnalysis.inContent) {
        addRec('critical', 'keyword', 'keywordNotInContent', 'keywordNotInContent', { keyword });
      }

      // Keyword in First 100 Words
      if (keywordAnalysis.inContent && !keywordAnalysis.inFirst100Words) {
        addRec('medium', 'keyword', 'keywordNotInFirst100Words', 'keywordNotInFirst100Words', { keyword });
      }

      // Keyword in URL
      if (!keywordAnalysis.inUrl) {
        addRec('low', 'keyword', 'keywordNotInUrl', 'keywordNotInUrl', { keyword });
      }

      // Keyword Density
      const density = keywordAnalysis.density;
      const recommendedMin = Math.max(1, Math.round(wordCount * 0.01));
      const recommendedMax = Math.round(wordCount * 0.02);

      if (density < 0.5 && keywordAnalysis.inContent) {
        addRec('high', 'keyword', 'keywordDensityLow', 'keywordDensityLow', {
          density: density.toFixed(2),
          occurrences: keywordAnalysis.occurrences,
          wordCount,
          recommended: recommendedMin - keywordAnalysis.occurrences,
          keyword,
        });
      } else if (density > 3) {
        addRec('medium', 'keyword', 'keywordDensityHigh', 'keywordDensityHigh', {
          density: density.toFixed(2),
          occurrences: keywordAnalysis.occurrences,
          recommended: recommendedMax,
          keyword,
        });
      }
    }

    // === COMPETITOR ANALYSIS ===
    if (serpData && serpData.competitors && serpData.competitors.length > 0) {
      addRec('medium', 'competitor', 'competitorAnalysis', 'competitorAnalysis', {
        count: serpData.competitors.length,
        keyword,
      });

      // Content comparison
      if (wordCount < competitorAvgWordCount * 0.6) {
        const percent = Math.round((1 - (wordCount / competitorAvgWordCount)) * 100);
        addRec('high', 'content', 'contentBelowCompetitors', 'contentBelowCompetitors', {
          percent,
          avgWords: competitorAvgWordCount,
        });
      }
    }

    // === EXCELLENT OPTIMIZATION (if score is high and few issues) ===
    if (recommendations.filter(r => r.priority === 'critical' || r.priority === 'high').length === 0 && keyword) {
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
