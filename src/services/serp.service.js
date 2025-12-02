import axios from 'axios';
import { env } from '../config/index.js';
import { ApiError } from '../utils/index.js';
import { Logger } from '../utils/logger.js';

class SerpService {
  constructor() {
    this.baseURL = env.DATAFORSEO_API_URL;
    this.email = env.DATAFORSEO_EMAIL;
    this.apiPassword = env.DATAFORSEO_API_PASSWORD;
  }

  /**
   * Get competitor results for a keyword using DataForSEO API
   * @param {string} keyword - The search keyword
   * @param {string} locationName - Location name (e.g., "United States")
   * @param {string} languageName - Language name (e.g., "English")
   * @param {string} device - Device type (desktop, mobile, tablet)
   * @param {number} depth - Number of results to fetch
   * @returns {Promise<Object>} SERP results with competitor data
   */
  async getCompetitorResults(keyword, locationName = 'United States', languageName = 'English', device = 'desktop', depth = 100) {
    if (!this.email || !this.apiPassword) {
      throw new ApiError(500, 'DataForSEO credentials not configured');
    }

    if (!keyword || keyword.trim().length === 0) {
      throw new ApiError(400, 'Keyword is required');
    }

    try {
      // Prepare request payload
      const payload = [
        {
          keyword: keyword.trim(),
          location_name: locationName,
          language_name: languageName,
          device: device,
          depth: depth,
        },
      ];

      // Make API request with Basic Authentication
      const response = await axios.post(
        this.baseURL,
        payload,
        {
          auth: {
            username: this.email,
            password: this.apiPassword,
          },
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 30000, // 30 seconds timeout
        }
      );

      // Log response for debugging
      Logger.log('DataForSEO API Response Status:', response.status);
      if (env.NODE_ENV === 'development') {
        Logger.log('DataForSEO API Response Data:', JSON.stringify(response.data, null, 2));
      } else {
        // In production, log a summary
        Logger.log('DataForSEO API Response Type:', typeof response.data, 'Is Array:', Array.isArray(response.data));
      }

      // Check if response has data
      if (!response.data) {
        Logger.error('DataForSEO API returned no data. Response:', {
          status: response.status,
          headers: response.headers,
        });
        throw new ApiError(500, 'Invalid response from DataForSEO API: No data received');
      }

      // Handle different response structures
      let result;
      if (Array.isArray(response.data)) {
        if (response.data.length === 0) {
          Logger.error('DataForSEO API returned empty array');
          throw new ApiError(500, 'Invalid response from DataForSEO API: Empty array');
        }
        result = response.data[0];
      } else if (response.data.status_code !== undefined) {
        // Response might be a single object instead of array
        result = response.data;
      } else {
        // Log the full response structure for debugging
        Logger.error('Unexpected response structure from DataForSEO API');
        Logger.error('Response data type:', typeof response.data);
        Logger.error('Response data keys:', Object.keys(response.data || {}));
        Logger.error('Response data sample:', JSON.stringify(response.data).substring(0, 500));
        throw new ApiError(500, `Invalid response from DataForSEO API: Unexpected structure. Check logs for details.`);
      }

      // Check for API errors
      if (result.status_code !== undefined && result.status_code !== 20000) {
        const errorMessage = result.status_message || 'Unknown error from DataForSEO API';
        Logger.error('DataForSEO API error:', errorMessage, 'Status code:', result.status_code);
        throw new ApiError(400, `DataForSEO API error: ${errorMessage} (Code: ${result.status_code})`);
      }

      // Extract competitor results
      const tasks = result.tasks || [];
      if (tasks.length === 0) {
        Logger.warn('No tasks in DataForSEO response');
        return {
          keyword,
          location: locationName,
          language: languageName,
          device,
          competitors: [],
          totalResults: 0,
        };
      }

      // Handle task result structure
      const task = tasks[0];
      let serpData;
      
      if (Array.isArray(task.result)) {
        serpData = task.result[0];
      } else if (task.result) {
        serpData = task.result;
      } else {
        Logger.warn('No result in task:', JSON.stringify(task));
        return {
          keyword,
          location: locationName,
          language: languageName,
          device,
          competitors: [],
          totalResults: 0,
        };
      }

      const organicResults = serpData?.items || [];

      // Format competitor data
      const competitors = organicResults
        .filter((item) => item.type === 'organic')
        .map((item, index) => ({
          position: index + 1,
          title: item.title || '',
          url: item.url || '',
          domain: item.domain || '',
          description: item.description || '',
          breadcrumb: item.breadcrumb || '',
        }));

      return {
        keyword,
        location: locationName,
        language: languageName,
        device,
        competitors,
        totalResults: competitors.length,
        searchInfo: {
          seResultsCount: serpData?.se_results_count || 0,
          checkUrl: serpData?.check_url || '',
          datetime: serpData?.datetime || new Date().toISOString(),
        },
      };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      // Handle axios errors
      if (error.response) {
        const statusCode = error.response.status;
        const responseData = error.response.data;
        Logger.error('DataForSEO API Error Response:', {
          status: statusCode,
          data: responseData,
        });
        
        // Try to extract error message from DataForSEO response
        let errorMessage = 'DataForSEO API request failed';
        if (responseData) {
          if (typeof responseData === 'string') {
            errorMessage = responseData;
          } else if (responseData.message) {
            errorMessage = responseData.message;
          } else if (responseData.status_message) {
            errorMessage = responseData.status_message;
          } else if (Array.isArray(responseData) && responseData[0]?.status_message) {
            errorMessage = responseData[0].status_message;
          }
        }
        
        throw new ApiError(statusCode, errorMessage);
      }

      if (error.request) {
        throw new ApiError(503, 'No response from DataForSEO API. Please try again later.');
      }

      // Handle other errors
      throw new ApiError(500, `Failed to fetch SERP data: ${error.message}`);
    }
  }

  /**
   * Get competitor results for multiple keywords
   * @param {Array<string>} keywords - Array of keywords
   * @param {string} locationName - Location name
   * @param {string} languageName - Language name
   * @param {string} device - Device type
   * @returns {Promise<Array>} Array of competitor results
   */
  async getMultipleKeywordResults(keywords, locationName = 'United States', languageName = 'English', device = 'desktop') {
    if (!Array.isArray(keywords) || keywords.length === 0) {
      throw new ApiError(400, 'Keywords array is required and must not be empty');
    }

    const results = await Promise.all(
      keywords.map((keyword) =>
        this.getCompetitorResults(keyword, locationName, languageName, device).catch((error) => ({
          keyword,
          error: error.message,
          competitors: [],
        }))
      )
    );

    return results;
  }
}

export const serpService = new SerpService();

