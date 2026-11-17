import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createVoiceActionGuard,
  executeConfirmedVoiceAction,
  fillListingField,
  resolveVoiceIntent
} from '../../shared/voice/actions.js';
import { normalizeLanguage, speechLocale, SUPPORTED_LANGUAGES } from '../../shared/voice/languages.js';
import { extractFishType, parseVoiceCommand } from '../../shared/voice/intents.js';
import { createBrowserRecognition, speakBrowser } from '../../shared/voice/browserSpeech.js';
import { speechErrorKey } from '../../shared/voice/speechErrors.js';

test('language preferences resolve all supported languages and fall back safely', () => {
  assert.deepEqual(SUPPORTED_LANGUAGES.map(item => item.code), ['en', 'kn', 'hi', 'ta', 'te', 'ml']);
  for (const language of SUPPORTED_LANGUAGES) {
    assert.equal(normalizeLanguage(language.code), language.code);
    assert.equal(speechLocale(language.code), language.locale);
  }
  assert.equal(normalizeLanguage('fr'), 'en');
});

test('fresh fish searches parse in English, Kannada, Hindi, Tamil, Telugu and Malayalam', () => {
  const commands = [
    ['Show me fresh fish', 'en'],
    ['ನನಗೆ ತಾಜಾ ಮೀನು ತೋರಿಸಿ', 'kn'],
    ['मुझे ताज़ी मछली दिखाओ', 'hi'],
    ['புதிய மீன் காட்டுங்கள்', 'ta'],
    ['తాజా చేపలు చూపించు', 'te'],
    ['പുതിയ മീൻ കാണിക്കുക', 'ml']
  ];
  for (const [command, language] of commands) {
    assert.equal(parseVoiceCommand(command, language)?.type, 'search', command);
    assert.equal(parseVoiceCommand(command, language)?.freshest, true, command);
  }
});

test('localized species names, price and location filters produce a filtered search intent', () => {
  assert.equal(extractFishType('நண்டு'), 'Crab');
  assert.equal(extractFishType('ಸೀಗಡಿ'), 'Prawns');
  const intent = parseVoiceCommand('Find prawns under 500 in Mangalore');
  assert.equal(intent.type, 'search');
  assert.equal(intent.fishType, 'Prawns');
  assert.equal(intent.maxPrice, 500);
  assert.equal(intent.location, 'mangalore');
  const items = [
    { id: 'one', fishType: 'Prawns', salePrice: 400, location: 'Mangalore' },
    { id: 'two', fishType: 'Prawns', salePrice: 400, location: 'Udupi' },
    { id: 'three', fishType: 'Prawns', salePrice: 600, location: 'Mangalore' }
  ];
  return resolveVoiceIntent({ intent, role: 'buyer', api: { listings: async () => items } })
    .then(result => assert.deepEqual(result.results.map(item => item.id), ['one']));
});

test('auction and marketplace commands are recognized in supported local languages', () => {
  for (const [command, language] of [
    ['Place a bid of 700 rupees', 'en'],
    ['700 ರೂಪಾಯಿ ಬಿಡ್ ಮಾಡಿ', 'kn'],
    ['700 रुपये की बोली लगाओ', 'hi'],
    ['700 ரூபாய் ஏலமிடு', 'ta'],
    ['700 రూపాయలు బిడ్ వేయి', 'te'],
    ['700 രൂപ ബിഡ്', 'ml']
  ]) {
    const intent = parseVoiceCommand(command, language);
    assert.equal(intent?.type, 'place_bid', command);
    assert.equal(intent.amount, 700, command);
  }
  assert.equal(parseVoiceCommand('என் ஆர்டர்கள்', 'ta')?.type, 'orders');
  assert.equal(parseVoiceCommand('నా అమ్మకాలు', 'te')?.type, 'sales');
  assert.equal(parseVoiceCommand('പുതിയ മീൻ ലിസ്റ്റിംഗ് ചേർക്കുക', 'ml')?.type, 'create_listing');
});

test('fisherman listing creation prompts for missing fields and requires explicit confirmation', async () => {
  const calls = [];
  const api = {
    meta: async () => ({ fishTypes: ['Tuna', 'Prawns'] }),
    createListing: async body => calls.push(body)
  };
  const start = await resolveVoiceIntent({
    intent: parseVoiceCommand('Add new fish listing', 'en'),
    role: 'fisherman',
    api
  });
  assert.equal(start.askField, 'fishType');
  let fields = fillListingField(start.fields, 'fishType', 'Tuna');
  fields = fillListingField(fields, 'quantity', '10 kg');
  fields = fillListingField(fields, 'price', '300 rupees');
  fields = fillListingField(fields, 'location', 'in Mangalore');
  const prepared = await resolveVoiceIntent({
    intent: { type: 'create_listing', fields },
    role: 'fisherman',
    api
  });
  assert.equal(prepared.confirmation.type, 'create_listing');
  assert.equal(calls.length, 0);
  await executeConfirmedVoiceAction({ action: prepared.confirmation, role: 'fisherman', api });
  assert.equal(calls.length, 1);
  assert.deepEqual(
    { fishType: calls[0].fishType, quantity: calls[0].quantity, salePrice: calls[0].salePrice, location: calls[0].location },
    { fishType: 'Tuna', quantity: 10, salePrice: 300, location: 'Mangalore' }
  );
  assert.ok(calls[0].requestId);
});

