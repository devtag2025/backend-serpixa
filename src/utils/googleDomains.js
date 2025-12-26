// utils/googleDomains.js

export const GOOGLE_DOMAIN_MAP = {
  "fr-fr": "google.fr",
  "nl-nl": "google.nl",
  "fr-be": "google.be",
  "nl-be": "google.be",
  "de-be": "google.be",
  "en-us": "google.com",
  "en-uk": "google.co.uk",
  "en-gb": "google.co.uk",
  "en-ca": "google.ca",
  "en-au": "google.com.au",
  "de-de": "google.de",
  "es-es": "google.es",
  "it-it": "google.it",
  "pt-pt": "google.pt",
  "pl-pl": "google.pl",
};

/**
 * Get Google domain based on language and country
 * @param {string} language - Language code (e.g., 'fr', 'nl', 'en')
 * @param {string} country - Country code (e.g., 'fr', 'be', 'nl', 'us')
 * @returns {string} Google domain (e.g., 'google.fr', 'google.be')
 */
export function getGoogleDomain(language, country) {
  if (!language || !country) {
    return "google.com"; // Default fallback
  }

  const key = `${language.toLowerCase()}-${country.toLowerCase()}`;
  return GOOGLE_DOMAIN_MAP[key] || "google.com";
}

/**
 * Get language name from language code
 * @param {string} languageCode - Language code (e.g., 'fr', 'nl', 'en')
 * @returns {string} Language name (e.g., 'French', 'Dutch', 'English')
 */
export function getLanguageName(languageCode) {
  const languageMap = {
    'fr': 'French',
    'nl': 'Dutch',
    'en': 'English',
    'de': 'German',
    'es': 'Spanish',
    'it': 'Italian',
    'pt': 'Portuguese',
    'pl': 'Polish',
  };

  return languageMap[languageCode?.toLowerCase()] || 'English';
}

/**
 * Parse language-country string (e.g., 'fr-fr', 'nl-be') into language and country
 * @param {string} locale - Locale string (e.g., 'fr-fr', 'nl-be')
 * @returns {Object} { language: 'fr', country: 'fr' }
 */
export function parseLocale(locale) {
  if (!locale) {
    return { language: 'en', country: 'us' };
  }

  const parts = locale.toLowerCase().split('-');
  if (parts.length >= 2) {
    return {
      language: parts[0],
      country: parts[1],
    };
  }

  // If only one part, assume it's both language and country
  return {
    language: parts[0] || 'en',
    country: parts[0] || 'us',
  };
}




