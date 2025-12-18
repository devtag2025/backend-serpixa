import axios from 'axios';
import { env } from '../config/index.js';
import { ApiError, getGoogleDomain, getLanguageName, parseLocale } from '../utils/index.js';
import { Logger } from '../utils/logger.js';
import { t } from '../locales/index.js';
import { getLocaleConfig, DEFAULT_LOCALE } from '../config/index.js';

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
   * Run geo audit using Google Maps API
   * @param {string} keyword - Search keyword
   * @param {string} city - City name
   * @param {string} country - Country name
   * @param {string} googleDomain - Google domain (e.g., 'google.be', 'google.fr')
   * @param {string} language - Language code (e.g., 'fr', 'en', 'nl')
   * @param {string} locale - Locale code (e.g., 'fr-be', 'en', 'nl-nl')
   * @returns {Promise<Object>} Audit result with local visibility score, competitors, and recommendations
   */
  async runGeoAudit(keyword, city, country, googleDomain = null, language = null, locale = DEFAULT_LOCALE) {
    try {
      // Get language name for DataForSEO API
      const languageName = language ? getLanguageName(language) : 'English';
      
      // Construct location_name as "City,Country" (no space after comma as per DataForSEO format)
      const locationName = `${city},${country}`;

      // Auto-detect googleDomain from country if not provided
      let finalGoogleDomain = googleDomain;
      if (!finalGoogleDomain && country) {
        const countryLower = country.toLowerCase();
        const domainMap = {
          'belgium': 'google.be',
          'france': 'google.fr',
          'netherlands': 'google.nl',
          'germany': 'google.de',
          'spain': 'google.es',
          'italy': 'google.it',
          'united kingdom': 'google.co.uk',
          'uk': 'google.co.uk',
          'united states': 'google.com',
          'us': 'google.com',
          'usa': 'google.com',
        };
        finalGoogleDomain = domainMap[countryLower] || 'google.com';
      }

      // Fetch data from Google Maps API
      const mapsData = await this.fetchMapsData(keyword, locationName, languageName, finalGoogleDomain);

      // Extract language code from locale for translations
      const localeConfig = getLocaleConfig(locale);
      const lang = localeConfig.language || 'en';

      // Transform and return results (no business name needed)
      return this.transformMapsResult(mapsData, keyword, locationName, lang);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, `Geo audit failed: ${error.message}`);
    }
  }

  /**
   * Fetch data from DataForSEO Google Maps API
   * Uses only the 4 required parameters: keyword, location_name, language_name, se_domain
   * @param {string} keyword - Search keyword
   * @param {string} locationName - Location in format "City,Country" (e.g., "Brussels,Belgium")
   * @param {string} languageName - Language name (e.g., "French", "English")
   * @param {string} googleDomain - Google domain (e.g., "google.be", "google.fr") - optional
   * @returns {Promise<Object>} Maps API response data
   */
  async fetchMapsData(keyword, locationName, languageName, googleDomain = null) {
    if (!this.login || !this.password) {
      throw new ApiError(500, 'DataForSEO credentials not configured');
    }

    try {
      // Build payload with only the 4 required parameters
      const payload = [{
        keyword: keyword.trim(),
        location_name: locationName,
        language_name: languageName,
      }];

      // Add se_domain only if provided (optional)
      if (googleDomain && googleDomain !== 'google.com') {
        payload[0].se_domain = googleDomain;
      }

      Logger.log('Sending request to DataForSEO Google Maps API:', {
        endpoint: '/v3/serp/google/maps/live/advanced',
        keyword: keyword.trim(),
        location_name: locationName,
        language_name: languageName,
        se_domain: googleDomain || 'not set',
      });

      const response = await this.client.post('/v3/serp/google/maps/live/advanced', payload);

      Logger.log('DataForSEO Maps API Response Status:', response.status);

      // Handle response structure
      let result;
      if (Array.isArray(response.data)) {
        if (response.data.length === 0) {
          throw new ApiError(502, 'No Maps data received');
        }
        result = response.data[0];
      } else if (response.data?.status_code !== undefined) {
        result = response.data;
      } else {
        Logger.error('Unexpected Maps API response structure:', typeof response.data);
        throw new ApiError(502, 'Unexpected API response structure');
      }

      // Check for API errors
      if (result.status_code !== 20000) {
        throw new ApiError(502, result.status_message || 'DataForSEO Maps API error');
      }

      const task = result.tasks?.[0];
      if (!task || task.status_code !== 20000) {
        const errorMsg = task?.status_message || 'Maps data fetch failed';
        Logger.error('DataForSEO Maps task error:', errorMsg, 'Code:', task?.status_code);
        
        // Provide helpful error messages
        if (errorMsg.includes('location_name') || errorMsg.includes('Invalid Field')) {
          throw new ApiError(400, `Invalid location: "${locationName}". Please use format "City,Country" (e.g., "Brussels,Belgium", "Paris,France"). Error: ${errorMsg}`);
        }
        
        throw new ApiError(502, errorMsg);
      }

      // Extract result data
      let mapsData;
      if (Array.isArray(task.result)) {
        mapsData = task.result[0];
      } else if (task.result) {
        mapsData = task.result;
      } else {
        throw new ApiError(502, 'No Maps result data found');
      }


      // Extract business listings from maps results
      const items = mapsData?.items || [];
      const businessItems = items.filter(item => 
        item.type === 'maps_results' || 
        item.type === 'local_pack' ||
        item.type === 'map' ||
        (item.title && (item.rating || item.reviews_count))
      );

      Logger.log('Business items found:', businessItems.length);

      return {
        items: businessItems,
        keyword: keyword,
        location: locationName,
        language: languageName,
        google_domain: googleDomain,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;

      if (error.response) {
        const statusCode = error.response.status;
        if (statusCode === 401) {
          Logger.error('DataForSEO authentication failed. Please check your credentials.');
          throw new ApiError(401, 'DataForSEO authentication failed. Please check your credentials in .env file');
        }
        throw new ApiError(statusCode, error.response.data?.message || 'Maps API request failed');
      }

      throw new ApiError(502, `Maps data fetch failed: ${error.message}`);
    }
  }

  /**
   * Transform Maps API response into audit result
   * Returns: local visibility score, competitors, and recommendations
   * No business info required - score is based on competitors analysis
   * @param {string} lang - Language code for translations (e.g., 'en', 'fr', 'nl')
   */
  transformMapsResult(data, keyword, location, lang = 'en') {
    if (!data || !data.items || data.items.length === 0) {
      return {
        keyword,
        location,
        localVisibilityScore: 0,
        competitors: [],
        recommendations: [{
          priority: 'high',
          issue: t(lang, 'geo.recommendations.noResults.issue'),
          action: t(lang, 'geo.recommendations.noResults.action'),
        }],
        napIssues: {
          nameConsistency: true,
          addressConsistency: true,
          phoneConsistency: true,
          issues: [],
        },
        citationIssues: {
          missingCitations: [],
          inconsistentData: [],
        },
        raw: data,
      };
    }

    // Extract competitors from maps results
    const competitors = [];
    data.items.forEach((item, index) => {
      // Handle items that may have nested items array
      if (item.items && Array.isArray(item.items)) {
        item.items.forEach((nestedItem) => {
          competitors.push({
            position: competitors.length + 1,
            name: nestedItem.title || nestedItem.name || '',
            rating: nestedItem.rating?.value || nestedItem.rating || null,
            reviews: nestedItem.reviews_count || nestedItem.reviews || 0,
            distance: nestedItem.distance || null,
            address: nestedItem.address || nestedItem.address_lines?.join(', ') || '',
            phone: nestedItem.phone || null,
            website: nestedItem.website || null,
            category: nestedItem.category || nestedItem.type || null,
            placeId: nestedItem.place_id || null,
          });
        });
      } else {
        competitors.push({
          position: competitors.length + 1,
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
    });

    // Calculate local visibility score based on competitors analysis (no business info needed)
    const localVisibilityScore = this.calculateLocalVisibilityScore(competitors);

    // Generate recommendations based on competitors
    const recommendations = this.generateRecommendations(competitors, lang);

    // Analyze NAP consistency from competitors
    const napIssues = this.analyzeNAPConsistency(competitors, lang);

    // Analyze citation issues from competitors
    const citationIssues = this.analyzeCitationIssues(competitors, lang);

    return {
      keyword,
      location,
      localVisibilityScore,
      competitors,
      recommendations,
      napIssues,
      citationIssues,
      raw: data,
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
   * Generate recommendations for citation and NAP improvement
   * Based on competitors analysis
   * @param {string} lang - Language code for translations (e.g., 'en', 'fr', 'nl')
   */
  generateRecommendations(competitors, lang = 'en') {
    const recommendations = [];

    if (!competitors || competitors.length === 0) {
      return recommendations;
    }

    // Helper to add recommendation with translations
    const addRec = (priority, issueKey, actionKey, vars = {}) => {
      const issue = t(lang, `geo.recommendations.${issueKey}.issue`, vars);
      const action = t(lang, `geo.recommendations.${issueKey}.action`, vars);
      if (issue && action && !issue.includes('.issue')) {
        recommendations.push({
          priority,
          issue,
          action,
        });
      }
    };

    // Analyze competitor ratings
    const ratings = competitors.filter(c => c.rating).map(c => c.rating);
    if (ratings.length > 0) {
      const avgRating = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;

      if (avgRating >= 4.5) {
        addRec('high', 'highCompetition', 'highCompetition', { avgRating: avgRating.toFixed(1) });
      } else if (avgRating < 3.5) {
        addRec('medium', 'marketOpportunity', 'marketOpportunity', { avgRating: avgRating.toFixed(1) });
      }
    }

    // Analyze review counts
    const reviews = competitors.filter(c => c.reviews).map(c => c.reviews);
    if (reviews.length > 0) {
      const avgReviews = reviews.reduce((sum, r) => sum + r, 0) / reviews.length;

      if (avgReviews > 50) {
        addRec('high', 'competitiveMarket', 'competitiveMarket', { avgReviews: Math.round(avgReviews) });
      }
    }

    // Analyze NAP completeness
    const competitorsWithNAP = competitors.filter(c => c.name && c.address && c.phone).length;
    const napCompleteness = (competitorsWithNAP / competitors.length) * 100;

    if (napCompleteness < 80) {
      addRec('medium', 'napIncomplete', 'napIncomplete', { percentage: Math.round(100 - napCompleteness) });
    } else {
      addRec('high', 'napComplete', 'napComplete');
    }

    // Analyze website presence
    const competitorsWithWebsite = competitors.filter(c => c.website).length;
    const websitePercentage = (competitorsWithWebsite / competitors.length) * 100;

    if (websitePercentage > 70) {
      addRec('high', 'competitorsHaveWebsite', 'competitorsHaveWebsite', { percentage: Math.round(websitePercentage) });
    }

    // Analyze category consistency
    const competitorsWithCategory = competitors.filter(c => c.category).length;
    if (competitorsWithCategory < competitors.length * 0.8) {
      addRec('medium', 'missingCategory', 'missingCategory');
    }

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
   * Analyze citation issues from competitors
   * @param {string} lang - Language code for translations (e.g., 'en', 'fr', 'nl')
   */
  analyzeCitationIssues(competitors, lang = 'en') {
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

    if (websitePercentage < 50) {
      missingCitations.push(t(lang, 'geo.citationIssues.missingWebsite', { percentage: Math.round(100 - websitePercentage) }));
    } else if (websitePercentage >= 80) {
      inconsistentData.push(t(lang, 'geo.citationIssues.competitorsHaveWebsite', { percentage: Math.round(websitePercentage) }));
    }

    // Analyze category presence
    const competitorsWithCategory = competitors.filter(c => c.category).length;
    const categoryPercentage = (competitorsWithCategory / competitors.length) * 100;

    if (categoryPercentage < 70) {
      missingCitations.push(t(lang, 'geo.citationIssues.missingCategory', { percentage: Math.round(100 - categoryPercentage) }));
    }

    // Analyze top competitors
    const topCompetitors = competitors.slice(0, 10);
    const topWithWebsite = topCompetitors.filter(c => c.website).length;
    const topWithCategory = topCompetitors.filter(c => c.category).length;

    if (topWithWebsite >= 8 && websitePercentage < 80) {
      inconsistentData.push(t(lang, 'geo.citationIssues.topCompetitorsHaveWebsite'));
    }

    if (topWithCategory >= 8 && categoryPercentage < 80) {
      inconsistentData.push(t(lang, 'geo.citationIssues.topCompetitorsHaveCategory'));
    }

    return {
      missingCitations,
      inconsistentData,
    };
  }
}

export const geoAuditService = new GeoAuditService();
