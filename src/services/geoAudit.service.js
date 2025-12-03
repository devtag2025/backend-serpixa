import axios from 'axios';
import { env } from '../config/index.js';
import { ApiError } from '../utils/index.js';
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

  async runGeoAudit(keyword, location, businessName = null, languageName = 'English', device = 'desktop') {
    try {
      const localPackData = await this.fetchLocalPackData(keyword, location, languageName, device);
      return this.transformLocalPackResult(localPackData, keyword, location, businessName);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, `Geo audit failed: ${error.message}`);
    }
  }

  async fetchLocalPackData(keyword, locationName = 'United States', languageName = 'English', device = 'desktop') {
    if (!this.login || !this.password) {
      throw new ApiError(500, 'DataForSEO credentials not configured');
    }

    // Common location codes mapping for fallback
    const locationCodeMap = {
      'united states': 2840,
      'us': 2840,
      'usa': 2840,
      'united kingdom': 2826,
      'uk': 2826,
      'canada': 2036,
      'australia': 2033,
      'germany': 2276,
      'france': 2250,
      'new york': 1006164, // New York, NY
      'los angeles': 1002980, // Los Angeles, CA
      'chicago': 1002801, // Chicago, IL
      'houston': 1002931, // Houston, TX
      'phoenix': 1003444, // Phoenix, AZ
      'philadelphia': 1003440, // Philadelphia, PA
      'san antonio': 1003520, // San Antonio, TX
      'san diego': 1003521, // San Diego, CA
      'dallas': 1002840, // Dallas, TX
      'san jose': 1003522, // San Jose, CA
    };

    // Helper function to parse location string
    const parseLocation = (locationStr) => {
      if (!locationStr) return null;
      
      // Check if it's already a number
      const num = parseInt(locationStr);
      if (!isNaN(num) && num > 0) {
        return { type: 'code', value: num };
      }
      
      // Clean and normalize the location string
      let cleaned = locationStr.trim();
      
      // Remove common suffixes like ", NY", ", CA", etc.
      // Match patterns like "City, ST" or "City, State"
      const cityStateMatch = cleaned.match(/^(.+?),\s*[A-Z]{2}$/i);
      if (cityStateMatch) {
        cleaned = cityStateMatch[1].trim();
      }
      
      // Check if cleaned location is in our map
      const locationLower = cleaned.toLowerCase();
      if (locationCodeMap[locationLower]) {
        return { type: 'code', value: locationCodeMap[locationLower] };
      }
      
      // Try the original string in the map
      const originalLower = locationStr.toLowerCase().trim();
      if (locationCodeMap[originalLower]) {
        return { type: 'code', value: locationCodeMap[originalLower] };
      }
      
      // Return as location_name (try the cleaned version first, then original)
      return { type: 'name', value: cleaned || locationStr };
    };

    try {
      // Use the regular SERP endpoint which includes local_pack items
      // Build payload - try location_name first, fallback to location_code if needed
      const payload = [
        {
          keyword: keyword.trim(),
          language_name: languageName,
          device: device,
          depth: 100,
        },
      ];

      // Add location - parse and use appropriate format
      const parsedLocation = parseLocation(locationName);
      if (parsedLocation) {
        if (parsedLocation.type === 'code') {
          payload[0].location_code = parsedLocation.value;
        } else {
          payload[0].location_name = parsedLocation.value;
        }
      } else {
        // Default to United States if no location provided
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
      
      Logger.log('DataForSEO API Response Status:', response.status);

      // Handle different response structures
      let result;
      if (Array.isArray(response.data)) {
        if (response.data.length === 0) {
          Logger.warn('DataForSEO SERP API returned empty array');
          throw new ApiError(502, 'No SERP data received');
        }
        result = response.data[0];
      } else if (response.data?.status_code !== undefined) {
        result = response.data;
      } else {
        Logger.error('Unexpected SERP response structure:', typeof response.data);
        throw new ApiError(502, 'Unexpected API response structure');
      }

      if (result.status_code !== 20000) {
        Logger.error('DataForSEO SERP API error:', result.status_message, 'Code:', result.status_code);
        throw new ApiError(502, result.status_message || 'DataForSEO SERP API error');
      }

      const task = result.tasks?.[0];
      if (!task || task.status_code !== 20000) {
        const errorMsg = task?.status_message || 'SERP data fetch failed';
        Logger.error('DataForSEO SERP task error:', errorMsg, 'Code:', task?.status_code);
        
        // If location_name is invalid, provide helpful error message
        if (errorMsg.includes('location_name') || errorMsg.includes('Invalid Field')) {
          throw new ApiError(400, `Invalid location: "${locationName}". Please use a valid location name (e.g., "United States", "New York") or provide a location code (numeric). Error: ${errorMsg}`);
        }
        
        throw new ApiError(502, errorMsg);
      }

      let serpData;
      if (Array.isArray(task.result)) {
        serpData = task.result[0];
      } else if (task.result) {
        serpData = task.result;
      } else {
        Logger.error('No SERP result data found in task:', JSON.stringify(task, null, 2));
        throw new ApiError(502, 'No SERP result data found');
      }

      // Log the response structure for debugging
      Logger.log('SERP Data received:', {
        hasItems: !!serpData?.items,
        itemsCount: serpData?.items?.length || 0,
        itemTypes: serpData?.items?.map(item => item.type) || [],
        keyword: keyword,
        location: locationName,
      });

      // Extract local pack items from the SERP results
      const items = serpData?.items || [];
      Logger.log('Total items in SERP:', items.length);
      Logger.log('Item types found:', [...new Set(items.map(item => item.type))]);

      const localPackItems = items.filter(item => item.type === 'local_pack');
      Logger.log('Local pack items found:', localPackItems.length);

      // If no local pack items found, try Maps API as fallback
      if (localPackItems.length === 0) {
        Logger.warn('No local pack items found in SERP results, trying Maps API...');
        try {
          return await this.fetchMapsData(keyword, locationName, languageName, device);
        } catch (mapsError) {
          Logger.error('Maps API also failed:', mapsError.message);
          // Return the full SERP data so we can still process it
          return {
            items: items,
            local_pack_items: [],
            has_local_pack: false,
            serp_data: serpData,
          };
        }
      }

      // Return structured data with local pack items
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
          Logger.error('DataForSEO authentication failed. Please check your credentials.');
          throw new ApiError(401, 'DataForSEO authentication failed. Please check your credentials in .env file');
        }

        Logger.error('DataForSEO Local Pack API error response:', {
          status: statusCode,
          data: error.response.data,
        });
        throw new ApiError(statusCode, errorMessage);
      }

      Logger.error('Local Pack data fetch failed:', error.message);
      throw new ApiError(502, `Local Pack data fetch failed: ${error.message}`);
    }
  }

  async fetchMapsData(keyword, locationName = 'United States', languageName = 'English', device = 'desktop') {
    if (!this.login || !this.password) {
      throw new ApiError(500, 'DataForSEO credentials not configured');
    }

    // Helper function to parse location (reuse from fetchLocalPackData)
    const locationCodeMap = {
      'united states': 2840,
      'us': 2840,
      'usa': 2840,
      'united kingdom': 2826,
      'uk': 2826,
      'canada': 2036,
      'australia': 2033,
      'germany': 2276,
      'france': 2250,
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

    const parseLocation = (locationStr) => {
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
      if (locationCodeMap[locationLower]) {
        return { type: 'code', value: locationCodeMap[locationLower] };
      }
      const originalLower = locationStr.toLowerCase().trim();
      if (locationCodeMap[originalLower]) {
        return { type: 'code', value: locationCodeMap[originalLower] };
      }
      return { type: 'name', value: cleaned || locationStr };
    };

    try {
      const payload = [
        {
          keyword: keyword.trim(),
          language_name: languageName,
          device: device,
        },
      ];

      const parsedLocation = parseLocation(locationName);
      if (parsedLocation) {
        if (parsedLocation.type === 'code') {
          payload[0].location_code = parsedLocation.value;
        } else {
          payload[0].location_name = parsedLocation.value;
        }
      } else {
        payload[0].location_code = 2840;
      }

      Logger.log('Sending request to DataForSEO Maps API:', {
        endpoint: '/v3/serp/google/maps/live/advanced',
        keyword: keyword.trim(),
        location: parsedLocation,
        language: languageName,
        device: device,
      });

      const response = await this.client.post('/v3/serp/google/maps/live/advanced', payload);

      Logger.log('DataForSEO Maps API Response Status:', response.status);

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
        throw new ApiError(502, 'Unexpected Maps API response structure');
      }

      if (result.status_code !== 20000) {
        Logger.error('DataForSEO Maps API error:', result.status_message, 'Code:', result.status_code);
        throw new ApiError(502, result.status_message || 'DataForSEO Maps API error');
      }

      const task = result.tasks?.[0];
      if (!task || task.status_code !== 20000) {
        const errorMsg = task?.status_message || 'Maps data fetch failed';
        Logger.error('DataForSEO Maps task error:', errorMsg, 'Code:', task?.status_code);
        throw new ApiError(502, errorMsg);
      }

      let mapsData;
      if (Array.isArray(task.result)) {
        mapsData = task.result[0];
      } else if (task.result) {
        mapsData = task.result;
      } else {
        Logger.error('No Maps result data found in task:', JSON.stringify(task, null, 2));
        throw new ApiError(502, 'No Maps result data found');
      }

      Logger.log('Maps Data received:', {
        hasItems: !!mapsData?.items,
        itemsCount: mapsData?.items?.length || 0,
        itemTypes: mapsData?.items?.map(item => item.type) || [],
      });

      const items = mapsData?.items || [];
      Logger.log('Total items in Maps response:', items.length);
      Logger.log('Item types found in Maps:', [...new Set(items.map(item => item.type))]);

      // Maps API returns items directly, not in local_pack format
      // Extract business listings from maps results
      const mapItems = items.filter(item => 
        item.type === 'maps_results' || 
        item.type === 'local_pack' ||
        item.type === 'map' ||
        (item.title && (item.rating || item.reviews_count))
      );

      Logger.log('Map items found:', mapItems.length);

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
        const errorMessage = error.response.data?.message || error.response.statusText || 'DataForSEO Maps API request failed';

        if (statusCode === 401) {
          Logger.error('DataForSEO Maps authentication failed. Please check your credentials.');
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

  transformLocalPackResult(data, keyword, location, businessName = null) {
    if (!data) {
      return {
        keyword,
        location,
        businessName,
        localVisibilityScore: 0,
        businessInfo: null,
        competitors: [],
        recommendations: [],
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
        raw: null,
      };
    }

    // Extract local pack items from the structured data
    let localPackItems = data.local_pack_items || [];
    
    Logger.log('Transform: local_pack_items count:', localPackItems.length);
    Logger.log('Transform: has items array:', !!data.items);
    Logger.log('Transform: items count:', data.items?.length || 0);
    
    // If no local pack items found, check if we need to extract from items
    if (localPackItems.length === 0 && data.items) {
      const items = data.items || [];
      Logger.log('Transform: Filtering items for local_pack type...');
      const filtered = items.filter(item => item.type === 'local_pack');
      Logger.log('Transform: Found local_pack items:', filtered.length);
      if (filtered.length > 0) {
        localPackItems.push(...filtered);
      }
      
      // Also check for maps_results type (from Maps API)
      if (localPackItems.length === 0) {
        Logger.log('Transform: Checking for maps_results type...');
        const mapsResults = items.filter(item => 
          item.type === 'maps_results' || 
          item.type === 'map' ||
          (item.title && (item.rating || item.reviews_count))
        );
        Logger.log('Transform: Found maps_results items:', mapsResults.length);
        if (mapsResults.length > 0) {
          localPackItems.push(...mapsResults);
        }
      }
    }
    
    Logger.log('Transform: Final localPackItems count:', localPackItems.length);

    // Find business in results if businessName provided
    // First, we need to flatten all local pack items to search through them
    let businessInfo = null;
    let businessIndex = -1;
    
    if (businessName && localPackItems.length > 0) {
      const businessNameLower = businessName.toLowerCase();
      
      // Flatten all local pack items to search
      const allLocalItems = [];
      localPackItems.forEach((item) => {
        if (item.items && Array.isArray(item.items)) {
          item.items.forEach(localItem => allLocalItems.push(localItem));
        } else {
          allLocalItems.push(item);
        }
      });
      
      // Search for business in flattened items
      businessIndex = allLocalItems.findIndex((item) => {
        const itemName = (item.title || item.name || '').toLowerCase();
        return itemName.includes(businessNameLower) || businessNameLower.includes(itemName);
      });

      if (businessIndex >= 0) {
        const businessItem = allLocalItems[businessIndex];
        businessInfo = this.extractBusinessInfo(businessItem);
      }
    }

    // Extract competitors from local pack items
    // Local pack items can have different structures - handle both
    const competitors = [];
    
    if (localPackItems.length === 0) {
      // No local pack found - return empty result with recommendations
      return {
        keyword,
        location,
        businessName: businessName || keyword,
        localVisibilityScore: 0,
        businessInfo: null,
        competitors: [],
        recommendations: [{
          priority: 'high',
          issue: 'No local pack results found for this keyword and location',
          action: 'Try using a more specific location or a keyword that typically shows local results (e.g., "restaurants near me", "plumbers in [city]")',
        }],
        napIssues: {
          nameConsistency: true,
          addressConsistency: true,
          phoneConsistency: true,
          issues: ['No local pack data available'],
        },
        citationIssues: {
          missingCitations: [],
          inconsistentData: [],
        },
        raw: data,
      };
    }
    
    for (let i = 0; i < localPackItems.length; i++) {
      const item = localPackItems[i];
      
      // Handle different local pack item structures
      // Some items might have a 'items' array inside them
      if (item.items && Array.isArray(item.items)) {
        // This is a local_pack container with items inside
        item.items.forEach((localItem, idx) => {
          competitors.push({
            position: competitors.length + 1,
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
        // Direct local pack item
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
    }
    
    // Recalculate businessIndex based on competitors array if businessName was provided
    if (businessName && businessIndex < 0) {
      const businessNameLower = businessName.toLowerCase();
      businessIndex = competitors.findIndex((comp) => {
        const compName = (comp.name || '').toLowerCase();
        return compName.includes(businessNameLower) || businessNameLower.includes(compName);
      });
      
      if (businessIndex >= 0) {
        businessInfo = {
          name: competitors[businessIndex].name,
          address: competitors[businessIndex].address,
          phone: competitors[businessIndex].phone,
          website: competitors[businessIndex].website,
          rating: competitors[businessIndex].rating,
          reviews: competitors[businessIndex].reviews,
          category: competitors[businessIndex].category,
          placeId: competitors[businessIndex].placeId,
        };
      }
    }

    // Calculate local visibility score
    const localVisibilityScore = this.calculateLocalVisibilityScore(businessIndex, competitors, businessInfo);

    // Generate recommendations
    const recommendations = this.generateRecommendations(businessInfo, competitors, businessIndex);

    // Analyze NAP consistency
    const napIssues = this.analyzeNAPConsistency(businessInfo, competitors);

    // Analyze citation issues
    const citationIssues = this.analyzeCitationIssues(businessInfo, competitors);

      return {
        keyword,
        location,
        businessName: businessName || (businessInfo?.name || keyword),
        localVisibilityScore,
        businessInfo,
        competitors,
        recommendations,
        napIssues,
        citationIssues,
        raw: {
          ...data,
          original_items: data.items,
        },
      };
  }

  extractBusinessInfo(item) {
    return {
      name: item.title || item.name || null,
      address: item.address || item.address_lines?.join(', ') || null,
      phone: item.phone || null,
      website: item.website || null,
      rating: item.rating?.value || item.rating || null,
      reviews: item.reviews_count || item.reviews || 0,
      category: item.category || item.type || null,
      placeId: item.place_id || null,
      latitude: item.latitude || null,
      longitude: item.longitude || null,
    };
  }

  calculateLocalVisibilityScore(businessIndex, competitors, businessInfo) {
    let score = 0;

    // Position in local pack (0-50 points)
    if (businessIndex >= 0) {
      // Top 3 positions get higher scores
      if (businessIndex === 0) score += 50;
      else if (businessIndex === 1) score += 40;
      else if (businessIndex === 2) score += 30;
      else if (businessIndex < 5) score += 20;
      else score += 10;
    } else {
      // Business not found in local pack
      return 0;
    }

    // Rating score (0-25 points)
    if (businessInfo?.rating) {
      score += (businessInfo.rating / 5) * 25;
    }

    // Review count score (0-15 points)
    if (businessInfo?.reviews) {
      const reviewScore = Math.min(businessInfo.reviews / 100, 1) * 15;
      score += reviewScore;
    }

    // Completeness score (0-10 points)
    let completeness = 0;
    if (businessInfo?.name) completeness += 2;
    if (businessInfo?.address) completeness += 2;
    if (businessInfo?.phone) completeness += 2;
    if (businessInfo?.website) completeness += 2;
    if (businessInfo?.category) completeness += 2;
    score += completeness;

    return Math.round(score);
  }

  generateRecommendations(businessInfo, competitors, businessIndex) {
    const recommendations = [];

    // Position recommendations
    if (businessIndex < 0) {
      recommendations.push({
        priority: 'high',
        issue: 'Business not found in local pack results',
        action: 'Improve local SEO by optimizing your Google Business Profile, getting more reviews, and ensuring NAP consistency across all citations',
      });
    } else if (businessIndex >= 3) {
      recommendations.push({
        priority: 'high',
        issue: `Business is ranked at position ${businessIndex + 1} in local pack`,
        action: 'Work on improving your ranking by getting more positive reviews, optimizing your GBP profile, and improving local relevance',
      });
    } else if (businessIndex > 0) {
      recommendations.push({
        priority: 'medium',
        issue: `Business is ranked at position ${businessIndex + 1} in local pack`,
        action: 'You\'re in the top 3! Focus on getting more reviews and maintaining consistency to reach #1',
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
          issue: `Your rating (${businessInfo.rating}) is below the average competitor rating (${avgCompetitorRating.toFixed(1)})`,
          action: 'Focus on improving customer satisfaction and encourage satisfied customers to leave positive reviews',
        });
      }
    } else {
      recommendations.push({
        priority: 'high',
        issue: 'No rating found for your business',
        action: 'Ensure your Google Business Profile is properly set up and verified',
      });
    }

    // Review count recommendations
    if (businessInfo?.reviews) {
      const avgCompetitorReviews = competitors
        .filter(c => c.reviews)
        .reduce((sum, c) => sum + c.reviews, 0) / competitors.filter(c => c.reviews).length || 0;

      if (businessInfo.reviews < avgCompetitorReviews) {
        recommendations.push({
          priority: 'medium',
          issue: `You have fewer reviews (${businessInfo.reviews}) than competitors (avg: ${Math.round(avgCompetitorReviews)})`,
          action: 'Implement a review generation strategy to encourage more customers to leave reviews',
        });
      }
    } else {
      recommendations.push({
        priority: 'medium',
        issue: 'No reviews found for your business',
        action: 'Start collecting reviews from satisfied customers to improve your local visibility',
      });
    }

    // NAP consistency recommendations
    if (!businessInfo?.name || !businessInfo?.address || !businessInfo?.phone) {
      recommendations.push({
        priority: 'high',
        issue: 'Missing NAP (Name, Address, Phone) information',
        action: 'Ensure your business name, address, and phone number are complete and consistent across all platforms',
      });
    }

    // Website recommendations
    if (!businessInfo?.website) {
      recommendations.push({
        priority: 'medium',
        issue: 'No website listed in local pack',
        action: 'Add your website URL to your Google Business Profile to improve credibility and provide customers with more information',
      });
    }

    return recommendations;
  }

  analyzeNAPConsistency(businessInfo, competitors) {
    const issues = [];
    let nameConsistency = true;
    let addressConsistency = true;
    let phoneConsistency = true;

    if (!businessInfo) {
      return {
        nameConsistency: false,
        addressConsistency: false,
        phoneConsistency: false,
        issues: ['Business information not found in local pack'],
      };
    }

    // Check if NAP data exists
    if (!businessInfo.name) {
      nameConsistency = false;
      issues.push('Business name is missing');
    }

    if (!businessInfo.address) {
      addressConsistency = false;
      issues.push('Business address is missing');
    }

    if (!businessInfo.phone) {
      phoneConsistency = false;
      issues.push('Business phone number is missing');
    }

    return {
      nameConsistency,
      addressConsistency,
      phoneConsistency,
      issues,
    };
  }

  analyzeCitationIssues(businessInfo, competitors) {
    const missingCitations = [];
    const inconsistentData = [];

    if (!businessInfo) {
      return {
        missingCitations: ['Business not found in local pack'],
        inconsistentData: [],
      };
    }

    // Check for missing website
    if (!businessInfo.website) {
      missingCitations.push('Website URL not listed');
    }

    // Check for missing category
    if (!businessInfo.category) {
      missingCitations.push('Business category not specified');
    }

    // Compare with top competitors
    const topCompetitors = competitors.slice(0, 3);
    const competitorWebsites = topCompetitors.filter(c => c.website).length;
    const competitorCategories = topCompetitors.filter(c => c.category).length;

    if (competitorWebsites > 0 && !businessInfo.website) {
      inconsistentData.push('Most competitors have websites listed, but yours is missing');
    }

    if (competitorCategories > 0 && !businessInfo.category) {
      inconsistentData.push('Most competitors have categories listed, but yours is missing');
    }

    return {
      missingCitations,
      inconsistentData,
    };
  }
}

export const geoAuditService = new GeoAuditService();

