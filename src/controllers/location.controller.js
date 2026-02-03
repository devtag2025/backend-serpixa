import { ApiResponse } from '../utils/index.js';
import { locationService } from '../services/location.service.js';
import { Location } from '../models/index.js';

/**
 * Single endpoint to sync locations.
 *
 * POST /admin/locations/sync
 * Body:
 *  { "countryIsoCode": "FR" }   -> sync that country
 *  { "countryIsoCode": "ALL" }  -> sync all supported countries
 */
export const syncLocations = async (req, res, next) => {
  try {
    console.log("sync location function workingggggggg");
    
    const rawCode = (req.body?.countryIsoCode || '').trim();

    if (!rawCode) {
      return res
        .status(400)
        .json(
          new ApiResponse(
            400,
            null,
            'countryIsoCode is required (e.g. FR, BE, NL, BR, or ALL)'
          )
        );
    }

    const codeUpper = rawCode.toUpperCase();

    if (codeUpper === 'ALL') {
      const results = await locationService.syncSupportedCountries();
      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            { results },
            'Locations synced for all supported countries'
          )
        );
    }

    const result = await locationService.syncCountryLocations(codeUpper);

    return res
      .status(200)
      .json(new ApiResponse(200, { result }, 'Locations synced successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * Public endpoint: get locations for a given country (for Geo Audit form)
 *
 * GET /locations?country=France&search=paris&limit=20
 * or
 * GET /locations?countryIsoCode=FR&search=paris&limit=20
 */
export const getLocations = async (req, res, next) => {
  try {
    const { country, countryIsoCode, search = '', limit = 50 } = req.query;

    // Map human-readable country name to ISO code (for supported countries)
    const countryNameToIso = {
      france: 'FR',
      belgium: 'BE',
      netherlands: 'NL',
    };

    const isoFromName = country
      ? countryNameToIso[country.toLowerCase().trim()]
      : null;
    const iso = (countryIsoCode || isoFromName || '').toUpperCase();

    if (!iso) {
      return res
        .status(400)
        .json(
          new ApiResponse(
            400,
            null,
            'countryIsoCode or country (France, Belgium, Netherlands) is required'
          )
        );
    }

    // Basic regex escape
    const escapeRegex = (str) =>
      str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const parsedLimit = parseInt(limit, 10);
    const max = Math.min(Number.isNaN(parsedLimit) ? 50 : parsedLimit, 200);

    const filter = {
      countryIsoCode: iso,
      locationType: { $in: ['City', 'Municipality'] },
    };

    if (search && typeof search === 'string' && search.trim().length > 0) {
      filter.locationName = new RegExp(escapeRegex(search.trim()), 'i');
    }

    const locations = await Location.find(filter)
      .sort({ locationName: 1 })
      .limit(max)
      .select(
        'locationCode locationName locationNameParent countryIsoCode locationType'
      )
      .lean();

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { locations },
          'Locations fetched successfully'
        )
      );
  } catch (error) {
    next(error);
  }
};

export const locationController = {
  syncLocations,
  getLocations,
};


