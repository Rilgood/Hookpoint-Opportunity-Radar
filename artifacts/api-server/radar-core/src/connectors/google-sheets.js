import { ReplitConnectors } from '@replit/connectors-sdk';
import { BaseConnector } from './base.js';
import { observationTypeSet } from '../observation-contract.js';
import { AppError, normalizeDomain, safeHttpUrl, sha256 } from '../lib.js';
import { config } from '../config.js';

const MAX_RESPONSE_BYTES = 5_000_000;
const MAX_COLUMNS = 100;
const MAX_CELLS = 100_000;
const MAX_EXTRA_ATTRIBUTES = 25;
const MAX_BINDING_TENANTS = 1_000;
const MAX_IDS_PER_TENANT = 100;
const MAX_BOUND_IDS = 10_000;
const ID_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;
const BINDING_KEY_PATTERN = /^[a-f0-9]{24}$/;
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const SECRET_KEY_PATTERN = /token|secret|password|authorization|credential|cookie|session|api[_ -]?key/i;

const COLUMN_ALIASES = new Map(Object.entries({
  company_name: ['company_name', 'company', 'company name', 'business_name', 'business name', 'organization', 'organisation'],
  company_domain: ['company_domain', 'company domain', 'domain', 'website_domain', 'website domain'],
  type: ['type', 'observation_type', 'observation type', 'event_type', 'event type'],
  title: ['title', 'headline', 'subject'],
  body: ['body', 'description', 'details', 'summary'],
  url: ['url', 'source_url', 'source url', 'link'],
  external_id: ['external_id', 'external id', 'source_id', 'source id'],
  observed_at: ['observed_at', 'observed at', 'event_date', 'event date', 'date', 'timestamp'],
  confidence: ['confidence', 'confidence_score', 'confidence score'],
  amount: ['amount', 'value', 'deal_amount', 'deal amount'],
  industry: ['industry', 'sector'],
  city: ['city'],
  state: ['state', 'province', 'region'],
  country: ['country', 'country_code', 'country code']
}).flatMap(([canonical, aliases]) => aliases.map((alias) => [normalizeHeader(alias), canonical])));

const CANONICAL_COLUMNS = new Set(COLUMN_ALIASES.values());

export class GoogleSheetsConnector extends BaseConnector {
  constructor(manifest, transport = new ReplitConnectors()) {
    super(manifest);
    this.transport = transport;
  }

