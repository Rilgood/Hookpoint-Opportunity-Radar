import { connectorByKey } from '../services/catalog.js';
import { AppError } from '../lib.js';
import { BaseConnector } from './base.js';
import { ApifyConnector } from './apify.js';
import { GdeltConnector, NewsApiConnector } from './news.js';

export function connectorFor(key) {
  const manifest = connectorByKey.get(key);
  if (!manifest) throw new AppError(404, 'connector_not_found', `Unknown connector: ${key}`);
  if (key === 'newsapi') return new NewsApiConnector(manifest);
  if (key === 'gdelt') return new GdeltConnector(manifest);
  if (key.startsWith('apify_')) return new ApifyConnector(manifest);
  return new BaseConnector(manifest);
}

export const implementedConnectorKeys = new Set([
  'generic_webhook','gdelt','newsapi','apify_google_maps','apify_website','apify_google_search',
  'apify_facebook_ads','apify_instagram','apify_tiktok','apify_linkedin_company','apify_linkedin_jobs','apify_google_reviews'
]);
