const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.PICKPICK_XHS_PROXY_PORT || 18061);
const MAX_IMAGES = Number(process.env.PICKPICK_XHS_MAX_IMAGES || 9);
const DRAFT_DEBUG_PORT = Number(process.env.PICKPICK_XHS_DRAFT_PORT || 9223);
const EDGE_PATH = process.env.PICKPICK_XHS_BROWSER
  || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const DRAFT_PROFILE_DIR = process.env.PICKPICK_XHS_PROFILE
  || 'C:\\Users\\HP\\Desktop\\xhs-mcp\\browser-profile';
const DRAFT_IMAGE_DIR = process.env.PICKPICK_XHS_IMAGE_DIR
  || path.join(__dirname, '.xhs-draft-images');
const DRAFT_URL = 'https://creator.xiaohongshu.com/publish/publish?source=official&from=pickpick';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

function log(message, extra = '') {
  const suffix = extra ? ` ${extra}` : '';
  console.log(`[${new Date().toLocaleTimeString()}] ${message}${suffix}`);
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    ...CORS_HEADERS,
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 10 * 1024 * 1024) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(new Error('invalid json body'));
      }
    });
    req.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeFileName(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'image';
}

function imageExtensionFromType(contentType = '', fallback = '.jpg') {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('png')) return '.png';
  if (type.includes('webp')) return '.webp';
  if (type.includes('gif')) return '.gif';
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
  return fallback;
}

async function materializeImage(value, index) {
  const text = String(value || '').trim();
  if (!text) throw new Error('empty image');
  if (/^[a-zA-Z]:[\\/]/.test(text) || /^\\\\/.test(text) || /^\//.test(text)) {
    if (!fs.existsSync(text)) throw new Error(`image file not found: ${text}`);
    return text;
  }

  fs.mkdirSync(DRAFT_IMAGE_DIR, { recursive: true });
  const stamp = `${Date.now()}_${index + 1}`;

  const dataMatch = text.match(/^data:image\/([a-z0-9.+-]+);base64,(.+)$/i);
  if (dataMatch) {
    const ext = imageExtensionFromType(dataMatch[1], `.${dataMatch[1].replace('jpeg', 'jpg')}`);
    const filePath = path.join(DRAFT_IMAGE_DIR, `${stamp}_${sanitizeFileName('upload')}${ext}`);
    fs.writeFileSync(filePath, Buffer.from(dataMatch[2], 'base64'));
    return filePath;
  }

  if (/^https?:\/\//i.test(text)) {
    const response = await fetch(text, {
      headers: {
        'User-Agent': 'Mozilla/5.0 PickPick'
      }
    });
    if (!response.ok) throw new Error(`download image HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    const ext = imageExtensionFromType(contentType, path.extname(new URL(text).pathname) || '.jpg');
    const filePath = path.join(DRAFT_IMAGE_DIR, `${stamp}_${sanitizeFileName(path.basename(new URL(text).pathname, ext))}${ext}`);
    fs.writeFileSync(filePath, Buffer.from(await response.arrayBuffer()));
    return filePath;
  }

  throw new Error('unsupported image format');
}

async function materializeImages(images = []) {
  const selected = images.slice(0, MAX_IMAGES);
  const files = [];
  for (let index = 0; index < selected.length; index += 1) {
    files.push(await materializeImage(selected[index], index));
  }
  return files;
}

function buildDraftContent(payload) {
  const content = String(payload.content || '').trim();
  const tags = Array.isArray(payload.tags)
    ? payload.tags.map((tag) => String(tag || '').trim().replace(/^#+/, '')).filter(Boolean)
    : [];
  const tagText = [...new Set(tags)].map((tag) => `#${tag}`).join(' ');
  return [content, tagText].filter(Boolean).join('\n\n');
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}

async function waitForDraftBrowser(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await fetchJson(`http://127.0.0.1:${DRAFT_DEBUG_PORT}/json/version`);
    } catch (error) {
      lastError = error;
      await sleep(300);
    }
  }
  throw lastError || new Error('browser did not start');
}

