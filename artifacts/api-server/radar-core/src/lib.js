import crypto from 'node:crypto';

export const nowIso = () => new Date().toISOString();
export const id = (prefix = 'id') => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
export const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, Number(value) || 0));
export const round = (value, digits = 1) => Number(Number(value).toFixed(digits));
export const json = (value, fallback = {}) => {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
};
export const stableJson = (value) => JSON.stringify(sortObject(value));

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortObject(v)]));
  }
  return value;
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function hashSecret(value, salt) {
  return `v2:${hmac(String(value), String(salt))}`;
}

export function hmac(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function normalizeDomain(input = '') {
  if (!input) return '';
  try {
    const value = /^[a-z]+:\/\//i.test(input) ? input : `https://${input}`;
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return '';
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    return validHostname(hostname) ? hostname : '';
  } catch {
    return '';
  }
}

function validHostname(value) {
  if (!value || value.length > 253 || !value.includes('.')) return false;
  return value.split('.').every((label) => label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
}

export function normalizeName(input = '') {
  const suffixes = new Set(['inc','llc','ltd','corp','corporation','company','co']);
  return String(input).toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter((part) => part && !suffixes.has(part)).join(' ');
}

export function slugify(input = '') {
  return normalizeName(input).replaceAll(' ', '-').slice(0, 80) || 'company';
}

export function addDays(iso, days) {
  const date = new Date(iso || Date.now());
  date.setTime(date.getTime() + Number(days) * 86_400_000);
  return date.toISOString();
}

export function daysBetween(newer, older) {
  const delta = new Date(newer).getTime() - new Date(older).getTime();
  return Math.max(0, delta / 86_400_000);
}

export function escapeCsv(value) {
  const original = value == null ? '' : String(value);
  const string = /^[\t\r ]*[=+\-@]/.test(original) ? `'${original}` : original;
  return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

export function pick(object, keys) {
  return Object.fromEntries(keys.filter((key) => object[key] !== undefined).map((key) => [key, object[key]]));
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

export function safeHttpUrl(value, { required = false } = {}) {
  if (value == null || value === '') {
    if (required) throw new AppError(400, 'url_required', 'A URL is required.');
    return null;
  }
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
    if (url.username || url.password) throw new Error('embedded credentials');
    if ([...url.searchParams.keys()].some((key) => /token|secret|password|api[_-]?key|signature|credential|authorization/i.test(key))) throw new Error('credential query parameter');
    return url.toString().slice(0, 2_000);
  } catch {
    throw new AppError(400, 'invalid_url', 'URLs must use http or https and must not embed credentials.');
  }
}

const secretKeyPattern = /(?:^|_)(?:api_?)?key$|token|secret|password|authorization|credential|private|cookie|session[_-]?id/i;
const secretValuePattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+|[?&](?:token|secret|password|api[_-]?key|access[_-]?token)=[^&#\s]+/i;

export function redactSecrets(value, depth = 0) {
  if (depth > 8) return '[MAX_DEPTH]';
  if (Array.isArray(value)) return value.slice(0, 1_000).map((item) => redactSecrets(item, depth + 1));
  if (typeof value === 'string' && secretValuePattern.test(value)) return '[REDACTED]';
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretKeyPattern.test(key) ? '[REDACTED]' : redactSecrets(item, depth + 1)]));
}

export function containsSecretFields(value, depth = 0) {
  if (depth > 8) return true;
  if (value == null) return false;
  if (Array.isArray(value)) return value.some((item) => containsSecretFields(item, depth + 1));
  if (typeof value === 'string') return secretValuePattern.test(value);
  if (!isPlainObject(value)) return false;
  return Object.entries(value).some(([key, item]) => secretKeyPattern.test(key) || containsSecretFields(item, depth + 1));
}

export function assertJsonComplexity(value, { maxDepth = 30, maxNodes = 100_000 } = {}) {
  const stack = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > maxNodes || current.depth > maxDepth) throw new AppError(400, 'json_too_complex', `JSON may contain at most ${maxNodes} values and ${maxDepth} nesting levels.`);
    if (Array.isArray(current.value)) {
      for (const item of current.value) stack.push({ value: item, depth: current.depth + 1 });
    } else if (isPlainObject(current.value)) {
      for (const item of Object.values(current.value)) stack.push({ value: item, depth: current.depth + 1 });
    }
  }
}

export function redactText(value, maximum = 1_000) {
  return String(value ?? '')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    .replace(/((?:token|secret|password|api[_-]?key|authorization|credential)\s*[=:]\s*)[^\s,;}]+/gi, '$1[REDACTED]')
    .replace(/\b(?:hp_live|apify_api)_[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .slice(0, maximum);
}

export class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
