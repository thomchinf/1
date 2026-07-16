const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 9000);
const JUSTONE_TOKEN = process.env.JUSTONE_TOKEN || '';
const JUSTONE_SHARE_URL = process.env.JUSTONE_SHARE_URL || 'https://api.justoneapi.com/api/xiaohongshu/share-url-transfer/v1';
const JUSTONE_NOTE_URL = process.env.JUSTONE_NOTE_URL || 'https://api.justoneapi.com/api/xiaohongshu/get-note-detail/v1';
const JUSTONE_DIANPING_DETAIL_URL = process.env.JUSTONE_DIANPING_DETAIL_URL || '';
const IDATARIVER_API_KEY = process.env.IDATARIVER_API_KEY || '';
const IDATARIVER_DIANPING_NOTE_URL = process.env.IDATARIVER_DIANPING_NOTE_URL || 'https://apiok.us/api/a294/note/detail/v2';
const DIANPING_MOBILE_SERVICE_URL = process.env.DIANPING_MOBILE_SERVICE_URL || 'https://1452700938-19erev13jl.ap-guangzhou.tencentscf.com';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const AMAP_KEY = process.env.AMAP_KEY || '';
const AMAP_GEOCODE_URL = process.env.AMAP_GEOCODE_URL || 'https://restapi.amap.com/v3/geocode/geo';
const AMAP_POI_URL = process.env.AMAP_POI_URL || 'https://restapi.amap.com/v3/place/text';

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
      if (body.length > 20 * 1024 * 1024) {
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

function extractDianpingUrl(payload) {
  const values = [
    payload.shareUrl,
    payload.url,
    payload.dianpingMobile?.url,
    payload.dianpingMobileRequest?.url,
    payload.text,
    payload.rawText,
    payload.venue?.sourceUrl,
    payload.venue?.channelLinks?.dianping,
    ...Object.values(payload.venue?.channelLinks || {})
  ];
  return values
    .map(extractFirstUrl)
    .find((item) => /(?:dianping|dzdp|dper)\.com|dpurl\.cn/i.test(item)) || '';
}

function extractDianpingNoteId(value) {
  const text = String(value || '');
  const queryMatch = text.match(/[?&](?:note_id|noteId|id)=([^&\s]+)/i);
  if (queryMatch?.[1]) return decodeURIComponent(queryMatch[1]);
  const pathMatch = text.match(/\/(?:note|review|ugcdetail|feed|detail)\/([A-Za-z0-9_-]+)/i);
  if (pathMatch?.[1]) return pathMatch[1];
  return '';
}

function stripUrls(value) {
  return String(value || '').replace(/https?:\/\/\S+/g, '').trim();
}

function getPayloadText(payload) {
  return [
    payload.text,
    payload.rawText,
    payload.url,
    payload.venue?.channelLinks?.dianping
  ].filter(Boolean).join('\n');
}

function extractDianpingCurlText(payload) {
  const values = [
    payload.curlText,
    payload.curl,
    payload.dianpingCurlText,
    payload.dianpingMobile?.curlText,
    payload.dianpingMobileRequest?.curlText,
    payload.text,
    payload.rawText,
    payload.url
  ];
  return values.map((item) => String(item || '').trim()).find((item) => (
    /curl(?:\.exe)?\s+/i.test(item) && /(?:m\.|www\.)?dianping\.com\/shop\//i.test(item)
  )) || '';
}

function cleanCurlValue(value) {
  return String(value || '')
    .trim()
    .replace(/^\^+|\^+$/g, '')
    .replace(/^['"]|['"]$/g, '')
    .trim();
}

function normalizeCurlCommandText(value) {
  return String(value || '')
    .replace(/\^\r?\n/g, ' ')
    .replace(/\^"/g, '"')
    .replace(/"\^/g, '"')
    .replace(/\^'/g, "'")
    .replace(/'\^/g, "'");
}

function normalizeDianpingShopUrl(value) {
  const text = cleanCurlValue(value);
  const match = text.match(/https?:\/\/(?:m\.|www\.)?dianping\.com\/shop\/([A-Za-z0-9]+)/i);
  return match?.[1] ? `https://m.dianping.com/shop/${match[1]}` : '';
}

function extractDianpingMobileUrl(value) {
  const text = normalizeCurlCommandText(value);
  const direct = text.match(/https?:\/\/(?:m\.|www\.)?dianping\.com\/shop\/[A-Za-z0-9]+/i)?.[0] || '';
  return normalizeDianpingShopUrl(direct);
}

function canonicalHeaderName(name) {
  const lowered = cleanCurlValue(name).replace(/\\"/g, '"').replace(/^\\+/, '').replace(/^"+|"+$/g, '').trim().toLowerCase();
  const map = {
    accept: 'Accept',
    'accept-language': 'Accept-Language',
    cookie: 'Cookie',
    pragma: 'Pragma',
    referer: 'Referer',
    'user-agent': 'User-Agent'
  };
  return map[lowered] || '';
}

function normalizeDianpingMobileHeaders(headers = {}) {
  const output = {};
  Object.entries(headers || {}).forEach(([name, value]) => {
    const key = canonicalHeaderName(name);
    const text = String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\^([%#@&|<>()"'])/g, '$1')
      .replace(/\\"/g, '"')
      .trim();
    if (key && text) output[key] = text;
  });
  return output;
}

function parseDianpingCurlRequest(curlText) {
  const text = normalizeCurlCommandText(curlText);
  const url = extractDianpingMobileUrl(text);
  if (!url) return null;

  const headers = {};
  const headerPattern = /(?:^|\s)(?:-H|--header)\s+(?:"([^"]*)"|'([^']*)'|([^\r\n]+?)(?=\s+(?:-\w|--\w)|\s*$))/gi;
  let match;
  while ((match = headerPattern.exec(text))) {
    const headerLine = cleanCurlValue(match[1] || match[2] || match[3] || '');
    const separator = headerLine.indexOf(':');
    if (separator <= 0) continue;
    const key = headerLine.slice(0, separator).trim();
    const value = headerLine.slice(separator + 1).trim();
    if (key && value) headers[key] = value;
  }

  const cookiePattern = /(?:^|\s)(?:-b|--cookie)\s+(?:"([^"]*)"|'([^']*)'|([^\r\n]+?)(?=\s+(?:-\w|--\w)|\s*$))/gi;
  while ((match = cookiePattern.exec(text))) {
    const cookie = cleanCurlValue(match[1] || match[2] || match[3] || '');
    if (cookie) headers.Cookie = cookie;
  }

  return {
    url,
    headers: normalizeDianpingMobileHeaders(headers),
    requestMode: 'curl-compact'
  };
}

function normalizeDianpingMobileRequest(value) {
  if (!value || typeof value !== 'object') return null;
  const url = extractDianpingMobileUrl(value.url || value.shopUrl || value.sourceUrl);
  if (!url) return null;
  const headers = normalizeDianpingMobileHeaders(value.headers || {});
  if (value.cookie) headers.Cookie = String(value.cookie || '').trim();
  if (value.userAgent) headers['User-Agent'] = String(value.userAgent || '').trim();
  return {
    url,
    headers,
    requestMode: value.requestMode || 'compact'
  };
}

function extractDianpingMobileRequest(payload) {
  const direct = normalizeDianpingMobileRequest(payload.dianpingMobile)
    || normalizeDianpingMobileRequest(payload.dianpingMobileRequest);
  if (direct) return direct;

  const curlText = extractDianpingCurlText(payload);
  return parseDianpingCurlRequest(curlText);
}

function normalizeExistingVenueText(venue = {}) {
  return [
    venue.name ? `名称：${venue.name}` : '',
    venue.address ? `地点：${venue.address}` : '',
    venue.hours ? `时间：${venue.hours}` : '',
    venue.sceneType ? `场景：${venue.sceneType}` : '',
    Array.isArray(venue.tags) && venue.tags.length ? `标签：${venue.tags.join('、')}` : '',
    Array.isArray(venue.customTags) && venue.customTags.length ? `补充：${venue.customTags.join('、')}` : '',
    venue.notes ? `备注：${venue.notes}` : ''
  ].filter(Boolean).join('\n');
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

async function resolveDianpingMobileDetail(payload, debug) {
  const curlText = extractDianpingCurlText(payload);
  const mobileRequest = extractDianpingMobileRequest(payload);
  debug.hasDianpingMobileServiceUrl = Boolean(DIANPING_MOBILE_SERVICE_URL);
  debug.hasDianpingMobileCurl = Boolean(curlText);
  debug.hasDianpingMobileRequest = Boolean(mobileRequest);
  debug.dianpingMobileRequestMode = mobileRequest?.requestMode || '';
  debug.dianpingMobileRequestUrl = mobileRequest?.url || '';
  debug.dianpingMobileRequestHeaderNames = Object.keys(mobileRequest?.headers || {});
  if (!mobileRequest || !DIANPING_MOBILE_SERVICE_URL) return { detail: null, sourceText: '' };

  const serviceUrl = new URL(DIANPING_MOBILE_SERVICE_URL);
  serviceUrl.pathname = `${serviceUrl.pathname.replace(/\/$/, '')}/dianping/mobile-detail`;
  const result = await fetchJson(serviceUrl.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: mobileRequest.url,
      headers: mobileRequest.headers
    }),
    timeout: 30000
  });
  debug.dianpingApiProvider = 'dianping-mobile-service';
  debug.dianpingMobileServiceStatus = result.response.status;
  debug.dianpingMobileServiceCode = result.json?.code;
  debug.dianpingMobileServiceMessage = result.json?.msg || '';
  const serviceDebug = result.json?.data?.debug || {};
  debug.dianpingMobileServiceError = serviceDebug.error || '';
  debug.dianpingMobileServiceFinalUrl = serviceDebug.finalUrl || '';
  debug.dianpingMobileServiceDecodedEncoding = serviceDebug.decodedEncoding || '';
  debug.dianpingMobileServiceReadError = serviceDebug.readError || '';
  debug.dianpingMobileServiceHasCookie = serviceDebug.hasCookie ?? null;
  debug.dianpingMobileServiceHeaderNames = serviceDebug.headerNames || [];
  const shop = result.json?.data?.shop || null;
  if (!result.response.ok || !shop) {
    debug.errors.push(`dianping mobile service failed: ${result.json?.msg || result.text.slice(0, 160)}${serviceDebug.error ? ` (${serviceDebug.error})` : ''}`);
    return { detail: null, sourceText: '' };
  }
  debug.dianpingMobileStatusCode = serviceDebug.statusCode ?? null;
  debug.dianpingMobileImageCount = Array.isArray(shop.images) ? shop.images.length : 0;
  return {
    detail: normalizeDianpingMobileShop(shop),
    sourceText: normalizeDianpingMobileText(shop)
  };
}

async function resolveDianpingContent(payload, debug) {
  const rawText = getPayloadText(payload);
  const dianpingUrl = extractDianpingUrl(payload);
  debug.dianpingUrl = dianpingUrl;
  debug.dianpingNoteId = extractDianpingNoteId(dianpingUrl || rawText);
  debug.hasIdataRiverKey = Boolean(IDATARIVER_API_KEY);
  debug.hasIdataRiverDianpingNoteUrl = Boolean(IDATARIVER_DIANPING_NOTE_URL);
  debug.hasDianpingDetailApiUrl = Boolean(JUSTONE_DIANPING_DETAIL_URL);
  debug.hasDianpingMobileServiceUrl = Boolean(DIANPING_MOBILE_SERVICE_URL);

  let sourceText = '';
  let detail = null;

  const mobileResult = await resolveDianpingMobileDetail(payload, debug);
  if (mobileResult.detail) {
    detail = mobileResult.detail;
    sourceText = mobileResult.sourceText;
  } else if ((dianpingUrl || debug.dianpingNoteId) && IDATARIVER_API_KEY && IDATARIVER_DIANPING_NOTE_URL) {
    try {
      const noteApi = new URL(IDATARIVER_DIANPING_NOTE_URL);
      noteApi.searchParams.set('apikey', IDATARIVER_API_KEY);
      if (dianpingUrl) noteApi.searchParams.set('note_url', dianpingUrl);
      if (debug.dianpingNoteId) noteApi.searchParams.set('note_id', debug.dianpingNoteId);
      const detailResult = await fetchJson(noteApi.toString());
      debug.dianpingApiProvider = 'idatariver';
      debug.dianpingResponseStatus = detailResult.response.status;
      debug.dianpingApiCode = detailResult.json?.code;
      debug.dianpingApiMessage = detailResult.json?.message || detailResult.json?.msg || '';
      debug.dianpingCredits = detailResult.json?.credits ?? null;
      detail = normalizeDianpingDetail(detailResult.json, debug);
      sourceText = normalizeDianpingText(detail, dianpingUrl);
    } catch (error) {
      debug.errors.push(`idatariver dianping note api failed: ${error?.message || String(error)}`);
    }
  } else if (dianpingUrl && JUSTONE_TOKEN && JUSTONE_DIANPING_DETAIL_URL) {
    try {
      const detailApi = new URL(JUSTONE_DIANPING_DETAIL_URL);
      detailApi.searchParams.set('token', JUSTONE_TOKEN);
      detailApi.searchParams.set('url', dianpingUrl);
      detailApi.searchParams.set('shareUrl', dianpingUrl);
      detailApi.searchParams.set('shopUrl', dianpingUrl);
      const detailResult = await fetchJson(detailApi.toString());
      debug.dianpingApiProvider = 'justone-compatible';
      debug.dianpingResponseStatus = detailResult.response.status;
      debug.dianpingApiCode = detailResult.json?.code;
      debug.dianpingApiMessage = detailResult.json?.message || detailResult.json?.msg || '';
      detail = normalizeDianpingDetail(detailResult.json, debug);
      sourceText = normalizeDianpingText(detail, dianpingUrl);
    } catch (error) {
      debug.errors.push(`dianping detail api failed: ${error?.message || String(error)}`);
    }
  }

  const copiedText = stripUrls(rawText);
  const existingText = normalizeExistingVenueText(payload.venue);
  if (copiedText && copiedText.length > 6) {
    sourceText = [sourceText, copiedText].filter(Boolean).join('\n');
  }
  if (!sourceText && existingText) sourceText = existingText;
  if (!sourceText && dianpingUrl) {
    debug.errors.push('dianping link has no copied text and detail api is not configured');
    sourceText = dianpingUrl;
  }

  return { note: detail, sourceText };
}

function normalizeDianpingDetail(result, debug = {}) {
  const data = result?.result || result?.data?.result || result?.data || {};
  debug.dianpingDataKeys = Object.keys(data || {}).slice(0, 30);
  const candidates = [
    result?.result,
    result?.data?.result,
    data.shop,
    data.shopInfo,
    data.shop_info,
    data.poi,
    data.poiInfo,
    data.poi_info,
    data.business,
    data.businessInfo,
    data.data?.shop,
    data.data?.shopInfo,
    data.data?.shop_info,
    data.data?.poi,
    data.data?.poiInfo,
    data.data?.poi_info,
    data.data,
    data,
    ...collectDianpingCandidates(data)
  ].filter(Boolean);

  const raw = candidates.find(isDianpingLikeObject) || {};
  debug.dianpingCandidateCount = candidates.length;
  debug.dianpingCandidateKeys = Object.keys(raw || {}).slice(0, 30);

  return {
    title: pickString(raw.title, raw.feedTitle, raw.feed_title),
    name: pickString(raw.name, raw.shopName, raw.shop_name, raw.title, raw.poiName, raw.poi_name, raw.businessName),
    address: pickString(raw.address, raw.addr, raw.shopAddress, raw.shop_address, raw.poiAddress, raw.poi_address),
    hours: pickString(raw.hours, raw.openHours, raw.open_hours, raw.businessHours, raw.business_hours, raw.openTime, raw.open_time),
    priceText: pickString(raw.avgPrice, raw.avg_price, raw.avgPriceText, raw.priceText, raw.price, raw.perCapita),
    category: pickString(raw.category, raw.categoryName, raw.category_name, raw.shopType, raw.shop_type, raw.type),
    rating: pickString(raw.rating, raw.score, raw.star, raw.avgScore, raw.avg_score),
    statusText: pickString(raw.statusText, raw.status_text, raw.openStatus, raw.open_status, raw.businessStatus, raw.business_status),
    phone: pickString(raw.phone, raw.tel, raw.telephone, raw.mobile, raw.contactPhone, raw.contact_phone),
    tags: normalizeArray(raw.tags || raw.tag_list || raw.tagList || raw.recommendTags || raw.topicList || raw.topic_list),
    recommendations: normalizeArray(raw.recommendations || raw.recommendDishes || raw.recommend_dishes || raw.dishes),
    desc: pickString(raw.desc, raw.description, raw.introduction, raw.summary, raw.content, raw.richContent, raw.rich_content),
    images: normalizeDianpingImages(raw.feedPicList || raw.feed_pic_list || raw.images || raw.pictures || raw.picList || raw.pic_list)
  };
}

function collectDianpingCandidates(value, output = [], seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value) || output.length >= 80) return output;
  seen.add(value);
  if (isDianpingLikeObject(value)) output.push(value);
  if (Array.isArray(value)) {
    value.forEach((item) => collectDianpingCandidates(item, output, seen));
    return output;
  }
  Object.values(value).forEach((item) => collectDianpingCandidates(item, output, seen));
  return output;
}

function isDianpingLikeObject(item) {
  if (!item || typeof item !== 'object') return false;
  return Boolean(
    item.title ||
    item.content ||
    item.richContent ||
    item.rich_content ||
    item.name ||
    item.shopName ||
    item.shop_name ||
    item.poiName ||
    item.poi_name ||
    item.address ||
    item.shopAddress ||
    item.businessHours ||
    item.business_hours ||
    item.avgPrice ||
    item.avg_price
  );
}

function normalizeDianpingText(detail, dianpingUrl) {
  if (!detail) return dianpingUrl || '';
  return [
    detail.title ? `标题：${detail.title}` : '',
    detail.name ? `名称：${detail.name}` : '',
    detail.address ? `地点：${detail.address}` : '',
    detail.hours ? `时间：${detail.hours}` : '',
    detail.priceText ? `价格：${detail.priceText}` : '',
    detail.category ? `场景：${detail.category}` : '',
    detail.rating ? `评分：${detail.rating}` : '',
    detail.statusText ? `营业状态：${detail.statusText}` : '',
    detail.phone ? `电话：${detail.phone}` : '',
    detail.tags?.length ? `标签：${detail.tags.join('、')}` : '',
    detail.recommendations?.length ? `推荐：${detail.recommendations.join('、')}` : '',
    detail.images?.length ? `图片：${detail.images.join('、')}` : '',
    detail.desc ? `备注：${detail.desc}` : '',
    dianpingUrl || ''
  ].filter(Boolean).join('\n');
}

function normalizeDianpingMobileShop(shop = {}) {
  const recommendedDishes = normalizeArray(shop.recommendedDishes || shop.recommendations);
  const services = normalizeArray(shop.services);
  const rawTags = normalizeArray(shop.tags);
  const images = normalizeArray(shop.images).map(cleanImageUrl).filter(Boolean);
  return {
    provider: 'dianping-mobile',
    title: String(shop.name || '').trim(),
    name: String(shop.name || '').trim(),
    address: String(shop.address || '').trim(),
    hours: String(shop.hours || '').trim(),
    priceText: String(shop.avgPriceText || shop.priceText || '').trim(),
    category: String(shop.category || '').trim(),
    rating: String(shop.rating || '').trim(),
    reviewCount: String(shop.reviewCount || '').trim(),
    scoreDetail: String(shop.scoreDetail || '').trim(),
    area: String(shop.area || '').trim(),
    rankText: String(shop.rankText || '').trim(),
    statusText: String(shop.statusText || '').trim(),
    distanceText: String(shop.distanceText || '').trim(),
    phone: String(shop.phone || shop.tel || shop.telephone || '').trim(),
    tags: uniqueArray([String(shop.category || '').trim(), String(shop.area || '').trim(), String(shop.rankText || '').trim(), ...rawTags, ...services].filter(Boolean)),
    recommendations: recommendedDishes,
    services,
    desc: [
      shop.statusText ? `营业状态：${shop.statusText}` : '',
      (shop.phone || shop.tel || shop.telephone) ? `电话：${shop.phone || shop.tel || shop.telephone}` : ''
    ].filter(Boolean).join('\n'),
    images,
    sourceUrl: String(shop.sourceUrl || '').trim()
  };
}

function parsePriceFromText(value = '') {
  const text = String(value || '').trim();
  const amount = Number(text.match(/\d+(\.\d+)?/)?.[0]) || 0;
  let unit = '';
  if (amount) {
    if (/\/\s*人|人均|每人/.test(text)) unit = '人';
    else if (/\/\s*杯|每杯|杯/.test(text)) unit = '杯';
    else if (/\/\s*日|单日|全天|天/.test(text)) unit = '日';
    else unit = '人';
  }
  return { amount, unit, text: amount ? `人均：${amount}元` : '' };
}

function extractEnvironmentFeatures(value = '') {
  const text = String(value || '');
  const values = [];
  if (/非常安静|很安静|安静|清净|清静|静谧/.test(text)) values.push('音量：安静');
  else if (/较安静|比较安静|不吵/.test(text)) values.push('音量：较安静');
  if (/非常嘈杂|特别吵|很吵|吵闹/.test(text)) values.push('音量：非常嘈杂');
  else if (/嘈杂|有点吵|人声|聊天声|人多/.test(text)) values.push('音量：嘈杂');

  if (/自然光充足|自然光|采光很好|采光好|阳光|落地窗|明亮/.test(text)) values.push('光线：自然光充足');
  if (/适合拍照|出片|好拍/.test(text) && /明亮|采光|阳光|自然光/.test(text)) values.push('光线：明亮');
  if (/昏暗|偏暗|暗光|氛围感/.test(text)) values.push('光线：昏暗');

  if (/空间宽敞|宽敞|座位间距大|不挤/.test(text)) values.push('空间：空间宽敞');
  if (/局促|拥挤|挤|座位密|桌距近/.test(text)) values.push('空间：略显局促');
  if (/露台|露天|户外|室外|外摆|小院|院子|庭院|花园/.test(text)) values.push('空间：有户外区域');

  const styles = [];
  if (/极简|简约/.test(text)) styles.push('极简风');
  if (/工业风|水泥|清水混凝土|金属/.test(text)) styles.push('工业风');
  if (/日式|原木|木质|木头/.test(text)) styles.push('日式原木');
  if (/美式|复古|中古|怀旧/.test(text)) styles.push('美式复古');
  if (/露营|营地|帐篷/.test(text)) styles.push('露营风');
  if (/网红|ins|INS|打卡|出片/.test(text)) styles.push('网红 ins 风');
  if (/温馨|暖色|温暖|柔和|奶油/.test(text)) styles.push('温馨');
  uniqueArray(styles).slice(0, 2).forEach((style) => values.push(`风格：${style}`));

  if (/太冷|偏冷|空调冷/.test(text)) values.push('温度：偏冷');
  if (/太热|偏热|闷热/.test(text)) values.push('温度：偏热');
  if (/温度舒适|不冷不热|暖和|凉快/.test(text)) values.push('温度：舒适');
  return uniqueArray(values);
}

function extractDeviceFeatures(value = '') {
  const text = String(value || '');
  const values = [];
  if (/大桌|大桌子|长桌|多人桌|桌子大/.test(text)) values.push('大桌子');
  if (/小圆桌|圆桌/.test(text)) values.push('小圆桌');
  if (/沙发|沙发位/.test(text)) values.push('沙发位');
  if (/临窗|靠窗|窗边|窗景|景观位|落地窗/.test(text)) values.push('临窗座位');
  if (/高脚凳|吧台椅/.test(text)) values.push('高脚凳');
  if (/外摆|户外座|户外位|室外座|室外位/.test(text)) values.push('外摆区');
  if (/露台|露天平台|天台/.test(text)) values.push('露台');
  if (/插座|充电|电源/.test(text) && !/没.{0,4}插座|没有.{0,4}插座|无插座|插座.{0,4}(少|不足|不够)/.test(text)) values.push('插座');
  if (/充电宝/.test(text) && !/无充电宝|没有.{0,4}充电宝|不提供.{0,4}充电宝/.test(text)) values.push('提供充电宝');
  if (/Wi-?Fi|wifi|WIFI|无线网络|无线/.test(text)) values.push('Wi-Fi');
  if (/网速快|Wi-?Fi.{0,6}快|wifi.{0,6}快|网络.{0,6}快/i.test(text)) values.push('Wi-Fi速度快');
  if (/包间|包房|独立房间|独立空间|小房间/.test(text)) values.push('包间');
  if (/洗手间.{0,8}干净|卫生间.{0,8}干净|厕所.{0,8}干净/.test(text)) values.push('洗手间干净');
  else if (/洗手间.{0,8}密码|卫生间.{0,8}密码|厕所.{0,8}密码/.test(text)) values.push('洗手间需密码');
  else if (/无洗手间|没有洗手间|无卫生间|没有卫生间|没厕所/.test(text)) values.push('无洗手间');
  return uniqueArray(values);
}

function extractFoodCategories(value = '') {
  const text = String(value || '');
  const values = [];
  if (/手冲|单品手冲/.test(text)) values.push('手冲咖啡');
  if (/拿铁|澳白|馥芮白|美式|dirty|Dirty|冷萃|浓缩|特调咖啡|咖啡/.test(text)) values.push('咖啡饮品');
  if (/巴斯克/.test(text)) values.push('巴斯克蛋糕');
  if (/Gelato|gelato|冰淇淋|意式冰淇淋/.test(text)) values.push('Gelato');
  if (/可颂|面包|吐司|贝果|烘焙/.test(text)) values.push('烘焙');
  if (/蛋糕|甜品|甜点|慕斯|芝士|乳酪/.test(text)) values.push('蛋糕甜品');
  if (/轻食|简餐|沙拉|意面|披萨|汉堡|三明治|饭|brunch|早午餐/i.test(text)) values.push('轻食简餐');
  if (/茶|红茶|绿茶|乌龙|抹茶|焙茶|肉桂茶|花茶/.test(text)) values.push('茶饮');
  if (/气泡水|苏打水|sparkling/i.test(text)) values.push('气泡水');
  return uniqueArray(values);
}

function normalizeEnvironmentValues(values = []) {
  const normalized = uniqueArray(values.map((item) => {
    const text = String(item || '').trim();
    if (/^安静$/.test(text)) return '音量：安静';
    if (/较安静/.test(text)) return '音量：较安静';
    if (/非常嘈杂/.test(text)) return '音量：非常嘈杂';
    if (/嘈杂|人多吵闹/.test(text)) return '音量：嘈杂';
    if (/有窗景|采光好|光线好/.test(text)) return '光线：自然光充足';
    if (/光线暗/.test(text)) return '光线：昏暗';
    if (/户外|露台|外摆/.test(text)) return '空间：有户外区域';
    return text;
  }).filter((item) => item && !/座位|桌|插座|Wi-Fi|卫生间|洗手间|充电宝/.test(item)));
  const singleValuePrefixes = ['音量：', '光线：', '空间：', '温度：'];
  const seenPrefixes = new Set();
  return normalized.filter((item) => {
    const prefix = singleValuePrefixes.find((value) => item.startsWith(value));
    if (!prefix) return true;
    if (seenPrefixes.has(prefix)) return false;
    seenPrefixes.add(prefix);
    return true;
  });
}

function normalizeDeviceValues(values = []) {
  return uniqueArray(values.map((item) => {
    const text = String(item || '').trim();
    if (/^大桌$|长桌|多人桌/.test(text)) return '大桌子';
    if (/^小桌$/.test(text)) return '小圆桌';
    if (/卫生间|厕所/.test(text)) return '洗手间干净';
    if (/靠窗|窗边|窗景|落地窗|景观位|采光|阳光|窗户/.test(text)) return '临窗座位';
    if (/户外位|露天位|外摆/.test(text)) return '外摆区';
    if (/有露台/.test(text)) return '露台';
    return text;
  }).filter((item) => item && !/座位|座椅|桌位|位子|楼层|层数|柠檬水|自取水|纸巾|宠物|儿童|预约|等位|^[一二三四五六七八九十\d]+层$|^[一二三四五六七八九十\d]+楼$/.test(item)));
}

function normalizeBusinessValues(values = [], sourceText = '') {
  const text = uniqueArray([...normalizeArray(values), sourceText].filter(Boolean)).join(' ');
  const hasCoffee = /精品咖啡|咖啡|拿铁|美式|手冲|dirty|Dirty|冷萃|澳白|馥芮白|纯咖啡/.test(text);
  const hasChain = /星巴克|瑞幸|库迪|Manner|Tims|Peet|% Arabica|连锁/.test(text);
  const hasAlcohol = /酒吧|酒馆|精酿|红酒|葡萄酒|啤酒|鸡尾酒|特调鸡尾酒|晚上变身酒吧|夜酒|喝酒|小酒|酒水|酒|bar/i.test(text);
  const hasBook = /书店|书房|图书|阅读/.test(text);
  const hasBuyer = /买手店|买手|集合店|复合空间|选物|主理人/.test(text);
  const hasBakery = /烘焙|面包|可颂|贝果|吐司|蛋糕专门|甜品专门/.test(text);
  const hasCommunity = /社区|街角|居民区|邻里/.test(text);
  const hasViral = /网红|打卡|出片|ins|INS|拍照/.test(text);
  const hasTimeSplit = /白天.{0,10}咖啡.{0,16}(晚上|夜晚|夜间).{0,10}酒|(晚上|夜晚|夜间).{0,10}酒.{0,16}白天.{0,10}咖啡|早咖晚酒|昼咖夜酒|日间.{0,10}咖啡.{0,16}夜间.{0,10}酒|晚上变身酒吧|特调鸡尾酒|(\d{1,2}[:：]\d{2}|下午|傍晚|晚上|夜间).{0,8}(后|以后|开始).{0,12}(酒|酒吧|小酒)/.test(text);
  const output = [];
  if (hasCoffee && hasBook) output.push('咖啡+书店');
  else if (hasCoffee && hasAlcohol && hasTimeSplit) output.push('日咖夜酒（早C晚A）');
  else if (hasChain) output.push('连锁咖啡');
  else if (hasCoffee) output.push('精品咖啡');
  if (hasBakery) output.push('烘焙专门店');
  if (hasBuyer) output.push('买手店复合空间');
  if (hasViral) output.push('网红打卡店');
  if (!output.length && hasCommunity) output.push('社区咖啡馆');
  if (hasCommunity && output.length < 2 && !output.includes('社区咖啡馆')) output.push('社区咖啡馆');
  return uniqueArray(output).slice(0, 2);
}

function extractScenePersona(value = '') {
  const text = String(value || '');
  const values = [];
  const badNet = /网差|网络差|Wi-?Fi.{0,6}(慢|差)|没网|无网/i.test(text);
  const noStudy = /不适合.{0,8}(学习|自习|工作|办公)|不建议.{0,8}(学习|自习|工作|办公)|太吵.{0,8}(学习|自习|工作|办公)/.test(text);
  if (noStudy) {
    if (/学习|自习/.test(text)) values.push('不适合学习');
    if (/工作|办公|电脑|PPT|ppt/.test(text)) values.push('不适合工作');
  }
  if (!noStudy && /学习|自习|看书|阅读/.test(text)) values.push(/看书|阅读/.test(text) ? '适合看书' : '适合学习');
  if (!noStudy && !badNet && /电脑|办公|工作|赶PPT|赶ppt|写方案|远程办公/.test(text)) values.push('适合工作');
  if (/聚餐|聚会|朋友聚|多人|小聚/.test(text)) values.push('适合聚餐');
  if (/打卡|拍照|出片|网红|好拍|适合拍/.test(text)) values.push('适合打卡拍照');
  if (/下午茶|甜品|蛋糕|茶歇/.test(text)) values.push('适合下午茶');
  if (/亲子|孩子|儿童|遛娃|儿童推车/.test(text)) values.push('适合亲子');
  if (/一人食|一个人|独自|独处|旅行|游客|旅游/.test(text)) values.push(/旅行|游客|旅游/.test(text) ? '适合旅行' : '适合一人食');
  return uniqueArray(values);
}

function extractServiceFeatures(value = '') {
  const text = String(value || '');
  return uniqueArray([
    /免费.{0,4}柠檬水|柠檬水/.test(text) ? '免费柠檬水' : '',
    /免费.{0,4}自取水|自取水|自助水/.test(text) ? '免费自取水' : '',
    /提供纸巾|有纸巾|纸巾/.test(text) ? '提供纸巾' : '',
    /宠物友好|可带宠物|可以带宠物|允许宠物/.test(text) ? '宠物友好' : '',
    /不可携带宠物|不能带宠物|不允许宠物|禁止宠物/.test(text) ? '不可携带宠物' : '',
    /儿童推车|婴儿车/.test(text) ? '允许儿童推车' : '',
    /无需预约|不用预约/.test(text) ? '无需预约' : '',
    /需现场等位|现场等位/.test(text) ? '需现场等位' : '',
    /可提前预定包间|可预定包间|提前预定|提前预约/.test(text) ? '可提前预定包间' : '',
    /猫|猫咪|店猫/.test(text) ? '店猫' : '',
    /狗|狗狗|宠物狗|可带宠物/.test(text) ? '可带狗' : ''
  ]);
}

function extractPetFeatures(value = '') {
  return extractServiceFeatures(value);
}

function pruneDuplicateNotes(notes = '', venue = {}) {
  const serviceText = uniqueArray([...(venue.service || []), ...(venue.pet || [])]).join('、');
  const structuredText = [
    venue.name,
    venue.address,
    venue.hours,
    venue.price?.text,
    venue.price?.amount ? String(venue.price.amount) : '',
    ...(venue.environment || []),
    ...(venue.device || []),
    ...(venue.food || []),
    ...(venue.business || []),
    serviceText
  ].filter(Boolean).join(' ');
  return uniqueArray(String(notes || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      if (/^(免费服务|服务)[:：]/.test(line) && /(柠檬水|自取水|纸巾|宠物|儿童|预约|等位)/.test(line)) return false;
      if (/^预约规则[:：]/.test(line) && /(预约|等位|包间)/.test(serviceText)) return false;
      if (/^(地点|地址|时间|价格|美食|设备|环境|业态)[:：]/.test(line)) return false;
      const compactLine = line.replace(/\s+/g, '');
      if (compactLine.length <= 18 && structuredText.replace(/\s+/g, '').includes(compactLine)) return false;
      return true;
    }))
    .slice(0, 8)
    .join('\n');
}

function sanitizeVenueFields(venue = {}) {
  const next = { ...venue };
  next.service = uniqueArray([...(next.service || []), ...(next.pet || [])]);
  next.pet = next.service;
  next.environment = normalizeEnvironmentValues(next.environment || []);
  next.device = normalizeDeviceValues(next.device || []);
  next.tags = uniqueArray([...(next.tags || []), ...(next.environment || []), ...(next.device || [])])
    .filter((tag) => !/(柠檬水|自取水|纸巾|宠物|儿童|预约|等位)/.test(tag));
  next.customTags = uniqueArray([...(next.customTags || []), ...(next.food || []), ...(next.business || []), ...(next.service || [])])
    .filter((tag) => !next.tags.includes(tag));
  next.notes = pruneDuplicateNotes(next.notes || '', next);
  return next;
}

function normalizeDianpingDetailVenue(detail = {}) {
  if (!detail || detail.provider !== 'dianping-mobile') return null;
  const priceText = String(detail.priceText || '').trim();
  const services = normalizeArray(detail.services);
  const tags = normalizeArray(detail.tags);
  const recommendations = normalizeArray(detail.recommendations);
  const category = String(detail.category || '').trim();
  const featureText = [
    category,
    detail.area,
    detail.rankText,
    detail.statusText,
    detail.desc,
    ...services,
    ...tags,
    ...recommendations
  ].filter(Boolean).join(' ');
  const notes = [
    detail.statusText ? `营业状态：${detail.statusText}` : '',
    detail.phone ? `电话：${detail.phone}` : '',
    detail.rating ? `大众点评评分：${detail.rating}` : '',
    detail.reviewCount ? `评论数：${detail.reviewCount}` : '',
    detail.scoreDetail ? `评分明细：${detail.scoreDetail}` : '',
    detail.rankText ? `榜单：${detail.rankText}` : ''
  ].filter(Boolean).join('\n');
  const price = parsePriceFromText(priceText);
  return sanitizeVenueFields({
    name: detail.name || '',
    address: detail.address || '',
    hours: detail.hours || '',
    price,
    environment: normalizeEnvironmentValues(extractEnvironmentFeatures(featureText)),
    device: normalizeDeviceValues(extractDeviceFeatures(featureText)),
    food: extractFoodCategories(recommendations.join(' ')),
    business: normalizeBusinessValues([category], featureText),
    service: uniqueArray([...services, ...extractServiceFeatures(featureText)]),
    pet: uniqueArray([...services, ...extractServiceFeatures(featureText)]),
    tags: uniqueArray([...tags, ...services]),
    customTags: uniqueArray([...recommendations, category].filter(Boolean)),
    menuInfo: recommendations.length ? recommendations.join('、') : '',
    membershipInfo: '',
    notes,
    sceneType: extractScenePersona(featureText).join('、') || '',
    images: normalizeArray(detail.images).map(cleanImageUrl).filter(Boolean),
    source: detail.sourceUrl || ''
  });
}

function mergeVenueWithFallback(primary, fallback) {
  if (!primary) return fallback;
  if (!fallback) return primary;
  const merged = { ...primary };
  if (fallback.name && (!merged.name || fallback.name.includes(merged.name) || merged.name.includes(fallback.name))) {
    merged.name = fallback.name;
  }
  ['name', 'address', 'hours', 'menuInfo', 'membershipInfo', 'notes', 'sceneType', 'source'].forEach((field) => {
    if (!merged[field] && fallback[field]) merged[field] = fallback[field];
  });
  if (Number(fallback.price?.amount) || fallback.price?.text) {
    merged.price = fallback.price;
  }
  merged.service = uniqueArray([...(merged.service || []), ...(merged.pet || [])]);
  fallback.service = uniqueArray([...(fallback.service || []), ...(fallback.pet || [])]);
  ['environment', 'device', 'food', 'business', 'service', 'pet', 'tags', 'customTags', 'images'].forEach((field) => {
    merged[field] = uniqueArray([...(merged[field] || []), ...(fallback[field] || [])]);
  });
  merged.environment = normalizeEnvironmentValues([...(fallback.environment || []), ...(primary.environment || [])]);
  merged.device = normalizeDeviceValues(merged.device || []);
  merged.business = normalizeBusinessValues(merged.business || [], [merged.sceneType, merged.menuInfo, ...(merged.food || [])].join(' '));
  if (fallback.notes && merged.notes && !merged.notes.includes(fallback.notes)) {
    merged.notes = `${merged.notes}\n${fallback.notes}`;
  }
  return sanitizeVenueFields(merged);
}

function normalizeDianpingMobileText(shop = {}) {
  const detail = normalizeDianpingMobileShop(shop);
  return [
    detail.name ? `名称：${detail.name}` : '',
    detail.address ? `地点：${detail.address}` : '',
    detail.hours ? `时间：${detail.hours}` : '',
    detail.priceText ? `价格：${detail.priceText}` : '',
    detail.category ? `场景：${detail.category}` : '',
    detail.rating ? `评分：${detail.rating}` : '',
    detail.reviewCount ? `评论数：${detail.reviewCount}` : '',
    detail.scoreDetail ? `评分明细：${detail.scoreDetail}` : '',
    detail.area ? `商圈：${detail.area}` : '',
    detail.rankText ? `榜单：${detail.rankText}` : '',
    detail.statusText ? `营业状态：${detail.statusText}` : '',
    detail.phone ? `电话：${detail.phone}` : '',
    detail.distanceText ? `交通：${detail.distanceText}` : '',
    detail.services?.length ? `服务：${detail.services.join('、')}` : '',
    detail.recommendations?.length ? `推荐菜：${detail.recommendations.join('、')}` : '',
    detail.images?.length ? `图片：${detail.images.join('、')}` : '',
    detail.sourceUrl || ''
  ].filter(Boolean).join('\n');
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
  const images = uniqueArray([
    ...normalizeImageUrls(raw.images_list),
    ...normalizeImageUrls(raw.image_list),
    ...normalizeImageUrls(raw.images),
    ...normalizeImageUrls(raw.image),
    ...normalizeImageUrls(raw.pic_list),
    ...normalizeImageUrls(raw.picList),
    ...normalizeImageUrls(raw.pictures),
    ...normalizeImageUrls(raw.cover),
    ...normalizeImageUrls(card.images_list),
    ...normalizeImageUrls(card.image_list),
    ...normalizeImageUrls(card.images),
    ...normalizeImageUrls(card.image),
    ...normalizeImageUrls(card.pic_list),
    ...normalizeImageUrls(card.picList),
    ...normalizeImageUrls(card.pictures),
    ...normalizeImageUrls(card.cover)
  ]);
  debug.noteImageCount = images.length;

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
    ),
    images
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
  const value = values.find((item) => (
    (typeof item === 'string' && item.trim()) ||
    (typeof item === 'number' && Number.isFinite(item))
  ));
  return typeof value === 'undefined' ? '' : String(value).trim();
}

function normalizeNoteText(note, shareUrl) {
  if (!note) return '';
  return [
    note.title ? `标题：${note.title}` : '',
    note.desc ? `正文：${note.desc}` : '',
    note.author ? `作者：${note.author}` : '',
    note.ipLocation ? `地区：${note.ipLocation}` : '',
    note.images?.length ? `图片：${note.images.join('、')}` : '',
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
            'Extract one primary venue from lifestyle platform content, such as Xiaohongshu or Dianping.',
            'Return values in the same language as the source text.',
            'Use empty strings, empty arrays, or 0 for unknown fields.',
            'Do not invent facts. Only fill fields supported by the source text.',
            'Keep extraction rich but factual. Preserve all original evidence in sourceText; extract structured fields from that evidence, then put only simplified supported viewpoints in notes.',
            'If names conflict, prefer Gaode/Dianping POI names over Xiaohongshu names. Mention Xiaohongshu names only as aliases in notes when useful.',
            'If sources conflict on open status, hours, or phone, prefer Gaode/Dianping official details over Xiaohongshu or review text.',
            'If sources conflict on environment facts, prefer Gaode/Dianping facts over Xiaohongshu. Do not output contradictory environment labels, for example do not output both 光线：明亮 and 光线：昏暗.',
            'Do not duplicate one fact across multiple fields. Put 柠檬水/自取水/纸巾/宠物政策/预约等位 only in service, not in device or notes. Put physical facilities only in device. Put atmosphere only in environment.',
            'Classify venue facts into these PickPick fields:',
            'hours: use the most detailed version. Normalize like 周一至周五 10:00-19:30；周六至周日 10:00-20:00. Preserve special date rules exactly after normal hours, e.g. 2026-02-16至2026-02-16 周一 全天关闭.',
            'sceneType: output scene/persona labels joined by 、, such as 适合学习, 不适合学习, 适合工作, 不适合工作, 适合聚餐, 适合打卡拍照, 适合看书, 适合下午茶, 适合亲子, 适合一人食, 适合旅行. If text says 电脑/办公/赶PPT and does not say network is bad, classify as 适合工作. Also extract peak time facts into notes.',
            'environment: output atmosphere facts, not facilities. Use labels like 音量：安静/较安静/嘈杂/非常嘈杂, 光线：明亮/昏暗/自然光充足, 风格：极简风/工业风/日式原木/美式复古/露营风/网红 ins 风/温馨, 空间：空间宽敞/略显局促/有户外区域. Output only one 音量 label, one 光线 label, one 空间 label, and one 温度 label. Limit style to 2 keywords.',
            'device: output hardware/facility facts, such as 大桌子, 小圆桌, 沙发位, 临窗座位, 高脚凳, 外摆区, 露台, 插座, 提供充电宝, Wi-Fi速度快, 洗手间干净, 洗手间需密码, 无洗手间. Do not output floor counts such as 三层.',
            'food: output concrete product categories, not long dish names, such as 手冲咖啡, 巴斯克蛋糕, Gelato, 可颂, 轻食简餐, 茶饮, 气泡水. Put detailed dish names in menuInfo.',
            'business: choose 1-2 from this exact enum only: 精品咖啡, 连锁咖啡, 咖啡+书店, 日咖夜酒（早C晚A）, 社区咖啡馆, 烘焙专门店, 网红打卡店, 买手店复合空间. Use 日咖夜酒（早C晚A） if text says 晚上变身酒吧 or 特调鸡尾酒.',
            'service: output service/policy labels when supported, such as 免费柠檬水, 免费自取水, 提供纸巾, 宠物友好, 不可携带宠物, 允许儿童推车, 无需预约, 需现场等位, 可提前预定包间. If only shop cats/dogs are mentioned, use 店猫 or 可带狗. Do not output a separate pet field unless needed for backward compatibility.',
            'For Dianping text, prefer the Dianping price phrase for price.amount, price.unit, and price.text.',
            'price.amount must be a number. price.unit should be a short unit from the source text.',
            'price.text should be formatted like 人均：59元 when available; if no price exists, keep empty and do not guess.',
            'notes: include only real supported details not already covered by structured fields: 营业状态, 电话, 高峰时段, 外带规则, 榜单/评价来源, and one concise experience summary with 最大亮点 and 最大槽点. Do not repeat service/device/environment/food/address/hours/price facts already extracted. Do not infer or imagine.',
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
                service: [],
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
  const venue = enrichVenueWithSourceSignals(normalizeVenue(parsed?.venue || parsed), sourceText);
  debug.deepSeekError = '';
  return hasVenueData(venue) ? venue : null;
}

function normalizeVenue(value = {}) {
  const price = value.price || {};
  const environment = normalizeEnvironmentValues(normalizeArray(value.environment || value.environments));
  const device = normalizeDeviceValues(normalizeArray(value.device || value.devices || value.equipment));
  const food = normalizeArray(value.food || value.foods || value.menuItems || value.menu_items);
  const sourceForRules = [
    value.sceneType,
    value.scene_type,
    value.menuInfo,
    value.menu_info,
    value.notes,
    value.note
  ].filter(Boolean).join(' ');
  const business = normalizeBusinessValues(value.business || value.businessType || value.business_type || value.businesses, sourceForRules);
  const scenePersona = extractScenePersona([value.sceneType, value.scene_type, sourceForRules].filter(Boolean).join(' '));
  const service = uniqueArray([
    ...normalizeArray(value.service || value.services),
    ...normalizeArray(value.pet || value.pets)
  ]);
  const pet = service;
  const knownTagOptions = ['音量：安静', '音量：较安静', '音量：嘈杂', '音量：非常嘈杂', '光线：明亮', '光线：昏暗', '光线：自然光充足', '风格：极简风', '风格：工业风', '风格：日式原木', '风格：美式复古', '风格：露营风', '风格：网红 ins 风', '风格：温馨', '空间：空间宽敞', '空间：略显局促', '空间：有户外区域', '温度：舒适', '温度：偏冷', '温度：偏热', '大桌子', '小圆桌', '沙发位', '临窗座位', '高脚凳', '外摆区', '露台', '插座', '提供充电宝', 'Wi-Fi', 'Wi-Fi速度快', '包间', '洗手间干净', '洗手间需密码', '无洗手间'];
  const tags = uniqueArray([
    ...normalizeArray(value.tags).filter((tag) => knownTagOptions.includes(tag)),
    ...environment,
    ...device
  ]);
  const customTags = uniqueArray([
    ...normalizeArray(value.customTags || value.custom_tags),
    ...food,
    ...business,
    ...service
  ]);
  return sanitizeVenueFields({
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
    service,
    pet,
    tags,
    customTags,
    menuInfo: String(value.menuInfo || value.menu_info || '').trim(),
    membershipInfo: String(value.membershipInfo || value.membership_info || '').trim(),
    notes: extractUsefulNotes(value.notes || value.note || ''),
    sceneType: scenePersona.join('、') || String(value.sceneType || value.scene_type || '').trim(),
    images: normalizeArray(value.images || value.photos)
  });
}

function extractFullHoursFromText(value = '') {
  const lines = String(value || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const scheduleLines = lines.filter((line) => (
    /(营业|时间|开放|周一|周二|周三|周四|周五|周六|周日|周天|周末|工作日|节假日|每天|每日)/.test(line)
    && /\d{1,2}[:：]\d{2}/.test(line)
  ));
  if (scheduleLines.length) return uniqueArray(scheduleLines).slice(0, 4).join('；').replace(/：/g, ':');

  const scheduleMatches = String(value || '').match(/(?:周[一二三四五六日天末至到、,，\s-]+|工作日|节假日|每天|每日).{0,32}\d{1,2}[:：]\d{2}.{0,20}\d{1,2}[:：]\d{2}/g) || [];
  if (scheduleMatches.length) return uniqueArray(scheduleMatches).slice(0, 4).join('；').replace(/：/g, ':');

  const range = String(value || '').match(/\d{1,2}[:：]\d{2}\s*[-~—至到]\s*\d{1,2}[:：]\d{2}/);
  return range ? range[0].replace(/：/g, ':') : '';
}

function extractStatusPhoneNotes(value = '') {
  const text = String(value || '');
  const status = text.match(/(?:营业状态[:：]?\s*)?(营业中|休息中|暂停营业|已打烊)/)?.[1] || '';
  const phone = text.match(/(?:电话|商家电话|联系电话)[:：\s]*((?:\d{3,4}[-\s]?)?\d{7,8}(?:转\d+)?|1[3-9]\d{9})/)?.[1] || '';
  return [
    status ? `营业状态：${status}` : '',
    phone ? `电话：${phone}` : ''
  ].filter(Boolean).join('\n');
}

function extractUsefulNotes(value = '') {
  const text = String(value || '');
  const base = extractStatusPhoneNotes(text).split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const compact = text.replace(/\s+/g, ' ');
  const notes = [...base];
  const hasNegativePrice = /价格不便宜|不便宜|偏贵|贵|价格高|人均高/.test(compact);
  const hasWorth = /很值得|值得|值|性价比高|体验下来.*值/.test(compact);
  if (hasNegativePrice && hasWorth) notes.push('价格体验：不便宜但值得');
  else if (hasWorth) notes.push('价格体验：值得');
  else if (hasNegativePrice) notes.push('价格体验：不便宜');

  if (/环境.{0,12}(非常棒|很棒|特别棒|很好|不错|舒服)|环境非常棒|环境很棒/.test(compact)) notes.push('环境体验：非常棒');
  else if (/环境.{0,12}(一般|普通)/.test(compact)) notes.push('环境体验：一般');
  else if (/环境.{0,12}(嘈杂|吵|人多)/.test(compact)) notes.push('环境体验：偏吵');

  if (/柠檬水/.test(compact)) {
    notes.push(/不提供.{0,6}柠檬水|没有.{0,6}柠檬水|无.{0,6}柠檬水/.test(compact)
      ? '服务：不提供柠檬水'
      : '服务：提供柠檬水');
  } else {
    const serviceMatch = compact.match(/服务.{0,18}(很好|不错|一般|差|热情|冷淡|周到)/);
    if (serviceMatch) notes.push(`服务：${serviceMatch[1]}`);
  }

  if (/大众点评.{0,8}必吃榜|必吃榜/.test(compact)) notes.push('评价来源：大众点评必吃榜');
  if (/工作日中午.{0,12}(排队|人多)|周末.{0,12}(排队|人多|嘈杂|吵)|高峰.{0,12}(排队|人多)|饭点.{0,12}(排队|人多)/.test(compact)) {
    const peak = compact.match(/(?:工作日中午|周末|高峰|饭点).{0,18}(?:排队|人多|嘈杂|吵)/)?.[0] || '';
    notes.push(`高峰时段：${peak}`);
  }
  if (/外带减\s*\d+|支持外带|可以外带|可外带|不可外带|不能外带/.test(compact)) {
    const takeaway = compact.match(/外带减\s*\d+\s*元?|支持外带|可以外带|可外带|不可外带|不能外带/)?.[0] || '';
    notes.push(`外带规则：${takeaway}`);
  }
  if (/柠檬水|自取水|纸巾/.test(compact)) {
    const services = uniqueArray([
      /免费.{0,4}柠檬水|柠檬水/.test(compact) ? '免费柠檬水' : '',
      /免费.{0,4}自取水|自取水/.test(compact) ? '免费自取水' : '',
      /纸巾/.test(compact) ? '提供纸巾' : ''
    ]);
    if (services.length) notes.push(`免费服务：${services.join('、')}`);
  }
  if (/无需预约|不用预约|需现场等位|现场等位|提前预定|提前预约|可预定包间|可提前预定包间/.test(compact)) {
    const booking = compact.match(/无需预约|不用预约|需现场等位|现场等位|可提前预定包间|提前预定|提前预约/)?.[0] || '';
    notes.push(`预约规则：${booking}`);
  }
  if (/愿意.{0,4}二刷|会.{0,4}再去|想.{0,4}再去|好感|喜欢|推荐/.test(compact)) notes.push('好感度：想再去');
  if (/不推荐|避雷|踩雷/.test(compact)) notes.push('好感度：不推荐');
  if (/周末.{0,8}(人多|嘈杂|吵)|人多.{0,8}(嘈杂|吵)|排队/.test(compact)) notes.push('客流：人多或需排队');
  const highlight = compact.match(/(?:最大亮点|亮点|优点|最喜欢|推荐).{0,24}/)?.[0] || '';
  const drawback = compact.match(/(?:最大槽点|槽点|缺点|不足|避雷).{0,24}/)?.[0] || '';
  if (highlight || drawback) {
    notes.push(`体验总结：${[highlight ? `亮点是${highlight.replace(/^(最大亮点|亮点|优点|最喜欢|推荐)[:：]?/, '')}` : '', drawback ? `槽点是${drawback.replace(/^(最大槽点|槽点|缺点|不足|避雷)[:：]?/, '')}` : ''].filter(Boolean).join('，')}`);
  }

  return uniqueArray(notes).slice(0, 8).join('\n');
}

function enrichVenueWithSourceSignals(venue, sourceText = '') {
  if (!venue) return venue;
  const next = { ...venue };
  next.environment = normalizeEnvironmentValues([...(next.environment || []), ...extractEnvironmentFeatures(sourceText)]);
  next.device = normalizeDeviceValues([...(next.device || []), ...extractDeviceFeatures(sourceText)]);
  next.service = uniqueArray([...(next.service || []), ...(next.pet || []), ...extractServiceFeatures(sourceText)]);
  next.pet = next.service;
  const foodCategories = extractFoodCategories([sourceText, ...(next.food || [])].join(' '));
  if (foodCategories.length) next.food = foodCategories;
  next.business = normalizeBusinessValues(next.business || [], [sourceText, ...(next.food || [])].join(' '));
  const scenePersona = extractScenePersona(sourceText);
  if (scenePersona.length) next.sceneType = scenePersona.join('、');
  next.tags = uniqueArray([...(next.tags || []), ...(next.environment || []), ...(next.device || [])]);
  next.customTags = uniqueArray([...(next.customTags || []), ...(next.food || []), ...(next.business || []), ...(next.service || []), ...(next.pet || [])]);
  const sourceHours = extractFullHoursFromText(sourceText);
  if (sourceHours && (!next.hours || sourceHours.length > String(next.hours).length + 4)) next.hours = sourceHours;
  const notes = extractUsefulNotes(sourceText);
  if (notes) next.notes = next.notes && !next.notes.includes(notes) ? `${next.notes}\n${notes}` : (next.notes || notes);
  return sanitizeVenueFields(next);
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[，,、\s]+/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function normalizeDianpingImages(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === 'string') return item.trim();
    if (!item || typeof item !== 'object') return '';
    return pickString(item.url, item.picUrl, item.pic_url, item.imageUrl, item.image_url, item.id, item.picId, item.pic_id);
  }).map(cleanImageUrl).filter(Boolean);
}

function normalizeImageUrls(value, output = [], seen = new Set(), depth = 0) {
  if (!value || depth > 5 || output.length >= 80) return output;
  if (typeof value === 'string') {
    const url = cleanImageUrl(value);
    if (url) output.push(url);
    return output;
  }
  if (typeof value !== 'object' || seen.has(value)) return output;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => normalizeImageUrls(item, output, seen, depth + 1));
    return output;
  }
  [
    value.url,
    value.src,
    value.imageUrl,
    value.image_url,
    value.originUrl,
    value.origin_url,
    value.originalUrl,
    value.original_url,
    value.masterUrl,
    value.master_url,
    value.urlDefault,
    value.url_default,
    value.urlPre,
    value.url_pre,
    value.fileUrl,
    value.file_url
  ].forEach((item) => normalizeImageUrls(item, output, seen, depth + 1));
  ['urls', 'url_list', 'urlList', 'image_urls', 'imageUrls', 'images', 'image_list', 'imageList', 'info_list', 'infoList'].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(value, key)) normalizeImageUrls(value[key], output, seen, depth + 1);
  });
  return uniqueArray(output);
}

