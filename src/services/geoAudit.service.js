import axios from 'axios';
import { env, getLocaleConfig, DEFAULT_LOCALE } from '../config/index.js';
import { ApiError } from '../utils/index.js';
import { Logger } from '../utils/logger.js';
import { t } from '../locales/index.js';

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

    // Location code mappings
    this.locationCodeMap = {
      'united states': 2840,
      'us': 2840,
      'usa': 2840,
      'united kingdom': 2826,
      'uk': 2826,
      'canada': 2036,
      'australia': 2033,
      'germany': 2276,
      'france': 2250,
      'belgium': 2056,
      'netherlands': 2528,
      'new york': 1006164,
      'los angeles': 1002980,
      'chicago': 1002801,
      'houston': 1002931,
      'phoenix': 1003444,
      'philadelphia': 1003440,
      'san antonio': 1003520,
      'san diego': 1003521,
      'dallas': 1002840,
      'san jose': 1003522,
    };
  }

  async runGeoAudit(keyword, location, businessName = null, locale = DEFAULT_LOCALE, device = 'desktop') {
    try {
      const localeConfig = getLocaleConfig(locale);
      const lang = localeConfig.language || 'en';

      const localPackData = await this.fetchLocalPackData(
        keyword,
        location,
        localeConfig.languageName,
        device
      );

      return this.transformLocalPackResult(localPackData, keyword, location, businessName, lang);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, `Geo audit failed: ${error.message}`);
    }
  }

  parseLocation(locationStr) {
    if (!locationStr) return null;

    const num = parseInt(locationStr);
    if (!isNaN(num) && num > 0) {
      return { type: 'code', value: num };
    }

    let cleaned = locationStr.trim();
    const cityStateMatch = cleaned.match(/^(.+?),\s*[A-Z]{2}$/i);
    if (cityStateMatch) {
      cleaned = cityStateMatch[1].trim();
    }

    const locationLower = cleaned.toLowerCase();
    if (this.locationCodeMap[locationLower]) {
      return { type: 'code', value: this.locationCodeMap[locationLower] };
    }

    const originalLower = locationStr.toLowerCase().trim();
    if (this.locationCodeMap[originalLower]) {
      return { type: 'code', value: this.locationCodeMap[originalLower] };
    }

    return { type: 'name', value: cleaned || locationStr };
  }

  async fetchLocalPackData(keyword, locationName = 'United States', languageName = 'English', device = 'desktop') {
    if (!this.login || !this.password) {
      throw new ApiError(500, 'DataForSEO credentials not configured');
    }

    try {
      const payload = [
        {
          keyword: keyword.trim(),
          language_name: languageName,
          device: device,
          depth: 100,
        },
      ];

      const parsedLocation = this.parseLocation(locationName);
      if (parsedLocation) {
        if (parsedLocation.type === 'code') {
          payload[0].location_code = parsedLocation.value;
        } else {
          payload[0].location_name = parsedLocation.value;
        }
      } else {
        payload[0].location_code = 2840;
      }

      Logger.log('Sending request to DataForSEO SERP API:', {
        endpoint: '/v3/serp/google/organic/live/regular',
        keyword: keyword.trim(),
        location: parsedLocation,
        language: languageName,
        device: device,
      });

      const response = await this.client.post('/v3/serp/google/organic/live/regular', payload);

      let result;
      if (Array.isArray(response.data)) {
        if (response.data.length === 0) {
          throw new ApiError(502, 'No SERP data received');
        }
        result = response.data[0];
      } else if (response.data?.status_code !== undefined) {
        result = response.data;
      } else {
        throw new ApiError(502, 'Unexpected API response structure');
      }

      if (result.status_code !== 20000) {
        throw new ApiError(502, result.status_message || 'DataForSEO SERP API error');
      }

      const task = result.tasks?.[0];
      if (!task || task.status_code !== 20000) {
        const errorMsg = task?.status_message || 'SERP data fetch failed';

        if (errorMsg.includes('location_name') || errorMsg.includes('Invalid Field')) {
          throw new ApiError(400, `Invalid location: "${locationName}". Please use a valid location name.`);
        }

        throw new ApiError(502, errorMsg);
      }

      let serpData;
      if (Array.isArray(task.result)) {
        serpData = task.result[0];
      } else if (task.result) {
        serpData = task.result;
      } else {
        throw new ApiError(502, 'No SERP result data found');
      }

      const items = serpData?.items || [];
      const localPackItems = items.filter(item => item.type === 'local_pack');

      if (localPackItems.length === 0) {
        try {
          return await this.fetchMapsData(keyword, locationName, languageName, device);
        } catch (mapsError) {
          Logger.error('Maps API also failed:', mapsError.message);
          return {
            items: items,
            local_pack_items: [],
            has_local_pack: false,
            serp_data: serpData,
          };
        }
      }

      return {
        items: items,
        local_pack_items: localPackItems,
        has_local_pack: true,
        keyword: keyword,
        location: locationName,
        language: languageName,
        device: device,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;

      if (error.response) {
        const statusCode = error.response.status;
        const errorMessage = error.response.data?.message || error.response.statusText || 'DataForSEO API request failed';

        if (statusCode === 401) {
          throw new ApiError(401, 'DataForSEO authentication failed');
        }

        throw new ApiError(statusCode, errorMessage);
      }

      throw new ApiError(502, `Local Pack data fetch failed: ${error.message}`);
    }
  }

  async fetchMapsData(keyword, locationName = 'United States', languageName = 'English', device = 'desktop') {
    if (!this.login || !this.password) {
      throw new ApiError(500, 'DataForSEO credentials not configured');
    }

    try {
      const payload = [
        {
          keyword: keyword.trim(),
          language_name: languageName,
          device: device,
        },
      ];

      const parsedLocation = this.parseLocation(locationName);
      if (parsedLocation) {
        if (parsedLocation.type === 'code') {
          payload[0].location_code = parsedLocation.value;
        } else {
          payload[0].location_name = parsedLocation.value;
        }
      } else {
        payload[0].location_code = 2840;
      }

      const response = await this.client.post('/v3/serp/google/maps/live/advanced', payload);

      let result;
      if (Array.isArray(response.data)) {
        if (response.data.length === 0) {
          throw new ApiError(502, 'No Maps data received');
        }
        result = response.data[0];
      } else if (response.data?.status_code !== undefined) {
        result = response.data;
      } else {
        throw new ApiError(502, 'Unexpected Maps API response structure');
      }

      if (result.status_code !== 20000) {
        throw new ApiError(502, result.status_message || 'DataForSEO Maps API error');
      }

      const task = result.tasks?.[0];
      if (!task || task.status_code !== 20000) {
        throw new ApiError(502, task?.status_message || 'Maps data fetch failed');
      }

      let mapsData;
      if (Array.isArray(task.result)) {
        mapsData = task.result[0];
      } else if (task.result) {
        mapsData = task.result;
      } else {
        throw new ApiError(502, 'No Maps result data found');
      }

      const items = mapsData?.items || [];
      const mapItems = items.filter(item =>
        item.type === 'maps_results' ||
        item.type === 'local_pack' ||
        item.type === 'map' ||
        (item.title && (item.rating || item.reviews_count))
      );

      return {
        items: items,
        local_pack_items: mapItems,
        has_local_pack: mapItems.length > 0,
        maps_data: mapsData,
        keyword: keyword,
        location: locationName,
        language: languageName,
        device: device,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;

      if (error.response) {
        const statusCode = error.response.status;
        if (statusCode === 401) {
          throw new ApiError(401, 'DataForSEO authentication failed');
        }
        throw new ApiError(statusCode, error.response.data?.message || 'Maps API request failed');
      }

      throw new ApiError(502, `Maps data fetch failed: ${error.message}`);
    }
  }

  transformLocalPackResult(data, keyword, location, businessName = null, lang = 'en') {
    if (!data) {
      return this.buildEmptyResult(keyword, location, businessName, lang);
    }

    let localPackItems = data.local_pack_items || [];

    if (localPackItems.length === 0 && data.items) {
      const filtered = data.items.filter(item => item.type === 'local_pack');
      if (filtered.length > 0) {
        localPackItems.push(...filtered);
      }

      if (localPackItems.length === 0) {
        const mapsResults = data.items.filter(item =>
          item.type === 'maps_results' ||
          item.type === 'map' ||
          (item.title && (item.rating || item.reviews_count))
        );
        if (mapsResults.length > 0) {
          localPackItems.push(...mapsResults);
        }
      }
    }

    // Build competitors list
    const competitors = this.buildCompetitorsList(localPackItems, lang);

    if (competitors.length === 0) {
      return this.buildEmptyResult(keyword, location, businessName, lang, data);
    }

    // Find business in competitors
    const { businessInfo, businessIndex } = this.findBusiness(businessName, competitors, lang);

    // Calculate metrics
    const competitorStats = this.calculateCompetitorStats(competitors);
    const localVisibilityScore = this.calculateLocalVisibilityScore(businessIndex, competitors, businessInfo, competitorStats);
    const recommendations = this.generateEnhancedRecommendations(businessInfo, competitors, businessIndex, competitorStats, lang);
    const napIssues = this.analyzeNAPConsistency(businessInfo, competitors, lang);
    const citationIssues = this.analyzeCitationIssues(businessInfo, competitors, lang);

    return {
      keyword,
      location,
      businessName: businessName || (businessInfo?.name || keyword),
      localVisibilityScore,
      localVisibilityScoreLabel: t(lang, 'geo.labels.localVisibilityScore'),
      marketPosition: this.getMarketPosition(businessIndex, localVisibilityScore),
      marketPositionLabel: t(lang, 'geo.labels.competitorStrength'),
      businessInfo,
      businessInfoLabel: t(lang, 'geo.labels.businessInfo'),
      competitors,
      competitorsLabel: t(lang, 'geo.labels.competitors'),
      competitorStats,
      recommendations,
      napIssues,
      napIssuesLabel: t(lang, 'geo.labels.napConsistency'),
      citationIssues,
      citationIssuesLabel: t(lang, 'geo.labels.citations'),
      raw: {
        ...data,
        original_items: data.items,
      },
    };
  }

  buildEmptyResult(keyword, location, businessName, lang, data = null) {
    return {
      keyword,
      location,
      businessName: businessName || keyword,
      localVisibilityScore: 0,
      localVisibilityScoreLabel: t(lang, 'geo.labels.localVisibilityScore'),
      marketPosition: 'notFound',
      marketPositionLabel: t(lang, 'geo.labels.competitorStrength'),
      businessInfo: null,
      businessInfoLabel: t(lang, 'geo.labels.businessInfo'),
      competitors: [],
      competitorsLabel: t(lang, 'geo.labels.competitors'),
      competitorStats: { avgRating: 0, avgReviews: 0, totalCompetitors: 0 },
      recommendations: [{
        priority: 'critical',
        category: 'visibility',
        issue: t(lang, 'geo.recommendations.notInLocalPack.issue'),
        action: t(lang, 'geo.recommendations.notInLocalPack.action'),
        impact: 'high',
        effort: 'moderate',
      }],
      napIssues: {
        nameConsistency: false,
        nameConsistencyLabel: t(lang, 'geo.nap.nameConsistency'),
        nameConsistencyValue: t(lang, 'geo.nap.inconsistent'),
        addressConsistency: false,
        addressConsistencyLabel: t(lang, 'geo.nap.addressConsistency'),
        addressConsistencyValue: t(lang, 'geo.nap.inconsistent'),
        phoneConsistency: false,
        phoneConsistencyLabel: t(lang, 'geo.nap.phoneConsistency'),
        phoneConsistencyValue: t(lang, 'geo.nap.inconsistent'),
        issues: [t(lang, 'geo.nap.notFoundInLocalPack')],
      },
      napIssuesLabel: t(lang, 'geo.labels.napConsistency'),
      citationIssues: {
        missingCitationsLabel: t(lang, 'geo.citations.missingCitations'),
        missingCitations: [t(lang, 'geo.citations.notFoundInLocalPack')],
        inconsistentDataLabel: t(lang, 'geo.citations.inconsistentData'),
        inconsistentData: [],
      },
      citationIssuesLabel: t(lang, 'geo.labels.citations'),
      raw: data,
    };
  }

  buildCompetitorsList(localPackItems, lang) {
    const competitors = [];
    const competitorLabels = {
      positionLabel: t(lang, 'geo.labels.position'),
      nameLabel: t(lang, 'geo.labels.name'),
      ratingLabel: t(lang, 'geo.labels.rating'),
      reviewsLabel: t(lang, 'geo.labels.reviews'),
      distanceLabel: t(lang, 'geo.labels.distance'),
      addressLabel: t(lang, 'geo.labels.address'),
      phoneLabel: t(lang, 'geo.labels.phone'),
      websiteLabel: t(lang, 'geo.labels.website'),
      categoryLabel: t(lang, 'geo.labels.category'),
    };

    for (const item of localPackItems) {
      if (item.items && Array.isArray(item.items)) {
        item.items.forEach((localItem) => {
          competitors.push(this.buildCompetitorObject(localItem, competitors.length + 1, competitorLabels));
        });
      } else {
        competitors.push(this.buildCompetitorObject(item, competitors.length + 1, competitorLabels));
      }
    }

    return competitors;
  }

  buildCompetitorObject(item, position, labels) {
    return {
      position,
      ...labels,
      name: item.title || item.name || '',
      rating: item.rating?.value || item.rating || null,
      reviews: item.reviews_count || item.reviews || 0,
      distance: item.distance || null,
      address: item.address || item.address_lines?.join(', ') || '',
      phone: item.phone || null,
      website: item.website || null,
      category: item.category || item.type || null,
      placeId: item.place_id || null,
    };
  }

  findBusiness(businessName, competitors, lang) {
    let businessInfo = null;
    let businessIndex = -1;

    if (businessName) {
      const businessNameLower = businessName.toLowerCase();
      businessIndex = competitors.findIndex((comp) => {
        const compName = (comp.name || '').toLowerCase();
        return compName.includes(businessNameLower) || businessNameLower.includes(compName);
      });

      if (businessIndex >= 0) {
        const found = competitors[businessIndex];
        businessInfo = {
          name: found.name,
          nameLabel: t(lang, 'geo.labels.name'),
          address: found.address,
          addressLabel: t(lang, 'geo.labels.address'),
          phone: found.phone,
          phoneLabel: t(lang, 'geo.labels.phone'),
          website: found.website,
          websiteLabel: t(lang, 'geo.labels.website'),
          rating: found.rating,
          ratingLabel: t(lang, 'geo.labels.rating'),
          reviews: found.reviews,
          reviewsLabel: t(lang, 'geo.labels.reviews'),
          category: found.category,
          categoryLabel: t(lang, 'geo.labels.category'),
          placeId: found.placeId,
          position: businessIndex + 1,
          positionLabel: t(lang, 'geo.labels.position'),
        };
      }
    }

    return { businessInfo, businessIndex };
  }

  calculateCompetitorStats(competitors) {
    const withRating = competitors.filter(c => c.rating);
    const withReviews = competitors.filter(c => c.reviews);

    return {
      avgRating: withRating.length > 0 
        ? parseFloat((withRating.reduce((sum, c) => sum + c.rating, 0) / withRating.length).toFixed(2))
        : 0,
      avgReviews: withReviews.length > 0
        ? Math.round(withReviews.reduce((sum, c) => sum + c.reviews, 0) / withReviews.length)
        : 0,
      totalCompetitors: competitors.length,
      topRating: withRating.length > 0 ? Math.max(...withRating.map(c => c.rating)) : 0,
      topReviews: withReviews.length > 0 ? Math.max(...withReviews.map(c => c.reviews)) : 0,
    };
  }

  getMarketPosition(businessIndex, score) {
    if (businessIndex < 0) return 'notFound';
    if (businessIndex === 0 && score >= 80) return 'leader';
    if (businessIndex <= 2) return 'competitive';
    if (score >= 50) return 'emerging';
    return 'weak';
  }

  calculateLocalVisibilityScore(businessIndex, competitors, businessInfo, competitorStats) {
    let score = 0;

    // Position score (0-50 points)
    if (businessIndex >= 0) {
      if (businessIndex === 0) score += 50;
      else if (businessIndex === 1) score += 40;
      else if (businessIndex === 2) score += 30;
      else if (businessIndex < 5) score += 20;
      else score += 10;
    } else {
      return 0;
    }

    // Rating score (0-25 points)
    if (businessInfo?.rating) {
      const ratingScore = (businessInfo.rating / 5) * 25;
      // Bonus if above average
      if (businessInfo.rating > competitorStats.avgRating) {
        score += ratingScore * 1.1;
      } else {
        score += ratingScore;
      }
    }

    // Review score (0-15 points)
    if (businessInfo?.reviews) {
      const reviewScore = Math.min(businessInfo.reviews / Math.max(competitorStats.avgReviews, 50), 1) * 15;
      score += reviewScore;
    }

    // Profile completeness (0-10 points)
    let completeness = 0;
    if (businessInfo?.name) completeness += 2;
    if (businessInfo?.address) completeness += 2;
    if (businessInfo?.phone) completeness += 2;
    if (businessInfo?.website) completeness += 2;
    if (businessInfo?.category) completeness += 2;
    score += completeness;

    return Math.min(100, Math.round(score));
  }

  generateEnhancedRecommendations(businessInfo, competitors, businessIndex, competitorStats, lang = 'en') {
    const recommendations = [];

    // Helper to add recommendation
    const addRec = (priority, category, issueKey, actionKey, vars = {}) => {
      const issue = t(lang, `geo.recommendations.${issueKey}.issue`, vars);
      const action = t(lang, `geo.recommendations.${issueKey}.action`, vars);

      if (issue && action && !issue.includes('.issue')) {
        recommendations.push({
          priority,
          category,
          issue,
          action,
          impact: priority === 'critical' || priority === 'high' ? 'high' : priority === 'medium' ? 'medium' : 'low',
          effort: ['missingPhone', 'missingWebsite'].includes(issueKey) ? 'easy' : 'moderate',
        });
      }
    };

    // === CRITICAL: Not in Local Pack ===
    if (businessIndex < 0) {
      addRec('critical', 'visibility', 'notInLocalPack', 'notInLocalPack');
      return recommendations;
    }

    // === POSITION-BASED RECOMMENDATIONS ===
    if (businessIndex === 0) {
      addRec('low', 'success', 'position1', 'position1');
    } else if (businessIndex <= 2) {
      addRec('medium', 'visibility', 'position2or3', 'position2or3', { position: businessIndex + 1 });
    } else {
      addRec('high', 'visibility', 'lowPosition', 'lowPosition', { position: businessIndex + 1 });
    }

    // === RATING RECOMMENDATIONS ===
    if (businessInfo?.rating !== null && businessInfo?.rating !== undefined) {
      if (businessInfo.rating < 4) {
        addRec('high', 'reviews', 'lowRating', 'lowRating', { rating: businessInfo.rating });
      } else if (businessInfo.rating >= 4 && businessInfo.rating < 4.5) {
        addRec('low', 'reviews', 'goodRating', 'goodRating', { rating: businessInfo.rating });
      } else if (businessInfo.rating >= 4.5) {
        addRec('low', 'success', 'excellentRating', 'excellentRating', { rating: businessInfo.rating });
      }

      // Competitor rating comparison
      if (businessInfo.rating < competitorStats.avgRating) {
        addRec('high', 'reviews', 'competitorsBetterRating', 'competitorsBetterRating', {
          avg: competitorStats.avgRating.toFixed(1),
          rating: businessInfo.rating,
        });
      }
    }

    // === REVIEW RECOMMENDATIONS ===
    if (businessInfo?.reviews !== undefined) {
      if (businessInfo.reviews === 0) {
        addRec('critical', 'reviews', 'noReviews', 'noReviews');
      } else if (businessInfo.reviews < 10) {
        addRec('high', 'reviews', 'fewReviews', 'fewReviews', {
          count: businessInfo.reviews,
          avg: competitorStats.avgReviews,
          target: Math.max(20, competitorStats.avgReviews),
        });
      } else if (businessInfo.reviews < competitorStats.avgReviews) {
        addRec('medium', 'reviews', 'competitorsMoreReviews', 'competitorsMoreReviews', {
          avgReviews: competitorStats.avgReviews,
          reviews: businessInfo.reviews,
          target: Math.round(competitorStats.avgReviews * 1.5),
        });
      }
    }

    // === NAP RECOMMENDATIONS ===
    if (!businessInfo?.phone) {
      addRec('high', 'nap', 'missingPhone', 'missingPhone');
    }

    if (!businessInfo?.website) {
      addRec('medium', 'nap', 'missingWebsite', 'missingWebsite');
    }

    // === COMPETITION ANALYSIS ===
    if (competitors.length >= 5) {
      addRec('medium', 'competition', 'strongCompetition', 'strongCompetition', { count: competitors.length });
    }

    // Sort by priority
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    recommendations.sort((a, b) => (priorityOrder[a.priority] || 4) - (priorityOrder[b.priority] || 4));

    return recommendations;
  }

  analyzeNAPConsistency(businessInfo, competitors, lang = 'en') {
    const issues = [];
    let nameConsistency = true;
    let addressConsistency = true;
    let phoneConsistency = true;

    if (!businessInfo) {
      return {
        nameConsistency: false,
        nameConsistencyLabel: t(lang, 'geo.nap.nameConsistency'),
        nameConsistencyValue: t(lang, 'geo.nap.inconsistent'),
        addressConsistency: false,
        addressConsistencyLabel: t(lang, 'geo.nap.addressConsistency'),
        addressConsistencyValue: t(lang, 'geo.nap.inconsistent'),
        phoneConsistency: false,
        phoneConsistencyLabel: t(lang, 'geo.nap.phoneConsistency'),
        phoneConsistencyValue: t(lang, 'geo.nap.inconsistent'),
        issues: [t(lang, 'geo.nap.notFoundInLocalPack')],
      };
    }

    if (!businessInfo.name) {
      nameConsistency = false;
      issues.push(t(lang, 'geo.nap.nameMissing'));
    }

    if (!businessInfo.address) {
      addressConsistency = false;
      issues.push(t(lang, 'geo.nap.addressMissing'));
    }

    if (!businessInfo.phone) {
      phoneConsistency = false;
      issues.push(t(lang, 'geo.nap.phoneMissing'));
    }

    return {
      nameConsistency,
      nameConsistencyLabel: t(lang, 'geo.nap.nameConsistency'),
      nameConsistencyValue: nameConsistency ? t(lang, 'geo.nap.consistent') : t(lang, 'geo.nap.inconsistent'),
      addressConsistency,
      addressConsistencyLabel: t(lang, 'geo.nap.addressConsistency'),
      addressConsistencyValue: addressConsistency ? t(lang, 'geo.nap.consistent') : t(lang, 'geo.nap.inconsistent'),
      phoneConsistency,
      phoneConsistencyLabel: t(lang, 'geo.nap.phoneConsistency'),
      phoneConsistencyValue: phoneConsistency ? t(lang, 'geo.nap.consistent') : t(lang, 'geo.nap.inconsistent'),
      issues,
    };
  }

  analyzeCitationIssues(businessInfo, competitors, lang = 'en') {
    const missingCitations = [];
    const inconsistentData = [];

    if (!businessInfo) {
      return {
        missingCitationsLabel: t(lang, 'geo.citations.missingCitations'),
        missingCitations: [t(lang, 'geo.citations.notFoundInLocalPack')],
        inconsistentDataLabel: t(lang, 'geo.citations.inconsistentData'),
        inconsistentData: [],
      };
    }

    if (!businessInfo.website) {
      missingCitations.push(t(lang, 'geo.citations.websiteNotListed'));
    }

    if (!businessInfo.category) {
      missingCitations.push(t(lang, 'geo.citations.categoryNotSpecified'));
    }

    const topCompetitors = competitors.slice(0, 3);
    const competitorWebsites = topCompetitors.filter(c => c.website).length;
    const competitorCategories = topCompetitors.filter(c => c.category).length;

    if (competitorWebsites > 0 && !businessInfo.website) {
      inconsistentData.push(t(lang, 'geo.citations.competitorsHaveWebsite'));
    }

    if (competitorCategories > 0 && !businessInfo.category) {
      inconsistentData.push(t(lang, 'geo.citations.competitorsHaveCategory'));
    }

    return {
      missingCitationsLabel: t(lang, 'geo.citations.missingCitations'),
      missingCitations,
      inconsistentDataLabel: t(lang, 'geo.citations.inconsistentData'),
      inconsistentData,
    };
  }
}

export const geoAuditService = new GeoAuditService();
