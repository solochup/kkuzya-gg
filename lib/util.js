// Общие мелкие функции. Без Node-специфичных импортов: код можно переносить в Cloudflare Functions.

export const STEAM_BASE = 76561197960265728n;

/** SteamID64 или Account ID -> Account ID (число). */
export function toAccountId(input) {
  const s = String(input).trim();
  if (!/^\d+$/.test(s)) throw new Error('ID должен состоять только из цифр');
  const n = BigInt(s);
  return Number(n >= STEAM_BASE ? n - STEAM_BASE : n);
}

export const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function median(arr) {
  const a = arr.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const h = a.length >> 1;
  return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
}

export function mean(arr) {
  const a = arr.filter(Number.isFinite);
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
}

/**
 * Процентиль значения внутри группы (0..100), метод «средний ранг»:
 * (сколько меньше + половина равных) / размер группы. Включает само значение.
 * Возвращает null, если сравнивать не с кем.
 */
export function pctRank(value, values) {
  const v = values.filter(Number.isFinite);
  if (!Number.isFinite(value) || v.length < 2) return null;
  let lt = 0, eq = 0;
  for (const x of v) {
    if (x < value) lt++;
    else if (x === value) eq++;
  }
  return (100 * (lt + 0.5 * eq)) / v.length;
}

export const round = (x, d = 1) =>
  x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Время (секунды Unix, миллисекунды или ISO-строка) -> секунды Unix или null. */
export function toUnixSeconds(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 1e12 ? Math.round(v / 1000) : v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? Math.round(t / 1000) : null;
  }
  return null;
}
