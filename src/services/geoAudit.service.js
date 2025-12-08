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
      return {
        keyword,
        location,
        businessName,
        localVisibilityScore: 0,
        localVisibilityScoreLabel: t(lang, 'geo.labels.localVisibilityScore'),
        businessInfo: null,
        businessInfoLabel: t(lang, 'geo.labels.businessInfo'),
        competitors: [],
        competitorsLabel: t(lang, 'geo.labels.competitors'),
        recommendations: [],
        napIssues: {
          nameConsistency: true,
          nameConsistencyLabel: t(lang, 'geo.nap.nameConsistency'),
          nameConsistencyValue: t(lang, 'geo.nap.consistent'),
          addressConsistency: true,
          addressConsistencyLabel: t(lang, 'geo.nap.addressConsistency'),
          addressConsistencyValue: t(lang, 'geo.nap.consistent'),
          phoneConsistency: true,
          phoneConsistencyLabel: t(lang, 'geo.nap.phoneConsistency'),
          phoneConsistencyValue: t(lang, 'geo.nap.consistent'),
          issues: [],
        },
        napIssuesLabel: t(lang, 'geo.labels.napConsistency'),
        citationIssues: {
          missingCitationsLabel: t(lang, 'geo.citations.missingCitations'),
          missingCitations: [],
          inconsistentDataLabel: t(lang, 'geo.citations.inconsistentData'),
          inconsistentData: [],
        },
        citationIssuesLabel: t(lang, 'geo.labels.citations'),
        raw: null,
      };
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

    let businessInfo = null;
    let businessIndex = -1;

    // Build competitors list
    const competitors = [];

    if (localPackItems.length === 0) {
      return {
        keyword,
        location,
        businessName: businessName || keyword,
        localVisibilityScore: 0,
        localVisibilityScoreLabel: t(lang, 'geo.labels.localVisibilityScore'),
        businessInfo: null,
        businessInfoLabel: t(lang, 'geo.labels.businessInfo'),
        competitors: [],
        competitorsLabel: t(lang, 'geo.labels.competitors'),
        recommendations: [{
          priority: 'high',
          issue: t(lang, 'geo.recommendations.notInLocalPack.issue'),
          action: t(lang, 'geo.recommendations.notInLocalPack.action'),
        }],
        napIssues: {
          nameConsistency: true,
          nameConsistencyLabel: t(lang, 'geo.nap.nameConsistency'),
          nameConsistencyValue: t(lang, 'geo.nap.consistent'),
          addressConsistency: true,
          addressConsistencyLabel: t(lang, 'geo.nap.addressConsistency'),
          addressConsistencyValue: t(lang, 'geo.nap.consistent'),
          phoneConsistency: true,
          phoneConsistencyLabel: t(lang, 'geo.nap.phoneConsistency'),
          phoneConsistencyValue: t(lang, 'geo.nap.consistent'),
          issues: [t(lang, 'geo.nap.notFoundInLocalPack')],
        },
        napIssuesLabel: t(lang, 'geo.labels.napConsistency'),
        citationIssues: {
          missingCitationsLabel: t(lang, 'geo.citations.missingCitations'),
          missingCitations: [],
          inconsistentDataLabel: t(lang, 'geo.citations.inconsistentData'),
          inconsistentData: [],
        },
        citationIssuesLabel: t(lang, 'geo.labels.citations'),
        raw: data,
      };
    }

    // Competitor field labels (translated once)
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
          competitors.push({
            position: competitors.length + 1,
            ...competitorLabels,
            name: localItem.title || localItem.name || '',
            rating: localItem.rating?.value || localItem.rating || null,
            reviews: localItem.reviews_count || localItem.reviews || 0,
            distance: localItem.distance || null,
            address: localItem.address || localItem.address_lines?.join(', ') || '',
            phone: localItem.phone || null,
            website: localItem.website || null,
            category: localItem.category || localItem.type || null,
            placeId: localItem.place_id || null,
          });
        });
      } else {
        competitors.push({
          position: competitors.length + 1,
          ...competitorLabels,
          name: item.title || item.name || '',
          rating: item.rating?.value || item.rating || null,
          reviews: item.reviews_count || item.reviews || 0,
          distance: item.distance || null,
          address: item.address || item.address_lines?.join(', ') || '',
          phone: item.phone || null,
          website: item.website || null,
          category: item.category || item.type || null,
          placeId: item.place_id || null,
        });
      }
    }

    // Find business in competitors
    if (businessName) {
      const businessNameLower = businessName.toLowerCase();
      businessIndex = competitors.findIndex((comp) => {
        const compName = (comp.name || '').toLowerCase();
        return compName.includes(businessNameLower) || businessNameLower.includes(compName);
      });

      if (businessIndex >= 0) {
        businessInfo = {
          name: competitors[businessIndex].name,
          nameLabel: t(lang, 'geo.labels.name'),
          address: competitors[businessIndex].address,
          addressLabel: t(lang, 'geo.labels.address'),
          phone: competitors[businessIndex].phone,
          phoneLabel: t(lang, 'geo.labels.phone'),
          website: competitors[businessIndex].website,
          websiteLabel: t(lang, 'geo.labels.website'),
          rating: competitors[businessIndex].rating,
          ratingLabel: t(lang, 'geo.labels.rating'),
          reviews: competitors[businessIndex].reviews,
          reviewsLabel: t(lang, 'geo.labels.reviews'),
          category: competitors[businessIndex].category,
          categoryLabel: t(lang, 'geo.labels.category'),
          placeId: competitors[businessIndex].placeId,
        };
      }
    }

    const localVisibilityScore = this.calculateLocalVisibilityScore(businessIndex, competitors, businessInfo);
    const recommendations = this.generateRecommendations(businessInfo, competitors, businessIndex, lang);
    const napIssues = this.analyzeNAPConsistency(businessInfo, competitors, lang);
    const citationIssues = this.analyzeCitationIssues(businessInfo, competitors, lang);
    
    return {
      keyword,
      location,
      businessName: businessName || (businessInfo?.name || keyword),
      localVisibilityScore,
      localVisibilityScoreLabel: t(lang, 'geo.labels.localVisibilityScore'),
      businessInfo,
      businessInfoLabel: t(lang, 'geo.labels.businessInfo'),
      competitors,
      competitorsLabel: t(lang, 'geo.labels.competitors'),
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

  calculateLocalVisibilityScore(businessIndex, competitors, businessInfo) {
    let score = 0;

    if (businessIndex >= 0) {
      if (businessIndex === 0) score += 50;
      else if (businessIndex === 1) score += 40;
      else if (businessIndex === 2) score += 30;
      else if (businessIndex < 5) score += 20;
      else score += 10;
    } else {
      return 0;
    }

    if (businessInfo?.rating) {
      score += (businessInfo.rating / 5) * 25;
    }

    if (businessInfo?.reviews) {
      const reviewScore = Math.min(businessInfo.reviews / 100, 1) * 15;
      score += reviewScore;
    }

    let completeness = 0;
    if (businessInfo?.name) completeness += 2;
    if (businessInfo?.address) completeness += 2;
    if (businessInfo?.phone) completeness += 2;
    if (businessInfo?.website) completeness += 2;
    if (businessInfo?.category) completeness += 2;
    score += completeness;

    return Math.round(score);
  }

  generateRecommendations(businessInfo, competitors, businessIndex, lang = 'en') {
    const recommendations = [];

    // Position recommendations
    if (businessIndex < 0) {
      recommendations.push({
        priority: 'high',
        issue: t(lang, 'geo.recommendations.notInLocalPack.issue'),
        action: t(lang, 'geo.recommendations.notInLocalPack.action'),
      });
    } else if (businessIndex >= 3) {
      recommendations.push({
        priority: 'high',
        issue: t(lang, 'geo.recommendations.lowPosition.issue', { position: businessIndex + 1 }),
        action: t(lang, 'geo.recommendations.lowPosition.action'),
      });
    }

    // Rating recommendations
    if (businessInfo?.rating) {
      const avgCompetitorRating = competitors
        .filter(c => c.rating)
        .reduce((sum, c) => sum + c.rating, 0) / competitors.filter(c => c.rating).length || 0;

      if (businessInfo.rating < avgCompetitorRating) {
        recommendations.push({
          priority: 'high',
          issue: t(lang, 'geo.recommendations.competitorsBetterRating.issue'),
          action: t(lang, 'geo.recommendations.competitorsBetterRating.action'),
        });
      }

      if (businessInfo.rating < 4) {
        recommendations.push({
          priority: 'high',
          issue: t(lang, 'geo.recommendations.lowRating.issue', { rating: businessInfo.rating }),
          action: t(lang, 'geo.recommendations.lowRating.action'),
        });
      }
    }

    // Review recommendations
    if (businessInfo?.reviews !== undefined) {
      if (businessInfo.reviews === 0) {
        recommendations.push({
          priority: 'high',
          issue: t(lang, 'geo.recommendations.noReviews.issue'),
          action: t(lang, 'geo.recommendations.noReviews.action'),
        });
      } else if (businessInfo.reviews < 20) {
        recommendations.push({
          priority: 'medium',
          issue: t(lang, 'geo.recommendations.fewReviews.issue', { count: businessInfo.reviews }),
          action: t(lang, 'geo.recommendations.fewReviews.action'),
        });
      }

      const avgCompetitorReviews = competitors
        .filter(c => c.reviews)
        .reduce((sum, c) => sum + c.reviews, 0) / competitors.filter(c => c.reviews).length || 0;

      if (businessInfo.reviews < avgCompetitorReviews) {
        recommendations.push({
          priority: 'medium',
          issue: t(lang, 'geo.recommendations.competitorsMoreReviews.issue'),
          action: t(lang, 'geo.recommendations.competitorsMoreReviews.action'),
        });
      }
    }

    // NAP recommendations
    if (!businessInfo?.phone) {
      recommendations.push({
        priority: 'high',
        issue: t(lang, 'geo.recommendations.missingPhone.issue'),
        action: t(lang, 'geo.recommendations.missingPhone.action'),
      });
    }

    if (!businessInfo?.website) {
      recommendations.push({
        priority: 'medium',
        issue: t(lang, 'geo.recommendations.missingWebsite.issue'),
        action: t(lang, 'geo.recommendations.missingWebsite.action'),
      });
    }

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