test('voice bidding reads details and cannot submit before explicit confirmation', async () => {
  const calls = [];
  const listing = {
    id: 'tuna-listing',
    fishType: 'Tuna',
    saleMode: 'bid',
    auction: { id: 'tuna-auction', status: 'active', endTime: new Date(Date.now() + 60_000).toISOString() }
  };
  const api = {
    listings: async () => [listing],
    auction: async () => ({
      listing,
      auction: { id: 'tuna-auction', status: 'active', currentPrice: 500, minimumIncrement: 50, endTime: listing.auction.endTime }
    }),
    bid: async (...args) => calls.push(args)
  };
  const result = await resolveVoiceIntent({
    intent: parseVoiceCommand('Place a bid of 700 rupees on tuna'),
    role: 'buyer',
    api
  });
  assert.equal(result.confirmation.fishType, 'Tuna');
  assert.equal(result.confirmation.amount, 700);
  assert.match(result.message, /Tuna/);
  assert.match(result.message, /700/);
  assert.equal(calls.length, 0);
  await executeConfirmedVoiceAction({ action: result.confirmation, role: 'buyer', api });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ['tuna-auction', 700]);
});

test('role checks block buyer listing actions and fisherman bidding', async () => {
  let reads = 0;
  const api = { listings: async () => { reads += 1; return []; } };
  const buyerResult = await resolveVoiceIntent({
    intent: { type: 'create_listing', fields: {} },
    role: 'buyer',
    api
  });
  assert.match(buyerResult.message, /permission|allowed|ಅನುಮತಿ|अनुमति|அனுமதி|అనుమతి|അനുമതി/i);
  await assert.rejects(
    executeConfirmedVoiceAction({ action: { type: 'place_bid' }, role: 'fisherman', api }),
    /permission|allowed|அனுமதி|అనుమతి|അനുമതി/i
  );
  assert.equal(reads, 0);
});

test('repeated confirmation uses one in-flight request and does not repeat completed actions', async () => {
  let calls = 0;
  const guard = createVoiceActionGuard(async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 5));
    return { ok: true };
  });
  const action = { id: 'confirmation-once', type: 'place_bid' };
  const [first, concurrent] = await Promise.all([guard(action), guard(action)]);
  assert.deepEqual(first, { ok: true });
  assert.deepEqual(concurrent, { ok: true });
  assert.deepEqual(await guard(action), { duplicate: true });
  assert.equal(calls, 1);
});

test('browser speech reports transcripts and maps microphone errors without executing commands', () => {
  let instance;
  class MockRecognition {
    constructor() { instance = this; }
    start() { this.onstart?.(); }
    stop() {}
  }
  const transcripts = [];
  let starts = 0;
  const recognition = createBrowserRecognition({ SpeechRecognition: MockRecognition }, 'kn', {
    onStart: () => { starts += 1; },
    onTranscript: value => transcripts.push(value)
  });
  recognition.start();
  instance.onresult({ resultIndex: 0, results: [[{ transcript: '  ಸೀಗಡಿ ತೋರಿಸಿ  ' }]] });
  assert.equal(instance.lang, 'kn-IN');
  assert.equal(starts, 1);
  assert.deepEqual(transcripts, ['ಸೀಗಡಿ ತೋರಿಸಿ']);
  assert.equal(speechErrorKey('not-allowed'), 'permission');
  assert.equal(createBrowserRecognition({}, 'en'), null);
});

test('speech synthesis falls back cleanly when unavailable and localizes supported output', () => {
  assert.equal(speakBrowser({}, 'Hello', 'en'), false);
  let utterance;
  let spoken = 0;
  class MockUtterance {
    constructor(text) { this.text = text; utterance = this; }
  }
  const environment = {
    SpeechSynthesisUtterance: MockUtterance,
    speechSynthesis: { cancel() {}, speak: () => { spoken += 1; } }
  };
  assert.equal(speakBrowser(environment, 'ನಮಸ್ಕಾರ', 'kn'), true);
  assert.equal(utterance.lang, 'kn-IN');
  assert.equal(spoken, 1);
});
