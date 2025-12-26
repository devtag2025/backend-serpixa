import en from './en.json' with { type: 'json' };
import fr from './fr.json' with { type: 'json' };
import nl from './nl.json' with { type: 'json' };

export const translations = { en, fr, nl };

export const getTranslation = (lang, path, replacements = {}) => {
  const language = ['fr', 'nl'].includes(lang) ? lang : 'en';
  const keys = path.split('.');
  
  let value = translations[language];
  for (const key of keys) {
    value = value?.[key];
    if (!value) break;
  }

  // Fallback to English
  if (!value) {
    value = translations.en;
    for (const key of keys) {
      value = value?.[key];
      if (!value) break;
    }
  }

  if (typeof value === 'string') {
    return Object.entries(replacements).reduce(
      (str, [key, val]) => str.replace(new RegExp(`\\{${key}\\}`, 'g'), val),
      value
    );
  }

  return value || path;
};

export const t = getTranslation;