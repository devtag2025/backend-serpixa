import axios from 'axios';
import { env } from '../config/index.js';
import { ApiError } from '../utils/index.js';
import { Logger } from '../utils/logger.js';

class GBPService {
  constructor() {
    this.login = env.DATAFORSEO_LOGIN || env.DATAFORSEO_EMAIL;
    this.password = env.DATAFORSEO_PASSWORD || env.DATAFORSEO_API_PASSWORD;
    this.baseURL = env.DATAFORSEO_API_URL || 'https://sandbox.dataforseo.com';

    if (!this.login || !this.password) {
      Logger.error('DataForSEO credentials not configured for GBP service');
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

  async runAudit(businessName, location = 'United States', languageCode = 'en') {
    try {
      const gbpData = await this.fetchGBPData(businessName, location, languageCode);
      return this.transformResult(gbpData, businessName);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, `GBP audit failed: ${error.message}`);
    }
  }

  async fetchGBPData(businessName, location, languageCode) {
    if (!this.login || !this.password) {
      throw new ApiError(500, 'DataForSEO credentials not configured');
    }

    try {
      const response = await this.client.post('/v3/business_data/google/my_business_info/live', [
        {
          keyword: businessName,
          location_name: location,
          language_code: languageCode,
        },
      ]);

      const result = response.data;

      if (result.status_code !== 20000) {
        Logger.error('GBP API error:', result.status_message);
        throw new ApiError(502, result.status_message || 'GBP API error');
      }

      const task = result.tasks?.[0];
      if (!task || task.status_code !== 20000) {
        Logger.error('GBP task error:', task?.status_message);
        throw new ApiError(502, task?.status_message || 'GBP audit failed');
      }

      const items = task.result?.[0]?.items || [];
      return items.length > 0 ? items[0] : null;
    } catch (error) {
      if (error instanceof ApiError) throw error;

      if (error.response) {
        const statusCode = error.response.status;
        if (statusCode === 401) {
          throw new ApiError(401, 'DataForSEO authentication failed');
        }
        throw new ApiError(statusCode, error.response.data?.message || 'GBP API request failed');
      }

      throw new ApiError(502, `GBP data fetch failed: ${error.message}`);
    }
  }

  transformResult(data, businessName) {
    if (!data) {
      return {
        businessName,
        found: false,
        score: 0,
        businessInfo: {},
        checklist: this.generateEmptyChecklist(),
        recommendations: [
          { priority: 'high', issue: 'Business not found', action: 'Verify the business name or create a Google Business Profile' }
        ],
        raw: null,
      };
    }

    const businessInfo = {
      name: data.title || null,
      address: data.address || null,
      addressComponents: data.address_info || null,
      phone: data.phone || null,
      website: data.url || null,
      category: data.category || null,
      additionalCategories: data.additional_categories || [],
      description: data.description || null,
      hours: data.work_hours || null,
      rating: data.rating?.value || null,
      reviewCount: data.rating?.votes_count || 0,
      priceLevel: data.price_level || null,
      attributes: data.attributes?.available_attributes || [],
      photos: data.main_image ? 1 : 0,
      latitude: data.latitude || null,
      longitude: data.longitude || null,
      placeId: data.place_id || null,
    };

    const checklist = this.generateChecklist(businessInfo);
    const score = this.calculateScore(checklist);
    const recommendations = this.generateRecommendations(checklist, businessInfo);

    return {
      businessName,
      found: true,
      placeId: data.place_id || null,
      score,
      businessInfo,
      checklist,
      recommendations,
      raw: data,
    };
  }

  generateChecklist(info) {
    return [
      { field: 'name', label: 'Business Name', completed: !!info.name, value: info.name },
      { field: 'address', label: 'Business Address', completed: !!info.address, value: info.address },
      { field: 'phone', label: 'Phone Number', completed: !!info.phone, value: info.phone },
      { field: 'website', label: 'Website URL', completed: !!info.website, value: info.website },
      { field: 'category', label: 'Primary Category', completed: !!info.category, value: info.category },
      { field: 'additionalCategories', label: 'Additional Categories', completed: info.additionalCategories?.length > 0, value: info.additionalCategories?.length || 0 },
      { field: 'description', label: 'Business Description', completed: !!info.description, value: info.description ? `${info.description.length} chars` : null },
      { field: 'hours', label: 'Business Hours', completed: !!info.hours && Object.keys(info.hours).length > 0, value: info.hours ? 'Set' : null },
      { field: 'photos', label: 'Photos', completed: info.photos > 0, value: info.photos },
      { field: 'rating', label: 'Google Rating', completed: info.rating !== null, value: info.rating ? `${info.rating}/5` : null },
      { field: 'reviewCount', label: 'Customer Reviews', completed: info.reviewCount >= 5, value: info.reviewCount },
      { field: 'attributes', label: 'Business Attributes', completed: info.attributes?.length > 0, value: info.attributes?.length || 0 },
    ];
  }

  generateEmptyChecklist() {
    return [
      { field: 'name', label: 'Business Name', completed: false, value: null },
      { field: 'address', label: 'Business Address', completed: false, value: null },
      { field: 'phone', label: 'Phone Number', completed: false, value: null },
      { field: 'website', label: 'Website URL', completed: false, value: null },
      { field: 'category', label: 'Primary Category', completed: false, value: null },
      { field: 'additionalCategories', label: 'Additional Categories', completed: false, value: null },
      { field: 'description', label: 'Business Description', completed: false, value: null },
      { field: 'hours', label: 'Business Hours', completed: false, value: null },
      { field: 'photos', label: 'Photos', completed: false, value: null },
      { field: 'rating', label: 'Google Rating', completed: false, value: null },
      { field: 'reviewCount', label: 'Customer Reviews', completed: false, value: null },
      { field: 'attributes', label: 'Business Attributes', completed: false, value: null },
    ];
  }

  calculateScore(checklist) {
    const weights = {
      name: 10,
      address: 15,
      phone: 10,
      website: 10,
      category: 10,
      additionalCategories: 5,
      description: 10,
      hours: 10,
      photos: 5,
      rating: 5,
      reviewCount: 5,
      attributes: 5,
    };

    let earnedPoints = 0;
    let totalPoints = 0;

    for (const item of checklist) {
      const weight = weights[item.field] || 5;
      totalPoints += weight;
      if (item.completed) {
        earnedPoints += weight;
      }
    }

    return Math.round((earnedPoints / totalPoints) * 100);
  }

  generateRecommendations(checklist, info) {
    const recommendations = [];
    const incompleteItems = checklist.filter(item => !item.completed);

    const recommendationMap = {
      name: { priority: 'high', issue: 'Missing business name', action: 'Add your official business name to your profile.' },
      address: { priority: 'high', issue: 'Missing business address', action: 'Add your complete business address for local search visibility.' },
      phone: { priority: 'high', issue: 'Missing phone number', action: 'Add a local phone number to enable customer calls.' },
      website: { priority: 'high', issue: 'Missing website URL', action: 'Link your website to drive traffic from your GBP listing.' },
      category: { priority: 'high', issue: 'Missing primary category', action: 'Select the most accurate primary category for your business.' },
      additionalCategories: { priority: 'medium', issue: 'No additional categories', action: 'Add 2-5 relevant secondary categories to improve visibility.' },
      description: { priority: 'medium', issue: 'Missing business description', action: 'Add a compelling description (750 chars max) with relevant keywords.' },
      hours: { priority: 'high', issue: 'Missing business hours', action: 'Set your operating hours to help customers know when to visit.' },
      photos: { priority: 'medium', issue: 'No photos uploaded', action: 'Add high-quality photos of your business, products, and team.' },
      rating: { priority: 'low', issue: 'No Google rating yet', action: 'Encourage customers to rate your business on Google.' },
      reviewCount: { priority: 'medium', issue: 'Less than 5 reviews', action: 'Build your review base by asking satisfied customers for feedback.' },
      attributes: { priority: 'low', issue: 'No business attributes set', action: 'Add relevant attributes (WiFi, accessibility, payment methods, etc.).' },
    };

    for (const item of incompleteItems) {
      if (recommendationMap[item.field]) {
        recommendations.push(recommendationMap[item.field]);
      }
    }

    if (info.reviewCount < 10 && info.reviewCount >= 0) {
      recommendations.push({
        priority: 'medium',
        issue: `Only ${info.reviewCount} reviews`,
        action: 'Encourage satisfied customers to leave reviews. Respond to all existing reviews promptly.',
      });
    }

    if (info.rating && info.rating < 4) {
      recommendations.push({
        priority: 'high',
        issue: `Rating is ${info.rating}/5`,
        action: 'Address negative reviews professionally. Improve service quality to boost ratings.',
      });
    }

    if (info.description && info.description.length < 250) {
      recommendations.push({
        priority: 'low',
        issue: 'Business description is short',
        action: 'Expand your description to 750+ characters with keywords and services offered.',
      });
    }

    return recommendations;
  }
}

export const gbpService = new GBPService();