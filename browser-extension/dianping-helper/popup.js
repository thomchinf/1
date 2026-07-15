const ENDPOINT = 'https://1452700938-gzyqz1yprr.ap-guangzhou.tencentscf.com';
const MOBILE_USER_AGENT = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36';

const state = {
  tab: null,
  shopUrl: '',
  pageSnapshot: null,
  result: null
};

const els = {
  pageStatus: document.getElementById('page-status'),
  shopUrl: document.getElementById('shop-url'),
  extractBtn: document.getElementById('extract-btn'),
  extractStatus: document.getElementById('extract-status'),
  sendStatus: document.getElementById('send-status'),
  resultPanel: document.getElementById('result-panel'),
  resultName: document.getElementById('result-name'),
  resultPrice: document.getElementById('result-price'),
  resultAddress: document.getElementById('result-address'),
  resultHours: document.getElementById('result-hours'),
  resultScene: document.getElementById('result-scene'),
  resultFood: document.getElementById('result-food'),
  resultImages: document.getElementById('result-images'),
  sendPickPickBtn: document.getElementById('send-pickpick-btn'),
  copyJsonBtn: document.getElementById('copy-json-btn'),
  copyTextBtn: document.getElementById('copy-text-btn')
};

function setStatus(element, message, isError = false) {
  element.textContent = message || '';
  element.style.color = isError ? '#b23b28' : '';
}

function normalizeDianpingShopUrl(value) {
  const match = String(value || '').match(/https?:\/\/(?:m\.|www\.)?dianping\.com\/shop\/([A-Za-z0-9]+)/i);
  return match?.[1] ? `https://m.dianping.com/shop/${match[1]}` : '';
}

function chromeCall(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(result);
    });
  });
}

async function getActiveTab() {
  const tabs = await chromeCall(chrome.tabs.query, { active: true, currentWindow: true });
  return tabs[0] || null;
}

async function getCookiesForUrl(url) {
  try {
    return await chromeCall(chrome.cookies.getAll, { url });
  } catch (error) {
    return [];
  }
}

function mergeCookies(cookieGroups) {
  const map = new Map();
  cookieGroups.flat().forEach((cookie) => {
    if (!cookie?.name) return;
    map.set(cookie.name, cookie);
  });
  return [...map.values()]
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

async function buildHeaders(tabUrl, shopUrl) {
  const cookieHeader = mergeCookies([
    await getCookiesForUrl(tabUrl),
    await getCookiesForUrl(shopUrl),
    await getCookiesForUrl('https://www.dianping.com/'),
    await getCookiesForUrl('https://m.dianping.com/')
  ]);

  return {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': `${navigator.language || 'zh-CN'},zh;q=0.9`,
    Referer: tabUrl,
    'User-Agent': MOBILE_USER_AGENT,
    ...(cookieHeader ? { Cookie: cookieHeader } : {})
  };
}

async function getPageSnapshot(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const text = document.body?.innerText || '';
        const metaDescription = document.querySelector('meta[name="description"]')?.content || '';
        const metaKeywords = document.querySelector('meta[name="keywords"]')?.content || '';
        return {
          title: document.title || '',
          url: location.href,
          metaDescription,
          metaKeywords,
          text: text.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').slice(0, 16000)
        };
      }
    });
    return result?.result || null;
  } catch (error) {
    return null;
  }
}

function getVenue(data) {
  return data?.data?.venue || data?.venue || {};
}

function getSourceText(data) {
  return data?.data?.sourceText || data?.sourceText || '';
}

function renderResult(data) {
  const venue = getVenue(data);
  const food = [...(venue.food || []), ...(venue.customTags || [])]
    .filter(Boolean)
    .slice(0, 8);
  els.resultName.textContent = venue.name || '-';
  els.resultPrice.textContent = venue.price?.text || (venue.price?.amount ? `${venue.price.amount}` : '-');
  els.resultAddress.textContent = venue.address || '-';
  els.resultHours.textContent = venue.hours || '-';
  els.resultScene.textContent = venue.sceneType || '-';
  els.resultFood.textContent = food.length ? [...new Set(food)].join('、') : '-';
  els.resultImages.textContent = `${venue.images?.length || 0} 张`;
  els.resultPanel.classList.remove('is-hidden');
}

function buildPageText(snapshot) {
  if (!snapshot) return '';
  return [
    snapshot.title ? `页面标题：${snapshot.title}` : '',
    snapshot.metaDescription ? `页面描述：${snapshot.metaDescription}` : '',
    snapshot.metaKeywords ? `页面关键词：${snapshot.metaKeywords}` : '',
    snapshot.text || ''
  ].filter(Boolean).join('\n');
}

