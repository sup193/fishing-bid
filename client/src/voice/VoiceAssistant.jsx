import { useEffect, useRef, useState } from 'react';
import { Check, Mic, MicOff, Send, Volume2, X } from 'lucide-react';
import { SUPPORTED_LANGUAGES, normalizeLanguage } from '../../../shared/voice/languages.js';
import {
  createVoiceActionGuard,
  executeConfirmedVoiceAction,
  fillListingField,
  resolveVoiceIntent
} from '../../../shared/voice/actions.js';
import { extractFishType, parseVoiceCommand } from '../../../shared/voice/intents.js';
import { translate } from '../../../shared/voice/translations.js';
import { api } from '../api.js';
import { createBrowserRecognition, speakBrowser } from './speech.js';

function isCancelCommand(text) {
  return /^(cancel|stop|ರದ್ದು|ನಿಲ್ಲಿಸಿ|रद्द|रोकें|ரத்து|நிறுத்து|రద్దు|ఆపు|റദ്ദാക്കുക|നിർത്തുക)$/iu.test(text.trim());
}

function listingPrice(item) {
  return Number(item.saleMode === 'bid'
    ? item.auction?.currentPrice || item.auction?.startPrice || item.expectedPrice
    : item.salePrice || item.expectedPrice);
}

export default function VoiceAssistant({ user, onUserUpdate, onSearch, onActionComplete }) {
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
    api,
    language: action.language
  })));

  useEffect(() => () => {
    recognitionRef.current?.abort?.();
  }, []);

  const speak = text => {
    if (!speakBrowser(window, text, language)) {
      setError(translate(language, 'speechOutputUnavailable'));
    }
  };

  const respond = text => {
    setResponse(text);
    setError('');
    speak(text);
  };

  const saveLanguage = async nextLanguage => {
    setLanguage(nextLanguage);
    setPending(null);
    setDraft(null);
    setSelection(null);
    setError('');
    try {
      const result = await api.updatePreferredLanguage(nextLanguage);
      onUserUpdate?.(result.user);
      respond(translate(nextLanguage, 'languageSaved'));
    } catch (saveError) {
      setError(`${translate(nextLanguage, 'languageSaveFailed')} ${saveError.message}`);
    }
  };

  const startListening = () => {
    setError('');
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }
    const recognition = createBrowserRecognition(window, language, {
      onStart: () => setListening(true),
      onTranscript: transcript => {
        setRecognizedText(transcript);
        setInput(transcript);
      },
      onError: key => {
        setError(translate(language, key));
        setListening(false);
      },
      onEnd: () => {
        setListening(false);
        recognitionRef.current = null;
      }
    });
    if (!recognition) {
      setError(translate(language, 'speechUnavailable'));
      return;
    }
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (startError) {
      recognitionRef.current = null;
      setListening(false);
      setError(translate(language, startError?.name === 'NotAllowedError' ? 'permission' : 'speechUnavailable'));
    }
  };

  const handleResolution = result => {
    setResults(result.results || result.candidates || []);
    if (result.askField) {
      setDraft({ fields: result.fields, field: result.askField });
    } else {
      setDraft(null);
    }
    setSelection(result.askForFish ? { intent: result.intent } : null);
    if (result.confirmation) {
      setPending({ ...result.confirmation, language });
      respond(`${result.message} ${translate(language, 'confirmRequired')}`);
      return;
    }
    respond([result.message, result.note].filter(Boolean).join(' '));
  };

  const submitCommand = async event => {
    event.preventDefault();
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
          api,
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
          api,
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
      handleResolution(await resolveVoiceIntent({ intent, role: user.role, api, language }));
    } catch (commandError) {
      setError(commandError.message);
      respond(translate(language, 'actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  const confirmAction = async () => {
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
  };

  const cancelAction = () => {
    setPending(null);
    setDraft(null);
    setSelection(null);
    setResults([]);
    respond(translate(language, 'cancelled'));
  };

  return <section className="voice-assistant" aria-label={translate(language, 'title')}>
    <div className="voice-assistant-heading">
      <div>
        <p className="kicker">TIDEMARKET VOICE</p>
        <h2>{translate(language, 'title')}</h2>
        <p>{translate(language, 'subtitle')}</p>
      </div>
      <label className="voice-language-select">
        <span>{translate(language, 'language')}</span>
        <select aria-label={translate(language, 'language')} value={language} onChange={event => saveLanguage(event.target.value)}>
          {SUPPORTED_LANGUAGES.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
        </select>
      </label>
    </div>

    <div className={`voice-listening-state${listening ? ' is-listening' : ''}`} role="status" aria-live="polite">
      <span className="voice-pulse"><i /></span>
      {listening ? translate(language, 'listening') : translate(language, 'recognized')}
    </div>
    {recognizedText && <p className="voice-recognized-text" aria-live="polite">“{recognizedText}”</p>}
    <div className="voice-assistant-controls">
      <button type="button" className={`voice-mic-button${listening ? ' is-listening' : ''}`} onClick={startListening} aria-label={translate(language, listening ? 'stop' : 'listen')} disabled={busy}>
        {listening ? <MicOff size={18} /> : <Mic size={18} />} {translate(language, listening ? 'stop' : 'listen')}
      </button>
      <form className="voice-text-form" onSubmit={submitCommand}>
        <label className="sr-only" htmlFor="voice-command-input">{translate(language, 'textLabel')}</label>
        <input id="voice-command-input" value={input} onChange={event => setInput(event.target.value)} placeholder={translate(language, 'textPlaceholder')} disabled={busy} />
        <button type="submit" className="voice-send-button" aria-label={translate(language, 'send')} disabled={!input.trim() || busy}><Send size={17} /></button>
      </form>
    </div>
    <p className="voice-privacy-note">{translate(language, 'privacy')}</p>
    {error && <p className="voice-error" role="alert">{error}</p>}
    <div className="voice-response" aria-live="polite">
      <div className="voice-response-label"><Volume2 size={16} /><strong>{translate(language, 'response')}</strong></div>
      <p>{response}</p>
    </div>

    {pending && <div className="voice-confirmation" role="group" aria-label={translate(language, 'confirm')}>
      <div><strong>{translate(language, 'confirmRequired')}</strong><p>{response.split(` ${translate(language, 'confirmRequired')}`)[0]}</p></div>
      <div className="voice-confirmation-actions">
        <button type="button" className="button primary" onClick={confirmAction} disabled={busy}><Check size={16} /> {translate(language, 'confirm')}</button>
        <button type="button" className="button secondary" onClick={cancelAction} disabled={busy}><X size={16} /> {translate(language, 'cancel')}</button>
      </div>
    </div>}
    {(draft || selection) && <button type="button" className="voice-cancel-pending" onClick={cancelAction}>{translate(language, 'cancelPending')}</button>}

    {results.length > 0 && <div className="voice-results" aria-label={translate(language, 'results')}>
      <strong>{translate(language, 'results')}</strong>
      {results.slice(0, 5).map(item => <article key={item.id || item.auction?.id} className="voice-result-row">
        <span><b>{item.fishType}</b><small>{item.location || ''}{item.quantity ? ` · ${item.quantity} kg` : ''}</small></span>
        <span className="voice-result-price">₹{listingPrice(item).toLocaleString('en-IN')}/kg</span>
      </article>)}
    </div>}
  </section>;
}
