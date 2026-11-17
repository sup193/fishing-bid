const fishNames = [
  ['Tuna', ['tuna', 'ಟ್ಯೂನಾ', 'टूना', 'சூரை', 'ట్యూనా', 'ചൂര']],
  ['Pomfret', ['pomfret', 'பாம்ப்ரெட்', 'पॉम्फ्रेट', 'வாவல்', 'చందువ', 'ആവോലി']],
  ['Mackerel', ['mackerel', 'ಬಂಗುಡೆ', 'मैकेरल', 'கானாங்கெளுத்தி', 'అయిల', 'അയല']],
  ['Sardine', ['sardine', 'ಮತ್ತಿ', 'सार्डिन', 'மத்தி', 'మత్తి', 'മത്തി']],
  ['Prawns', ['prawn', 'prawns', 'shrimp', 'ಸೀಗಡಿ', 'झींगा', 'இறால்', 'రొయ్యలు', 'ചെമ്മീൻ']],
  ['Kingfish', ['kingfish', 'ಸುರಳಿ', 'सुरमई', 'வஞ்சிரம்', 'వంజరం', 'നെയ്മീൻ']],
  ['Crab', ['crab', 'ಏಡಿ', 'केकड़ा', 'நண்டு', 'పీత', 'ഞണ്ട്']],
  ['Squid', ['squid', 'ಕಣವ', 'स्क्विड', 'கணவாய்', 'కలమారి', 'കൂന്തൽ']],
  ['Lobster', ['lobster', 'ನಳ್ಳಿ', 'लॉब्स्टर', 'இறால் நண்டு', 'ఎండ్రకాయ', 'കൊഞ്ച്']],
  ['Clams', ['clam', 'clams', 'ಕಪ್ಪೆಚಿಪ್ಪು', 'क्लैम', 'சிப்பி', 'క్లామ్', 'കക്ക']],
  ['Mussels', ['mussel', 'mussels', 'ಮಸ್ಸೆಲ್', 'मसल्स', 'மஸ்ஸல்ஸ்', 'మస్సెల్స్', 'കല്ലുമ്മക്കായ']],
  ['Oysters', ['oyster', 'oysters', 'ಆಯ್ಸ್ಟರ್', 'ऑयस्टर', 'சிப்பி சிப்பி', 'ఆయిస్టర్', 'ഓയിസ്റ്റർ']],
  ['Anchovy', ['anchovy', 'ನೆತ್ತಿ', 'एंचोवी', 'நெத்திலி', 'నెత్తలి', 'നത്തോലി']],
  ['Seer Fish', ['seer fish', 'ಸೀರ್ ಮೀನು', 'सीर मछली', 'வஞ்சிரம்', 'వంజరం', 'നെയ്മീൻ']],
  ['Tilapia', ['tilapia', 'ತಿಲಾಪಿಯಾ', 'तिलापिया', 'திலாப்பியா', 'తిలాపియా', 'തിലാപ്പിയ']]
];
const otherFishTypes = [
  'Bangus', 'Big Head Carp', 'Black Spotted Barb', 'Catfish', 'Climbing Perch',
  'Fourfinger Threadfin', 'Freshwater Eel', 'Glass Perchlet', 'Goby', 'Gold Fish',
  'Gourami', 'Grass Carp', 'Green Spotted Puffer', 'Indian Carp', 'Indo-Pacific Tarpon',
  'Jaguar Gapote', 'Janitor Fish', 'Knifefish', 'Long-Snouted Pipefish', 'Mosquito Fish',
  'Mudfish', 'Mullet', 'Pangasius', 'Perch', 'Scat Fish', 'Silver Barb', 'Silver Carp',
  'Silver Perch', 'Snakehead', 'Tenpounder'
];
fishNames.push(...otherFishTypes.map(fishType => [fishType, [fishType]]));

