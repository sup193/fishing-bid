import { speechLocale } from './languages.js';
import { speechErrorKey } from './speechErrors.js';

export function createBrowserRecognition(environment, language, handlers = {}) {
  const Recognition = environment?.SpeechRecognition || environment?.webkitSpeechRecognition;
  if (typeof Recognition !== 'function') return null;
  const recognition = new Recognition();
  recognition.lang = speechLocale(language);
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => handlers.onStart?.();
  recognition.onresult = event => {
    const result = event.results?.[event.resultIndex || 0]?.[0]?.transcript;
    if (result) handlers.onTranscript?.(result.trim());
  };
  recognition.onerror = event => handlers.onError?.(speechErrorKey(event.error));
  recognition.onend = () => handlers.onEnd?.();
  return recognition;
}

export function speakBrowser(environment, text, language) {
  if (!environment?.speechSynthesis || typeof environment.SpeechSynthesisUtterance !== 'function') return false;
  environment.speechSynthesis.cancel();
  const utterance = new environment.SpeechSynthesisUtterance(text);
  utterance.lang = speechLocale(language);
  environment.speechSynthesis.speak(utterance);
  return true;
}
