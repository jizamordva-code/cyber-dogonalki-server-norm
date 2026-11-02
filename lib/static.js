'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ───────────────────── раздача веб-версии игры (папка public/) ─────────────────────
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm', '.pck': 'application/octet-stream', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.wasm', '.pck', '.json', '.css', '.svg', '.txt']);
const bufCache = new Map(); // "file|etag|enc" -> Promise<Buffer>

function encodeBuf(raw, enc) {
  return new Promise((resolve, reject) => {
    const cb = (e, out) => (e ? reject(e) : resolve(out));
    if (enc === 'br') {
      zlib.brotliCompress(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }, cb);
    } else zlib.gzip(raw, { level: 6 }, cb);
  });
}
function getBuf(file, etag, enc) {
  const key = `${file}|${etag}|${enc}`;
  if (!bufCache.has(key)) {
    const p = enc === 'raw'
      ? fs.promises.readFile(file)
      : getBuf(file, etag, 'raw').then((raw) => encodeBuf(raw, enc));
    bufCache.set(key, p);
    p.catch(() => bufCache.delete(key));
  }
  return bufCache.get(key);
}

async function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (_) { return false; }
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return false;
  let st;
  try { st = await fs.promises.stat(file); } catch (_) { return false; }
  if (!st.isFile()) return false;

  const ext = path.extname(file).toLowerCase();
  const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    ETag: etag,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Accept-Encoding',
  };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return true; }

  const ae = String(req.headers['accept-encoding'] || '');
  let enc = 'raw';
  if (COMPRESSIBLE.has(ext)) enc = /\bbr\b/.test(ae) ? 'br' : (/\bgzip\b/.test(ae) ? 'gzip' : 'raw');
  const body = await getBuf(file, etag, enc);
  if (enc !== 'raw') headers['Content-Encoding'] = enc;
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}

// Прогрев кэша сжатия, чтобы первый игрок не ждал
async function warmCache() {
  try {
    for (const name of await fs.promises.readdir(PUBLIC_DIR)) {
      const file = path.join(PUBLIC_DIR, name);
      const ext = path.extname(name).toLowerCase();
      const st = await fs.promises.stat(file);
      if (!st.isFile() || !COMPRESSIBLE.has(ext)) continue;
      const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
      await getBuf(file, etag, 'br');
    }
    console.log('static cache warmed');
  } catch (_) { /* папки public может не быть */ }
}


module.exports = { serveStatic, warmCache };
