const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 9000);
const JUSTONE_TOKEN = process.env.JUSTONE_TOKEN || '';
const JUSTONE_SHARE_URL = process.env.JUSTONE_SHARE_URL || 'https://api.justoneapi.com/api/xiaohongshu/share-url-transfer/v1';
const JUSTONE_NOTE_URL = process.env.JUSTONE_NOTE_URL || 'https://api.justoneapi.com/api/xiaohongshu/get-note-detail/v1';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

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
  const response = await fetch(url, options);
  const text = await response.text();
  return {
    response,
    text,
    json: parseJson(text, null)
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

  const note = normalizeNoteDetail(noteResult.json, noteId);
  const sourceText = normalizeNoteText(note, shareUrl);
  return { note, sourceText };
}

function normalizeNoteDetail(result, noteId) {
  const data = result?.data || {};
  const candidates = [
    data.note,
    data.noteInfo,
    data.note_info,
    data.noteDetail,
    data.note_detail,
    data.note_list?.[0],
    data.notes?.[0],
    data.items?.[0],
    data
  ].filter(Boolean);

  const raw = candidates.find((item) => {
    return item.title || item.desc || item.description || item.content || item.note_card || item.user || item.author;
  }) || {};
  const card = raw.note_card || raw.noteCard || {};
  const user = raw.user || raw.user_info || raw.userInfo || card.user || card.user_info || {};

  return {
    noteId,
    title: pickString(raw.title, card.title, raw.display_title, card.display_title),
    desc: pickString(raw.desc, raw.description, raw.content, card.desc, card.description, card.content),
    author: pickString(raw.author, raw.nickname, user.nickname, user.name),
    ipLocation: pickString(raw.ipLocation, raw.ip_location, raw.ipLocationName, card.ipLocation, card.ip_location)
  };
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

  const response = await fetch(DEEPSEEK_API_URL, {
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
            '你是 PickPick 的场地信息提取器。',
            '只返回 JSON，不要解释。',
            '从小红书笔记中提取一个最主要的场地。',
            '未知字段返回空字符串、空数组或 0。',
            'tags 只放明确可筛选的通用标签，例如 有插座、可久坐、适合办公、可拍照、露天位。',
            'customTags 放更细的特色标签。',
            'price.amount 只返回数字，unit 用 杯、位、小时、日 或 人均。'
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
                price: { amount: 0, unit: '日' },
                tags: [],
                customTags: [],
                menuInfo: '',
                membershipInfo: '',
                notes: '',
                sceneType: ''
              }
            },
            existingVenue: inputVenue || null,
            sourceText
          })
        }
      ]
    })
  });

  debug.deepSeekStatus = response.status;
  const responseText = await response.text();
  const result = parseJson(responseText, null);
  if (!response.ok) {
    debug.deepSeekError = result?.error?.message || responseText.slice(0, 300);
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
  return {
    name: String(value.name || '').trim(),
    address: String(value.address || '').trim(),
    hours: String(value.hours || '').trim(),
    price: {
      amount: Number(price.amount || 0),
      unit: String(price.unit || '日').trim() || '日'
    },
    tags: normalizeArray(value.tags),
    customTags: normalizeArray(value.customTags || value.custom_tags),
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

function hasVenueData(venue) {
  if (!venue) return false;
  return Boolean(
    venue.name ||
    venue.address ||
    venue.hours ||
    Number(venue.price?.amount) ||
    venue.tags?.length ||
    venue.customTags?.length ||
    venue.menuInfo ||
    venue.membershipInfo ||
    venue.notes ||
    venue.sceneType
  );
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

  sendJson(res, 200, { code: 0, msg: 'ok', data: null });
});

server.listen(PORT, () => {
  console.log(`PickPick extract function listening on ${PORT}`);
});
