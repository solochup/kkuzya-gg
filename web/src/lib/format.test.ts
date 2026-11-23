import { describe, expect, it } from 'vitest';
import { createFormat } from './format';

// Intl использует неразрывные пробелы; сравниваем без них.
const n = (s: string) => s.replace(/[  ]/g, ' ');
const ru = createFormat('ru', { min: 'мин', hour: 'ч', justNow: 'только что', never: 'никогда' });
const en = createFormat('en', { min: 'min', hour: 'h', justNow: 'just now', never: 'never' });

describe('format', () => {
  it('нет данных -> тире, а не ноль (оба языка)', () => {
    for (const f of [ru, en]) {
      expect(f.num(null)).toBe('—');
      expect(f.num(Number.NaN)).toBe('—');
      expect(f.pct(undefined)).toBe('—');
      expect(f.clock(null)).toBe('—');
      expect(f.date(null)).toBe('—');
    }
  });
  it('числа и доли по правилам языка', () => {
    expect(n(ru.num(1245.68))).toBe('1 246');
    expect(en.num(1245.68)).toBe('1,246');
    expect(ru.num(2.8539, 2)).toBe('2,85');
    expect(en.num(2.8539, 2)).toBe('2.85');
    expect(ru.pct(0.6032, 1)).toBe('60,3%');
    expect(en.pct(0.6032, 1)).toBe('60.3%');
    expect(n(ru.compact(61400))).toBe('61,4 тыс.');
    expect(en.compact(61400)).toBe('61.4K');
  });
  it('время матча и длительность', () => {
    expect(ru.clock(2114)).toBe('35:14');
    expect(en.clock(3723)).toBe('1:02:03');
    expect(ru.duration(2154)).toBe('36 мин');
    expect(en.duration(2154)).toBe('36 min');
    expect(ru.duration(3900)).toBe('1 ч 5 мин');
    expect(en.duration(3900)).toBe('1 h 5 min');
  });
  it('даты через Intl', () => {
    const ts = Date.UTC(2026, 10, 20, 12, 0) / 1000;
    expect(n(ru.date(ts))).toMatch(/^20 нояб/);
    expect(en.date(ts)).toBe('Nov 20');
  });
  it('возраст данных через Intl.RelativeTimeFormat', () => {
    const now = 1_000_000_000;
    expect(ru.age(now - 10_000, now)).toBe('только что');
    expect(en.age(now - 10_000, now)).toBe('just now');
    expect(n(ru.age(now - 5 * 60_000, now))).toMatch(/^5 мин\.? назад$/);
    expect(en.age(now - 5 * 60_000, now)).toMatch(/^5 min\.? ago$/);
    expect(en.age(now - 3 * 3600_000, now)).toMatch(/^3 hr\.? ago$/);
    expect(ru.age(null, now)).toBe('никогда');
  });
});