const words = {
  search: ['show me', 'show', 'find', 'search', 'ನನಗೆ', 'ತೋರಿಸಿ', 'ಹುಡುಕಿ', 'दिखाओ', 'दिखाइए', 'खोजो', 'ढूंढो', 'காட்டு', 'காண்பி', 'தேடு', 'చూపించు', 'చూపండి', 'వెతుకు', 'చూడండి', 'കാണിക്കുക', 'കാണിക്കൂ', 'തിരയുക'],
  fresh: ['fresh', 'newest', 'ತಾಜಾ', 'ಹೊಸ', 'ताज़ी', 'ताज़ा', 'नया', 'புதிய', 'புதிதாக', 'తాజా', 'కొత్త', 'പുതിയ', 'പുതുതായി'],
  auction: ['auction', 'auctions', 'bidding', 'ಹರಾಜು', 'नीलामी', 'ஏலம்', 'వేలం', 'ലേലം'],
  bid: ['bid', 'place a bid', 'offer', 'ಬಿಡ್', 'ಹರಾಜು ಹಾಕು', 'बोली', 'लगाओ', 'ஏலம்', 'ஏலமிடு', 'బిడ్', 'వేలం వేయి', 'ബിഡ്', 'ലേലം വിളി'],
  highest: ['highest bid', 'current bid', 'current highest', 'ಅತಿ ಹೆಚ್ಚು ಬಿಡ್', 'ಹೆಚ್ಚಿನ ಬಿಡ್', 'सबसे ऊँची बोली', 'सबसे ऊंची बोली', 'वर्तमान बोली', 'அதிகபட்ச ஏலம்', 'தற்போதைய ஏலம்', 'అత్యధిక బిడ్', 'ప్రస్తుత బిడ్', 'ഏറ്റവും ഉയർന്ന ബിഡ്', 'നിലവിലെ ബിഡ്'],
  time: ['time left', 'time remaining', 'how much time', 'ಎಷ್ಟು ಸಮಯ', 'ಸಮಯ ಉಳಿದಿದೆ', 'कितना समय', 'समय बचा', 'எவ்வளவு நேரம்', 'நேரம் மீதம்', 'ఎంత సమయం', 'సమయం మిగిలి', 'എത്ര സമയം', 'സമയം ബാക്കി'],
  order: ['my orders', 'show orders', 'orders', 'ಆರ್ಡರ್', 'ಆರ್ಡರ್‌ಗಳು', 'ನನ್ನ ಆರ್ಡರ್', 'ऑर्डर', 'मेरे ऑर्डर', 'ஆர்டர்', 'என் ஆர்டர்', 'ఆర్డర్', 'నా ఆర్డర్లు', 'ഓർഡർ', 'എന്റെ ഓർഡറുകൾ'],
  track: ['track', 'status', 'ಸ್ಥಿತಿ', 'ಟ್ರ್ಯಾಕ್', 'ट्रैक', 'स्थिति', 'நிலை', 'கண்காணி', 'స్థితి', 'ట్రాక్', 'നില', 'ട്രാക്ക്'],
  payment: ['payment', 'paid', 'pay status', 'ಪಾವತಿ', 'ಹಣ ಪಾವತಿ', 'भुगतान', 'पैसे', 'கட்டணம்', 'பணம்', 'చెల్లింపు', 'డబ్బు', 'പേയ്മെന്റ്', 'പണം'],
  helpOrder: ['how do i place an order', 'how to place an order', 'place an order', 'order help', 'ಆರ್ಡರ್ ಮಾಡುವುದು', 'ಆರ್ಡರ್ ಹೇಗೆ', 'ऑर्डर कैसे', 'ऑर्डर करना', 'ஆர்டர் செய்வது', 'ஆர்டர் எப்படி', 'ఆర్డర్ ఎలా', 'ఆర్డర్ చేయడం', 'ഓർഡർ എങ്ങനെ', 'ഓർഡർ ചെയ്യാൻ'],
  helpBid: ['how bidding works', 'explain bidding', 'bidding help', 'ಬಿಡ್ಡಿಂಗ್ ಹೇಗೆ', 'ಹರಾಜು ಹೇಗೆ', 'बोली कैसे', 'नीलामी कैसे', 'ஏலம் எப்படி', 'ஏலம் விளக்கு', 'బిడ్డింగ్ ఎలా', 'వేలం ఎలా', 'ബിഡ്ഡിംഗ് എങ്ങനെ', 'ലേലം എങ്ങനെ'],
  addListing: ['add new fish listing', 'add a listing', 'new listing', 'post a catch', 'ಹೊಸ ಮೀನು ಪಟ್ಟಿ', 'ಮೀನು ಪಟ್ಟಿ ಸೇರಿಸಿ', 'ಹೊಸ ಪಟ್ಟಿಯನ್ನು ಸೇರಿಸಿ', 'नई मछली लिस्टिंग', 'नई लिस्टिंग', 'मछली सूची जोड़ें', 'புதிய மீன் பட்டியல்', 'புதிய பட்டியல் சேர்க்க', 'కొత్త చేపల లిస్టింగ్', 'కొత్త లిస్టింగ్ జోడించు', 'പുതിയ മീൻ ലിസ്റ്റിംഗ്', 'പുതിയ ലിസ്റ്റിംഗ് ചേർക്കുക'],
  update: ['update', 'change', 'set', 'ನವೀಕರಿಸಿ', 'ಬದಲಾಯಿಸಿ', 'अपडेट', 'बदलें', 'மாற்று', 'புதுப்பி', 'మార్చు', 'నవీకరించు', 'മാറ്റുക', 'പുതുക്കുക'],
  price: ['price', 'cost', 'ಬೆಲೆ', 'ದರ', 'कीमत', 'मूल्य', 'விலை', 'ధర', 'വില'],
  quantity: ['quantity', 'amount', 'stock', 'ಪ್ರಮಾಣ', 'ಪ್ರಮಾಣವನ್ನು', 'मात्रा', 'संख्या', 'அளவு', 'எண்ணிக்கை', 'పరిమాణం', 'స్టాక్', 'അളവ്', 'സ്റ്റോക്ക്'],
  sales: ['sales', 'my sales', 'sold', 'ಮಾರಾಟ', 'ನನ್ನ ಮಾರಾಟ', 'बिक्री', 'मेरी बिक्री', 'விற்பனை', 'என் விற்பனை', 'అమ్మకాలు', 'నా అమ్మకాలు', 'വിൽപ്പന', 'എന്റെ വിൽപ്പന'],
  pending: ['pending orders', 'orders pending', 'ಬಾಕಿ ಆರ್ಡರ್', 'ಬಾಕಿ ಇರುವ ಆರ್ಡರ್', 'लंबित ऑर्डर', 'बाकी ऑर्डर', 'நிலுவை ஆர்டர்', 'పెండింగ్ ఆర్డర్', 'బాకీ ఆర్డర్', 'പെൻഡിംഗ് ഓർഡർ', 'ബാക്കിയുള്ള ഓർഡർ'],
  activeListings: ['active listings', 'my listings', 'show listings', 'ನನ್ನ ಪಟ್ಟಿಗಳು', 'ಸಕ್ರಿಯ ಪಟ್ಟಿಗಳು', 'मेरी लिस्टिंग', 'सक्रिय सूची', 'என் பட்டியல்கள்', 'செயலில் உள்ள பட்டியல்', 'నా లిస్టింగ్‌లు', 'క్రియాశీల లిస్టింగ్‌లు', 'എന്റെ ലിസ്റ്റിംഗുകൾ', 'സജീവ ലിസ്റ്റിംഗുകൾ']
};

