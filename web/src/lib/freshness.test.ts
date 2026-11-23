import { describe, expect, it } from 'vitest';
import { freshLimitMin, freshStateOf, LOCAL_FRESH_MIN } from './freshness';

const MIN = 60_000;
const now = 1_800_000_000_000;
const local = { ok: true, stale: false, lastSuccessAt: now - 10 * MIN };
const published = { ...local, publish: { mode: 'on-change' as const, publishedAt: now, checkEveryMin: 15, heartbeatHours: 24 } };

describe('свежесть данных', () => {
  it('локальный сервер: как раньше, 20 минут', () => {
    expect(freshLimitMin(undefined)).toBe(LOCAL_FRESH_MIN);
    expect(freshLimitMin(published.publish)).toBe(24 * 60 + 120);
    expect(freshStateOf(local, now)).toBe('fresh');
    expect(freshStateOf({ ...local, lastSuccessAt: now - 25 * MIN }, now)).toBe('aging');
  });

  it('опубликованный сайт: пропущенные публикации без изменений не делают данные «устаревшими»', () => {
    expect(freshStateOf({ ...published, lastSuccessAt: now - 6 * 60 * MIN }, now)).toBe('fresh');
    expect(freshStateOf({ ...published, lastSuccessAt: now - 25 * 60 * MIN }, now)).toBe('fresh');
  });

  it('опубликованный сайт: если обновления остановились, после суток + 2 ч честно «давно не обновлялись»', () => {
    expect(freshStateOf({ ...published, lastSuccessAt: now - 27 * 60 * MIN }, now)).toBe('aging');
  });

  it('ошибка API важнее возраста', () => {
    expect(freshStateOf({ ...published, ok: false, stale: true }, now)).toBe('stale');
    expect(freshStateOf({ ...local, lastSuccessAt: null }, now)).toBe('aging');
  });
});
