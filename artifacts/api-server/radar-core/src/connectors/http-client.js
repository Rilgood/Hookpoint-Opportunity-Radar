import { config } from '../config.js';
import { AppError, redactText } from '../lib.js';

export async function requestJson(url, options = {}) {
  const retries = Math.max(0, Number(options.retries ?? (options.method && options.method !== 'GET' ? 0 : 2)));
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs || config.connectorTimeoutMs));
  const { retries: ignoredRetries, timeoutMs: ignoredTimeout, ...fetchOptions } = options;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { ...fetchOptions, signal: AbortSignal.timeout(timeoutMs) });
      const raw = await readLimitedBody(response, 25_000_000);
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < retries) {
          await pause(retryDelay(response, attempt));
          continue;
        }
        const status = response.status === 429 || response.status >= 500 ? 502 : 422;
        throw new AppError(status, 'provider_request_failed', `Provider returned HTTP ${response.status}${safeProviderMessage(raw)}.`);
      }
      try { return raw ? JSON.parse(raw) : {}; }
      catch { throw new AppError(502, 'provider_invalid_json', 'Provider returned invalid JSON.'); }
    } catch (error) {
      lastError = error;
      const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      const retryableNetworkError = !(error instanceof AppError);
      if ((!timeout && !retryableNetworkError) || attempt >= retries) {
        if (timeout) throw new AppError(504, 'provider_timeout', `Provider request exceeded ${timeoutMs} ms.`);
        if (retryableNetworkError) throw new AppError(502, 'provider_network_error', 'Provider request failed at the network layer.');
        throw error;
      }
      await pause(Math.min(4_000, 250 * 2 ** attempt));
    }
  }
  throw lastError;
}

async function readLimitedBody(response, maximumBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) throw new AppError(502, 'provider_response_too_large', 'Provider response exceeded 25 MB.');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => {});
      throw new AppError(502, 'provider_response_too_large', 'Provider response exceeded 25 MB.');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

function retryDelay(response, attempt) {
  const retryAfter = Number(response.headers.get('retry-after'));
  return Number.isFinite(retryAfter) ? Math.min(10_000, retryAfter * 1_000) : Math.min(4_000, 250 * 2 ** attempt);
}

function safeProviderMessage(raw) {
  const text = redactText(String(raw || '').replace(/[\r\n]+/g, ' '), 300).trim();
  return text ? `: ${text}` : '';
}

function pause(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
