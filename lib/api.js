// Запросы к API: пауза между запросами, таймаут, повтор при 429/5xx, журнал для отчёта.
// Использует только fetch/AbortController: работает и в Node 18+, и в Cloudflare Functions.
import { sleep } from './util.js';

const HEADERS_OF_INTEREST = [
  'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset',
  'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset', 'ratelimit-policy',
  'retry-after', 'cache-control', 'age', 'etag', 'last-modified',
  'access-control-allow-origin', 'content-encoding', 'cf-cache-status',
];

export class ApiClient {
  constructor({
    delayMs = 400, timeoutMs = 30000, retries = 2,
    fetchImpl = globalThis.fetch, origin = 'https://example.pages.dev',
    userAgent = 'deadlock-check/0.1',
  } = {}) {
    Object.assign(this, { delayMs, timeoutMs, retries, fetchImpl, origin, userAgent });
    this.log = [];
    this.lastAt = 0;
  }

  async #pause() {
    const wait = this.delayMs - (Date.now() - this.lastAt);
    if (wait > 0) await sleep(wait);
    this.lastAt = Date.now();
  }

  /** Возвращает { ok, json?, status?, error?, entry } и никогда не бросает исключение. */
  async getJson(url, { label = '', timeoutMs = this.timeoutMs, headers = {} } = {}) {
    let last = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      await this.#pause();
      const t0 = Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const entry = { label, url, attempt, status: null, ms: null, bytes: null, headers: {}, error: null };
      this.log.push(entry);
      try {
        const res = await this.fetchImpl(url, {
          headers: { accept: 'application/json', origin: this.origin, 'user-agent': this.userAgent, ...headers },
          signal: ctrl.signal,
        });
        const text = await res.text();
        entry.status = res.status;
        entry.ms = Date.now() - t0;
        entry.bytes = new TextEncoder().encode(text).length;
        for (const h of HEADERS_OF_INTEREST) {
          const v = res.headers.get(h);
          if (v != null) entry.headers[h] = v;
        }
        if (res.status === 429 || res.status >= 500) {
          last = { ok: false, status: res.status, error: `HTTP ${res.status}`, entry };
          if (attempt < this.retries) {
            const ra = Number(res.headers.get('retry-after'));
            await sleep(Math.min(60, Number.isFinite(ra) && ra > 0 ? ra : 2 ** (attempt + 1)) * 1000);
            continue;
          }
          return last;
        }
        if (res.status === 304) return { ok: true, status: 304, notModified: true, entry };
        if (!res.ok) {
          entry.error = `HTTP ${res.status}`;
          return { ok: false, status: res.status, error: entry.error, snippet: text.slice(0, 200), entry };
        }
        try {
          return { ok: true, status: res.status, json: JSON.parse(text), entry };
        } catch {
          entry.error = 'ответ не JSON';
          return { ok: false, status: res.status, error: entry.error, snippet: text.slice(0, 200), entry };
        }
      } catch (e) {
        entry.ms = Date.now() - t0;
        // У fetch в Node текст ошибки всегда «fetch failed»; настоящая причина лежит в e.cause (ENOTFOUND, ECONNRESET, сертификат...).
        const cause = e && e.cause ? e.cause.code || e.cause.message || String(e.cause) : '';
        entry.error = e && e.name === 'AbortError'
          ? `таймаут ${timeoutMs} мс`
          : `${String((e && e.message) || e)}${cause ? ` (${cause})` : ''}`;
        last = { ok: false, status: null, error: entry.error, entry };
        if (attempt < this.retries) await sleep(1000 * 2 ** attempt);
      } finally {
        clearTimeout(timer);
      }
    }
    return last;
  }
}