const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase()
  .replace(/[.,!?;:()"'।]/gu, ' ').replace(/\s+/g, ' ').trim();
const containsAny = (text, values) => values.some(value => text.includes(normalize(value)));

export function extractFishType(text) {
  const normalized = normalize(text);
  const aliases = fishNames.flatMap(([fishType, values]) => values.map(value => ({ fishType, value: normalize(value) })))
    .sort((left, right) => right.value.length - left.value.length);
  return aliases.find(alias => normalized.includes(alias.value))?.fishType || null;
}

export function extractVoiceAmount(text) {
  const matches = [...String(text || '').matchAll(/(?:₹\s*)?(\d[\d,]*(?:\.\d+)?)/gu)];
  if (!matches.length) return null;
  const amount = Number(matches[matches.length - 1][1].replace(/,/g, ''));
  return Number.isFinite(amount) ? amount : null;
}

export function parseListingFields(text) {
  const normalized = normalize(text);
  const quantityMatch = normalized.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:kg|kgs|kilograms?|ಕಿಲೋ(?:ಗ್ರಾಂ)?|किलो|கிலோ|కిలోలు?|കിലോ(?:ഗ്രാം)?)/u);
  const amount = extractVoiceAmount(text);
  const priceMatch = normalized.match(/(?:price|cost|ಬೆಲೆ|ದರ|कीमत|मूल्य|விலை|ధర|വില)\s*(?:to|at|ಒಂದು|को|గా)?\s*(?:₹\s*)?(\d[\d,]*(?:\.\d+)?)/u);
  return {
    fishType: extractFishType(text),
    quantity: quantityMatch ? Number(quantityMatch[1].replace(/,/g, '')) : null,
    price: priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : amount,
    location: null
  };
}

