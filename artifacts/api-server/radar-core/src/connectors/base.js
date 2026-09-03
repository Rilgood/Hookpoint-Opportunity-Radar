import { AppError, redactText } from '../lib.js';
import { config } from '../config.js';

export class BaseConnector {
  constructor(manifest) { this.manifest = manifest; }
  validateConfiguration() { return true; }
  async collect() { throw new AppError(501, 'connector_not_implemented', `${this.manifest.label} requires a source-specific collection adapter.`); }
  normalize() { throw new AppError(501, 'normalizer_not_implemented', `${this.manifest.label} requires a record normalizer.`); }
  normalizeCollection() { return null; }
  shouldNormalizeItems() { return true; }
  async run(input = {}) {
    this.validateConfiguration();
    const raw = await this.collect(input);
    if (!Array.isArray(raw) && !Array.isArray(raw?.items)) {
      throw new AppError(502, 'invalid_provider_payload', `${this.manifest.label} did not return an item array.`);
    }
    const items = Array.isArray(raw) ? raw : raw.items;
    if (!Array.isArray(items)) throw new AppError(502, 'invalid_provider_payload', `${this.manifest.label} did not return an item array.`);
    if (items.length > config.connectorMaxRecords) throw new AppError(502, 'connector_record_limit', `${this.manifest.label} returned more than ${config.connectorMaxRecords} records in one run.`);
    const records = [];
    const normalizationErrors = [];
    try {
      const collection = this.normalizeCollection(items, input);
      records.push(...(Array.isArray(collection) ? collection.filter(Boolean) : collection ? [collection] : []));
    } catch (error) {
      normalizationErrors.push({ index: -1, code: 'collection_normalization_error', message: redactText(error.message || 'Collection normalization failed', 500) });
    }
    if (this.shouldNormalizeItems(input)) items.forEach((item, index) => {
      try {
        const normalized = this.normalize(item, input);
        records.push(...(Array.isArray(normalized) ? normalized.filter(Boolean) : normalized ? [normalized] : []));
      } catch (error) {
        normalizationErrors.push({ index, code: 'normalization_error', message: redactText(error.message || 'Record normalization failed', 500) });
      }
    });
    if (records.length > config.connectorMaxRecords) throw new AppError(502, 'connector_record_limit', `${this.manifest.label} normalized more than ${config.connectorMaxRecords} records in one run.`);
    return { records, normalizationErrors, cursor: Array.isArray(raw) ? null : raw.cursor || null, usage: Array.isArray(raw) ? null : raw.usage || null };
  }
  requireEnv(name) {
    const value = process.env[name];
    if (!value) throw new AppError(409, 'connector_not_configured', `${name} is required for ${this.manifest.label}.`);
    return value;
  }
}
