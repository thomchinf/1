const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 9000);
const JUSTONE_TOKEN = process.env.JUSTONE_TOKEN || '';
const JUSTONE_SHARE_URL = process.env.JUSTONE_SHARE_URL || 'https://api.justoneapi.com/api/xiaohongshu/share-url-transfer/v1';
const JUSTONE_NOTE_URL = process.env.JUSTONE_NOTE_URL || 'https://api.justoneapi.com/api/xiaohongshu/get-note-detail/v1';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const AMAP_KEY = process.env.AMAP_KEY || '';
const AMAP_GEOCODE_URL = process.env.AMAP_GEOCODE_URL || 'https://restapi.amap.com/v3/geocode/geo';

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Date',
    'Access-Control-Max-Age': '86400'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy();
        reject(new Error('request body too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function requestText(urlString, options = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const target = new URL(urlString);
    const client = target.protocol === 'https:' ? https : http;
    const body = options.body ? String(options.body) : '';
    const headers = { ...(options.headers || {}) };
    if (body && !headers['Content-Length'] && !headers['content-length']) {
      headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = client.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method: options.method || (body ? 'POST' : 'GET'),
      headers,
      timeout: options.timeout || 25000
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const status = res.statusCode || 0;
        const location = res.headers.location;
        if ([301, 302, 303, 307, 308].includes(status) && location && redirectCount < 3) {
          const nextUrl = new URL(location, target).toString();
          requestText(nextUrl, options, redirectCount + 1).then(resolve).catch(reject);
          return;
        }
        resolve({
          response: {
            ok: status >= 200 && status < 300,
            status,
            headers: res.headers
          },
          text: Buffer.concat(chunks).toString('utf8')
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('request timeout'));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function extractFirstUrl(value) {
  return String(value || '').match(/https?:\/\/\S+/)?.[0] || '';
}

function extractXiaohongshuUrl(payload) {
  const values = [
    payload.shareUrl,
    payload.url,
    payload.text,
    payload.rawText,
    payload.venue?.sourceUrl,
    ...Object.values(payload.venue?.channelLinks || {})
  ];
  return values.map(extractFirstUrl).find((item) => item.includes('xiaohongshu.com') || item.includes('xhslink.com')) || '';
}

function extractNoteId(value) {
  const text = String(value || '');
  const discoveryMatch = text.match(/\/(?:discovery\/item|explore)\/([A-Za-z0-9]+)/);
  if (discoveryMatch?.[1]) return discoveryMatch[1];
  const noteIdMatch = text.match(/[?&]noteId=([A-Za-z0-9]+)/);
  if (noteIdMatch?.[1]) return noteIdMatch[1];
  return '';
}

async function fetchJson(url, options = {}) {
  const result = await requestText(url, options);
  return {
    response: result.response,
    text: result.text,
    json: parseJson(result.text, null)
  };
}

async function resolveXiaohongshuNote(payload, debug) {
  const shareUrl = extractXiaohongshuUrl(payload);
  debug.shareUrl = shareUrl;
  if (!shareUrl) {
    debug.errors.push('no xiaohongshu url found');
    return { note: null, sourceText: '' };
  }

  let redirectUrl = '';
  let noteId = extractNoteId(shareUrl);
  let noteIdSource = noteId ? 'input-url' : '';

  if (!noteId && JUSTONE_TOKEN && JUSTONE_SHARE_URL) {
    const shareApi = new URL(JUSTONE_SHARE_URL);
    shareApi.searchParams.set('token', JUSTONE_TOKEN);
    shareApi.searchParams.set('shareUrl', shareUrl);
    const shareResult = await fetchJson(shareApi.toString());
    debug.shareResponseStatus = shareResult.response.status;
    const shareData = shareResult.json?.data || {};
    redirectUrl = shareData.redirect_url || shareData.redirectUrl || '';
    debug.redirectUrl = redirectUrl;
    noteId = extractNoteId(redirectUrl);
    noteIdSource = noteId ? 'share-api' : '';
  }

  debug.noteId = noteId;
  debug.noteIdSource = noteIdSource;
  if (!noteId) {
    debug.errors.push('note id not found');
    return { note: null, sourceText: '' };
  }

  const noteApi = new URL(JUSTONE_NOTE_URL);
  noteApi.searchParams.set('token', JUSTONE_TOKEN);
  noteApi.searchParams.set('noteId', noteId);
  const noteResult = await fetchJson(noteApi.toString());
  debug.noteResponseStatus = noteResult.response.status;
  debug.noteApiCode = noteResult.json?.code;
  debug.noteApiMessage = noteResult.json?.message || noteResult.json?.msg || '';

  const note = normalizeNoteDetail(noteResult.json, noteId, debug);
  const sourceText = normalizeNoteText(note, shareUrl);
  return { note, sourceText };
}

function normalizeNoteDetail(result, noteId, debug = {}) {
  const data = result?.data || {};
  debug.noteDataKeys = Object.keys(data || {}).slice(0, 30);
  const candidates = [
    data.note,
    data.noteInfo,
    data.note_info,
    data.noteDetail,
    data.note_detail,
    data.data?.note,
    data.data?.noteInfo,
    data.data?.note_info,
    data.data?.noteDetail,
    data.data?.note_detail,
    data.data?.note_list?.[0],
    data.data?.notes?.[0],
    data.data?.items?.[0],
    data.data,
    data.note_list?.[0],
    data.notes?.[0],
    data.items?.[0],
    data,
    ...collectNoteCandidates(data)
  ].filter(Boolean);

  const raw = candidates.find(isNoteLikeObject) || {};
  debug.noteCandidateCount = candidates.length;
  debug.noteCandidateKeys = Object.keys(raw || {}).slice(0, 30);
  const card = raw.note_card || raw.noteCard || raw.card || raw.note || raw.note_info || raw.noteInfo || {};
  const user = raw.user || raw.user_info || raw.userInfo || raw.author || card.user || card.user_info || card.userInfo || {};

  return {
    noteId,
    title: pickString(
      raw.title,
      raw.display_title,
      raw.displayTitle,
      raw.note_title,
      raw.noteTitle,
      card.title,
      card.display_title,
      card.displayTitle,
      card.note_title,
      card.noteTitle
    ),
    desc: pickString(
      raw.desc,
      raw.description,
      raw.content,
      raw.text,
      raw.note_desc,
      raw.noteDesc,
      raw.desc_text,
      card.desc,
      card.description,
      card.content,
      card.text,
      card.note_desc,
      card.noteDesc
    ),
    author: pickString(
      typeof raw.author === 'string' ? raw.author : '',
      raw.nickname,
      user.nickname,
      user.name,
      user.user_name,
      user.userName
    ),
    ipLocation: pickString(
      raw.ipLocation,
      raw.ip_location,
      raw.ipLocationName,
      raw.ip_location_name,
      card.ipLocation,
      card.ip_location,
      card.ipLocationName,
      card.ip_location_name
    )
  };
}

function collectNoteCandidates(value, output = [], seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value) || output.length >= 80) return output;
  seen.add(value);
  if (isNoteLikeObject(value)) output.push(value);
  if (Array.isArray(value)) {
    value.forEach((item) => collectNoteCandidates(item, output, seen));
    return output;
  }
  Object.values(value).forEach((item) => collectNoteCandidates(item, output, seen));
  return output;
}

function isNoteLikeObject(item) {
  if (!item || typeof item !== 'object') return false;
  return Boolean(
    item.title ||
    item.display_title ||
    item.displayTitle ||
    item.note_title ||
    item.noteTitle ||
    item.desc ||
    item.description ||
    item.content ||
    item.text ||
    item.note_desc ||
    item.noteDesc ||
    item.note_card ||
    item.noteCard
  );
}

function pickString(...values) {
  const value = values.find((item) => typeof item === 'string' && item.trim());
  return value ? value.trim() : '';
}

function normalizeNoteText(note, shareUrl) {
  if (!note) return '';
  return [
    note.title ? `标题：${note.title}` : '',
    note.desc ? `正文：${note.desc}` : '',
    note.author ? `作者：${note.author}` : '',
    note.ipLocation ? `地区：${note.ipLocation}` : '',
    shareUrl || ''
  ].filter(Boolean).join('\n');
}

async function extractVenueWithDeepSeek(sourceText, inputVenue, debug) {
  debug.hasDeepSeekKey = Boolean(DEEPSEEK_API_KEY);
  debug.deepSeekApiUrl = DEEPSEEK_API_URL ? 'configured' : '';
  debug.deepSeekModel = DEEPSEEK_MODEL;

  if (!sourceText || !DEEPSEEK_API_KEY || !DEEPSEEK_API_URL) return null;

  const deepSeekResult = await fetchJson(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      response_format: { type: 'json_object' },
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: [
            'You are the venue information extractor for PickPick.',
            'Return JSON only. Do not explain.',
            'Extract one primary venue from the Xiaohongshu note.',
            'Return values in the same language as the source text.',
            'Use empty strings, empty arrays, or 0 for unknown fields.',
            'Do not invent facts. Only fill fields supported by the source text.',
            'Classify venue facts into these PickPick fields:',
            'environment: only use explicit values like 安静, 禁烟, 靠窗.',
            'device: only use explicit values like 插座, 大桌, 音乐, 卫生间.',
            'food: food or drink names explicitly mentioned, such as 柠檬巴斯克, 抹茶拿铁.',
            'business: venue business type, such as 纯咖啡, 日咖夜酒, 书店+咖啡.',
            'pet: only use 猫 or 狗 when explicitly mentioned.',
            'price.amount must be a number. price.unit should be a short unit from the source text.',
            'price.text should keep the original price phrase when available.',
            'tags and customTags are optional backward-compatible fields.'
          ].join('\n')
        },
        {
          role: 'user',
          content: JSON.stringify({
            expectedShape: {
              venue: {
                name: '',
                address: '',
                hours: '',
                sceneType: '',
                environment: [],
                device: [],
                food: [],
                price: { amount: 0, unit: '', text: '' },
                business: [],
                pet: [],
                tags: [],
                customTags: [],
                menuInfo: '',
                membershipInfo: '',
                notes: ''
              }
            },
            existingVenue: inputVenue || null,
            sourceText
          })
        }
      ]
    })
  });

  debug.deepSeekStatus = deepSeekResult.response.status;
  const result = deepSeekResult.json;
  if (!deepSeekResult.response.ok) {
    debug.deepSeekError = result?.error?.message || deepSeekResult.text.slice(0, 300);
    return null;
  }

  const content = result?.choices?.[0]?.message?.content || '';
  const parsed = parseJson(content, null);
  const venue = normalizeVenue(parsed?.venue || parsed);
  debug.deepSeekError = '';
  return hasVenueData(venue) ? venue : null;
}

