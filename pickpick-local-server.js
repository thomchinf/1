const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const rootDir = __dirname;
const preferredPort = Number(process.env.PICKPICK_PORT) || 4173;
const maxPort = preferredPort + 40;
const listenHost = process.env.PICKPICK_HOST || '0.0.0.0';
const browserHost = '127.0.0.1';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function openBrowser(url) {
  if (process.env.PICKPICK_NO_OPEN === '1') return;
  const command = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  childProcess.exec(command, () => {});
}

function resolveRequestPath(requestUrl) {
  const parsedUrl = new URL(requestUrl, `http://${browserHost}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(rootDir, relativePath);
  if (!filePath.startsWith(rootDir)) return null;
  return filePath;
}

function sendNotFound(response) {
  response.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end('Not found');
}

function handleRequest(request, response) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { 'Allow': 'GET, HEAD' });
    response.end();
    return;
  }

  const filePath = resolveRequestPath(request.url || '/');
  if (!filePath) {
    sendNotFound(response);
    return;
  }

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      sendNotFound(response);
      return;
    }

    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache'
    });

    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    fs.createReadStream(filePath).pipe(response);
  });
}

function getLanUrls(port) {
  const interfaces = os.networkInterfaces();
  return Object.values(interfaces)
    .flat()
    .filter(Boolean)
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => `http://${entry.address}:${port}/`);
}

function listen(port) {
  const server = http.createServer(handleRequest);
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && port < maxPort) {
      listen(port + 1);
      return;
    }
    console.error('[PickPick] Server failed:', error.message);
    process.exitCode = 1;
  });
  server.listen(port, listenHost, () => {
    const localUrl = `http://${browserHost}:${port}/`;
    const lanUrls = getLanUrls(port);
    console.log(`[PickPick] Local server: ${localUrl}`);
    if (lanUrls.length) {
      console.log('[PickPick] Phone URLs on the same Wi-Fi:');
      lanUrls.forEach((url) => console.log(`  ${url}`));
    } else {
      console.log('[PickPick] No LAN IPv4 address found. Check Wi-Fi connection.');
    }
    console.log('[PickPick] Close this window to stop the local server.');
    openBrowser(localUrl);
  });
}

listen(preferredPort);