async function ensureDraftBrowser() {
  try {
    await waitForDraftBrowser(1200);
    return;
  } catch (error) {}

  if (!fs.existsSync(EDGE_PATH)) {
    throw new Error(`Edge not found: ${EDGE_PATH}`);
  }
  fs.mkdirSync(DRAFT_PROFILE_DIR, { recursive: true });
  spawn(EDGE_PATH, [
    `--remote-debugging-port=${DRAFT_DEBUG_PORT}`,
    `--user-data-dir=${DRAFT_PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    DRAFT_URL
  ], {
    detached: true,
    stdio: 'ignore'
  }).unref();
  await waitForDraftBrowser(15000);
}

async function openDraftTab() {
  await ensureDraftBrowser();
  const encodedUrl = encodeURIComponent(DRAFT_URL);
  try {
    return await fetchJson(`http://127.0.0.1:${DRAFT_DEBUG_PORT}/json/new?${encodedUrl}`, { method: 'PUT' });
  } catch (error) {
    const pages = await fetchJson(`http://127.0.0.1:${DRAFT_DEBUG_PORT}/json/list`);
    const page = pages.find((item) => item.type === 'page' && item.url && item.webSocketDebuggerUrl)
      || pages.find((item) => item.webSocketDebuggerUrl);
    if (!page) throw error;
    return page;
  }
}

class CdpClient {
  constructor(wsUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(wsUrl);
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
      else resolve(message.result || {});
    });
  }

  async ready() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
  }

  async send(method, params = {}) {
    await this.ready();
    const id = this.nextId;
    this.nextId += 1;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`${method} timeout`));
      }, 30000);
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  close() {
    try {
      this.socket.close();
    } catch (error) {}
  }
}

async function evaluate(client, expression, returnByValue = true) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'browser evaluation failed');
  }
  return result.result?.value;
}

async function waitForEvaluate(client, expression, timeoutMs = 30000, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  let lastValue = null;
  while (Date.now() < deadline) {
    lastValue = await evaluate(client, expression).catch(() => null);
    if (lastValue) return lastValue;
    await sleep(intervalMs);
  }
  throw new Error('browser page is not ready');
}

async function focusAndType(client, focusExpression, text) {
  const focused = await evaluate(client, focusExpression);
  if (!focused) throw new Error('input field not found');
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    modifiers: 2,
    windowsVirtualKeyCode: 65,
    code: 'KeyA',
    key: 'a'
  });
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    modifiers: 2,
    windowsVirtualKeyCode: 65,
    code: 'KeyA',
    key: 'a'
  });
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    windowsVirtualKeyCode: 8,
    code: 'Backspace',
    key: 'Backspace'
  });
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    windowsVirtualKeyCode: 8,
    code: 'Backspace',
    key: 'Backspace'
  });
  await client.send('Input.insertText', { text });
}

async function setUploadFiles(client, files) {
  const documentResult = await client.send('DOM.getDocument', { depth: -1, pierce: true });
  let query = await client.send('DOM.querySelector', {
    nodeId: documentResult.root.nodeId,
    selector: 'input[type="file"]'
  });
  if (!query.nodeId) {
    await evaluate(client, `(() => {
      const candidates = [...document.querySelectorAll('button, div, span')];
      const target = candidates.find((item) => /上传图文|上传图片|添加图片|\\+/.test(item.innerText || item.getAttribute('aria-label') || ''));
      if (target) target.click();
      return Boolean(target);
    })()`).catch(() => false);
    await sleep(1000);
    query = await client.send('DOM.querySelector', {
      nodeId: documentResult.root.nodeId,
      selector: 'input[type="file"]'
    });
  }
  if (!query.nodeId) throw new Error('image upload input not found');
  await client.send('DOM.setFileInputFiles', {
    nodeId: query.nodeId,
    files
  });
}