function normalizeVenue(value = {}) {
  const price = value.price || {};
  const environment = normalizeArray(value.environment || value.environments);
  const device = normalizeArray(value.device || value.devices || value.equipment);
  const food = normalizeArray(value.food || value.foods || value.menuItems || value.menu_items);
  const business = normalizeArray(value.business || value.businessType || value.business_type || value.businesses);
  const pet = normalizeArray(value.pet || value.pets);
  const knownTagOptions = ['安静', '禁烟', '靠窗', '插座', '大桌', '音乐', '卫生间'];
  const tags = uniqueArray([
    ...normalizeArray(value.tags).filter((tag) => knownTagOptions.includes(tag)),
    ...environment,
    ...device
  ]);
  const customTags = uniqueArray([
    ...normalizeArray(value.customTags || value.custom_tags),
    ...food,
    ...business,
    ...pet
  ]);
  return {
    name: String(value.name || '').trim(),
    address: String(value.address || '').trim(),
    hours: String(value.hours || '').trim(),
    price: {
      amount: Number(price.amount || 0),
      unit: String(price.unit || '').trim(),
      text: String(price.text || value.priceText || value.price_text || '').trim()
    },
    environment,
    device,
    food,
    business,
    pet,
    tags,
    customTags,
    menuInfo: String(value.menuInfo || value.menu_info || '').trim(),
    membershipInfo: String(value.membershipInfo || value.membership_info || '').trim(),
    notes: String(value.notes || '').trim(),
    sceneType: String(value.sceneType || value.scene_type || '').trim()
  };
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[，,、\s]+/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function uniqueArray(values) {
  return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))];
}

