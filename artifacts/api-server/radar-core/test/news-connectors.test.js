import test from 'node:test';
import assert from 'node:assert/strict';
import { GdeltConnector, NewsApiConnector } from '../src/connectors/news.js';

test('NewsAPI resumes with an overlap and advances its published-time cursor', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.NEWS_API_KEY;
  process.env.NEWS_API_KEY = 'test-news-key';
  let requested;
  globalThis.fetch = async (url) => {
    requested = new URL(url);
    return new Response(JSON.stringify({ totalResults: 2, articles: [
      { url: 'https://news.test/1', title: 'One', publishedAt: '2026-09-03T12:00:00.000Z' },
      { url: 'https://news.test/2', title: 'Two', publishedAt: '2026-09-03T12:05:00.000Z' }
    ] }), { status: 200 });
  };
  try {
    const connector = new NewsApiConnector({ label: 'NewsAPI' });
    connector.validateConfiguration();
    const result = await connector.collect({ company: { domain: 'target.test' }, cursor: { published_at: '2026-09-03T11:00:00.000Z' } });
    assert.equal(requested.searchParams.get('from'), '2026-09-03T10:55:00.000Z');
    assert.equal(result.cursor.published_at, '2026-09-03T12:05:00.000Z');
    assert.equal(result.usage.provider_total_results, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.NEWS_API_KEY;
    else process.env.NEWS_API_KEY = originalKey;
  }
});

test('GDELT resumes with the documented compact UTC start timestamp', async () => {
  const originalFetch = globalThis.fetch;
  let requested;
  globalThis.fetch = async (url) => {
    requested = new URL(url);
    return new Response(JSON.stringify({ articles: [{ url: 'https://news.test/gdelt', title: 'GDELT', seendate: '20260903T120000Z' }] }), { status: 200 });
  };
  try {
    const connector = new GdeltConnector({ label: 'GDELT' });
    const result = await connector.collect({ company: { name: 'Target' }, cursor: { seen_at: '2026-09-03T11:00:00.000Z' } });
    assert.equal(requested.searchParams.get('startdatetime'), '20260903105500');
    assert.equal(result.cursor.seen_at, '2026-09-03T12:00:00.000Z');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
