// Форматирование чисел, времени и долей через Intl с учётом языка. Нет данных -> «—», а не 0.
export type Lang = 'ru' | 'en';
export const LOCALES: Record<Lang, string> = { ru: 'ru-RU', en: 'en-US' };

const DASH = '—';
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Набор форматтеров для одного языка. Слова единиц берутся из словаря (units). */
export function createFormat(lang: Lang, units: { min: string; justNow: string; never: string; hour: string }) {
  const loc = LOCALES[lang];
  const cache = new Map<number, Intl.NumberFormat>();
  const nf = (d: number) => {
    let f = cache.get(d);
    if (!f) { f = new Intl.NumberFormat(loc, { minimumFractionDigits: d, maximumFractionDigits: d }); cache.set(d, f); }
    return f;
  };
  const compactNf = new Intl.NumberFormat(loc, { notation: 'compact', maximumFractionDigits: 1 });
  const DATE = new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short' });
  const DATE_TIME = new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const TIME = new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit' });
  const rel = new Intl.RelativeTimeFormat(loc, { numeric: 'always', style: 'short' });

  const num = (v: number | null | undefined, digits = 0) => (isNum(v) ? nf(digits).format(v) : DASH);
  return {
    lang,
    num,
    /** 0.534 -> «53%» / «53%». */
    pct: (share: number | null | undefined, digits = 0) => (isNum(share) ? `${num(share * 100, digits)}%` : DASH),
    /** 41200 -> «41,2 тыс.» / «41.2K». */
    compact: (v: number | null | undefined) => (isNum(v) ? compactNf.format(v) : DASH),
    /** Секунды -> «35:14» или «1:02:03» (одинаково для всех языков). */
    clock: (seconds: number | null | undefined) => {
      if (!isNum(seconds) || seconds < 0) return DASH;
      const s = Math.round(seconds);
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
      return `${h ? h + ':' : ''}${h ? String(m).padStart(2, '0') : String(m)}:${String(r).padStart(2, '0')}`;
    },
    /** Секунды -> «36 мин» / «36 min»; «1 ч 5 мин» / «1 h 5 min». */
    duration: (seconds: number | null | undefined) => {
      if (!isNum(seconds)) return DASH;
      const m = Math.round(seconds / 60);
      return m < 60 ? `${m} ${units.min}` : `${Math.floor(m / 60)} ${units.hour} ${m % 60} ${units.min}`;
    },
    /** Unix-секунды -> «20 нояб.» / «Nov 20». */
    date: (unixS: number | null | undefined) => (isNum(unixS) ? DATE.format(unixS * 1000).replace(/\.$/, '') : DASH),
    dateTime: (unixS: number | null | undefined) => (isNum(unixS) ? DATE_TIME.format(unixS * 1000) : DASH),
    timeMs: (ms: number | null | undefined) => (isNum(ms) ? TIME.format(ms) : DASH),
    /** Возраст: «только что», «5 мин. назад» / «just now», «5 min. ago». */
    age: (fromMs: number | null | undefined, nowMs: number) => {
      if (!isNum(fromMs)) return units.never;
      const s = Math.max(0, Math.round((nowMs - fromMs) / 1000));
      if (s < 45) return units.justNow;
      const m = Math.round(s / 60);
      if (m < 60) return rel.format(-m, 'minute');
      const h = Math.round(m / 60);
      if (h < 48) return rel.format(-h, 'hour');
      return rel.format(-Math.round(h / 24), 'day');
    },
  };
}
export type Formatter = ReturnType<typeof createFormat>;