async function prepareXiaohongshuDraft(payload) {
  const files = await materializeImages(payload.images || []);
  if (!files.length) throw new Error('at least one image is required');

  log('draft browser open start', `images=${files.length}`);
  const page = await openDraftTab();
  const client = new CdpClient(page.webSocketDebuggerUrl);
  try {
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Page.bringToFront');
    await client.send('Page.navigate', { url: DRAFT_URL });
    await waitForEvaluate(client, 'document.readyState === "complete"', 30000);
    await sleep(1500);
    const loginState = await evaluate(client, `(() => ({
      url: location.href,
      login: /\\/login/.test(location.pathname) || /短信登录|验证码|登录即同意/.test(document.body.innerText || '')
    }))()`);
    if (loginState?.login) {
      return {
        needsLogin: true,
        url: loginState.url,
        message: '请在打开的小红书创作服务平台窗口登录后，再回 PickPick 重试。'
      };
    }

    await evaluate(client, `(() => {
      const targets = [...document.querySelectorAll('button, div, span')];
      const tab = targets.find((item) => (item.innerText || '').trim() === '上传图文');
      if (tab) tab.click();
      return true;
    })()`).catch(() => true);
    await sleep(1000);
    await setUploadFiles(client, files);
    await sleep(2500);

    const title = String(payload.title || '').trim().slice(0, 20);
    const content = buildDraftContent(payload);
    await focusAndType(client, `(() => {
      const inputs = [...document.querySelectorAll('input')];
      const input = inputs.find((item) => /标题/.test(item.placeholder || '')) || inputs[0];
      if (!input) return false;
      input.focus();
      return true;
    })()`, title);
    await sleep(500);
    await focusAndType(client, `(() => {
      const editors = [...document.querySelectorAll('[contenteditable="true"], textarea')];
      const editor = editors.find((item) => /输入正文|正文|描述/.test(item.getAttribute('placeholder') || item.dataset.placeholder || item.ariaLabel || ''))
        || document.querySelector('.ql-editor')
        || editors[0];
      if (!editor) return false;
      editor.focus();
      return true;
    })()`, content);

    await evaluate(client, 'window.scrollTo({ top: 0, behavior: "smooth" })').catch(() => null);
    log('draft browser filled', `images=${files.length}`);
    return {
      draft: true,
      imageCount: files.length,
      url: await evaluate(client, 'location.href').catch(() => DRAFT_URL)
    };
  } finally {
    client.close();
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, {
      code: 0,
      msg: 'ok',
      data: {
        service: 'pickpick-xiaohongshu-draft-proxy',
        mode: 'manual-draft',
        browser: EDGE_PATH,
        profileDir: DRAFT_PROFILE_DIR,
        imageDir: DRAFT_IMAGE_DIR,
        maxImages: MAX_IMAGES
      }
    });
    return;
  }

  if (req.method !== 'POST' || !['/prepare-xiaohongshu', '/publish-xiaohongshu'].includes(url.pathname)) {
    sendJson(res, 404, { code: 404, msg: 'not found' });
    return;
  }

  try {
    const payload = await readJson(req);
    if (!payload.title || !payload.content || !Array.isArray(payload.images) || !payload.images.length) {
      sendJson(res, 400, { code: 1001, msg: 'title, content and at least one image are required' });
      return;
    }
    const result = await prepareXiaohongshuDraft(payload);
    sendJson(res, 200, { code: 0, msg: 'ok', data: result });
  } catch (error) {
    log('draft request failed', error?.message || 'draft failed');
    sendJson(res, 500, { code: 1000, msg: error?.message || 'draft failed' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  log(`PickPick Xiaohongshu draft proxy listening on http://127.0.0.1:${PORT}`);
  log(`Draft browser profile: ${DRAFT_PROFILE_DIR}`);
});
