import axios from 'axios';
import { env } from '../config/index.js';
import { ApiError, getGoogleDomain, getLanguageName, parseLocale } from '../utils/index.js';
import { Logger } from '../utils/logger.js';
import { t } from '../locales/index.js';
import { getLocaleConfig, DEFAULT_LOCALE } from '../config/index.js';
import { gbpService } from './gbp.service.js';

class GeoAuditService {
  constructor() {
    this.login = env.DATAFORSEO_LOGIN || env.DATAFORSEO_EMAIL;
    this.password = env.DATAFORSEO_PASSWORD || env.DATAFORSEO_API_PASSWORD;
    this.baseURL = env.DATAFORSEO_API_URL || 'https://sandbox.dataforseo.com';

    if (!this.login || !this.password) {
      Logger.error('DataForSEO credentials not configured for Geo Audit service');
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

  /**
   * Run geo audit using Google Local Finder API + optional GBP data
   * @param {string} keyword - Search keyword
   * @param {string} city - City name
   * @param {string} region - Region/State name (optional)
   * @param {string} country - Country name
   * @param {string} googleDomain - Google domain (e.g., 'google.be', 'google.fr')
   * @param {string} language - Language code (e.g., 'fr', 'en', 'nl')
   * @param {string} locale - Locale code (e.g., 'fr-be', 'en', 'nl-nl')
   * @param {string} businessName - User's business name (optional, for GBP lookup)
   * @param {string} gbpLink - GBP/Google Maps URL (optional, for place_id lookup)
   * @returns {Promise<Object>} Audit result with local visibility score, competitors, businessInfo, and actionable recommendations
   */
  async runGeoAudit(keyword, city, region = null, country, googleDomain = null, language = null, locale = DEFAULT_LOCALE, businessName = null, gbpLink = null) {
    try {
      // Get language name for DataForSEO API
      const languageName = language ? getLanguageName(language) : 'English';

      // city now already contains the full DataForSEO location_name
      // e.g. "Paris,Paris,Ile-de-France,France" from our Location DB
      const locationName = city || country;

      const localeConfig = getLocaleConfig(locale);
      const lang = localeConfig.language || 'en';

      // Fetch Local Finder + GBP data in parallel when businessName or gbpLink provided
      const [localFinderData, gbpData] = await Promise.all([
        this.fetchMapsData(keyword, locationName, languageName, googleDomain),
        (businessName || gbpLink)
          ? this.fetchUserGBPData(businessName || keyword, locationName, localeConfig.languageCode, gbpLink)
          : Promise.resolve(null),
      ]);

      // Transform and return results with actionable recommendations (incl. GBP-based when available)
      return this.transformMapsResult(localFinderData, keyword, locationName, lang, gbpData);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, `Geo audit failed: ${error.message}`);
    }
  }

  /**
   * Fetch user's business data from Google Business Profile (my_business_info API)
   * Used to get credible NAP and generate better recommendations
   */
  async fetchUserGBPData(businessName, locationName, languageCode, gbpLink = null) {
    try {
      if (!businessName) return null;
      const placeId = gbpLink ? gbpService.extractPlaceIdFromUrl(gbpLink) : null;

      if (placeId) {
        const data = await gbpService.fetchGBPDataByPlaceId(placeId, locationName, languageCode);
        return data ? { raw: data, source: 'place_id' } : null;
      }
      const data = await gbpService.fetchGBPDataByKeyword(businessName, locationName, languageCode);
      return data ? { raw: data, source: 'keyword' } : null;
    } catch (err) {
      Logger.warn('GBP data fetch failed for geo audit:', err.message);
      return null;
    }
  }

  /**
   * Fetch data from DataForSEO Google Local Finder API
   * Passes through DataForSEO responses transparently
   * @param {string} keyword - Search keyword
   * @param {string} locationName - Location in format "City,Region,Country" or "City,Country" (e.g., "Amsterdam,North Holland,Netherlands")
   * @param {string} languageName - Language name (e.g., "French", "English")
   * @param {string} googleDomain - Google domain (e.g., "google.be", "google.fr") - optional
   * @returns {Promise<Object>} Local Finder API response data
   */
  async fetchMapsData(keyword, locationName, languageName, googleDomain = null) {
    if (!this.login || !this.password) {
      throw new ApiError(500, 'DataForSEO credentials not configured');
    }

    // Build payload for Local Finder API
    const payload = [{
      keyword: keyword.trim(),
      location_name: locationName,
      language_name: languageName,
      depth: 10, // Get top 10 results
      // Note: se_domain is NOT supported for this endpoint → using default
    }];

    Logger.log('Sending request to DataForSEO Google Local Finder API:', {
      endpoint: '/v3/serp/google/local_finder/live/advanced',
      keyword: keyword.trim(),
      location_name: locationName,
      language_name: languageName,
      se_domain: 'default (not sent)',
    });

    const response = await this.client.post('/v3/serp/google/local_finder/live/advanced', payload);

    Logger.log('DataForSEO Local Finder API Response Status:', response.status);

    // Handle response structure - pass through DataForSEO response
    let result;
    if (Array.isArray(response.data)) {
      if (response.data.length === 0) {
        throw new ApiError(502, 'No Local Finder data received from DataForSEO');
      }
      result = response.data[0];
    } else if (response.data?.status_code !== undefined) {
      result = response.data;
    } else {
      throw new ApiError(502, 'Unexpected DataForSEO API response structure');
    }

    // Check for API errors - pass through DataForSEO error messages
    if (result.status_code !== 20000) {
      throw new ApiError(502, `DataForSEO API error: ${result.status_message || 'Unknown error'} (Code: ${result.status_code})`);
    }

    const task = result.tasks?.[0];
    if (!task || task.status_code !== 20000) {
      const errorMsg = task?.status_message || 'DataForSEO task failed';
      const errorCode = task?.status_code || 'unknown';
      throw new ApiError(502, `DataForSEO task error: ${errorMsg} (Code: ${errorCode})`);
    }

    // Extract result data - pass through DataForSEO structure
    let localFinderData;
    if (Array.isArray(task.result)) {
      localFinderData = task.result[0];
    } else if (task.result) {
      localFinderData = task.result;
    } else {
      throw new ApiError(502, 'DataForSEO returned no result data');
    }

    // Extract business listings from Local Finder results
    // Local Finder API returns items in a different structure
    const items = localFinderData?.items || [];
    const businessItems = items.filter(item => 
      item.type === 'local_finder' ||
      item.type === 'local_pack' ||
      (item.title && (item.rating || item.reviews_count || item.rating?.value))
    );

    Logger.log('Business items found:', businessItems.length);

    return {
      items: businessItems,
      keyword: keyword,
      location: locationName,
      language: languageName,
      google_domain: googleDomain,
      raw: localFinderData, // Keep raw data for analysis
    };
  }

  /**
   * Extract address from Local Finder description (first line often contains street address)
   */
  extractAddressFromDescription(description) {
    if (!description || typeof description !== 'string') return '';
    const firstLine = description.split('\n')[0]?.trim();
    // Skip lines that look like hours (e.g. "Fermé · Ouvre à 11:00") or review quotes
    if (!firstLine || /^(Fermé|Ouvert|Open|Closed|·)/.test(firstLine) || /^["']/.test(firstLine)) return '';
    if (/^\d+/.test(firstLine) || /street|straat|rue|laan|baan|weg/i.test(firstLine)) return firstLine;
    return firstLine.length > 5 && firstLine.length < 120 ? firstLine : '';
  }

  /**
   * Extract phone number from Local Finder description text
   * Matches Belgian/Dutch/French/International formats: +32, 0x, +31, +33, +1, etc.
   */
  extractPhoneFromDescription(description) {
    if (!description || typeof description !== 'string') return null;
    // Match +32 123 45 67 89, +32 123456789, 03 123 45 67, 012345678, +31 20 ..., etc.
    const phoneMatch = description.match(
      /(?:\+?\d{1,4}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{2,4}[\s.-]?\d{2,4}[\s.-]?\d{2,4}(?:[\s.-]?\d{2,4})?/
    );
    if (!phoneMatch) return null;
    const raw = phoneMatch[0];
    // Reject if it looks like a time (e.g. 11:00) or year
    if (/\d{1,2}:\d{2}/.test(raw) || /^19\d{2}$|^20\d{2}$/.test(raw.replace(/\D/g, ''))) return null;
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) return null;
    return raw.trim();
  }

  /**
   * Extract website URL from Local Finder description text
   */
  extractWebsiteFromDescription(description) {
    if (!description || typeof description !== 'string') return null;
    const urlMatch = description.match(
      /https?:\/\/[^\s"'<>)\],]+|www\.[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}[^\s"'<>)\],]*/
    );
    if (!urlMatch) return null;
    let url = urlMatch[0].trim();
    if (url.startsWith('www.')) url = `https://${url}`;
    return url;
  }

  /**
   * Transform Local Finder API response into audit result
   * Returns: local visibility score, competitors, businessInfo (from GBP when available), and actionable recommendations
   * @param {string} lang - Language code for translations (e.g., 'en', 'fr', 'nl')
   * @param {Object} gbpData - User's GBP data from my_business_info API (optional)
   */
  transformMapsResult(data, keyword, location, lang = 'en', gbpData = null) {
    const emptyResult = {
      keyword,
      location,
      localVisibilityScore: 0,
      competitors: [],
      businessInfo: null,
      recommendations: [{
        priority: 'high',
        issue: t(lang, 'geo.recommendations.noResults.issue'),
        action: t(lang, 'geo.recommendations.noResults.action'),
      }],
      napIssues: { nameConsistency: true, addressConsistency: true, phoneConsistency: true, issues: [] },
      citationIssues: { missingCitations: [], inconsistentData: [] },
      raw: data,
    };

    if (!data || !data.items || data.items.length === 0) {
      return emptyResult;
    }

    // Build businessInfo from GBP data when available
    const businessInfo = gbpData?.raw ? this.buildBusinessInfoFromGBP(gbpData.raw) : null;

    // Extract competitors from Local Finder results
    const competitors = [];
    data.items.forEach((item) => {
      const extractItem = (it) => {
        const desc = it.description || '';
        const address = it.address || it.address_lines?.join(', ') || it.address_text || this.extractAddressFromDescription(desc);
        const phone = it.phone || it.phone_number || this.extractPhoneFromDescription(desc);
        const website = it.website || it.website_url || it.url || this.extractWebsiteFromDescription(desc);
        const reviewsCount = it.rating?.votes_count ?? it.reviews_count ?? it.reviews ?? it.review_count ?? 0;
        return {
          position: competitors.length + 1,
          name: it.title || it.name || it.business_title || '',
          rating: it.rating?.value ?? it.rating ?? it.rating_value ?? null,
          reviews: reviewsCount,
          distance: it.distance || it.distance_text || null,
          address: address || '',
          phone: phone || null,
          website: website || null,
          category: it.category || it.type || it.category_name || null,
          placeId: it.place_id || it.google_place_id || null,
          cid: it.cid || null,
        };
      };
      if (item.items && Array.isArray(item.items)) {
        item.items.forEach((nestedItem) => competitors.push(extractItem(nestedItem)));
      } else {
        competitors.push(extractItem(item));
      }
    });

    const localVisibilityScore = this.calculateLocalVisibilityScore(competitors);
    const topCompetitors = competitors.slice(0, 10);

    // Generate recommendations (use GBP data when available for credible, user-specific recommendations)
    const recommendations = this.generateRecommendations(topCompetitors, lang, businessInfo);

    // NAP analysis: use user's GBP data when available, else fall back to competitor-based
    const napIssues = businessInfo
      ? this.analyzeNAPConsistencyFromUser(businessInfo, lang)
      : this.analyzeNAPConsistency(topCompetitors, lang);

    const citationIssues = this.analyzeCitationIssues(topCompetitors, lang, businessInfo);

    return {
      keyword,
      location,
      localVisibilityScore,
      businessInfo,
      competitors: topCompetitors,
      recommendations,
      napIssues,
      citationIssues,
      raw: data,
    };
  }

  /**
   * Build businessInfo object from GBP API response
   */
  buildBusinessInfoFromGBP(data) {
    const rating = data.rating?.value ?? data.rating ?? null;
    const reviews = data.rating?.votes_count ?? data.reviews_count ?? data.review_count ?? 0;
    return {
      name: data.title || data.name || null,
      address: data.address || data.address_str || null,
      phone: data.phone || data.phone_number || null,
      website: data.url || data.website || data.domain || null,
      rating: typeof rating === 'number' ? rating : null,
      reviews: typeof reviews === 'number' ? reviews : 0,
      category: data.category || data.main_category || null,
      placeId: data.place_id || data.cid || null,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
    };
  }

  /**
   * Analyze NAP consistency from user's GBP data (credible, user-specific)
   */
  analyzeNAPConsistencyFromUser(businessInfo, lang = 'en') {
    const issues = [];
    const nameConsistency = !!businessInfo?.name;
    const addressConsistency = !!businessInfo?.address;
    const phoneConsistency = !!businessInfo?.phone;

    if (!nameConsistency) issues.push(t(lang, 'geo.napIssues.missingNameUser'));
    if (!addressConsistency) issues.push(t(lang, 'geo.napIssues.missingAddressUser'));
    if (!phoneConsistency) issues.push(t(lang, 'geo.napIssues.missingPhoneUser'));

    return {
      nameConsistency,
      addressConsistency,
      phoneConsistency,
      issues,
    };
  }

  /**
   * Calculate local visibility score (0-100)
   * Based on competitors analysis: average rating, total competitors, data completeness
   */
  calculateLocalVisibilityScore(competitors) {
    if (!competitors || competitors.length === 0) {
      return 0;
    }

    let score = 0;

    // Number of competitors (0-30 points)
    // More competitors = more competitive market = higher potential visibility
    const competitorCount = competitors.length;
    if (competitorCount >= 20) score += 30;
    else if (competitorCount >= 10) score += 25;
    else if (competitorCount >= 5) score += 20;
    else score += 15;

    // Average rating of competitors (0-30 points)
    const ratings = competitors.filter(c => c.rating).map(c => c.rating);
    if (ratings.length > 0) {
      const avgRating = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
      score += (avgRating / 5) * 30; // Scale to 30 points
    }

    // Average reviews (0-20 points)
    const reviews = competitors.filter(c => c.reviews).map(c => c.reviews);
    if (reviews.length > 0) {
      const avgReviews = reviews.reduce((sum, r) => sum + r, 0) / reviews.length;
      const reviewScore = Math.min(avgReviews / 100, 1) * 20;
      score += reviewScore;
    }

    // Data completeness across competitors (0-20 points)
    let completeness = 0;
    competitors.forEach(comp => {
      if (comp.name) completeness += 0.2;
      if (comp.address) completeness += 0.2;
      if (comp.phone) completeness += 0.2;
      if (comp.website) completeness += 0.2;
      if (comp.category) completeness += 0.2;
    });
    const avgCompleteness = completeness / competitors.length;
    score += avgCompleteness * 20;

    return Math.round(Math.min(score, 100));
  }

  /**
   * Generate actionable recommendations for website/page improvements
   * Based on competitors analysis + optional user GBP data for credible, user-specific recommendations
   * @param {string} lang - Language code for translations (e.g., 'en', 'fr', 'nl')
   * @param {Object} businessInfo - User's business data from GBP (optional)
   */
  /**
   * Find user's business position in competitor list (1-based) by matching name or placeId/cid
   */
  findUserPositionInCompetitors(competitors, businessInfo) {
    if (!businessInfo || !competitors?.length) return null;
    const nameA = (businessInfo.name || '').trim().toLowerCase();
    const placeId = businessInfo.placeId || null;
    const idx = competitors.findIndex((c) => {
      if (placeId && (c.placeId === placeId || c.cid === placeId)) return true;
      const nameB = (c.name || '').trim().toLowerCase();
      if (!nameA || !nameB) return false;
      if (nameA === nameB) return true;
      if (nameA.includes(nameB) || nameB.includes(nameA)) return true;
      return false;
    });
    return idx >= 0 ? idx + 1 : null;
  }

  generateRecommendations(competitors, lang = 'en', businessInfo = null) {
    const recommendations = [];

    if (!competitors || competitors.length === 0) {
      return recommendations;
    }

    const userPosition = this.findUserPositionInCompetitors(competitors, businessInfo);
    const userInTop3 = userPosition != null && userPosition <= 3;
    const userHasCompleteNAP = businessInfo?.name && businessInfo?.address && businessInfo?.phone;

    // Helper to add recommendation with enhanced structure (like SEO Audit)
    const addRec = (priority, category, issueKey, actionKey, vars = {}, impact = null, effort = null) => {
      const issue = t(lang, `geo.recommendations.${issueKey}.issue`, vars);
      const action = t(lang, `geo.recommendations.${issueKey}.action`, vars);
      if (issue && action && !issue.includes('.issue')) {
        // Auto-determine impact and effort if not provided
        const autoImpact = impact || (priority === 'critical' || priority === 'high' ? 'high' : priority === 'medium' ? 'medium' : 'low');
        const autoEffort = effort || (['website', 'content', 'citations'].includes(category) ? 'moderate' : 'easy');
        
        recommendations.push({
          priority,
          category,
          issue,
          action,
          impact: autoImpact,
          effort: autoEffort,
        });
      }
    };

    // === CRITICAL: Website Optimization ===
    const competitorsWithWebsite = competitors.filter(c => c.website).length;
    const websitePercentage = (competitorsWithWebsite / competitors.length) * 100;
    const top3Competitors = competitors.slice(0, 3);
    const top3WithWebsite = top3Competitors.filter(c => c.website).length;

    if (top3WithWebsite === 3 && websitePercentage >= 80) {
      addRec('critical', 'website', 'topCompetitorsHaveWebsite', 'topCompetitorsHaveWebsite', 
        { percentage: Math.round(websitePercentage) }, 'high', 'moderate');
    } else if (websitePercentage < 50) {
      addRec('high', 'website', 'missingWebsite', 'missingWebsite', 
        { percentage: Math.round(100 - websitePercentage) }, 'high', 'moderate');
    }

    // === CRITICAL: Local Content on Website ===
    // Never use a competitor name — only user's business name or neutral phrase
    const contentKeyword = businessInfo?.name || 'your business';
    if (!userInTop3) {
      addRec('critical', 'content', 'localContentRequired', 'localContentRequired',
        { keyword: contentKeyword }, 'high', 'moderate');
    }

    // === GBP-SPECIFIC RECOMMENDATIONS (when we have user's data from GBP API) ===
    if (businessInfo) {
      if (!businessInfo.website) {
        addRec('critical', 'website', 'gbpMissingWebsite', 'gbpMissingWebsite', {}, 'high', 'easy');
      }
      if (!businessInfo.phone) {
        addRec('high', 'citations', 'gbpMissingPhone', 'gbpMissingPhone', {}, 'high', 'easy');
      }
      if (!businessInfo.address) {
        addRec('high', 'citations', 'gbpMissingAddress', 'gbpMissingAddress', {}, 'high', 'easy');
      }
      if (businessInfo.rating !== null && businessInfo.rating < 4) {
        addRec('high', 'reviews', 'lowRating', 'lowRating', { rating: businessInfo.rating }, 'high', 'moderate');
      }
      if (businessInfo.reviews < 10) {
        const avg = Math.round(top3Competitors.reduce((s, c) => s + (c.reviews || 0), 0) / Math.max(top3Competitors.length, 1));
        addRec('high', 'reviews', 'fewReviews', 'fewReviews',
          { count: businessInfo.reviews, avg, target: Math.max(20, avg) }, 'high', 'moderate');
      }
    }

    // === CRITICAL: Google Business Profile Optimization ===
    // Skip when we have user's GBP data — we already show specific missing-field recs or profile is complete (avoid "optimize GBP" when already optimized)
    if (!businessInfo) {
      addRec('critical', 'gbp', 'gbpOptimizationRequired', 'gbpOptimizationRequired', {}, 'high', 'easy');
    }

    // Analyze competitor ratings (skip "reach top 3" targets when user is already in top 3)
    const ratings = competitors.filter(c => c.rating).map(c => c.rating);
    if (ratings.length > 0) {
      const avgRating = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
      const top3AvgRating = top3Competitors
        .filter(c => c.rating)
        .map(c => c.rating)
        .reduce((sum, r) => sum + r, 0) / Math.max(top3Competitors.filter(c => c.rating).length, 1);

      if (avgRating >= 4.5) {
        addRec('high', 'reviews', 'highCompetition', 'highCompetition', 
          { avgRating: avgRating.toFixed(1) }, 'high', 'moderate');
      }

      if (!userInTop3 && top3AvgRating >= 4.5) {
        addRec('critical', 'reviews', 'top3RatingTarget', 'top3RatingTarget', 
          { targetRating: '4.5+', avgRating: top3AvgRating.toFixed(1) }, 'high', 'moderate');
      }
    }

    // Analyze review counts (skip "get 605+ reviews to compete" when user is already in top 3)
    const reviews = competitors.filter(c => c.reviews).map(c => c.reviews);
    if (reviews.length > 0) {
      const avgReviews = reviews.reduce((sum, r) => sum + r, 0) / reviews.length;
      const top3AvgReviews = top3Competitors
        .filter(c => c.reviews)
        .map(c => c.reviews)
        .reduce((sum, r) => sum + r, 0) / Math.max(top3Competitors.filter(c => c.reviews).length, 1);

      if (!userInTop3 && top3AvgReviews > 50) {
        addRec('critical', 'reviews', 'top3ReviewTarget', 'top3ReviewTarget', 
          { targetReviews: Math.round(top3AvgReviews), avgReviews: Math.round(avgReviews) }, 'high', 'moderate');
      } else if (avgReviews > 50) {
        addRec('high', 'reviews', 'competitiveMarket', 'competitiveMarket', 
          { avgReviews: Math.round(avgReviews) }, 'high', 'moderate');
      }
    }

    // === HIGH PRIORITY: NAP Consistency ===
    // Skip when user's NAP is already complete (from GBP) — avoid "NAP missing" when it's present
    if (!userHasCompleteNAP) {
      const competitorsWithNAP = competitors.filter(c => c.name && c.address && c.phone).length;
      const napCompleteness = (competitorsWithNAP / competitors.length) * 100;
      const top3WithNAP = top3Competitors.filter(c => c.name && c.address && c.phone).length;

      if (top3WithNAP === 3) {
        addRec('high', 'citations', 'top3NAPComplete', 'top3NAPComplete', {}, 'high', 'easy');
      } else if (napCompleteness < 80) {
        addRec('high', 'citations', 'napIncomplete', 'napIncomplete', 
          { percentage: Math.round(100 - napCompleteness) }, 'high', 'easy');
      }
    }

    // === HIGH PRIORITY: Local Citations ===
    addRec('high', 'citations', 'buildLocalCitations', 'buildLocalCitations', 
      { count: '30+' }, 'high', 'moderate');

    // === HIGH PRIORITY: Website Local SEO Elements ===
    // Skip when already in top 3 — message says "to appear in top 10" which doesn't apply
    if (!userInTop3) {
      addRec('high', 'website', 'localSeoElements', 'localSeoElements', {}, 'high', 'moderate');
    }

    // === MEDIUM PRIORITY: Category Optimization ===
    const competitorsWithCategory = competitors.filter(c => c.category).length;
    const categoryPercentage = (competitorsWithCategory / competitors.length) * 100;
    if (categoryPercentage < 80) {
      addRec('medium', 'gbp', 'missingCategory', 'missingCategory', 
        { percentage: Math.round(100 - categoryPercentage) }, 'medium', 'easy');
    }

    // === MEDIUM PRIORITY: Content Freshness ===
    addRec('medium', 'content', 'freshContentRequired', 'freshContentRequired', {}, 'medium', 'moderate');

    // === MEDIUM PRIORITY: Local Backlinks ===
    addRec('medium', 'backlinks', 'localBacklinksRequired', 'localBacklinksRequired', 
      { count: '10+' }, 'medium', 'difficult');

    return recommendations;
  }

  /**
   * Analyze NAP (Name, Address, Phone) consistency from competitors
   * @param {string} lang - Language code for translations (e.g., 'en', 'fr', 'nl')
   */
  analyzeNAPConsistency(competitors, lang = 'en') {
    if (!competitors || competitors.length === 0) {
      return {
        nameConsistency: true,
        addressConsistency: true,
        phoneConsistency: true,
        issues: [],
      };
    }

    const issues = [];
    
    // Calculate NAP completeness across competitors
    const withName = competitors.filter(c => c.name).length;
    const withAddress = competitors.filter(c => c.address).length;
    const withPhone = competitors.filter(c => c.phone).length;

    const namePercentage = (withName / competitors.length) * 100;
    const addressPercentage = (withAddress / competitors.length) * 100;
    const phonePercentage = (withPhone / competitors.length) * 100;

    const nameConsistency = namePercentage >= 90;
    const addressConsistency = addressPercentage >= 90;
    const phoneConsistency = phonePercentage >= 90;

    if (!nameConsistency) {
      issues.push(t(lang, 'geo.napIssues.missingName', { percentage: Math.round(100 - namePercentage) }));
    }
    if (!addressConsistency) {
      issues.push(t(lang, 'geo.napIssues.missingAddress', { percentage: Math.round(100 - addressPercentage) }));
    }
    if (!phoneConsistency) {
      issues.push(t(lang, 'geo.napIssues.missingPhone', { percentage: Math.round(100 - phonePercentage) }));
    }

    return {
      nameConsistency,
      addressConsistency,
      phoneConsistency,
      issues,
    };
  }

  /**
   * Analyze citation issues from competitors + optional user GBP data
   * When businessInfo is present, adds user-specific citation issues (e.g. missing website in GBP)
   * @param {string} lang - Language code for translations (e.g., 'en', 'fr', 'nl')
   * @param {Object} businessInfo - User's business data from GBP (optional)
   */
  analyzeCitationIssues(competitors, lang = 'en', businessInfo = null) {
    const missingCitations = [];
    const inconsistentData = [];

    if (!competitors || competitors.length === 0) {
      return {
        missingCitations: [],
        inconsistentData: [],
      };
    }

    // Analyze website presence
    const competitorsWithWebsite = competitors.filter(c => c.website).length;
    const websitePercentage = (competitorsWithWebsite / competitors.length) * 100;

    // Only add competitor-based website issues when we have some data (avoid "100% missing" when API returned no websites)
    if (competitorsWithWebsite > 0 && websitePercentage >= 80) {
      inconsistentData.push(t(lang, 'geo.citationIssues.competitorsHaveWebsite', { percentage: Math.round(websitePercentage) }));
    } else if (websitePercentage > 0 && websitePercentage < 50) {
      missingCitations.push(t(lang, 'geo.citationIssues.missingWebsite', { percentage: Math.round(100 - websitePercentage) }));
    } else if (competitorsWithWebsite === 0 && !businessInfo) {
      // No competitor website data from API – likely data limitation; add single note instead of "100% missing"
      missingCitations.push(t(lang, 'geo.citationIssues.citationDataMayBeLimited'));
    }

    // Analyze category presence
    const competitorsWithCategory = competitors.filter(c => c.category).length;
    const categoryPercentage = (competitorsWithCategory / competitors.length) * 100;

    if (competitorsWithCategory > 0 && categoryPercentage < 70) {
      missingCitations.push(t(lang, 'geo.citationIssues.missingCategory', { percentage: Math.round(100 - categoryPercentage) }));
    }
    // When 0% have category we don't add "100% missing" – treat as API limitation

    // Analyze top competitors
    const topCompetitors = competitors.slice(0, 10);
    const topWithWebsite = topCompetitors.filter(c => c.website).length;
    const topWithCategory = topCompetitors.filter(c => c.category).length;

    if (topWithWebsite >= 8 && websitePercentage > 0 && websitePercentage < 80) {
      inconsistentData.push(t(lang, 'geo.citationIssues.topCompetitorsHaveWebsite'));
    }

    if (topWithCategory >= 8 && categoryPercentage > 0 && categoryPercentage < 80) {
      inconsistentData.push(t(lang, 'geo.citationIssues.topCompetitorsHaveCategory'));
    }

    // When we have user's GBP data, add user-specific citation issues
    if (businessInfo) {
      if (!businessInfo.website) {
        missingCitations.push(t(lang, 'geo.citationIssues.missingWebsiteUser'));
      }
      if (!businessInfo.phone) {
        missingCitations.push(t(lang, 'geo.citationIssues.missingPhoneUser'));
      }
      if (!businessInfo.address) {
        missingCitations.push(t(lang, 'geo.citationIssues.missingAddressUser'));
      }
      if (!businessInfo.category) {
        missingCitations.push(t(lang, 'geo.citationIssues.missingCategoryUser'));
      }
    }

    return {
      missingCitations,
      inconsistentData,
    };
  }
}

export const geoAuditService = new GeoAuditService();
