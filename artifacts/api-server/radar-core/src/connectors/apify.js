import { BaseConnector } from './base.js';
import { AppError } from '../lib.js';
import { normalizeApify, normalizeApifyCollection } from './normalizers.js';
import { requestJson } from './http-client.js';

export class ApifyConnector extends BaseConnector {
  validateConfiguration() {
    this.token = this.requireEnv('APIFY_TOKEN');
    this.actor = this.requireEnv(this.manifest.actorEnv);
    return true;
  }

  validateInput(input = {}) {
    if (this.manifest.key === 'apify_google_search' && !input.company?.name && !input.company?.domain) {
      throw new AppError(400, 'company_required', 'Google Search collection requires a target company identity to prevent result misattribution.');
    }
    return true;
  }

  async collect(input = {}) {
    this.validateInput(input);
    const actor = encodeURIComponent(this.actor.replaceAll('/', '~'));
    const url = `https://api.apify.com/v2/actors/${actor}/run-sync-get-dataset-items?clean=true&format=json`;
    try {
      return await requestJson(url, {
        method: 'POST', retries: 0,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
        body: JSON.stringify(input.actor_input || input)
      });
    } catch (error) {
      if (error instanceof AppError) throw new AppError(error.status, 'apify_run_failed', error.message);
      throw error;
    }
  }

  normalize(item, input) { return normalizeApify(this.manifest.key, item, input); }
  normalizeCollection(items, input) { return normalizeApifyCollection(this.manifest.key, items, input); }
  shouldNormalizeItems() { return this.manifest.key !== 'apify_facebook_ads'; }
}