async function extractCurrentShop() {
  if (!state.tab || !state.shopUrl) return;
  setStatus(els.extractStatus, '正在读取页面和 Cookie，并请求 PickPick 云函数...');
  els.extractBtn.disabled = true;
  try {
    const [headers, snapshot] = await Promise.all([
      buildHeaders(state.tab.url, state.shopUrl),
      getPageSnapshot(state.tab.id)
    ]);
    state.pageSnapshot = snapshot;
    if (!headers.Cookie) {
      throw new Error('没有读取到大众点评 Cookie，请确认已登录，并允许扩展读取站点数据。');
    }

    const pageText = buildPageText(snapshot);
    const payload = {
      type: 'extract',
      channel: 'dianping',
      context: 'extension',
      text: [state.shopUrl, pageText].filter(Boolean).join('\n'),
      url: state.shopUrl,
      venue: {
        name: '',
        channelLinks: {
          dianping: state.shopUrl
        }
      },
      dianpingMobile: {
        url: state.shopUrl,
        headers,
        requestMode: 'extension-compact'
      }
    };

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`云函数请求失败：${response.status}`);
    const data = await response.json();
    state.result = data;
    await chrome.storage.local.set({
      pickpickDianpingLastResult: data,
      pickpickDianpingLastShopUrl: state.shopUrl,
      pickpickDianpingLastPageText: pageText,
      pickpickDianpingLastUpdatedAt: Date.now()
    });
    renderResult(data);
    setStatus(els.extractStatus, '提取完成。');
  } catch (error) {
    setStatus(els.extractStatus, error?.message || String(error), true);
  } finally {
    els.extractBtn.disabled = !state.shopUrl;
  }
}

async function findPickPickTab() {
  const tabs = await chromeCall(chrome.tabs.query, {});
  return tabs.find((tab) => /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+\/?/i.test(tab.url || ''))
    || tabs.find((tab) => /\/pick\/index\.html$/i.test((tab.url || '').replace(/\\/g, '/')))
    || tabs.find((tab) => /index\.html$/i.test(tab.url || '') && /pick/i.test(tab.title || ''))
    || null;
}

function buildBridgePayload(data) {
  return {
    source: 'pickpick-dianping-helper',
    channel: 'dianping',
    shopUrl: state.shopUrl,
    rawText: buildPlainText(data),
    venue: getVenue(data),
    result: data
  };
}

async function sendToPickPick() {
  if (!state.result) return;
  setStatus(els.sendStatus, '正在查找已打开的 PickPick 页面...');
  try {
    const tab = await findPickPickTab();
    if (!tab?.id) {
      throw new Error('没有找到 PickPick 页面。请先打开 PickPick，再点击发送。');
    }
    const payload = buildBridgePayload(state.result);
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (detail) => {
        window.dispatchEvent(new CustomEvent('pickpick:dianping-result', { detail }));
      },
      args: [payload]
    });
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
    setStatus(els.sendStatus, '已发送到 PickPick。');
  } catch (error) {
    setStatus(els.sendStatus, `${error?.message || String(error)} 可先复制文本手动粘贴。`, true);
  }
}

async function copyText(value, doneMessage) {
  await navigator.clipboard.writeText(value);
  setStatus(els.extractStatus, doneMessage);
}

function buildPlainText(data) {
  const venue = getVenue(data);
  return [
    venue.name ? `名称：${venue.name}` : '',
    venue.address ? `地点：${venue.address}` : '',
    venue.hours ? `时间：${venue.hours}` : '',
    venue.price?.text || venue.price?.amount ? `价格：${venue.price?.text || venue.price?.amount}` : '',
    venue.sceneType ? `场景：${venue.sceneType}` : '',
    venue.device?.length ? `设备：${venue.device.join('、')}` : '',
    venue.food?.length ? `美食：${venue.food.join('、')}` : '',
    venue.business?.length ? `业态：${venue.business.join('、')}` : '',
    venue.pet?.length ? `宠物：${venue.pet.join('、')}` : '',
    venue.notes ? `备注：${venue.notes}` : '',
    venue.images?.length ? `图片：${venue.images.join('\n')}` : '',
    getSourceText(data)
  ].filter(Boolean).join('\n');
}

async function init() {
  state.tab = await getActiveTab();
  state.shopUrl = normalizeDianpingShopUrl(state.tab?.url || '');
  els.shopUrl.value = state.shopUrl || '';
  if (!state.tab) {
    els.pageStatus.textContent = '没有读取到当前标签页。';
    return;
  }
  if (!state.shopUrl) {
    els.pageStatus.textContent = '请先打开大众点评店铺详情页。';
    return;
  }
  els.pageStatus.textContent = '已识别当前大众点评店铺页。';
  els.extractBtn.disabled = false;
}

els.extractBtn.addEventListener('click', extractCurrentShop);
els.sendPickPickBtn.addEventListener('click', sendToPickPick);
els.copyJsonBtn.addEventListener('click', () => {
  if (!state.result) return;
  copyText(JSON.stringify(state.result, null, 2), 'JSON 已复制。');
});
els.copyTextBtn.addEventListener('click', () => {
  if (!state.result) return;
  copyText(buildPlainText(state.result), '文本已复制。');
});

init().catch((error) => {
  els.pageStatus.textContent = error?.message || String(error);
});
