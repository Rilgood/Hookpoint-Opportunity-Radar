import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeApify, normalizeApifyCollection } from '../src/connectors/normalizers.js';

test('normalizes a Google Maps record into the canonical observation contract', () => {
  const result = normalizeApify('apify_google_maps', { title: 'Studio One', placeId: 'abc', website: 'https://studio.example/', totalScore: 4.7, reviewsCount: 120, city: 'New York' });
  assert.equal(result.source, 'google_maps');
  assert.equal(result.company.domain, 'studio.example');
  assert.equal(result.type, 'review_metric');
  assert.equal(result.attributes.rating, 4.7);
});

test('normalizes an ad-library result without storing credentials', () => {
  const result = normalizeApify('apify_facebook_ads', { adArchiveID: 'ad1', pageName: 'Example', adCreativeBodies: ['A better opening.'], startDate: '2026-08-01' }, { company: { domain: 'example.com' }, active_ads: 12 });
  assert.equal(result.company.name, 'Example');
  assert.equal(result.attributes.active_ads, 12);
  assert.equal(result.body, 'A better opening.');
});

test('aggregates an ad-library collection into an account-level metric snapshot', () => {
  const result = normalizeApifyCollection('apify_facebook_ads', [
    { adArchiveID: 'ad1', pageName: 'Example', adCreativeBodies: ['Repeated opening'], startDate: new Date().toISOString() },
    { adArchiveID: 'ad2', pageName: 'Example', adCreativeBodies: ['Repeated opening'], startDate: new Date().toISOString() }
  ], { company: { name: 'Example', domain: 'example.com' }, snapshot_id: '2026-09-03' });
  assert.equal(result.external_id, 'account-snapshot:example.com:2026-09-03');
  assert.equal(result.attributes.active_ads, 2);
  assert.equal(result.attributes.new_ads_7d, 2);
  assert.equal(result.attributes.duplicate_creative_ratio, 0.5);
  assert.equal(result.attributes.metric_scope, 'account_snapshot');
});
