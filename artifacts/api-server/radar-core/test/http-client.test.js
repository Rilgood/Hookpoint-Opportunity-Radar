import test from 'node:test';
import assert from 'node:assert/strict';
import { requestJson } from '../src/connectors/http-client.js';

test('rejects an oversized provider response from headers before buffering it', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 200, headers: { 'content-length': '25000001' } });
  try {
    await assert.rejects(() => requestJson('https://provider.test/data', { retries: 0 }), (error) => error.code === 'provider_response_too_large');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects invalid provider JSON with a stable operational error', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('not-json', { status: 200 });
  try {
    await assert.rejects(() => requestJson('https://provider.test/data', { retries: 0 }), (error) => error.code === 'provider_invalid_json');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
