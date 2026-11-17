import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SUPPORTED_LANGUAGES, normalizeLanguage } from '../../../shared/voice/languages';
import {
  createVoiceActionGuard,
  executeConfirmedVoiceAction,
  fillListingField,
  resolveVoiceIntent
} from '../../../shared/voice/actions';
import { extractFishType, parseVoiceCommand } from '../../../shared/voice/intents';
import { translate } from '../../../shared/voice/translations';
import { mobileApi } from '../../api';
import { beginSpeechRecognition, speakMobile } from '../voice/speech';
import { Button, Card, colors, Notice } from './common';

function isCancelCommand(text) {
  return /^(cancel|stop|ರದ್ದು|ನಿಲ್ಲಿಸಿ|रद्द|रोकें|ரத்து|நிறுத்து|రద్దు|ఆపు|റദ്ദാക്കുക|നിർത്തുക)$/iu.test(text.trim());
}

function itemPrice(item) {
  return Number(item.saleMode === 'bid'
    ? item.auction?.currentPrice || item.auction?.startPrice || item.expectedPrice
    : item.salePrice || item.expectedPrice);
}

export default function VoiceAssistantPanel({ user, onUserUpdate, onSearch, onActionComplete }) {
  const [language, setLanguage] = useState(() => normalizeLanguage(user?.preferredLanguage));
  const [input, setInput] = useState('');
  const [recognizedText, setRecognizedText] = useState('');
  const [response, setResponse] = useState(() => translate(user?.preferredLanguage, 'subtitle'));
  const [error, setError] = useState('');
  const [pending, setPending] = useState(null);
  const [draft, setDraft] = useState(null);
  const [selection, setSelection] = useState(null);
  const [results, setResults] = useState([]);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const recognitionRef = useRef(null);
  const actionGuardRef = useRef(createVoiceActionGuard(action => executeConfirmedVoiceAction({
    action,
    role: user.role,
    api: mobileApi,
    language: action.language
  })));

  useEffect(() => () => {
    recognitionRef.current?.abort?.();
    recognitionRef.current?.dispose?.();
  }, []);

  function speak(text) {
    if (!speakMobile(text, language)) {
      setError(translate(language, 'speechOutputUnavailable'));
    }
  }

  function respond(text) {
    setResponse(text);
    setError('');
    speak(text);
  }

  async function saveLanguage(nextLanguage) {
    setLanguage(nextLanguage);
    setPending(null);
    setDraft(null);
    setSelection(null);
    setError('');
    try {
      const result = await mobileApi.updatePreferredLanguage(nextLanguage);
      onUserUpdate?.(result.user);
      respond(translate(nextLanguage, 'languageSaved'));
    } catch (saveError) {
      setError(`${translate(nextLanguage, 'languageSaveFailed')} ${saveError.message}`);
    }
  }

  async function listen() {
    setError('');
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }
    let reportedError = false;
    const service = await beginSpeechRecognition(language, {
      onStart: () => setListening(true),
      onTranscript: transcript => {
        setRecognizedText(transcript);
        setInput(transcript);
      },
      onError: key => {
        reportedError = true;
        setError(translate(language, key));
        setListening(false);
      },
      onEnd: () => {
        setListening(false);
        recognitionRef.current?.dispose?.();
        recognitionRef.current = null;
      }
    });
    if (!service) {
      setListening(false);
      if (!reportedError) setError(translate(language, 'speechUnavailable'));
      return;
    }
    recognitionRef.current = service;
    setListening(true);
  }

  function handleResolution(result) {
    setResults(result.results || result.candidates || []);
    setDraft(result.askField ? { fields: result.fields, field: result.askField } : null);
    setSelection(result.askForFish ? { intent: result.intent } : null);
    if (result.confirmation) {
      setPending({ ...result.confirmation, language });
      respond(`${result.message} ${translate(language, 'confirmRequired')}`);
      return;
    }
    respond([result.message, result.note].filter(Boolean).join(' '));
  }

  async function submitCommand() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setRecognizedText(text);
    setError('');
    if (pending) {
      if (isCancelCommand(text)) {
        setPending(null);
        setResults([]);
        respond(translate(language, 'cancelled'));
      } else {
        respond(translate(language, 'confirmRequired'));
      }
      return;
    }

    setBusy(true);
    try {
      if (draft) {
        const fields = fillListingField(draft.fields, draft.field, text);
        handleResolution(await resolveVoiceIntent({
          intent: { type: 'create_listing', fields },
          role: user.role,
          api: mobileApi,
          language
        }));
        return;
      }
      if (selection) {
        const fishType = extractFishType(text);
        if (!fishType) {
          respond(translate(language, 'unclear'));
          return;
        }
        handleResolution(await resolveVoiceIntent({
          intent: { ...selection.intent, fishType },
          role: user.role,
          api: mobileApi,
          language
        }));
        return;
      }
      const intent = parseVoiceCommand(text, language);
      if (!intent) {
        respond(translate(language, 'unclear'));
        return;
      }
      if (intent.type === 'search') onSearch?.(intent);
      handleResolution(await resolveVoiceIntent({ intent, role: user.role, api: mobileApi, language }));
    } catch (commandError) {
      setError(commandError.message);
      respond(translate(language, 'actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmAction() {
    if (!pending || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await actionGuardRef.current(pending);
      if (result.duplicate) {
        respond(translate(language, 'commandAccepted'));
        return;
      }
      setPending(null);
      setDraft(null);
      setSelection(null);
      setResults([]);
      respond(result.message);
      await onActionComplete?.();
    } catch (actionError) {
      setError(actionError.message);
      respond(translate(language, 'actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  function cancelAction() {
    setPending(null);
    setDraft(null);
    setSelection(null);
    setResults([]);
    respond(translate(language, 'cancelled'));
  }

  return (
    <Card style={styles.panel}>
      <View style={styles.header}>
        <View style={styles.heading}>
          <Text style={styles.kicker}>TIDEMARKET VOICE</Text>
          <Text style={styles.title}>{translate(language, 'title')}</Text>
          <Text style={styles.subtitle}>{translate(language, 'subtitle')}</Text>
        </View>
      </View>
      <Text style={styles.languageLabel}>{translate(language, 'language')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.languages}>
        {SUPPORTED_LANGUAGES.map(item => (
          <Pressable
            key={item.code}
            accessibilityRole="button"
            accessibilityState={{ selected: language === item.code }}
            onPress={() => saveLanguage(item.code)}
            style={[styles.languageChip, language === item.code && styles.languageChipSelected]}
          >
            <Text style={[styles.languageText, language === item.code && styles.languageTextSelected]}>{item.name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={[styles.listening, listening && styles.listeningActive]} accessibilityLiveRegion="polite">
        {listening ? <ActivityIndicator size="small" color={colors.sea} /> : <View style={styles.statusDot} />}
        <Text style={styles.listeningText}>{translate(language, listening ? 'listening' : 'recognized')}</Text>
      </View>
      {recognizedText ? <Text style={styles.recognized} accessibilityLiveRegion="polite">“{recognizedText}”</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={translate(language, listening ? 'stop' : 'listen')}
        onPress={listen}
        disabled={busy}
        style={[styles.micButton, listening && styles.micButtonActive, busy && styles.disabled]}
      >
        <Text style={styles.micButtonText}>{translate(language, listening ? 'stop' : 'listen')}</Text>
      </Pressable>
      <Text style={styles.inputLabel}>{translate(language, 'textLabel')}</Text>
      <TextInput
        accessibilityLabel={translate(language, 'textLabel')}
        value={input}
        onChangeText={setInput}
        onSubmitEditing={submitCommand}
        placeholder={translate(language, 'textPlaceholder')}
        placeholderTextColor={colors.muted}
        editable={!busy}
        returnKeyType="send"
        style={styles.input}
      />
      <Button label={translate(language, 'send')} onPress={submitCommand} loading={busy} disabled={!input.trim()} />
      <Text style={styles.privacy}>{translate(language, 'privacy')}</Text>
      {error ? <Notice>{error}</Notice> : null}
      <View style={styles.response}>
        <Text style={styles.responseLabel}>{translate(language, 'response')}</Text>
        <Text style={styles.responseText} accessibilityLiveRegion="polite">{response}</Text>
      </View>

      {pending ? <View style={styles.confirmation}>
        <Text style={styles.confirmText}>{translate(language, 'confirmRequired')}</Text>
        <Button label={translate(language, 'confirm')} onPress={confirmAction} loading={busy} />
        <Button label={translate(language, 'cancel')} variant="secondary" onPress={cancelAction} disabled={busy} />
      </View> : null}
      {(draft || selection) && !pending ? <Button label={translate(language, 'cancelPending')} variant="secondary" onPress={cancelAction} /> : null}
      {results.length ? <View style={styles.results}>
        <Text style={styles.responseLabel}>{translate(language, 'results')}</Text>
        {results.slice(0, 5).map(item => (
          <View key={item.id || item.auction?.id} style={styles.resultRow}>
            <View style={styles.resultName}>
              <Text style={styles.resultFish}>{item.fishType}</Text>
              <Text style={styles.resultMeta}>{item.location || ''}{item.quantity ? ` · ${item.quantity} kg` : ''}</Text>
            </View>
            <Text style={styles.resultPrice}>₹{itemPrice(item).toLocaleString('en-IN')}/kg</Text>
          </View>
        ))}
      </View> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 12, marginBottom: 16, borderColor: colors.sea, borderWidth: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between' },
  heading: { flex: 1 },
  kicker: { color: colors.sea, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 21, fontWeight: '800', marginTop: 4 },
  subtitle: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  languageLabel: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  languages: { gap: 7 },
  languageChip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: colors.white },
  languageChipSelected: { backgroundColor: colors.ink, borderColor: colors.ink },
  languageText: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  languageTextSelected: { color: colors.white },
  listening: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 24 },
  listeningActive: { backgroundColor: colors.pale, paddingHorizontal: 8, borderRadius: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.sea },
  listeningText: { color: colors.muted, fontSize: 12 },
  recognized: { color: colors.ink, fontSize: 14, fontStyle: 'italic' },
  micButton: { backgroundColor: colors.sea, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  micButtonActive: { backgroundColor: colors.coral },
  micButtonText: { color: colors.white, fontWeight: '800' },
  disabled: { opacity: 0.6 },
  inputLabel: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 11, color: colors.ink },
  privacy: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  response: { backgroundColor: colors.foam, borderRadius: 8, padding: 12, gap: 6 },
  responseLabel: { color: colors.sea, fontSize: 12, fontWeight: '800' },
  responseText: { color: colors.ink, fontSize: 13, lineHeight: 19 },
  confirmation: { gap: 9, borderWidth: 1, borderColor: colors.coral, borderRadius: 8, padding: 12 },
  confirmText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  results: { gap: 8 },
  resultRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 8 },
  resultName: { flex: 1, gap: 3 },
  resultFish: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  resultMeta: { color: colors.muted, fontSize: 11 },
  resultPrice: { color: colors.coral, fontSize: 12, fontWeight: '800' }
});
