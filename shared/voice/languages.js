export const SUPPORTED_LANGUAGES = Object.freeze([
  { code: 'en', name: 'English', locale: 'en-IN' },
  { code: 'kn', name: 'ಕನ್ನಡ', locale: 'kn-IN' },
  { code: 'hi', name: 'हिन्दी', locale: 'hi-IN' },
  { code: 'ta', name: 'தமிழ்', locale: 'ta-IN' },
  { code: 'te', name: 'తెలుగు', locale: 'te-IN' },
  { code: 'ml', name: 'മലയാളം', locale: 'ml-IN' }
]);

export function normalizeLanguage(language) {
  return SUPPORTED_LANGUAGES.some(item => item.code === language) ? language : 'en';
}

export function speechLocale(language) {
  return SUPPORTED_LANGUAGES.find(item => item.code === normalizeLanguage(language)).locale;
}
