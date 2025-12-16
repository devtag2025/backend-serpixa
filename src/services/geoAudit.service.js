import axios from 'axios';
import { env } from '../config/index.js';
import { ApiError, getGoogleDomain, getLanguageName, parseLocale } from '../utils/index.js';
import { Logger } from '../utils/logger.js';

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
   * @returns {Promise<Object>} Audit result with local visibility score, competitors, and recommendations
   */
  async runGeoAudit(keyword, city, country, googleDomain = null, language = null) {
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

      // Transform and return results (no business name needed)
      return this.transformMapsResult(mapsData, keyword, locationName);
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
          Logger.warn('DataForSEO Maps API returned empty array');
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
        Logger.error('DataForSEO Maps API error:', result.status_message, 'Code:', result.status_code);
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
        Logger.error('No Maps result data found in task:', JSON.stringify(task, null, 2));
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
        const errorMessage = error.response.data?.message || error.response.statusText || 'DataForSEO Maps API request failed';

        if (statusCode === 401) {
          Logger.error('DataForSEO authentication failed. Please check your credentials.');
          throw new ApiError(401, 'DataForSEO authentication failed. Please check your credentials in .env file');
        }

        Logger.error('DataForSEO Maps API error response:', {
          status: statusCode,
          data: error.response.data,
        });
        throw new ApiError(statusCode, errorMessage);
      }

      Logger.error('Maps data fetch failed:', error.message);
      throw new ApiError(502, `Maps data fetch failed: ${error.message}`);
    }
  }

  /**
   * Transform Maps API response into audit result
   * Returns: local visibility score, competitors, and recommendations
   * No business info required - score is based on competitors analysis
   */
  transformMapsResult(data, keyword, location) {
    if (!data || !data.items || data.items.length === 0) {
      return {
        keyword,
        location,
        localVisibilityScore: 0,
        competitors: [],
        recommendations: [{
          priority: 'high',
          issue: 'No local pack results found for this keyword and location',
          action: 'Try using a more specific location or a keyword that typically shows local results',
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
    const recommendations = this.generateRecommendations(competitors);

    // Analyze NAP consistency from competitors
    const napIssues = this.analyzeNAPConsistency(competitors);

    // Analyze citation issues from competitors
    const citationIssues = this.analyzeCitationIssues(competitors);

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
   */
  generateRecommendations(competitors) {
    const recommendations = [];

    if (!competitors || competitors.length === 0) {
      return recommendations;
    }

    // Analyze competitor ratings
    const ratings = competitors.filter(c => c.rating).map(c => c.rating);
    if (ratings.length > 0) {
      const avgRating = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
      const minRating = Math.min(...ratings);
      const maxRating = Math.max(...ratings);

      if (avgRating >= 4.5) {
        recommendations.push({
          priority: 'high',
          issue: `High competition: Average competitor rating is ${avgRating.toFixed(1)}/5`,
          action: 'Focus on maintaining excellent service quality and customer satisfaction to compete effectively',
        });
      } else if (avgRating < 3.5) {
        recommendations.push({
          priority: 'medium',
          issue: `Market opportunity: Average competitor rating is ${avgRating.toFixed(1)}/5`,
          action: 'There is room to stand out by providing better service quality than competitors',
        });
      }
    }

    // Analyze review counts
    const reviews = competitors.filter(c => c.reviews).map(c => c.reviews);
    if (reviews.length > 0) {
      const avgReviews = reviews.reduce((sum, r) => sum + r, 0) / reviews.length;
      const maxReviews = Math.max(...reviews);

      if (avgReviews > 50) {
        recommendations.push({
          priority: 'high',
          issue: `Competitive market: Competitors average ${Math.round(avgReviews)} reviews`,
          action: 'Implement an active review generation strategy to build social proof and compete effectively',
        });
      }
    }

    // Analyze NAP completeness
    const competitorsWithNAP = competitors.filter(c => c.name && c.address && c.phone).length;
    const napCompleteness = (competitorsWithNAP / competitors.length) * 100;

    if (napCompleteness < 80) {
      recommendations.push({
        priority: 'medium',
        issue: `${Math.round(100 - napCompleteness)}% of competitors are missing complete NAP information`,
        action: 'Ensure your business has complete Name, Address, and Phone information to improve visibility',
      });
    } else {
      recommendations.push({
        priority: 'high',
        issue: 'Most competitors have complete NAP information',
        action: 'Ensure your NAP (Name, Address, Phone) is complete and consistent across all platforms to compete effectively',
      });
    }

    // Analyze website presence
    const competitorsWithWebsite = competitors.filter(c => c.website).length;
    const websitePercentage = (competitorsWithWebsite / competitors.length) * 100;

    if (websitePercentage > 70) {
      recommendations.push({
        priority: 'high',
        issue: `${Math.round(websitePercentage)}% of competitors have websites listed`,
        action: 'Add your website URL to your Google Business Profile to match competitor standards',
      });
    }

    // Analyze category consistency
    const competitorsWithCategory = competitors.filter(c => c.category).length;
    if (competitorsWithCategory < competitors.length * 0.8) {
      recommendations.push({
        priority: 'medium',
        issue: 'Some competitors are missing category information',
        action: 'Ensure your business category is properly set in your Google Business Profile',
      });
    }

    return recommendations;
  }

  /**
   * Analyze NAP (Name, Address, Phone) consistency from competitors
   */
  analyzeNAPConsistency(competitors) {
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
      issues.push(`${Math.round(100 - namePercentage)}% of competitors are missing business names`);
    }
    if (!addressConsistency) {
      issues.push(`${Math.round(100 - addressPercentage)}% of competitors are missing addresses`);
    }
    if (!phoneConsistency) {
      issues.push(`${Math.round(100 - phonePercentage)}% of competitors are missing phone numbers`);
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
   */
  analyzeCitationIssues(competitors) {
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
      missingCitations.push(`${Math.round(100 - websitePercentage)}% of competitors are missing website URLs`);
    } else if (websitePercentage >= 80) {
      inconsistentData.push(`Most competitors (${Math.round(websitePercentage)}%) have websites listed - ensure yours is included`);
    }

    // Analyze category presence
    const competitorsWithCategory = competitors.filter(c => c.category).length;
    const categoryPercentage = (competitorsWithCategory / competitors.length) * 100;

    if (categoryPercentage < 70) {
      missingCitations.push(`${Math.round(100 - categoryPercentage)}% of competitors are missing category information`);
    }

    // Analyze top competitors
    const topCompetitors = competitors.slice(0, 10);
    const topWithWebsite = topCompetitors.filter(c => c.website).length;
    const topWithCategory = topCompetitors.filter(c => c.category).length;

    if (topWithWebsite >= 8 && websitePercentage < 80) {
      inconsistentData.push('Top competitors have websites - ensure your website is listed to compete effectively');
    }

    if (topWithCategory >= 8 && categoryPercentage < 80) {
      inconsistentData.push('Top competitors have categories - ensure your category is properly set');
    }

    return {
      missingCitations,
      inconsistentData,
    };
  }
}

export const geoAuditService = new GeoAuditService();