function hasVenueData(venue) {
  if (!venue) return false;
  return Boolean(
    venue.name ||
    venue.address ||
    venue.hours ||
    Number(venue.price?.amount) ||
    venue.price?.text ||
    venue.environment?.length ||
    venue.device?.length ||
    venue.food?.length ||
    venue.business?.length ||
    venue.pet?.length ||
    venue.tags?.length ||
    venue.customTags?.length ||
    venue.menuInfo ||
    venue.membershipInfo ||
    venue.notes ||
    venue.sceneType
  );
}

function parseAmapLocation(value) {
  const [longitude, latitude] = String(value || '').split(',').map((item) => Number(item));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function normalizeAmapGeocode(item = {}, query = '') {
  const location = parseAmapLocation(item.location);
  if (!location) return null;
  return {
    query,
    formattedAddress: String(item.formatted_address || item.formattedAddress || '').trim(),
    country: String(item.country || '').trim(),
    province: String(item.province || '').trim(),
    city: Array.isArray(item.city) ? '' : String(item.city || '').trim(),
    district: Array.isArray(item.district) ? '' : String(item.district || '').trim(),
    township: Array.isArray(item.township) ? '' : String(item.township || '').trim(),
    adcode: String(item.adcode || '').trim(),
    citycode: String(item.citycode || '').trim(),
    latitude: location.latitude,
    longitude: location.longitude,
    level: String(item.level || '').trim()
  };
}

async function handleGeocode(payload) {
  const query = String(payload.address || payload.query || payload.location || '').trim();
  const city = String(payload.city || '').trim();
  const debug = {
    stage: 'amap-geocode',
    hasAmapKey: Boolean(AMAP_KEY),
    query,
    city,
    amapStatus: null,
    amapInfo: '',
    amapInfocode: '',
    errors: []
  };

  if (!query) {
    debug.errors.push('empty address');
    return { code: 0, msg: 'empty address', data: { place: null, debug } };
  }

  if (!AMAP_KEY) {
    debug.errors.push('missing AMAP_KEY');
    return { code: 0, msg: 'missing amap key', data: { place: null, debug } };
  }

  try {
    const url = new URL(AMAP_GEOCODE_URL);
    url.searchParams.set('key', AMAP_KEY);
    url.searchParams.set('address', query);
    if (city) url.searchParams.set('city', city);
    const result = await fetchJson(url.toString());
    debug.httpStatus = result.response.status;
    debug.amapStatus = result.json?.status || '';
    debug.amapInfo = result.json?.info || '';
    debug.amapInfocode = result.json?.infocode || '';

    const geocode = result.json?.geocodes?.[0];
    const place = normalizeAmapGeocode(geocode, query);
    if (!result.response.ok || result.json?.status !== '1' || !place) {
      debug.errors.push('geocode not found');
      return { code: 0, msg: 'geocode not found', data: { place: null, debug } };
    }

    return { code: 0, msg: 'ok', data: { place, debug } };
  } catch (error) {
    debug.errors.push(error?.message || String(error));
    return { code: 0, msg: 'geocode failed', data: { place: null, debug } };
  }
}

async function handleExtract(payload) {
  const debug = {
    stage: 'justone-deepseek-extract',
    inputChannel: payload.channel || '',
    inputContext: payload.context || '',
    errors: [],
    hasToken: Boolean(JUSTONE_TOKEN),
    hasNoteApiUrl: Boolean(JUSTONE_NOTE_URL),
    shareUrl: '',
    redirectUrl: '',
    noteId: '',
    noteIdSource: '',
    shareResponseStatus: null,
    noteResponseStatus: null,
    noteApiCode: null,
    noteApiMessage: ''
  };

  try {
    const { note, sourceText } = await resolveXiaohongshuNote(payload, debug);
    const venue = await extractVenueWithDeepSeek(sourceText, payload.venue, debug);
    return {
      code: 0,
      msg: 'ok',
      data: {
        venue,
        sourceText,
        note,
        debug
      }
    };
  } catch (error) {
    debug.errors.push(error?.message || String(error));
    return {
      code: 0,
      msg: 'extract failed',
      data: {
        venue: null,
        sourceText: '',
        note: null,
        debug
      }
    };
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === 'GET') {
    sendJson(res, 200, { code: 0, msg: 'ok', data: null });
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { code: 405, msg: 'method not allowed', data: null });
    return;
  }

  const payload = parseJson(await readBody(req), {});
  if (payload.type === 'extract') {
    sendJson(res, 200, await handleExtract(payload));
    return;
  }

  if (payload.type === 'geocode') {
    sendJson(res, 200, await handleGeocode(payload));
    return;
  }

  sendJson(res, 200, { code: 0, msg: 'ok', data: null });
});

server.listen(PORT, () => {
  console.log(`PickPick extract function listening on ${PORT}`);
});