function cleanImageUrl(value) {
  const text = String(value || '').trim().replace(/&amp;/g, '&');
  if (!text || !/^https?:\/\//i.test(text)) return '';
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (isKnownImageUrl(url)) return url.toString();
  } catch (error) {
    return '';
  }
  return '';
}

function isKnownImageUrl(url) {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  if (/\.(jpe?g|png|webp|gif|avif)(?:$|[?#])/i.test(`${path}${url.search}`)) return true;
  if (host.includes('dpfile.com')) return true;
  if (host.includes('meituan.net')) return true;
  if (host.includes('xiaohongshu.com') || host.includes('xhscdn.com') || host.includes('sns-webpic') || host.includes('sns-img')) {
    return !/\/discovery\/item\//.test(path);
  }
  if (host.includes('autonavi.com') || host.includes('amap.com')) return /showpic|image|photo|pic/.test(path);
  return false;
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
    venue.service?.length ||
    venue.pet?.length ||
    venue.tags?.length ||
    venue.customTags?.length ||
    venue.images?.length ||
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

function normalizeAmapPoi(item = {}, query = '') {
  const location = parseAmapLocation(item.location);
  const bizExt = item.biz_ext || item.bizExt || {};
  const photos = Array.isArray(item.photos)
    ? item.photos.map((photo) => ({
      title: String(photo.title || '').trim(),
      url: cleanImageUrl(photo.url)
    })).filter((photo) => photo.url)
    : [];
  return {
    id: String(item.id || '').trim(),
    query,
    name: String(item.name || '').trim(),
    type: String(item.type || '').trim(),
    typecode: String(item.typecode || '').trim(),
    address: Array.isArray(item.address) ? '' : String(item.address || '').trim(),
    pname: String(item.pname || '').trim(),
    cityname: String(item.cityname || '').trim(),
    adname: String(item.adname || '').trim(),
    adcode: String(item.adcode || '').trim(),
    tel: Array.isArray(item.tel) ? '' : String(item.tel || '').trim(),
    distance: String(item.distance || '').trim(),
    latitude: location?.latitude || null,
    longitude: location?.longitude || null,
    rating: String(bizExt.rating || '').trim(),
    cost: String(bizExt.cost || '').trim(),
    openTime: String(bizExt.opentime2 || bizExt.open_time || bizExt.openTime || bizExt.opentime || '').trim(),
    photos,
    raw: item
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

async function handlePoiSearch(payload) {
  const keyword = String(payload.keyword || payload.keywords || payload.name || payload.query || '').trim();
  const city = String(payload.city || '').trim();
  const debug = {
    stage: 'amap-poi-search',
    hasAmapKey: Boolean(AMAP_KEY),
    keyword,
    city,
    amapStatus: null,
    amapInfo: '',
    amapInfocode: '',
    count: 0,
    errors: []
  };

  if (!keyword) {
    debug.errors.push('empty keyword');
    return { code: 0, msg: 'empty keyword', data: { pois: [], best: null, debug } };
  }

  if (!AMAP_KEY) {
    debug.errors.push('missing AMAP_KEY');
    return { code: 0, msg: 'missing amap key', data: { pois: [], best: null, debug } };
  }

  try {
    const url = new URL(AMAP_POI_URL);
    url.searchParams.set('key', AMAP_KEY);
    url.searchParams.set('keywords', keyword);
    url.searchParams.set('offset', String(Math.min(Math.max(Number(payload.offset) || 10, 1), 25)));
    url.searchParams.set('page', String(Math.max(Number(payload.page) || 1, 1)));
    url.searchParams.set('extensions', 'all');
    if (city) {
      url.searchParams.set('city', city);
      url.searchParams.set('citylimit', 'true');
    }

    const result = await fetchJson(url.toString());
    debug.httpStatus = result.response.status;
    debug.amapStatus = result.json?.status || '';
    debug.amapInfo = result.json?.info || '';
    debug.amapInfocode = result.json?.infocode || '';
    debug.count = Number(result.json?.count || 0);

    const pois = Array.isArray(result.json?.pois)
      ? result.json.pois.map((poi) => normalizeAmapPoi(poi, keyword)).filter((poi) => poi.name)
      : [];
    const best = pois[0] || null;
    if (!result.response.ok || result.json?.status !== '1') {
      debug.errors.push('poi search failed');
      return { code: 0, msg: 'poi search failed', data: { pois, best, raw: result.json, debug } };
    }

    return { code: 0, msg: 'ok', data: { pois, best, raw: result.json, debug } };
  } catch (error) {
    debug.errors.push(error?.message || String(error));
    return { code: 0, msg: 'poi search failed', data: { pois: [], best: null, debug } };
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
    hasIdataRiverKey: Boolean(IDATARIVER_API_KEY),
    hasIdataRiverDianpingNoteUrl: Boolean(IDATARIVER_DIANPING_NOTE_URL),
    hasDianpingDetailApiUrl: Boolean(JUSTONE_DIANPING_DETAIL_URL),
    hasDianpingMobileServiceUrl: Boolean(DIANPING_MOBILE_SERVICE_URL),
    hasDianpingMobileCurl: false,
    hasDianpingMobileRequest: false,
    dianpingMobileRequestMode: '',
    dianpingMobileRequestUrl: '',
    dianpingMobileRequestHeaderNames: [],
    shareUrl: '',
    redirectUrl: '',
    dianpingUrl: '',
    dianpingNoteId: '',
    dianpingApiProvider: '',
    dianpingMobileServiceStatus: null,
    dianpingMobileServiceCode: null,
    dianpingMobileServiceMessage: '',
    dianpingMobileServiceError: '',
    dianpingMobileServiceFinalUrl: '',
    dianpingMobileServiceDecodedEncoding: '',
    dianpingMobileServiceReadError: '',
    dianpingMobileServiceHasCookie: null,
    dianpingMobileServiceHeaderNames: [],
    dianpingMobileStatusCode: null,
    dianpingMobileImageCount: 0,
    noteId: '',
    noteIdSource: '',
    shareResponseStatus: null,
    noteResponseStatus: null,
    noteApiCode: null,
    noteApiMessage: ''
  };

  try {
    const channel = String(payload.channel || '').toLowerCase();
    let resolved;
    if (channel === 'xiaohongshu') {
      resolved = await resolveXiaohongshuNote(payload, debug);
    } else if (channel === 'dianping') {
      resolved = await resolveDianpingContent(payload, debug);
    } else {
      resolved = {
        note: null,
        sourceText: [stripUrls(getPayloadText(payload)), normalizeExistingVenueText(payload.venue)]
          .filter(Boolean)
          .join('\n')
      };
    }
    const { note, sourceText } = resolved;
    const extractedVenue = await extractVenueWithDeepSeek(sourceText, payload.venue, debug);
    const noteImages = normalizeArray(note?.images).map(cleanImageUrl).filter(Boolean);
    const fallbackVenue = normalizeDianpingDetailVenue(note);
    const mergedExtractedVenue = mergeVenueWithFallback(extractedVenue, fallbackVenue);
    const venueImages = normalizeArray(mergedExtractedVenue?.images).map(cleanImageUrl).filter(Boolean);
    const images = channel === 'xiaohongshu' || channel === 'dianping'
      ? uniqueArray([...noteImages, ...venueImages])
      : uniqueArray([...venueImages, ...noteImages]);
    const venue = mergedExtractedVenue
      ? {
        ...mergedExtractedVenue,
        images
      }
      : null;
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

  if (payload.type === 'poiSearch') {
    sendJson(res, 200, await handlePoiSearch(payload));
    return;
  }

  sendJson(res, 200, { code: 0, msg: 'ok', data: null });
});

server.listen(PORT, () => {
  console.log(`PickPick extract function listening on ${PORT}`);
});
