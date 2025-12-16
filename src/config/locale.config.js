export const SUPPORTED_LOCALES = {
    en: {
      code: 'en',
      language: 'en',
      languageName: 'English',
      languageCode: 'en',
      region: 'US',
      locationName: 'United States',
      seDomain: 'google.com',
      displayName: 'English (US)',
    },
    fr_fr: {
      code: 'fr_fr',
      language: 'fr',
      languageName: 'French',
      languageCode: 'fr',
      region: 'FR',
      locationName: 'France',
      seDomain: 'google.fr',
      displayName: 'French (France)',
    },
    fr_be: {
      code: 'fr_be',
      language: 'fr',
      languageName: 'French',
      languageCode: 'fr',
      region: 'BE',
      locationName: 'Belgium',
      seDomain: 'google.be',
      displayName: 'French (Belgium)',
    },
    nl_be: {
      code: 'nl_be',
      language: 'nl',
      languageName: 'Dutch',
      languageCode: 'nl',
      region: 'BE',
      locationName: 'Belgium',
      seDomain: 'google.be',
      displayName: 'Dutch (Belgium)',
    },
    nl_nl: {
      code: 'nl_nl',
      language: 'nl',
      languageName: 'Dutch',
      languageCode: 'nl',
      region: 'NL',
      locationName: 'Netherlands',
      seDomain: 'google.nl',
      displayName: 'Dutch (Netherlands)',
    },
  };
  
  export const DEFAULT_LOCALE = 'en';
  
  export const getLocaleConfig = (localeCode) => {
    if (!localeCode) return SUPPORTED_LOCALES[DEFAULT_LOCALE];
    const normalized = localeCode.toLowerCase().replace('-', '_');
    return SUPPORTED_LOCALES[normalized] || SUPPORTED_LOCALES[DEFAULT_LOCALE];
  };
  
  export const getSupportedLocales = () => Object.keys(SUPPORTED_LOCALES);
  
  export const isValidLocale = (localeCode) => {
    if (!localeCode) return true; // Default is valid
    const normalized = localeCode.toLowerCase().replace('-', '_');
    return !!SUPPORTED_LOCALES[normalized];
  };