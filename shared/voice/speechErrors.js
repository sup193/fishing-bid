export function speechErrorKey(code) {
  if (['not-allowed', 'service-not-allowed', 'permission-denied', 'audio-capture'].includes(code)) return 'permission';
  if (code === 'network') return 'networkError';
  if (code === 'no-speech') return 'noSpeech';
  if (code === 'language-not-supported' || code === 'unsupported-language') return 'unsupportedLanguage';
  return 'speechUnavailable';
}
