import { DEFAULT_LOCALE } from '../config/index.js';


export function getLocaleFromRequest(req) {
  // 1. Check request body first (explicitly sent from frontend)
  if (req.body?.locale) {
    return normalizeLocale(req.body.locale);
  }

  // 2. Check Accept-Language header
  if (req.headers['accept-language']) {
    const acceptLanguage = req.headers['accept-language'];
    // Parse Accept-Language header (e.g., "fr-FR,fr;q=0.9,en;q=0.8")
    const languages = acceptLanguage.split(',').map(lang => {
      const [code] = lang.split(';');
      return code.trim().toLowerCase();
    });
    
    // Try to match supported languages
    for (const lang of languages) {
      if (lang.startsWith('fr')) return 'fr';
      if (lang.startsWith('nl')) return 'nl';
      if (lang.startsWith('en')) return 'en';
    }
  }

  // 3. Default to English
  return DEFAULT_LOCALE;
}


export function normalizeLocale(locale) {
  if (!locale) return DEFAULT_LOCALE;
  
  const normalized = locale.toLowerCase().replace(/[_-]/g, '-');
  
  // Extract language code (first part before - or _)
  const languageCode = normalized.split('-')[0];
  
  // Map to supported email languages (en, fr, nl)
  if (['fr', 'french', 'français'].includes(languageCode)) return 'fr';
  if (['nl', 'dutch', 'nederlands'].includes(languageCode)) return 'nl';
  
  // Default to English
  return 'en';
}

