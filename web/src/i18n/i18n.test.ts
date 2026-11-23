import { describe, expect, it } from 'vitest';
import { ru, ruPlurals } from './ru';
import { en, enPlurals } from './en';
import { createI18n, interpolate } from './index';
import type { Dict } from '../api/types';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const CYRILLIC = /[А-Яа-яЁё]/;

describe('словари', () => {
  it('в английском ровно те же ключи, что в русском', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort());
    expect(Object.keys(enPlurals).sort()).toEqual(Object.keys(ruPlurals).sort());
  });
  it('плейсхолдеры совпадают у каждого ключа', () => {
    for (const k of Object.keys(ru) as (keyof typeof ru)[]) expect(placeholders(en[k]), k).toEqual(placeholders(ru[k]));
  });
  it('в английском словаре нет кириллицы (кроме самоназвания языка «Русский»)', () => {
    for (const [k, v] of Object.entries(en)) if (k !== 'lang.ru') expect(CYRILLIC.test(v), `${k}: ${v}`).toBe(false);
  });
  it('пустые строки только у намеренно пустых подписей осей в EN', () => {
    for (const [k, v] of Object.entries(ru)) expect(v.length, k).toBeGreaterThan(0);
    for (const [k, v] of Object.entries(en)) if (!v) expect(k).toMatch(/^dna\.axis\.\w+\.sub$/);
  });
  it('неприкосновенные имена не переводятся', () => {
    expect(ru['nav.dashboard']).toBe(en['nav.dashboard']);
    expect(ru['nav.lab']).toBe(en['nav.lab']);
  });
});

describe('createI18n', () => {
  const dict: Dict = {
    heroes: { 64: { n: 'Drifter', ru: 'Скиталец', icon: null, card: null }, 3: { n: 'Vindicta', ru: 'Виндикта', icon: null, card: null }, 99: { n: 'Newhero', icon: null, card: null }, 5: { n: null, icon: null, card: null } },
    items: { 1: { n: 'Extended Magazine', ru: 'Увеличенный магазин', type: 'upgrade', slot: 'weapon', tier: 1, cost: 800, icon: null, active: false, shopable: true, abilityType: null, heroes: null } },
  };
  it('интерполяция и формы множественного числа', () => {
    expect(interpolate('{a} из {b}', { a: 1, b: 2 })).toBe('1 из 2');
    const r = createI18n('ru'), e = createI18n('en');
    expect([1, 2, 5, 11, 21, 22].map((x) => r.count(x))).toEqual(['1 матч', '2 матча', '5 матчей', '11 матчей', '21 матч', '22 матча']);
    expect([1, 2, 10].map((x) => e.count(x))).toEqual(['1 match', '2 matches', '10 matches']);
    expect(r.count(5, 'win')).toBe('5 побед');
    expect(e.count(1, 'loss')).toBe('1 loss');
  });
  it('игровые названия: официальная локализация, иначе оригинал, без выдуманных переводов', () => {
    const r = createI18n('ru'), e = createI18n('en');
    expect(r.hero(64, dict)).toBe('Скиталец');
    expect(e.hero(64, dict)).toBe('Drifter');
    expect(r.hero(99, dict)).toBe('Newhero');          // локализации нет — оригинал
    expect(r.hero(5, dict)).toBe('Герой #5');
    expect(e.hero(777, dict)).toBe('Hero #777');
    expect(r.item(1, dict)).toBe('Увеличенный магазин');
    expect(e.item(1, dict)).toBe('Extended Magazine');
    expect(e.item(2, dict)).toBe('Item #2');
  });
  it('режимы и причины переводятся по кодам, неизвестные значения не угадываются', () => {
    const r = createI18n('ru'), e = createI18n('en');
    expect(e.gameMode(1)).toBe('Normal 6v6');
    expect(e.gameMode(9)).toBe('Mode 9 (unknown)');
    expect(r.matchMode(4)).toBe('Рейтинговый');
    expect(e.matchMode(1)).toBe('Unranked');
    expect(e.matchMode(3)).toBe('Type 3 (unknown)');
    expect(e.posReason({ code: 'few_reliable', n: 7 })).toBe('only 7 of 11 other players have reliable paths');
    expect(e.posReason({ code: 'path_mismatch' })).toBe('player path does not match deaths');
    expect(e.exclReason('short')).toBe('shorter than 10 min');
    expect(e.tech('таймаут 60000 мс')).toBe('timeout 60000 ms');
    expect(e.syncError({ step: 'history', error: 'история: HTTP 503', code: 'request', detail: 'HTTP 503' })).toBe('Match history: HTTP 503');
    expect(e.skipped({ matchId: 1, reason: 'Street Brawl', kind: 'mode', gameMode: 4 })).toBe('Street Brawl');
    expect(e.skipped({ matchId: 1, reason: '…', kind: 'failed', code: 'meta_unavailable', detail: 'HTTP 500' })).toBe('metadata unavailable for more than 12 h (HTTP 500)');
  });
});