  async collect(input = {}) {
    const spreadsheetId = resolveSpreadsheetId(input);
    assertTenantSheetBinding(input.trustedTenantId, spreadsheetId);
    const range = parseRange(input.range);
    const canonicalUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
    const path = `/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range.a1)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
    let response;
    try {
      response = await this.transport.proxy('google-sheet', path, { method: 'GET' });
    } catch {
      throw new AppError(502, 'google_sheets_request_failed', 'Google Sheets request failed.');
    }
    if (!response || typeof response.ok !== 'boolean' || typeof response.text !== 'function') {
      throw new AppError(502, 'google_sheets_invalid_response', 'Google Sheets returned an invalid response.');
    }
    if (!response.ok) {
      throw new AppError(502, 'google_sheets_request_failed', `Google Sheets request failed with status ${safeStatus(response.status)}.`);
    }
    let text;
    try {
      text = await readBoundedText(response);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(502, 'google_sheets_invalid_response', 'Google Sheets response could not be read.');
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new AppError(502, 'google_sheets_invalid_response', 'Google Sheets returned invalid JSON.');
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || (payload.values !== undefined && !Array.isArray(payload.values))) {
      throw new AppError(502, 'google_sheets_invalid_response', 'Google Sheets returned an invalid values payload.');
    }
    const providerValues = payload.values || [];
    if (providerValues.length > range.rows || providerValues.length > config.connectorMaxRecords + 1) {
      throw new AppError(502, 'google_sheets_row_limit', 'Google Sheets returned more rows than allowed.');
    }
    if (providerValues.some((row) => !Array.isArray(row) || row.length > range.columns)) {
      throw new AppError(502, 'google_sheets_invalid_response', 'Google Sheets returned values outside the requested range.');
    }
    if (providerValues.length === 0) return [];

    const headers = parseHeaders(providerValues[0], range.columns);
    return providerValues.slice(1).map((row, index) => ({
      row,
      headers,
      rowNumber: range.startRow + index + 1,
      spreadsheetId,
      spreadsheetUrl: canonicalUrl,
      sheetScope: range.sheetScope
    }));
  }

  normalize(item, input = {}) {
    const values = mapRow(item.headers, item.row);
    const type = cleanString(values.type, 'type', 80).toLowerCase().replace(/[\s-]+/g, '_');
    if (!observationTypeSet.has(type)) throw new Error('Row must contain a supported observation type.');
    const title = cleanString(values.title, 'title', 500);
    if (!title) throw new Error('Row must contain a nonempty title.');

    const fallback = input.company && typeof input.company === 'object' ? input.company : {};
    const companyName = cleanOptional(values.company_name ?? fallback.name, 'company_name', 300);
    const domainInput = cleanOptional(values.company_domain ?? fallback.domain, 'company_domain', 500);
    const companyDomain = domainInput ? normalizeDomain(domainInput) : '';
    if (domainInput && !companyDomain) throw new Error('Row contains an invalid company domain.');
    if (!companyName && !companyDomain) throw new Error('Row must contain a company name or domain.');

    const observed = parseTimestamp(values.observed_at);
    const retrieved = new Date().toISOString();
    const rawRef = `google_sheets:${item.spreadsheetId}:sheet:${item.sheetScope}:row:${item.rowNumber}`;
    const suppliedExternalId = cleanOptional(values.external_id, 'external_id', 500);
    const rowUrl = values.url == null || values.url === '' ? null : safeHttpUrl(cleanString(values.url, 'url', 2_000));
    const confidence = parseConfidence(values.confidence);
    const attributes = extraAttributes(item.headers, item.row);
    const amount = parseAmount(values.amount);
    if (amount != null) attributes.amount = amount;

    return {
      source: 'google_sheets',
      external_id: suppliedExternalId || `sheet-row:${sha256(rawRef).slice(0, 32)}`,
      type,
      title,
      body: cleanOptional(values.body, 'body', 20_000),
      url: rowUrl || item.spreadsheetUrl,
      observed_at: observed || retrieved,
      retrieved_at: retrieved,
      event_time_quality: observed ? 'reported' : 'retrieval_time',
      normalizer_version: 'google_sheets-v1',
      confidence,
      company: {
        name: companyName || undefined,
        domain: companyDomain || undefined,
        industry: cleanOptional(values.industry, 'industry', 200),
        city: cleanOptional(values.city, 'city', 200),
        state: cleanOptional(values.state, 'state', 200),
        country: cleanOptional(values.country, 'country', 200)
      },
      raw_ref: rawRef,
      attributes
    };
  }
}

export function googleSheetsTenantBindingKey(tenantId) {
  if (typeof tenantId !== 'string' || !tenantId.trim() || tenantId.length > 500 || CONTROL_PATTERN.test(tenantId)) {
    throw new AppError(403, 'google_sheets_tenant_required', 'A trusted tenant context is required for Google Sheets.');
  }
  return sha256(tenantId).slice(0, 24);
}

export function hasGoogleSheetsTenantBinding(tenantId) {
  try {
    const bindings = parseTenantBindings(process.env.GOOGLE_SHEETS_TENANT_BINDINGS);
    const bindingKey = googleSheetsTenantBindingKey(tenantId);
    return Array.isArray(bindings[bindingKey]) && bindings[bindingKey].length > 0;
  } catch {
    return false;
  }
}

function assertTenantSheetBinding(trustedTenantId, spreadsheetId) {
  const bindings = parseTenantBindings(process.env.GOOGLE_SHEETS_TENANT_BINDINGS);
  const bindingKey = googleSheetsTenantBindingKey(trustedTenantId);
  const allowed = bindings[bindingKey];
  if (!allowed || !allowed.includes(spreadsheetId)) {
    throw new AppError(403, 'google_sheets_sheet_forbidden', 'This Google Sheet is not authorized for the current workspace.');
  }
}

function parseTenantBindings(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new AppError(409, 'google_sheets_bindings_required', 'GOOGLE_SHEETS_TENANT_BINDINGS must be configured by an administrator.');
  }
  if (Buffer.byteLength(raw, 'utf8') > 1_000_000) {
    throw new AppError(409, 'google_sheets_bindings_invalid', 'GOOGLE_SHEETS_TENANT_BINDINGS exceeds the configuration size limit.');
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new AppError(409, 'google_sheets_bindings_invalid', 'GOOGLE_SHEETS_TENANT_BINDINGS is invalid.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new AppError(409, 'google_sheets_bindings_invalid', 'GOOGLE_SHEETS_TENANT_BINDINGS must be a JSON object.');
  }
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > MAX_BINDING_TENANTS) {
    throw new AppError(409, 'google_sheets_bindings_invalid', 'GOOGLE_SHEETS_TENANT_BINDINGS has an invalid number of workspace bindings.');
  }
  let totalIds = 0;
  for (const [key, ids] of entries) {
    if (!BINDING_KEY_PATTERN.test(key) || !Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS_PER_TENANT) {
      throw new AppError(409, 'google_sheets_bindings_invalid', 'GOOGLE_SHEETS_TENANT_BINDINGS contains an invalid workspace binding.');
    }
    if (new Set(ids).size !== ids.length || ids.some((id) => typeof id !== 'string' || !ID_PATTERN.test(id))) {
      throw new AppError(409, 'google_sheets_bindings_invalid', 'GOOGLE_SHEETS_TENANT_BINDINGS contains invalid or duplicate spreadsheet IDs.');
    }
    totalIds += ids.length;
    if (totalIds > MAX_BOUND_IDS) {
      throw new AppError(409, 'google_sheets_bindings_invalid', 'GOOGLE_SHEETS_TENANT_BINDINGS contains too many spreadsheet IDs.');
    }
  }
  return value;
}

function resolveSpreadsheetId(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(400, 'invalid_google_sheets_input', 'Google Sheets input must be an object.');
  }
  let fromUrl = null;
  if (input.spreadsheet_url != null) {
    if (typeof input.spreadsheet_url !== 'string' || CONTROL_PATTERN.test(input.spreadsheet_url)) {
      throw new AppError(400, 'invalid_spreadsheet_url', 'spreadsheet_url must be a valid Google Sheets URL.');
    }
    try {
      const parsed = new URL(input.spreadsheet_url);
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'docs.google.com' || parsed.username || parsed.password || parsed.port) throw new Error();
      const match = /^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/.*)?$/.exec(parsed.pathname);
      if (!match || !ID_PATTERN.test(match[1])) throw new Error();
      fromUrl = match[1];
    } catch {
      throw new AppError(400, 'invalid_spreadsheet_url', 'spreadsheet_url must use https://docs.google.com/spreadsheets/d/<id>.');
    }
  }
  let direct = null;
  if (input.spreadsheet_id != null) {
    if (typeof input.spreadsheet_id !== 'string' || !ID_PATTERN.test(input.spreadsheet_id)) {
      throw new AppError(400, 'invalid_spreadsheet_id', 'spreadsheet_id is invalid.');
    }
    direct = input.spreadsheet_id;
  }
  if (!fromUrl && !direct) throw new AppError(400, 'spreadsheet_required', 'spreadsheet_url or spreadsheet_id is required.');
  if (fromUrl && direct && fromUrl !== direct) throw new AppError(400, 'spreadsheet_mismatch', 'spreadsheet_url and spreadsheet_id must identify the same spreadsheet.');
  return fromUrl || direct;
}

function parseRange(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 300 || CONTROL_PATTERN.test(value) || value.trim().startsWith('=')) {
    throw new AppError(400, 'invalid_sheet_range', 'range must be a finite A1 range.');
  }
  const raw = value.trim();
  const match = /^(?:(?:'((?:[^']|'')+)'|([A-Za-z0-9_ -]{1,100}))!)?\$?([A-Za-z]{1,3})\$?([1-9]\d{0,6}):\$?([A-Za-z]{1,3})\$?([1-9]\d{0,6})$/.exec(raw);
  if (!match) throw new AppError(400, 'invalid_sheet_range', 'range must include finite starting and ending cells.');
  const sheet = match[1] ?? match[2];
  if (sheet != null && (!sheet.trim() || CONTROL_PATTERN.test(sheet) || /^[=+@]/.test(sheet.trim()))) {
    throw new AppError(400, 'invalid_sheet_range', 'range contains an invalid sheet name.');
  }
  const startColumn = columnNumber(match[3]);
  const endColumn = columnNumber(match[5]);
  const startRow = Number(match[4]);
  const endRow = Number(match[6]);
  const columns = endColumn - startColumn + 1;
  const rows = endRow - startRow + 1;
  if (columns < 1 || rows < 1 || columns > MAX_COLUMNS || rows > config.connectorMaxRecords + 1 || columns * rows > MAX_CELLS) {
    throw new AppError(400, 'sheet_range_too_large', 'range is reversed or exceeds the allowed row, column, or cell limit.');
  }
  const sheetScope = sha256(sheet || 'default-sheet').slice(0, 16);
  return { a1: raw, startRow, rows, columns, sheetScope };
}

function columnNumber(value) {
  return [...value.toUpperCase()].reduce((total, character) => total * 26 + character.charCodeAt(0) - 64, 0);
}

function parseHeaders(row, requestedColumns) {
  if (!Array.isArray(row) || row.length === 0 || row.length > requestedColumns) {
    throw new AppError(502, 'google_sheets_invalid_headers', 'Google Sheets must return a header row within the requested range.');
  }
  const seen = new Set();
  return row.map((value) => {
    const original = cleanString(value, 'header', 100);
    const key = normalizeHeader(original);
    if (!key || seen.has(key)) throw new AppError(422, 'google_sheets_invalid_headers', 'Google Sheets headers must be nonempty and unique.');
    seen.add(key);
    return { key, canonical: COLUMN_ALIASES.get(key) || null, original };
  });
}

function normalizeHeader(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function mapRow(headers, row) {
  const result = {};
  headers.forEach((header, index) => {
    if (header.canonical && result[header.canonical] === undefined) result[header.canonical] = row[index];
  });
  return result;
}

function cleanString(value, field, maximum) {
  if (value == null) return '';
  if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error(`${field} must be a scalar value.`);
  const text = String(value).trim();
  if (CONTROL_PATTERN.test(text) || text.startsWith('=')) throw new Error(`${field} contains a formula or control character.`);
  if (text.length > maximum) throw new Error(`${field} exceeds its maximum length.`);
  return text;
}

function cleanOptional(value, field, maximum) {
  const result = cleanString(value, field, maximum);
  return result || undefined;
}

function parseTimestamp(value) {
  if (value == null || value === '') return null;
  const text = cleanString(value, 'observed_at', 100);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error('observed_at must be a valid timestamp.');
  return date.toISOString();
}

function parseConfidence(value) {
  if (value == null || value === '') return 0.8;
  const number = Number(cleanString(value, 'confidence', 30));
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error('confidence must be between 0 and 1.');
  return number;
}

function parseAmount(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('amount must be finite.');
    return value;
  }
  const text = cleanString(value, 'amount', 100);
  const match = /^\s*([+-])?\s*(?:[$€£¥]\s*)?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d+))?\s*([kmb])?\s*(?:usd|eur|gbp|jpy)?\s*$/i.exec(text);
  if (!match) throw new Error('amount must be a numeric or currency value.');
  const multiplier = { k: 1_000, m: 1_000_000, b: 1_000_000_000 }[match[4]?.toLowerCase()] || 1;
  const number = Number(`${match[1] || ''}${match[2].replaceAll(',', '')}${match[3] ? `.${match[3]}` : ''}`) * multiplier;
  if (!Number.isFinite(number)) throw new Error('amount must be finite.');
  return number;
}

function extraAttributes(headers, row) {
  const attributes = {};
  for (let index = 0; index < headers.length && Object.keys(attributes).length < MAX_EXTRA_ATTRIBUTES; index += 1) {
    const header = headers[index];
    if (header.canonical || CANONICAL_COLUMNS.has(header.key) || SECRET_KEY_PATTERN.test(header.original)) continue;
    const value = row[index];
    if (value == null || value === '' || !['string', 'number', 'boolean'].includes(typeof value)) continue;
    const key = header.key.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
    if (!key || SECRET_KEY_PATTERN.test(key)) continue;
    if (typeof value === 'number') {
      if (Number.isFinite(value)) attributes[key] = value;
    } else if (typeof value === 'boolean') {
      attributes[key] = value;
    } else {
      attributes[key] = cleanString(value, key, 2_000);
    }
  }
  return attributes;
}

async function readBoundedText(response) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new AppError(502, 'google_sheets_response_too_large', 'Google Sheets response exceeded the size limit.');
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new AppError(502, 'google_sheets_response_too_large', 'Google Sheets response exceeded the size limit.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

function safeStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : 502;
}