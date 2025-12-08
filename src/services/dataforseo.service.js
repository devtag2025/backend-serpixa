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

      const competitors = organicResults
        .filter((item) => item.type === 'organic')
        .map((item, index) => ({
          position: index + 1,
          title: item.title || '',
          url: item.url || '',
          domain: item.domain || '',
          description: item.description || '',
          breadcrumb: item.breadcrumb || '',
        }));

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
      checks: {
        title: { label: t(lang, 'seo.checks.title'), exists: false, existsLabel: t(lang, 'seo.labels.no') },
        description: { label: t(lang, 'seo.checks.description'), exists: false, existsLabel: t(lang, 'seo.labels.no') },
        h1: { label: t(lang, 'seo.checks.h1'), exists: false, existsLabel: t(lang, 'seo.labels.no'), count: 0 },
        h2: { label: t(lang, 'seo.checks.h2'), count: 0 },
        canonical: { label: t(lang, 'seo.checks.canonical'), exists: false, existsLabel: t(lang, 'seo.labels.no') },
        images: { label: t(lang, 'seo.checks.images'), total: 0, withoutAlt: 0 },
        links: { label: t(lang, 'seo.checks.links'), internal: 0, external: 0, broken: 0 },
        loadTime: { label: t(lang, 'seo.checks.loadTime'), value: null },
        wordCount: { label: t(lang, 'seo.checks.wordCount'), value: 0 },
      },
      keywordAnalysis: null,
      recommendations: [],
      competitors: serpData?.competitors || [],
      raw: null,
    };
  }

  const pageData = data.items?.[0] || {};
  const meta = pageData.meta || {};
  const onPage = pageData.onpage_score || 0;

  // Build checks with translated labels
  const checks = {
    title: {
      label: t(lang, 'seo.checks.title'),
      exists: !!meta.title,
      existsLabel: !!meta.title ? t(lang, 'seo.labels.yes') : t(lang, 'seo.labels.no'),
      value: meta.title || null,
      length: meta.title?.length || 0,
      lengthLabel: t(lang, 'seo.labels.length'),
      optimal: meta.title?.length >= 30 && meta.title?.length <= 60,
      optimalLabel: t(lang, 'seo.labels.optimal'),
    },
    description: {
      label: t(lang, 'seo.checks.description'),
      exists: !!meta.description,
      existsLabel: !!meta.description ? t(lang, 'seo.labels.yes') : t(lang, 'seo.labels.no'),
      value: meta.description || null,
      length: meta.description?.length || 0,
      lengthLabel: t(lang, 'seo.labels.length'),
      optimal: meta.description?.length >= 120 && meta.description?.length <= 160,
      optimalLabel: t(lang, 'seo.labels.optimal'),
    },
    h1: {
      label: t(lang, 'seo.checks.h1'),
      exists: !!meta.htags?.h1?.length,
      existsLabel: !!meta.htags?.h1?.length ? t(lang, 'seo.labels.yes') : t(lang, 'seo.labels.no'),
      count: meta.htags?.h1?.length || 0,
      countLabel: t(lang, 'seo.labels.count'),
      values: meta.htags?.h1 || [],
    },
    h2: {
      label: t(lang, 'seo.checks.h2'),
      count: meta.htags?.h2?.length || 0,
      countLabel: t(lang, 'seo.labels.count'),
      values: meta.htags?.h2 || [],
    },
    canonical: {
      label: t(lang, 'seo.checks.canonical'),
      exists: !!meta.canonical,
      existsLabel: !!meta.canonical ? t(lang, 'seo.labels.yes') : t(lang, 'seo.labels.no'),
      value: meta.canonical || null,
    },
    images: {
      label: t(lang, 'seo.checks.images'),
      total: pageData.images?.images_count || 0,
      totalLabel: t(lang, 'seo.labels.total'),
      withoutAlt: pageData.images?.images_without_alt || 0,
      withoutAltLabel: t(lang, 'seo.labels.withoutAlt'),
    },
    links: {
      label: t(lang, 'seo.checks.links'),
      internal: pageData.links?.internal?.count || 0,
      internalLabel: t(lang, 'seo.labels.internal'),
      external: pageData.links?.external?.count || 0,
      externalLabel: t(lang, 'seo.labels.external'),
      broken: pageData.links?.broken?.count || 0,
      brokenLabel: t(lang, 'seo.labels.broken'),
    },
    loadTime: {
      label: t(lang, 'seo.checks.loadTime'),
      value: pageData.page_timing?.time_to_interactive || null,
    },
    wordCount: {
      label: t(lang, 'seo.checks.wordCount'),
      value: meta.content?.plain_text_word_count || 0,
    },
  };

  const keywordAnalysis = keyword ? this.analyzeKeyword(keyword, meta, pageData, lang) : null;
  const recommendations = this.generateRecommendations(checks, keywordAnalysis, keyword, serpData, lang);

  return {
    url,
    keyword,
    score: Math.round(onPage * 100) / 100,
    checks,
    keywordAnalysis,
    recommendations,
    competitors: serpData?.competitors || [],
    serpInfo: serpData ? {
      location: serpData.location,
      language: serpData.language,
      device: serpData.device,
      totalResults: serpData.totalResults,
      searchInfo: serpData.searchInfo,
    } : null,
    raw: data,
  };
}

