import axios from 'axios';

import { env } from '../config/index.js';
import { ApiError } from '../utils/index.js';
import { Logger } from '../utils/logger.js';
import { Location } from '../models/index.js';

// Only keep city-level locations we care about
const ALLOWED_TYPES = ['City', 'Municipality'];

// Countries we support today (can be extended later)
const SUPPORTED_COUNTRIES = ['FR', 'BE', 'NL'];

class LocationService {
  constructor() {
    this.login = env.DATAFORSEO_LOGIN || env.DATAFORSEO_EMAIL;
    this.password = env.DATAFORSEO_PASSWORD || env.DATAFORSEO_API_PASSWORD;
    this.baseURL = env.DATAFORSEO_API_URL || 'https://sandbox.dataforseo.com';

    if (!this.login || !this.password) {
      Logger.error('DataForSEO credentials not configured for Location service');
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
   * Fetch all Google locations for a specific country from DataForSEO
   * Filters by ALLOWED_TYPES and upserts into MongoDB
   * @param {string} countryIsoCode - e.g. 'FR', 'BE', 'NL'
   */
  async syncCountryLocations(countryIsoCode) {
    const country = (countryIsoCode || '').toUpperCase();

    if (!this.login || !this.password) {
      throw new ApiError(500, 'DataForSEO credentials not configured');
    }

    if (!country) {
      throw new ApiError(400, 'Country ISO code is required');
    }

    try {
      console.log('[LocationService] Fetching Google locations from DataForSEO', {
        countryIsoCode: country,
        endpoint: `/v3/business_data/google/locations/${country.toLowerCase()}`,
      });


      const response = await this.client.get(
        `/v3/business_data/google/locations/${country.toLowerCase()}`
      );

      const data = response.data;
      console.log('[LocationService] Raw DataForSEO response:', JSON.stringify(data, null, 2));

      if (!data || data.status_code !== 20000) {
        const message = data?.status_message || 'Unknown DataForSEO error';
        Logger.error('[LocationService] DataForSEO locations error', {
          countryIsoCode: country,
          status_code: data?.status_code,
          status_message: message,
        });
        throw new ApiError(502, message);
      }

      const task = data.tasks?.[0];
      if (!task || task.status_code !== 20000) {
        const message = task?.status_message || 'DataForSEO task error';
        Logger.error('[LocationService] DataForSEO locations task error', {
          countryIsoCode: country,
          status_code: task?.status_code,
          status_message: message,
        });
        throw new ApiError(502, message);
      }

      // Locations endpoint: tasks[0].result is an array of location objects (no .items wrapper)
      let items = [];

      if (Array.isArray(task.result)) {
        // Standard structure: result: [ {location_code,...}, {...}, ... ]
        items = task.result;
      } else if (Array.isArray(task.result?.[0])) {
        // Just in case the first element is an array
        items = task.result[0];
      } else if (Array.isArray(task.result?.items)) {
        // Fallback if DataForSEO ever wraps in .items
        items = task.result.items;
      }

      console.log('[LocationService] Parsed locations count:', items.length);

      // Filter only allowed location types (City / Municipality)
      const filtered = items.filter((loc) =>
        ALLOWED_TYPES.includes(loc.location_type)
      );

      Logger.log('[LocationService] Locations fetched & filtered', {
        countryIsoCode: country,
        total: items.length,
        kept: filtered.length,
      });

      if (filtered.length === 0) {
        return { countryIsoCode: country, total: 0, inserted: 0, updated: 0 };
      }

      // Upsert in bulk for performance
      const bulkOps = filtered.map((loc) => ({
        updateOne: {
          filter: {
            countryIsoCode: loc.country_iso_code?.toUpperCase() || country,
            locationCode: loc.location_code,
          },
          update: {
            $set: {
              countryIsoCode: loc.country_iso_code?.toUpperCase() || country,
              locationCode: loc.location_code,
              locationName: loc.location_name,
              locationNameParent: loc.location_name_parent,
              locationType: loc.location_type,
              raw: loc,
            },
          },
          upsert: true,
        },
      }));

      const result = await Location.bulkWrite(bulkOps, { ordered: false });

      const inserted = result.upsertedCount || 0;
      const updated =
        (result.modifiedCount || 0) +
        ((result.matchedCount || 0) - (result.upsertedCount || 0));

      Logger.log('[LocationService] Locations synced to MongoDB', {
        countryIsoCode: country,
        inserted,
        updated,
      });

      return {
        countryIsoCode: country,
        total: filtered.length,
        inserted,
        updated,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;

      Logger.error('[LocationService] syncCountryLocations failed', {
        countryIsoCode: country,
        message: error.message,
      });

      if (error.response) {
        throw new ApiError(
          error.response.status,
          error.response.data?.message || 'DataForSEO locations request failed'
        );
      }

      throw new ApiError(502, `Location sync failed: ${error.message}`);
    }
  }

  /**
   * Sync all supported countries at once (FR, BE, NL)
   * Returns summary per country
   */
  async syncSupportedCountries() {
    const results = [];
    for (const country of SUPPORTED_COUNTRIES) {
      // Run sequentially to avoid hitting rate limits
      // eslint-disable-next-line no-await-in-loop
      const res = await this.syncCountryLocations(country);
      results.push(res);
    }
    return results;
  }
}

export const locationService = new LocationService();

