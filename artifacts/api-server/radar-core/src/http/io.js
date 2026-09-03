import fs from 'node:fs';
import path from 'node:path';
import { AppError, assertJsonComplexity } from '../lib.js';
import { config } from '../config.js';

const mime = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon'
};

export function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

export function sendText(res, status, body, contentType = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'content-type': contentType, 'content-length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

export async function readBody(req, maxBytes = config.maxBodyBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new AppError(413, 'payload_too_large', `Request body exceeds ${maxBytes} bytes.`);
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return { raw: '', data: {} };
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  const mediaType = contentType.split(';', 1)[0].trim();
  if (mediaType !== 'application/json' && !/^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(mediaType)) throw new AppError(415, 'unsupported_media_type', 'Use an application/json media type.');
  try {
    const data = JSON.parse(raw);
    assertJsonComplexity(data);
    return { raw, data };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, 'invalid_json', 'Request body must be valid JSON.');
  }
}

export function serveStatic(res, pathname) {
  let requested;
  try { requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\//, ''); }
  catch { return false; }
  const safe = path.normalize(requested).replace(/^(\.\.(\/|\\|$))+/, '');
  const file = path.join(config.publicDir, safe);
  if (!(file === config.publicDir || file.startsWith(`${config.publicDir}${path.sep}`)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'content-length': body.length, 'cache-control': 'no-cache' });
  res.end(body);
  return true;
}
