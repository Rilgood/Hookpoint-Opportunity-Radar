import { BaseConnector } from './base.js';
import { AppError, normalizeDomain } from '../lib.js';
import { requestJson } from './http-client.js';

export class NewsApiConnector extends BaseConnector {
  validateConfiguration() { this.key = this.requireEnv('NEWS_API_KEY'); }
  validateInput(input = {}) {
    if (!input.company?.name && !input.company?.domain) throw new AppError(400, 'company_required', 'NewsAPI requires a target company identity to prevent news misattribution.');
    return { limit: boundedLimit(input.limit, 50, 100), from: cursorStart(input.from) };
  }
  async collect(input = {}) {
    const { limit } = this.validateInput(input);
    const query = input.query || quotedTarget(input.company.name || input.company.domain);
    const url = new URL('https://newsapi.org/v2/everything');
    url.searchParams.set('q', query);
    url.searchParams.set('sortBy', 'publishedAt');
    url.searchParams.set('pageSize', String(limit));
    const from = cursorStart(input.cursor?.published_at || input.from);
    if (from) url.searchParams.set('from', from.toISOString());
    const result = await requestJson(url, { headers: { 'X-Api-Key': this.key }, retries: 2 });
    const items = Array.isArray(result.articles) ? result.articles : [];
    return {
      items,
      cursor: newestCursor(items.map((article) => article.publishedAt), 'published_at', input.cursor),
      usage: { requests: 1, provider_total_results: Number(result.totalResults || items.length) }
    };
  }
  normalize(article, input) {
    const retrieved = new Date().toISOString();
    return { source: 'newsapi', external_id: article.url, type: input.type || 'news', title: article.title, body: article.description || article.content, url: article.url,
      observed_at: article.publishedAt || retrieved, retrieved_at: retrieved, event_time_quality: article.publishedAt ? 'reported' : 'retrieval_time', normalizer_version: 'newsapi-v1',
      confidence: 0.72, company: input.company || { name: input.query, domain: normalizeDomain(input.domain) }, attributes: input.attributes || {} };
  }
}

export class GdeltConnector extends BaseConnector {
  validateInput(input = {}) {
    if (!input.company?.name && !input.company?.domain) throw new AppError(400, 'company_required', 'GDELT requires a target company identity to prevent news misattribution.');
    return { limit: boundedLimit(input.limit, 50, 250), start: cursorStart(input.start_datetime) };
  }
  async collect(input = {}) {
    const { limit } = this.validateInput(input);
    const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
    url.searchParams.set('query', input.query || quotedTarget(input.company.name || input.company.domain));
    url.searchParams.set('mode', 'artlist');
    url.searchParams.set('format', 'json');
    url.searchParams.set('maxrecords', String(limit));
    url.searchParams.set('sort', 'DateDesc');
    const start = cursorStart(input.cursor?.seen_at || input.start_datetime);
    if (start) url.searchParams.set('startdatetime', gdeltTimestamp(start));
    const result = await requestJson(url, { retries: 2 });
    const items = Array.isArray(result.articles) ? result.articles : [];
    return {
      items,
      cursor: newestCursor(items.map((article) => parseGdeltDate(article.seendate)), 'seen_at', input.cursor),
      usage: { requests: 1, provider_results: items.length }
    };
  }
  normalize(article, input) {
    const retrieved = new Date().toISOString();
    const observed = parseGdeltDate(article.seendate);
    return { source: 'gdelt', external_id: article.url, type: input.type || 'news', title: article.title, body: article.seendate ? `Seen ${article.seendate} in ${article.domain}` : null,
      url: article.url, observed_at: observed || retrieved, retrieved_at: retrieved, event_time_quality: observed ? 'provider_estimated' : 'retrieval_time', normalizer_version: 'gdelt-v1',
      confidence: 0.68, company: input.company, attributes: { language: article.language, source_country: article.sourcecountry, ...input.attributes } };
  }
}

function parseGdeltDate(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function quotedTarget(value) { return `"${String(value).replace(/["\\]+/g, ' ').trim()}"`; }

function boundedLimit(value, fallback, maximum) {
  if (value == null || value === '') return fallback;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) throw new AppError(400, 'invalid_connector_limit', `limit must be an integer between 1 and ${maximum}.`);
  return limit;
}

function cursorStart(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new AppError(400, 'invalid_connector_cursor', 'Connector cursor/start time must be a valid date.');
  return new Date(parsed.getTime() - 5 * 60_000);
}

function newestCursor(values, key, previous = null) {
  const valid = values.filter(Boolean).map((value) => new Date(value)).filter((value) => !Number.isNaN(value.getTime()));
  if (!valid.length) return previous || null;
  const newest = new Date(Math.max(...valid.map((value) => value.getTime()))).toISOString();
  return { ...(previous && typeof previous === 'object' ? previous : {}), [key]: newest };
}

function gdeltTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '').replace('T', '');
}
