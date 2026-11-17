import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { speechLocale } from '../../../shared/voice/languages.js';
import { speechErrorKey } from '../../../shared/voice/speechErrors.js';
import { createBrowserRecognition, speakBrowser } from '../../../shared/voice/browserSpeech.js';

export async function beginSpeechRecognition(language, handlers = {}) {
  if (Platform.OS === 'web') {
    const recognition = createBrowserRecognition(globalThis, language, handlers);
    if (!recognition) return null;
    try {
      recognition.start();
      return {
        stop: () => recognition.stop(),
        abort: () => recognition.abort?.(),
        dispose: () => {}
      };
    } catch (error) {
      handlers.onError?.(speechErrorKey(error?.name));
      return null;
    }
  }

  let speechRecognition;
  try {
    speechRecognition = await import('expo-speech-recognition');
  } catch (error) {
    handlers.onError?.(speechErrorKey(error?.code || error?.message));
    return null;
  }
  const module = speechRecognition.ExpoSpeechRecognitionModule;
  if (!module || !module.isRecognitionAvailable()) return null;

  const permissions = await module.requestPermissionsAsync();
  if (!permissions.granted) {
    handlers.onError?.('permission');
    return null;
  }

  const subscriptions = [
    module.addListener('start', () => handlers.onStart?.()),
    module.addListener('result', event => {
      const transcript = event.results?.find(result => result.isFinal)?.transcript
        || event.results?.[0]?.transcript;
      if (transcript) handlers.onTranscript?.(transcript.trim());
    }),
    module.addListener('error', event => handlers.onError?.(speechErrorKey(event.error))),
    module.addListener('end', () => handlers.onEnd?.())
  ];

  try {
    module.start({ lang: speechLocale(language), continuous: false, interimResults: false });
  } catch (error) {
    subscriptions.forEach(subscription => subscription.remove());
    handlers.onError?.(speechErrorKey(error?.code || error?.message));
    return null;
  }
  return {
    stop: () => module.stop(),
    abort: () => module.abort(),
    dispose: () => {
      subscriptions.forEach(subscription => subscription.remove());
    }
  };
}

export function speakMobile(text, language) {
  if (Platform.OS === 'web') return speakBrowser(globalThis, text, language);
  try {
    Speech.speak(text, { language: speechLocale(language) });
    return true;
  } catch {
    return false;
  }
}
