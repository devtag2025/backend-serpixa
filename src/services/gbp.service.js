import axios from 'axios';
import { env, getLocaleConfig, DEFAULT_LOCALE } from '../config/index.js';
import { ApiError } from '../utils/index.js';
import { Logger } from '../utils/logger.js';
import { t } from '../locales/index.js';

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

  async runAudit(businessName, locale = DEFAULT_LOCALE) {
    try {
      const localeConfig = getLocaleConfig(locale);
      const lang = localeConfig.language || 'en';

      const gbpData = await this.fetchGBPData(
        businessName,
        localeConfig.locationName,
        localeConfig.languageCode
      );

      return this.transformResult(gbpData, businessName, lang);
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

  transformResult(data, businessName, lang = 'en') {
    if (!data) {
      return {
        businessName,
        found: false,
        score: 0,
        scoreLabel: t(lang, 'gbp.labels.completenessScore'),
        businessInfo: {},
        businessInfoLabel: t(lang, 'gbp.labels.businessInfo'),
        checklist: this.generateEmptyChecklist(lang),
        checklistLabel: t(lang, 'gbp.labels.profileChecklist'),
        recommendations: [
          {
            priority: 'high',
            issue: t(lang, 'gbp.recommendations.notFound.issue'),
            action: t(lang, 'gbp.recommendations.notFound.action'),
          },
        ],
        raw: null,
      };
    }

    const businessInfo = {
      name: data.title || null,
      nameLabel: t(lang, 'gbp.labels.name'),
      address: data.address || null,
      addressLabel: t(lang, 'gbp.labels.address'),
      addressComponents: data.address_info || null,
      phone: data.phone || null,
      phoneLabel: t(lang, 'gbp.labels.phone'),
      website: data.url || null,
      websiteLabel: t(lang, 'gbp.labels.website'),
      category: data.category || null,
      categoryLabel: t(lang, 'gbp.labels.category'),
      additionalCategories: data.additional_categories || [],
      description: data.description || null,
      hours: data.work_hours || null,
      rating: data.rating?.value || null,
      ratingLabel: t(lang, 'gbp.labels.rating'),
      reviewCount: data.rating?.votes_count || 0,
      reviewsLabel: t(lang, 'gbp.labels.reviews'),
      priceLevel: data.price_level || null,
      attributes: data.attributes?.available_attributes || null,
      photos: data.main_image ? 1 : 0,
      latitude: data.latitude || null,
      longitude: data.longitude || null,
      placeId: data.place_id || null,
    };

    const checklist = this.generateChecklist(businessInfo, lang);
    const score = this.calculateScore(checklist);
    const recommendations = this.generateRecommendations(checklist, businessInfo, lang);

    return {
      businessName,
      found: true,
      placeId: data.place_id || null,
      score,
      scoreLabel: t(lang, 'gbp.labels.completenessScore'),
      businessInfo,
      businessInfoLabel: t(lang, 'gbp.labels.businessInfo'),
      checklist,
      checklistLabel: t(lang, 'gbp.labels.profileChecklist'),
      recommendations,
      raw: data,
    };
  }

  generateChecklist(info, lang = 'en') {
    const complete = t(lang, 'gbp.labels.complete');
    const incomplete = t(lang, 'gbp.labels.incomplete');
    const chars = t(lang, 'common.chars');
    const set = t(lang, 'common.set');
    const notSet = t(lang, 'common.notSet');

    return [
      { field: 'name', label: t(lang, 'gbp.checklist.name'), completed: !!info.name, completedLabel: !!info.name ? complete : incomplete, value: info.name },
      { field: 'address', label: t(lang, 'gbp.checklist.address'), completed: !!info.address, completedLabel: !!info.address ? complete : incomplete, value: info.address },
      { field: 'phone', label: t(lang, 'gbp.checklist.phone'), completed: !!info.phone, completedLabel: !!info.phone ? complete : incomplete, value: info.phone },
      { field: 'website', label: t(lang, 'gbp.checklist.website'), completed: !!info.website, completedLabel: !!info.website ? complete : incomplete, value: info.website },
      { field: 'category', label: t(lang, 'gbp.checklist.category'), completed: !!info.category, completedLabel: !!info.category ? complete : incomplete, value: info.category },
      { field: 'additionalCategories', label: t(lang, 'gbp.checklist.additionalCategories'), completed: info.additionalCategories?.length > 0, completedLabel: info.additionalCategories?.length > 0 ? complete : incomplete, value: info.additionalCategories?.length || 0 },
      { field: 'description', label: t(lang, 'gbp.checklist.description'), completed: !!info.description, completedLabel: !!info.description ? complete : incomplete, value: info.description ? `${info.description.length} ${chars}` : null },
      { field: 'hours', label: t(lang, 'gbp.checklist.hours'), completed: !!info.hours && Object.keys(info.hours).length > 0, completedLabel: (!!info.hours && Object.keys(info.hours).length > 0) ? complete : incomplete, value: info.hours ? set : notSet },
      { field: 'photos', label: t(lang, 'gbp.checklist.photos'), completed: info.photos > 0, completedLabel: info.photos > 0 ? complete : incomplete, value: info.photos },
      { field: 'rating', label: t(lang, 'gbp.checklist.rating'), completed: info.rating !== null, completedLabel: info.rating !== null ? complete : incomplete, value: info.rating ? `${info.rating}/5` : null },
      { field: 'reviewCount', label: t(lang, 'gbp.checklist.reviewCount'), completed: info.reviewCount >= 5, completedLabel: info.reviewCount >= 5 ? complete : incomplete, value: info.reviewCount },
      { field: 'attributes', label: t(lang, 'gbp.checklist.attributes'), completed: info.attributes && (Array.isArray(info.attributes) ? info.attributes.length > 0 : Object.keys(info.attributes).length > 0), completedLabel: (info.attributes && (Array.isArray(info.attributes) ? info.attributes.length > 0 : Object.keys(info.attributes).length > 0)) ? complete : incomplete, value: Array.isArray(info.attributes) ? info.attributes.length : (info.attributes ? Object.keys(info.attributes).length : 0) },
    ];
  }

  generateEmptyChecklist(lang = 'en') {
    const incomplete = t(lang, 'gbp.labels.incomplete');

    return [
      { field: 'name', label: t(lang, 'gbp.checklist.name'), completed: false, completedLabel: incomplete, value: null },
      { field: 'address', label: t(lang, 'gbp.checklist.address'), completed: false, completedLabel: incomplete, value: null },
      { field: 'phone', label: t(lang, 'gbp.checklist.phone'), completed: false, completedLabel: incomplete, value: null },
      { field: 'website', label: t(lang, 'gbp.checklist.website'), completed: false, completedLabel: incomplete, value: null },
      { field: 'category', label: t(lang, 'gbp.checklist.category'), completed: false, completedLabel: incomplete, value: null },
      { field: 'additionalCategories', label: t(lang, 'gbp.checklist.additionalCategories'), completed: false, completedLabel: incomplete, value: null },
      { field: 'description', label: t(lang, 'gbp.checklist.description'), completed: false, completedLabel: incomplete, value: null },
      { field: 'hours', label: t(lang, 'gbp.checklist.hours'), completed: false, completedLabel: incomplete, value: null },
      { field: 'photos', label: t(lang, 'gbp.checklist.photos'), completed: false, completedLabel: incomplete, value: null },
      { field: 'rating', label: t(lang, 'gbp.checklist.rating'), completed: false, completedLabel: incomplete, value: null },
      { field: 'reviewCount', label: t(lang, 'gbp.checklist.reviewCount'), completed: false, completedLabel: incomplete, value: null },
      { field: 'attributes', label: t(lang, 'gbp.checklist.attributes'), completed: false, completedLabel: incomplete, value: null },
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

  generateRecommendations(checklist, info, lang = 'en') {
    const recommendations = [];
    const incompleteItems = checklist.filter(item => !item.completed);

    // Add recommendations for incomplete items
    for (const item of incompleteItems) {
      const recKey = `gbp.recommendations.${item.field}`;
      const issue = t(lang, `${recKey}.issue`);
      const action = t(lang, `${recKey}.action`);

      if (issue && action && issue !== `${recKey}.issue`) {
        const priority = ['name', 'address', 'phone', 'website', 'category', 'hours'].includes(item.field)
          ? 'high'
          : ['additionalCategories', 'description', 'photos', 'reviewCount'].includes(item.field)
            ? 'medium'
            : 'low';

        recommendations.push({ priority, issue, action });
      }
    }

    // Additional context-based recommendations
    if (info.reviewCount > 0 && info.reviewCount < 10) {
      recommendations.push({
        priority: 'medium',
        issue: t(lang, 'gbp.recommendations.lowReviews.issue', { count: info.reviewCount }),
        action: t(lang, 'gbp.recommendations.lowReviews.action'),
      });
    }

    if (info.rating && info.rating < 4) {
      recommendations.push({
        priority: 'high',
        issue: t(lang, 'gbp.recommendations.lowRating.issue', { rating: info.rating }),
        action: t(lang, 'gbp.recommendations.lowRating.action'),
      });
    }

    if (info.description && info.description.length < 250) {
      recommendations.push({
        priority: 'low',
        issue: t(lang, 'gbp.recommendations.shortDescription.issue'),
        action: t(lang, 'gbp.recommendations.shortDescription.action'),
      });
    }

    return recommendations;
  }
}

export const gbpService = new GBPService();