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
   * Run geo audit using Google Local Finder API
   * @param {string} keyword - Search keyword
   * @param {string} city - City name
   * @param {string} region - Region/State name (optional)
   * @param {string} country - Country name
   * @param {string} googleDomain - Google domain (e.g., 'google.be', 'google.fr')
   * @param {string} language - Language code (e.g., 'fr', 'en', 'nl')
   * @param {string} locale - Locale code (e.g., 'fr-be', 'en', 'nl-nl')
   * @returns {Promise<Object>} Audit result with local visibility score, competitors, and actionable recommendations
   */
  async runGeoAudit(keyword, city, region = null, country, googleDomain = null, language = null, locale = DEFAULT_LOCALE) {
    try {
      // Get language name for DataForSEO API
      const languageName = language ? getLanguageName(language) : 'English';
      
      // Construct location_name as "City,Region,Country" or "City,Country" (no space after comma as per DataForSEO format)
      const locationName = region 
        ? `${city},${region},${country}`
        : `${city},${country}`;

      // Fetch data from Google Local Finder API
      const localFinderData = await this.fetchMapsData(keyword, locationName, languageName, googleDomain);

      // Extract language code from locale for translations
      const localeConfig = getLocaleConfig(locale);
      const lang = localeConfig.language || 'en';

      // Transform and return results with actionable recommendations
      return this.transformMapsResult(localFinderData, keyword, locationName, lang);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, `Geo audit failed: ${error.message}`);
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
    }];

    // Add se_domain only if provided (optional)
    if (googleDomain && googleDomain !== 'google.com') {
      payload[0].se_domain = googleDomain;
    }

    Logger.log('Sending request to DataForSEO Google Local Finder API:', {
      endpoint: '/v3/serp/google/local_finder/live/advanced',
      keyword: keyword.trim(),
      location_name: locationName,
      language_name: languageName,
      se_domain: googleDomain || 'not set',
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
   * Transform Local Finder API response into audit result
   * Returns: local visibility score, competitors, and actionable recommendations for website/page improvements
   * Recommendations tell users what to do to rank in top 10
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

    // Extract competitors from Local Finder results
    const competitors = [];
    data.items.forEach((item, index) => {
      // Handle Local Finder API structure - items may be nested or flat
      if (item.items && Array.isArray(item.items)) {
        item.items.forEach((nestedItem) => {
          competitors.push({
            position: competitors.length + 1,
            name: nestedItem.title || nestedItem.name || nestedItem.business_title || '',
            rating: nestedItem.rating?.value || nestedItem.rating || nestedItem.rating_value || null,
            reviews: nestedItem.reviews_count || nestedItem.reviews || nestedItem.review_count || 0,
            distance: nestedItem.distance || nestedItem.distance_text || null,
            address: nestedItem.address || nestedItem.address_lines?.join(', ') || nestedItem.address_text || '',
            phone: nestedItem.phone || nestedItem.phone_number || null,
            website: nestedItem.website || nestedItem.website_url || null,
            category: nestedItem.category || nestedItem.type || nestedItem.category_name || null,
            placeId: nestedItem.place_id || nestedItem.google_place_id || null,
          });
        });
      } else {
        competitors.push({
          position: competitors.length + 1,
          name: item.title || item.name || item.business_title || '',
          rating: item.rating?.value || item.rating || item.rating_value || null,
          reviews: item.reviews_count || item.reviews || item.review_count || 0,
          distance: item.distance || item.distance_text || null,
          address: item.address || item.address_lines?.join(', ') || item.address_text || '',
          phone: item.phone || item.phone_number || null,
          website: item.website || item.website_url || null,
          category: item.category || item.type || item.category_name || null,
          placeId: item.place_id || item.google_place_id || null,
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
      competitors: competitors.slice(0, 10), // Only return top 10 competitors
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
   * Generate actionable recommendations for website/page improvements
   * Based on competitors analysis - tells users what to do to rank in top 10
   * @param {string} lang - Language code for translations (e.g., 'en', 'fr', 'nl')
   */
  generateRecommendations(competitors, lang = 'en') {
    const recommendations = [];

    if (!competitors || competitors.length === 0) {
      return recommendations;
    }

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
    addRec('critical', 'content', 'localContentRequired', 'localContentRequired', 
      { keyword: competitors[0]?.name || 'your business' }, 'high', 'moderate');

    // === CRITICAL: Google Business Profile Optimization ===
    addRec('critical', 'gbp', 'gbpOptimizationRequired', 'gbpOptimizationRequired', {}, 'high', 'easy');

    // Analyze competitor ratings
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

      // Target rating for top 3
      if (top3AvgRating >= 4.5) {
        addRec('critical', 'reviews', 'top3RatingTarget', 'top3RatingTarget', 
          { targetRating: '4.5+', avgRating: top3AvgRating.toFixed(1) }, 'high', 'moderate');
      }
    }

    // Analyze review counts
    const reviews = competitors.filter(c => c.reviews).map(c => c.reviews);
    if (reviews.length > 0) {
      const avgReviews = reviews.reduce((sum, r) => sum + r, 0) / reviews.length;
      const top3AvgReviews = top3Competitors
        .filter(c => c.reviews)
        .map(c => c.reviews)
        .reduce((sum, r) => sum + r, 0) / Math.max(top3Competitors.filter(c => c.reviews).length, 1);

      if (top3AvgReviews > 50) {
        addRec('critical', 'reviews', 'top3ReviewTarget', 'top3ReviewTarget', 
          { targetReviews: Math.round(top3AvgReviews), avgReviews: Math.round(avgReviews) }, 'high', 'moderate');
      } else if (avgReviews > 50) {
        addRec('high', 'reviews', 'competitiveMarket', 'competitiveMarket', 
          { avgReviews: Math.round(avgReviews) }, 'high', 'moderate');
      }
    }

    // === HIGH PRIORITY: NAP Consistency ===
    const competitorsWithNAP = competitors.filter(c => c.name && c.address && c.phone).length;
    const napCompleteness = (competitorsWithNAP / competitors.length) * 100;
    const top3WithNAP = top3Competitors.filter(c => c.name && c.address && c.phone).length;

    if (top3WithNAP === 3) {
      addRec('high', 'citations', 'top3NAPComplete', 'top3NAPComplete', {}, 'high', 'easy');
    } else if (napCompleteness < 80) {
      addRec('high', 'citations', 'napIncomplete', 'napIncomplete', 
        { percentage: Math.round(100 - napCompleteness) }, 'high', 'easy');
    }

    // === HIGH PRIORITY: Local Citations ===
    addRec('high', 'citations', 'buildLocalCitations', 'buildLocalCitations', 
      { count: '30+' }, 'high', 'moderate');

    // === HIGH PRIORITY: Website Local SEO Elements ===
    addRec('high', 'website', 'localSeoElements', 'localSeoElements', {}, 'high', 'moderate');

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
