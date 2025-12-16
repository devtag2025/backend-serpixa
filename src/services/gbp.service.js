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
        profileStrength: 'poor',
        profileStrengthLabel: t(lang, 'gbp.labels.profileStrength'),
        businessInfo: {},
        businessInfoLabel: t(lang, 'gbp.labels.businessInfo'),
        checklist: this.generateEmptyChecklist(lang),
        checklistLabel: t(lang, 'gbp.labels.profileChecklist'),
        recommendations: [
          {
            priority: 'critical',
            category: 'setup',
            issue: t(lang, 'gbp.recommendations.notFound.issue'),
            action: t(lang, 'gbp.recommendations.notFound.action'),
            impact: 'high',
            effort: 'moderate',
          },
        ],
        raw: null,
      };
    }

    const businessInfo = this.buildBusinessInfo(data, lang);
    const checklist = this.generateChecklist(businessInfo, lang);
    const score = this.calculateScore(checklist);
    const profileStrength = this.getProfileStrength(score);
    const recommendations = this.generateEnhancedRecommendations(checklist, businessInfo, score, lang);

    return {
      businessName,
      found: true,
      placeId: data.place_id || null,
      score,
      scoreLabel: t(lang, 'gbp.labels.completenessScore'),
      profileStrength,
      profileStrengthLabel: t(lang, 'gbp.labels.profileStrength'),
      businessInfo,
      businessInfoLabel: t(lang, 'gbp.labels.businessInfo'),
      checklist,
      checklistLabel: t(lang, 'gbp.labels.profileChecklist'),
      recommendations,
      raw: data,
    };
  }

  buildBusinessInfo(data, lang) {
    const photoCount = this.countPhotos(data);
    const descriptionLength = data.description?.length || 0;

    return {
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
      descriptionLength,
      hours: data.work_hours || null,
      rating: data.rating?.value || null,
      ratingLabel: t(lang, 'gbp.labels.rating'),
      reviewCount: data.rating?.votes_count || 0,
      reviewsLabel: t(lang, 'gbp.labels.reviews'),
      priceLevel: data.price_level || null,
      attributes: data.attributes?.available_attributes || null,
      photos: photoCount,
      latitude: data.latitude || null,
      longitude: data.longitude || null,
      placeId: data.place_id || null,
      isVerified: data.is_claimed || null,
    };
  }

  countPhotos(data) {
    let count = 0;
    if (data.main_image) count += 1;
    if (data.photos && Array.isArray(data.photos)) count += data.photos.length;
    if (data.photos_count) count = Math.max(count, data.photos_count);
    return count;
  }

  getProfileStrength(score) {
    if (score >= 90) return 'excellent';
    if (score >= 70) return 'good';
    if (score >= 50) return 'needsImprovement';
    return 'poor';
  }

  generateChecklist(info, lang = 'en') {
    const complete = t(lang, 'gbp.labels.complete');
    const incomplete = t(lang, 'gbp.labels.incomplete');
    const chars = t(lang, 'common.chars');
    const set = t(lang, 'common.set');
    const notSet = t(lang, 'common.notSet');

    const hasHours = info.hours && Object.keys(info.hours).length > 0;
    const hasAttributes = info.attributes && (Array.isArray(info.attributes) ? info.attributes.length > 0 : Object.keys(info.attributes).length > 0);
    const attributeCount = Array.isArray(info.attributes) ? info.attributes.length : (info.attributes ? Object.keys(info.attributes).length : 0);

    return [
      {
        field: 'name',
        label: t(lang, 'gbp.checklist.name'),
        completed: !!info.name,
        completedLabel: !!info.name ? complete : incomplete,
        value: info.name,
        weight: 10,
      },
      {
        field: 'address',
        label: t(lang, 'gbp.checklist.address'),
        completed: !!info.address,
        completedLabel: !!info.address ? complete : incomplete,
        value: info.address,
        weight: 15,
      },
      {
        field: 'phone',
        label: t(lang, 'gbp.checklist.phone'),
        completed: !!info.phone,
        completedLabel: !!info.phone ? complete : incomplete,
        value: info.phone,
        weight: 10,
      },
      {
        field: 'website',
        label: t(lang, 'gbp.checklist.website'),
        completed: !!info.website,
        completedLabel: !!info.website ? complete : incomplete,
        value: info.website,
        weight: 10,
      },
      {
        field: 'category',
        label: t(lang, 'gbp.checklist.category'),
        completed: !!info.category,
        completedLabel: !!info.category ? complete : incomplete,
        value: info.category,
        weight: 12,
      },
      {
        field: 'additionalCategories',
        label: t(lang, 'gbp.checklist.additionalCategories'),
        completed: info.additionalCategories?.length > 0,
        completedLabel: info.additionalCategories?.length > 0 ? complete : incomplete,
        value: info.additionalCategories?.length || 0,
        weight: 5,
      },
      {
        field: 'description',
        label: t(lang, 'gbp.checklist.description'),
        completed: !!info.description && info.descriptionLength >= 250,
        completedLabel: (!!info.description && info.descriptionLength >= 250) ? complete : incomplete,
        value: info.description ? `${info.descriptionLength} ${chars}` : null,
        weight: 10,
      },
      {
        field: 'hours',
        label: t(lang, 'gbp.checklist.hours'),
        completed: hasHours,
        completedLabel: hasHours ? complete : incomplete,
        value: hasHours ? set : notSet,
        weight: 8,
      },
      {
        field: 'photos',
        label: t(lang, 'gbp.checklist.photos'),
        completed: info.photos >= 10,
        completedLabel: info.photos >= 10 ? complete : incomplete,
        value: info.photos,
        weight: 8,
      },
      {
        field: 'rating',
        label: t(lang, 'gbp.checklist.rating'),
        completed: info.rating !== null && info.rating >= 4,
        completedLabel: (info.rating !== null && info.rating >= 4) ? complete : incomplete,
        value: info.rating ? `${info.rating}/5` : null,
        weight: 5,
      },
      {
        field: 'reviewCount',
        label: t(lang, 'gbp.checklist.reviewCount'),
        completed: info.reviewCount >= 10,
        completedLabel: info.reviewCount >= 10 ? complete : incomplete,
        value: info.reviewCount,
        weight: 5,
      },
      {
        field: 'attributes',
        label: t(lang, 'gbp.checklist.attributes'),
        completed: hasAttributes,
        completedLabel: hasAttributes ? complete : incomplete,
        value: attributeCount,
        weight: 2,
      },
    ];
  }

  generateEmptyChecklist(lang = 'en') {
    const incomplete = t(lang, 'gbp.labels.incomplete');

    return [
      { field: 'name', label: t(lang, 'gbp.checklist.name'), completed: false, completedLabel: incomplete, value: null, weight: 10 },
      { field: 'address', label: t(lang, 'gbp.checklist.address'), completed: false, completedLabel: incomplete, value: null, weight: 15 },
      { field: 'phone', label: t(lang, 'gbp.checklist.phone'), completed: false, completedLabel: incomplete, value: null, weight: 10 },
      { field: 'website', label: t(lang, 'gbp.checklist.website'), completed: false, completedLabel: incomplete, value: null, weight: 10 },
      { field: 'category', label: t(lang, 'gbp.checklist.category'), completed: false, completedLabel: incomplete, value: null, weight: 12 },
      { field: 'additionalCategories', label: t(lang, 'gbp.checklist.additionalCategories'), completed: false, completedLabel: incomplete, value: null, weight: 5 },
      { field: 'description', label: t(lang, 'gbp.checklist.description'), completed: false, completedLabel: incomplete, value: null, weight: 10 },
      { field: 'hours', label: t(lang, 'gbp.checklist.hours'), completed: false, completedLabel: incomplete, value: null, weight: 8 },
      { field: 'photos', label: t(lang, 'gbp.checklist.photos'), completed: false, completedLabel: incomplete, value: null, weight: 8 },
      { field: 'rating', label: t(lang, 'gbp.checklist.rating'), completed: false, completedLabel: incomplete, value: null, weight: 5 },
      { field: 'reviewCount', label: t(lang, 'gbp.checklist.reviewCount'), completed: false, completedLabel: incomplete, value: null, weight: 5 },
      { field: 'attributes', label: t(lang, 'gbp.checklist.attributes'), completed: false, completedLabel: incomplete, value: null, weight: 2 },
    ];
  }

  calculateScore(checklist) {
    let earnedPoints = 0;
    let totalPoints = 0;

    for (const item of checklist) {
      const weight = item.weight || 5;
      totalPoints += weight;
      if (item.completed) {
        earnedPoints += weight;
      }
    }

    return Math.round((earnedPoints / totalPoints) * 100);
  }

  generateEnhancedRecommendations(checklist, info, score, lang = 'en') {
    const recommendations = [];
    const incompleteItems = checklist.filter(item => !item.completed);

    // Helper to add recommendation with consistent structure
    const addRec = (priority, category, issueKey, actionKey, vars = {}) => {
      const issue = t(lang, `gbp.recommendations.${issueKey}.issue`, vars);
      const action = t(lang, `gbp.recommendations.${issueKey}.action`, vars);

      if (issue && action && !issue.includes('.issue')) {
        const effortMap = {
          name: 'easy', address: 'easy', phone: 'easy', website: 'easy',
          category: 'easy', additionalCategories: 'easy', description: 'easy',
          hours: 'easy', photos: 'moderate', rating: 'moderate',
          reviewCount: 'moderate', attributes: 'easy',
        };

        recommendations.push({
          priority,
          category,
          issue,
          action,
          impact: priority === 'critical' || priority === 'high' ? 'high' : priority === 'medium' ? 'medium' : 'low',
          effort: effortMap[issueKey] || 'moderate',
        });
      }
    };

    // === CRITICAL ITEMS (Core profile elements) ===
    const criticalFields = ['name', 'address', 'phone', 'category'];
    for (const item of incompleteItems.filter(i => criticalFields.includes(i.field))) {
      addRec('critical', 'profile', item.field, item.field);
    }

    // === HIGH PRIORITY ===
    // Website
    if (!info.website) {
      addRec('high', 'profile', 'website', 'website');
    }

    // Hours
    if (!info.hours || Object.keys(info.hours).length === 0) {
      addRec('high', 'profile', 'hours', 'hours');
    }

    // Description
    if (!info.description) {
      addRec('high', 'content', 'description', 'description');
    } else if (info.descriptionLength < 500) {
      addRec('medium', 'content', 'shortDescription', 'shortDescription', { length: info.descriptionLength });
    }

    // Photos
    if (info.photos === 0) {
      addRec('high', 'content', 'photos', 'photos');
    } else if (info.photos < 25) {
      addRec('medium', 'content', 'fewPhotos', 'fewPhotos', { count: info.photos });
    }

    // === MEDIUM PRIORITY ===
    // Additional Categories
    if (!info.additionalCategories || info.additionalCategories.length === 0) {
      addRec('medium', 'profile', 'additionalCategories', 'additionalCategories');
    }

    // Attributes
    const hasAttributes = info.attributes && (Array.isArray(info.attributes) ? info.attributes.length > 0 : Object.keys(info.attributes).length > 0);
    if (!hasAttributes) {
      addRec('medium', 'profile', 'attributes', 'attributes');
    }

    // === REVIEW-BASED RECOMMENDATIONS ===
    // Rating
    if (info.rating === null) {
      addRec('high', 'reviews', 'rating', 'rating');
    } else if (info.rating < 4) {
      addRec('high', 'reviews', 'lowRating', 'lowRating', { rating: info.rating });
    }

    // Review Count
    if (info.reviewCount === 0) {
      addRec('high', 'reviews', 'reviewCount', 'reviewCount');
    } else if (info.reviewCount < 10) {
      addRec('high', 'reviews', 'lowReviewCount', 'lowReviewCount', {
        count: info.reviewCount,
        target: 50,
      });
    } else if (info.reviewCount < 50) {
      addRec('medium', 'reviews', 'lowReviews', 'lowReviews', {
        count: info.reviewCount,
        target: Math.max(100, info.reviewCount * 2),
      });
    }

    // === PROFILE COMPLETENESS ===
    if (score < 100 && score >= 70) {
      addRec('low', 'profile', 'profileIncomplete', 'profileIncomplete', { score });
    } else if (score >= 90) {
      addRec('low', 'success', 'excellentProfile', 'excellentProfile', { score });
    }

    // Sort by priority
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    recommendations.sort((a, b) => (priorityOrder[a.priority] || 4) - (priorityOrder[b.priority] || 4));

    return recommendations;
  }
}

export const gbpService = new GBPService();