analyzeKeyword(keyword, meta, pageData, lang = 'en') {
  const keywordLower = keyword.toLowerCase();
  const title = (meta.title || '').toLowerCase();
  const description = (meta.description || '').toLowerCase();
  const h1Values = (meta.htags?.h1 || []).map(h => h.toLowerCase());
  const h2Values = (meta.htags?.h2 || []).map(h => h.toLowerCase());
  const plainText = (meta.content?.plain_text_content || '').toLowerCase();

  const keywordCount = (plainText.match(new RegExp(keywordLower, 'g')) || []).length;
  const wordCount = meta.content?.plain_text_word_count || 1;
  const density = ((keywordCount / wordCount) * 100).toFixed(2);

  const inTitle = title.includes(keywordLower);
  const inDescription = description.includes(keywordLower);
  const inH1 = h1Values.some(h => h.includes(keywordLower));
  const inH2 = h2Values.some(h => h.includes(keywordLower));
  const inContent = plainText.includes(keywordLower);
  const densityOptimal = parseFloat(density) >= 1 && parseFloat(density) <= 3;

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
    occurrences: keywordCount,
    occurrencesLabel: t(lang, 'seo.keywordAnalysis.occurrences'),
    density: parseFloat(density),
    densityLabel: t(lang, 'seo.keywordAnalysis.density'),
    densityOptimal,
    densityOptimalLabel: t(lang, 'seo.keywordAnalysis.densityOptimal'),
    densityOptimalValue: densityOptimal ? t(lang, 'common.yes') : t(lang, 'common.no'),
  };
}

  generateRecommendations(checks, keywordAnalysis, keyword, serpData = null, lang = 'en') {
    const recommendations = [];

    // Competitor analysis recommendation
    if (serpData && serpData.competitors && serpData.competitors.length > 0) {
      recommendations.push({
        priority: 'high',
        issue: t(lang, 'seo.recommendations.competitorAnalysis.issue', { count: serpData.competitors.length, keyword }),
        action: t(lang, 'seo.recommendations.competitorAnalysis.action'),
      });
    }

    // Title checks
    if (!checks.title.exists) {
      recommendations.push({
        priority: 'high',
        issue: t(lang, 'seo.recommendations.missingTitle.issue'),
        action: t(lang, 'seo.recommendations.missingTitle.action'),
      });
    } else if (!checks.title.optimal) {
      recommendations.push({
        priority: 'medium',
        issue: t(lang, 'seo.recommendations.titleNotOptimal.issue'),
        action: t(lang, 'seo.recommendations.titleNotOptimal.action'),
      });
    }

    // Description checks
    if (!checks.description.exists) {
      recommendations.push({
        priority: 'high',
        issue: t(lang, 'seo.recommendations.missingDescription.issue'),
        action: t(lang, 'seo.recommendations.missingDescription.action'),
      });
    } else if (!checks.description.optimal) {
      recommendations.push({
        priority: 'medium',
        issue: t(lang, 'seo.recommendations.descriptionNotOptimal.issue'),
        action: t(lang, 'seo.recommendations.descriptionNotOptimal.action'),
      });
    }

    // H1 checks
    if (!checks.h1.exists) {
      recommendations.push({
        priority: 'high',
        issue: t(lang, 'seo.recommendations.missingH1.issue'),
        action: t(lang, 'seo.recommendations.missingH1.action'),
      });
    } else if (checks.h1.count > 1) {
      recommendations.push({
        priority: 'medium',
        issue: t(lang, 'seo.recommendations.multipleH1.issue'),
        action: t(lang, 'seo.recommendations.multipleH1.action'),
      });
    }

    // Image alt checks
    if (checks.images.withoutAlt > 0) {
      recommendations.push({
        priority: 'medium',
        issue: t(lang, 'seo.recommendations.imagesNoAlt.issue', { count: checks.images.withoutAlt }),
        action: t(lang, 'seo.recommendations.imagesNoAlt.action'),
      });
    }

    // Broken links
    if (checks.links.broken > 0) {
      recommendations.push({
        priority: 'high',
        issue: t(lang, 'seo.recommendations.brokenLinks.issue', { count: checks.links.broken }),
        action: t(lang, 'seo.recommendations.brokenLinks.action'),
      });
    }

    // Canonical
    if (!checks.canonical.exists) {
      recommendations.push({
        priority: 'medium',
        issue: t(lang, 'seo.recommendations.missingCanonical.issue'),
        action: t(lang, 'seo.recommendations.missingCanonical.action'),
      });
    }

    // Word count
    if (checks.wordCount < 300) {
      recommendations.push({
        priority: 'medium',
        issue: t(lang, 'seo.recommendations.lowWordCount.issue'),
        action: t(lang, 'seo.recommendations.lowWordCount.action'),
      });
    }

    // Keyword-specific recommendations
    if (keywordAnalysis && keyword) {
      if (!keywordAnalysis.inTitle) {
        recommendations.push({
          priority: 'high',
          issue: t(lang, 'seo.recommendations.keywordNotInTitle.issue'),
          action: t(lang, 'seo.recommendations.keywordNotInTitle.action', { keyword }),
        });
      }
      if (!keywordAnalysis.inDescription) {
        recommendations.push({
          priority: 'high',
          issue: t(lang, 'seo.recommendations.keywordNotInDescription.issue'),
          action: t(lang, 'seo.recommendations.keywordNotInDescription.action', { keyword }),
        });
      }
      if (!keywordAnalysis.inH1) {
        recommendations.push({
          priority: 'high',
          issue: t(lang, 'seo.recommendations.keywordNotInH1.issue'),
          action: t(lang, 'seo.recommendations.keywordNotInH1.action', { keyword }),
        });
      }
      if (!keywordAnalysis.inContent) {
        recommendations.push({
          priority: 'high',
          issue: t(lang, 'seo.recommendations.keywordNotInContent.issue'),
          action: t(lang, 'seo.recommendations.keywordNotInContent.action', { keyword }),
        });
      }
      if (!keywordAnalysis.densityOptimal && keywordAnalysis.inContent) {
        if (keywordAnalysis.density < 1) {
          recommendations.push({
            priority: 'medium',
            issue: t(lang, 'seo.recommendations.keywordDensityLow.issue'),
            action: t(lang, 'seo.recommendations.keywordDensityLow.action', { keyword }),
          });
        } else if (keywordAnalysis.density > 3) {
          recommendations.push({
            priority: 'medium',
            issue: t(lang, 'seo.recommendations.keywordDensityHigh.issue'),
            action: t(lang, 'seo.recommendations.keywordDensityHigh.action', { keyword }),
          });
        }
      }
    }

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