function priceFilter(text) {
  const maxWords = 'under|below|less than|up to|ನಲ್ಲಿ ಕಡಿಮೆ|ಗಿಂತ ಕಡಿಮೆ|से कम|तक|குறைவாக|கீழ்|లోపు|కంటే తక్కువ|తక్కువ|താഴെ|ൽ താഴെ';
  const minWords = 'above|over|more than|ಹೆಚ್ಚು|ಗಿಂತ ಹೆಚ್ಚು|से अधिक|से ऊपर|அதிகம்|மேல்|కంటే ఎక్కువ|పైన|కంటే ఎక్కువ|കൂടുതൽ|മുകളിൽ';
  const max = text.match(new RegExp(`(?:${maxWords})\\s*(?:₹\\s*)?(\\d[\\d,]*(?:\\.\\d+)?)`, 'u'))
    || text.match(new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s*(?:ರೂಪಾಯಿ|रुपये|ரூபாய்|రూపాయలు|രൂപ|₹)?\\s*(?:${maxWords})`, 'u'));
  const min = text.match(new RegExp(`(?:${minWords})\\s*(?:₹\\s*)?(\\d[\\d,]*(?:\\.\\d+)?)`, 'u'))
    || text.match(new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s*(?:ರೂಪಾಯಿ|रुपये|ரூபாய்|రూపాయలు|രൂപ|₹)?\\s*(?:${minWords})`, 'u'));
  return {
    maxPrice: max ? Number(max[1].replace(/,/g, '')) : null,
    minPrice: min ? Number(min[1].replace(/,/g, '')) : null
  };
}

