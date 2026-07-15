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
    tags: uniqueArray([String(shop.category || '').trim(), String(shop.area || '').trim(), String(shop.rankText || '').trim(), ...services].filter(Boolean)),
    recommendations: recommendedDishes,
    services,
    desc: [
      shop.scoreDetail ? `评分明细：${shop.scoreDetail}` : '',
      shop.rankText ? `榜单：${shop.rankText}` : '',
      shop.statusText ? `营业状态：${shop.statusText}` : '',
      shop.distanceText ? `交通：${shop.distanceText}` : '',
      services.length ? `服务：${services.join('、')}` : ''
    ].filter(Boolean).join('\n'),
    images,
    sourceUrl: String(shop.sourceUrl || '').trim()
  };
}

function normalizeDianpingDetailVenue(detail = {}) {
  if (!detail || detail.provider !== 'dianping-mobile') return null;
  const priceText = String(detail.priceText || '').trim();
  const priceAmount = Number(priceText.match(/\d+(\.\d+)?/)?.[0]) || 0;
  const services = normalizeArray(detail.services);
  const recommendations = normalizeArray(detail.recommendations);
  const category = String(detail.category || '').trim();
  const notes = [
    detail.rating ? `大众点评评分：${detail.rating}` : '',
    detail.reviewCount ? `评论数：${detail.reviewCount}` : '',
    detail.scoreDetail ? `评分明细：${detail.scoreDetail}` : '',
    detail.rankText ? `榜单：${detail.rankText}` : '',
    detail.statusText ? `营业状态：${detail.statusText}` : '',
    detail.distanceText ? `交通：${detail.distanceText}` : '',
    services.length ? `服务：${services.join('、')}` : ''
  ].filter(Boolean).join('\n');
  return {
    name: detail.name || '',
    address: detail.address || '',
    hours: detail.hours || '',
    price: {
      amount: priceAmount,
      unit: priceAmount ? '人' : '',
      text: priceText
    },
    environment: [],
    device: services.filter((item) => /插座|Wi-?Fi|无线|停车|卫生间|宠物/i.test(item)),
    food: recommendations,
    business: category ? [category] : [],
    pet: uniqueArray([
      services.some((item) => /猫/.test(item)) ? '猫' : '',
      services.some((item) => /狗/.test(item)) ? '狗' : ''
    ]),
    tags: services,
    customTags: uniqueArray([...recommendations, category].filter(Boolean)),
    menuInfo: recommendations.length ? recommendations.join('、') : '',
    membershipInfo: '',
    notes,
    sceneType: /咖啡/.test(category) ? '咖啡馆' : (category || ''),
    images: normalizeArray(detail.images).map(cleanImageUrl).filter(Boolean),
    source: detail.sourceUrl || ''
  };
}

function mergeVenueWithFallback(primary, fallback) {
  if (!primary) return fallback;
  if (!fallback) return primary;
  const merged = { ...primary };
  ['name', 'address', 'hours', 'menuInfo', 'membershipInfo', 'notes', 'sceneType', 'source'].forEach((field) => {
    if (!merged[field] && fallback[field]) merged[field] = fallback[field];
  });
  if ((!Number(merged.price?.amount) && !merged.price?.text) && (Number(fallback.price?.amount) || fallback.price?.text)) {
    merged.price = fallback.price;
  }
  ['environment', 'device', 'food', 'business', 'pet', 'tags', 'customTags', 'images'].forEach((field) => {
    merged[field] = uniqueArray([...(merged[field] || []), ...(fallback[field] || [])]);
  });
  if (fallback.notes && merged.notes && !merged.notes.includes(fallback.notes)) {
    merged.notes = `${merged.notes}\n${fallback.notes}`;
  }
  return merged;
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
            'If the source says a feature is missing, scarce, unavailable, inconvenient, noisy, smoky, or otherwise negative, do not add it as a positive environment/device/tag. Put that caveat in notes.',
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
    sceneType: String(value.sceneType || value.scene_type || '').trim(),
    images: normalizeArray(value.images || value.photos)
  };
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
    openTime: String(bizExt.open_time || bizExt.openTime || bizExt.opentime || bizExt.opentime2 || '').trim(),
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
    const noteImages = normalizeArray(note?.images);
    const fallbackVenue = normalizeDianpingDetailVenue(note);
    const mergedExtractedVenue = mergeVenueWithFallback(extractedVenue, fallbackVenue);
    const venue = mergedExtractedVenue && noteImages.length
      ? {
        ...mergedExtractedVenue,
        images: uniqueArray([...(mergedExtractedVenue.images || []), ...noteImages])
      }
      : mergedExtractedVenue;
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