function extractLocation(text) {
  const connector = /(?:^|\s)(?:near|from|around|at|in|ಹತ್ತಿರ|ನಲ್ಲಿ|ಇಂದ|के पास|में|से|அருகில்|இல்|இருந்து|దగ్గర|లో|నుండి|അടുത്ത്|ൽ|നിന്ന്)\s+(.+)$/u;
  const match = text.match(connector);
  if (!match) return null;
  const location = match[1]
    .replace(/\s+(?:under|below|less than|up to|above|over|more than|ಗಿಂತ ಕಡಿಮೆ|ಸೆ ಕಡಿಮೆ|से कम|तक|குறைவாக|கீழ்|లోపు|కంటే తక్కువ|താഴെ|ൽ താഴെ|ಕంటే ಹೆಚ್ಚು|से अधिक|से ऊपर|அதிகம்|மேல்|కంటే ఎక్కువ|പైన|കൂടുതൽ|മുകളിൽ)\s*(?:₹\s*)?\d[\d,]*(?:\.\d+)?(?:\s*(?:rupees?|ರೂಪಾಯಿ|रुपये|ரூபாய்|రూపాయలు|രൂപ))?.*$/u, '')
    .replace(/\b(?:₹?\s*\d[\d,]*(?:\.\d+)?\s*(?:rupees?|ರೂಪಾಯಿ|रுபாய்|रुपये|ரூபாய்|రూపాయలు|രൂപ)?)\b/gu, '')
    .trim();
  return location || null;
}

export function parseVoiceCommand(input, language = 'en') {
  const rawText = String(input || '').trim();
  const text = normalize(rawText);
  if (!text) return null;

  const fishType = extractFishType(text);
  const amount = extractVoiceAmount(text);
  const priceWords = containsAny(text, words.price);
  const updateWords = containsAny(text, words.update);
  const bidWords = containsAny(text, words.bid);

  if (containsAny(text, words.addListing)) {
    return { type: 'create_listing', fields: parseListingFields(text), rawText, language };
  }
  if (updateWords && priceWords && amount !== null) {
    return { type: 'update_price', fishType, amount, rawText, language };
  }
  if (updateWords && containsAny(text, words.quantity) && amount !== null) {
    return { type: 'update_quantity', fishType, amount, rawText, language };
  }
  if (containsAny(text, words.pending)) {
    return { type: 'pending_orders', rawText, language };
  }
  if (containsAny(text, words.sales) && !containsAny(text, words.price)) {
    return { type: 'sales', rawText, language };
  }
  if (containsAny(text, words.activeListings) && !containsAny(text, words.sales)) {
    return { type: 'active_listings', rawText, language };
  }
  if (containsAny(text, words.helpOrder)) return { type: 'help_order', rawText, language };
  if (containsAny(text, words.helpBid)) return { type: 'help_bidding', rawText, language };
  if (containsAny(text, words.payment)) return { type: 'payment_status', rawText, language };
  if (containsAny(text, words.order)) {
    return { type: containsAny(text, words.track) ? 'track_order' : 'orders', rawText, language };
  }
  if (bidWords && amount !== null) return { type: 'place_bid', fishType, amount, rawText, language };
  if (containsAny(text, words.highest) || containsAny(text, words.time)) {
    return { type: 'auction_info', fishType, rawText, language };
  }
  if (containsAny(text, words.auction)) {
    return { type: 'show_auctions', fishType, rawText, language };
  }

  const { maxPrice, minPrice } = priceFilter(text);
  const location = extractLocation(text);
  const freshest = containsAny(text, words.fresh);
  const category = /prawn|shrimp|ಸೀಗಡಿ|झींगा|இறால்|రొయ్యలు|ചെമ്മീൻ/u.test(text) ? 'Prawns'
    : /crab|ಏಡಿ|केकड़ा|நண்டு|పీత|ഞണ്ട്/u.test(text) ? 'Crab'
      : /squid|ಕಣವ|स्क्विड|கணவாய்|కలమారి|കൂന്തൽ/u.test(text) ? 'Squid'
        : /shellfish|ಚಿಪ್ಪು|शेलफिश|சிப்பி|షెల్ఫిష్|കക്ക/u.test(text) ? 'Shellfish' : null;
  const searchCommand = containsAny(text, words.search) || fishType || freshest || maxPrice !== null || minPrice !== null || category;
  if (searchCommand) {
    return { type: 'search', fishType, category, maxPrice, minPrice, location, freshest, rawText, language };
  }
  return null;
}

export const VOICE_FISH_NAMES = fishNames.map(([fishType]) => fishType);
