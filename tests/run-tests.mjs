// Тесты без зависимостей. Запуск: node tests/run-tests.mjs
// Для тестов на реальном матче: FIXTURE=путь\к\metadata.json node tests/run-tests.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { toAccountId, pctRank } from '../lib/util.js';
import { spreadWindows, buildDigest } from '../lib/digest.js';
import { aggregateTimeline, aggregateScores, matchScores } from '../lib/metrics.js';
import { parseHistory } from '../lib/history.js';
import { heuristicKind, inventoryAt } from '../lib/items.js';
import { ApiClient } from '../lib/api.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0, skipped = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

// ---------- Чистая логика ----------
test('SteamID64 -> Account ID', () => {
  assert.equal(toAccountId('76561199560928611'), 1600662883);
  assert.equal(toAccountId('1600662883'), 1600662883);
  assert.throws(() => toAccountId('abc'));
});

test('процентиль: крайние значения, равные, пустая группа', () => {
  const g = [1, 2, 3, 4];
  assert.equal(pctRank(4, g), 87.5);
  assert.equal(pctRank(1, g), 12.5);
  assert.equal(pctRank(5, [5, 5, 5, 5]), 50);
  assert.equal(pctRank(1, [1]), null);
  assert.equal(pctRank(NaN, g), null);
});

test('нерегулярные снимки: сумма сохраняется, распределение по минутам верное', () => {
  const snaps = [{ t: 180, x: 180 }, { t: 360, x: 540 }, { t: 540, x: 540 }, { t: 600, x: 600 }];
  const per = spreadWindows(snaps, 'x', 600);
  near(per.reduce((a, b) => a + b, 0), 600);
  near(per[0], 60); near(per[2], 60);            // 180 за 180 с = 60 в минуту
  near(per[3], 120); near(per[5], 120);          // окно 180-360: 360 за 3 минуты
  near(per[6], 0); near(per[8], 0);              // окно без прироста
  near(per[9], 60);                              // последнее окно 60 с: +60
});

test('последнее короткое окно (14 с): прирост не теряется и не раздувается', () => {
  const per = spreadWindows([{ t: 2100, x: 2100 }, { t: 2114, x: 2114 }], 'x', 2114);
  near(per.reduce((a, b) => a + b, 0), 2114);
  assert.equal(per.length, 36);
  near(per[35], 14);
});

test('счётчик не убывает: отрицательный прирост игнорируется', () => {
  const per = spreadWindows([{ t: 60, x: 100 }, { t: 120, x: 50 }], 'x', 120);
  assert.ok(per.every((v) => v >= 0));
});

function fakeDigest(id, T, perMin = 100) {
  const M = Math.ceil(T / 60);
  const arr = (v) => new Array(M).fill(v);
  const cover = Array.from({ length: M }, (_, m) => Math.min(60, T - m * 60));
  return {
    matchId: id, durationS: T, abandonS: 0, positions: null,
    minutes: { cover, snapCover: cover.slice(), kills: arr(0), deaths: arr(0), damage: arr(perMin), taken: arr(50), creeps: arr(3), alive: null, ally: null, enemy: null, combat: null },
    totals: {}, lobby: [],
  };
}

test('таймлайн: в корзину входят только матчи, дошедшие до этих минут', () => {
  const tl = aggregateTimeline([fakeDigest(1, 1200), fakeDigest(2, 2100), fakeDigest(3, 600)], 5);
  const by = Object.fromEntries(tl.map((b) => [`${b.from}-${b.to}`, b]));
  assert.equal(by['0-5'].n, 3);
  assert.equal(by['5-10'].n, 3);
  assert.equal(by['10-15'].n, 2);      // матч на 10 минут сюда не доходит
  assert.equal(by['20-25'].n, 1);
  assert.equal(by['30-35'].n, 1);
  assert.equal(by['30-35'].minutes, 5);
});

test('таймлайн: частичная последняя минута не искажает среднее', () => {
  const tl = aggregateTimeline([fakeDigest(1, 70, 100)], 5);   // минута 0 полная, минута 1 только 10 с
  assert.equal(tl[0].minutes, 1);
  near(tl[0].dmgPerMin, 100);
});

test('таймлайн: показатели по минутам считаются как Σ/Σ, а не среднее средних', () => {
  const a = fakeDigest(1, 300, 100), b = fakeDigest(2, 300, 300);
  const tl = aggregateTimeline([a, b], 5);
  near(tl[0].dmgPerMin, 200);
  assert.equal(tl[0].nPos, 0);
  assert.equal(tl[0].allyShare, null);
});

test('история: разные формы ответа, дубликаты, сортировка', () => {
  const rows = [{ match_id: 1, start_time: 100, duration_s: 10, hero_id: 5 }, { match_id: 2, start_time: 300, duration_s: 10 }, { match_id: 2, start_time: 300 }];
  for (const json of [rows, { matches: rows }, { some: 'x', data: rows }]) {
    const h = parseHistory(json);
    assert.equal(h.ok, true);
    assert.deepEqual(h.rows.map((r) => r.matchId), [2, 1]);
  }
  assert.equal(parseHistory({ a: 1 }).ok, false);
  assert.equal(parseHistory([]).ok, false);
  assert.equal(parseHistory([{ start_time: 1 }]).ok, false);
});

test('история: время в миллисекундах и ISO переводится в секунды', () => {
  const h = parseHistory([{ match_id: 1, start_time: 1795175176000 }, { match_id: 2, start_time: '2026-11-20T11:46:16Z' }]);
  assert.equal(h.rows[0].startTime, 1795175176);
  assert.equal(h.rows[1].startTime, 1795175176);
});

test('предметы: инвентарь на момент t учитывает покупку и продажу', () => {
  const items = [{ t: 100, id: 1, up: 1, sold: 0 }, { t: 200, id: 2, up: 1, sold: 400 }, { t: 300, id: 3, up: 0, sold: 0 }];
  assert.deepEqual(inventoryAt(items, 150, null).map((i) => i.id), [1]);
  assert.deepEqual(inventoryAt(items, 250, null).map((i) => i.id), [1, 2]);
  assert.deepEqual(inventoryAt(items, 500, null).map((i) => i.id), [1]);   // 2 продан, 3 способность
  assert.equal(heuristicKind({ up: 1 }), 'shop');
  assert.equal(heuristicKind({ up: 12345 }), 'ability');
});

test('API-клиент: 429 с Retry-After, повтор, затем успех; ошибки не бросают исключений', async () => {
  let n = 0;
  const fetchImpl = async () => {
    n++;
    if (n === 1) return new Response('slow down', { status: 429, headers: { 'retry-after': '0' } });
    return new Response('{"ok":true}', { status: 200, headers: { 'x-ratelimit-remaining': '9' } });
  };
  const c = new ApiClient({ fetchImpl, delayMs: 0, retries: 2 });
  const r = await c.getJson('https://x.test/a');
  assert.equal(r.ok, true);
  assert.equal(c.log.length, 2);
  assert.equal(c.log[1].headers['x-ratelimit-remaining'], '9');
  const bad = new ApiClient({ fetchImpl: async () => { throw new Error('network down'); }, delayMs: 0, retries: 0 });
  const r2 = await bad.getJson('https://x.test/b');
  assert.equal(r2.ok, false);
  assert.match(r2.error, /network down/);
  const html = new ApiClient({ fetchImpl: async () => new Response('<html>', { status: 200 }), delayMs: 0, retries: 0 });
  assert.equal((await html.getJson('https://x.test/c')).ok, false);
});

test('сводка: сообщения об ошибках на мусорных данных', () => {
  assert.ok(buildDigest(null, 1).error);
  assert.ok(buildDigest({ match_info: { players: [] } }, 1).error);
  assert.ok(buildDigest({ match_info: { duration_s: 100, players: [{ account_id: 5 }] } }, 1).error);
});

// ---------- Реальный матч ----------
const FIX = process.env.FIXTURE;
const real = FIX && fs.existsSync(FIX) ? JSON.parse(fs.readFileSync(FIX, 'utf8')) : null;
const realTest = (name, fn) => test(name, async () => { if (!real) { skipped++; passed--; return; } await fn(); });

realTest('реальный матч: убийства из смертей врагов совпадают с итогом у всех 12 игроков', () => {
  const mi = real.match_info;
  for (const pl of mi.players) {
    const k = mi.players.reduce((s, v) => s + v.death_details.filter((d) => d.killer_player_slot === pl.player_slot && v.team !== pl.team).length, 0);
    assert.equal(k, pl.kills, `слот ${pl.player_slot}`);
  }
});

realTest('реальный матч: сводка компактна и содержит ожидаемое', () => {
  const d = buildDigest(real, 1600662883);
  assert.equal(d.error, undefined);
  assert.equal(d.matchId, 140650454);
  assert.equal(d.durationS, 2114);
  assert.equal(d.won, false);
  assert.deepEqual(d.snapshotTimes, [180, 360, 540, 720, 900, 1200, 1500, 1800, 2100, 2114]);
  assert.equal(d.killTimes.length, 6);
  assert.equal(d.deathEvents.length, 5);
  assert.equal(d.items.length, 34);
  assert.equal(d.items.filter((i) => i.sold > 0).length, 10);
  assert.equal(d.items.filter((i) => i.up === 1).length, 19);
  assert.equal(d.minutes.cover.length, 36);
  near(d.minutes.cover[35], 14);
  const size = JSON.stringify(d).length;
  assert.ok(size < 40000, `сводка ${size} байт`);
  // суммы по минутам равны итогам
  near(d.minutes.damage.reduce((a, b) => a + b, 0), d.totals.playerDamage, 1e-6 * d.totals.playerDamage + 1e-6);
  assert.equal(d.minutes.kills.reduce((a, b) => a + b, 0), 6);
  assert.equal(d.minutes.deaths.reduce((a, b) => a + b, 0), 5);
  assert.ok(d.lobby.length === 12 && d.lobby.filter((l) => l.me).length === 1);
});

realTest('реальный матч: показатели в пределах 0-100 и воспроизводимы', () => {
  const d = buildDigest(real, 1600662883);
  const s = matchScores(d), s2 = matchScores(d);
  assert.deepEqual(s, s2);
  for (const [k, v] of Object.entries(s)) {
    assert.ok(v.score == null || (v.score >= 0 && v.score <= 100), k);
  }
  const agg = aggregateScores([d]);
  assert.equal(agg.used, 1);
});

realTest('реальный матч: покупки по гипотезе дают 19 магазинных и 15 способностей', () => {
  const d = buildDigest(real, 1600662883);
  assert.equal(d.items.filter((i) => heuristicKind(i) === 'shop').length, 19);
  assert.equal(d.items.filter((i) => heuristicKind(i) === 'ability').length, 15);
});

realTest('сквозной прогон check.mjs офлайн: отчёт создан, дефектные матчи не ломают прогон', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlcheck-'));
  const fx = path.join(dir, 'fx'), out = path.join(dir, 'out');
  let r = spawnSync(process.execPath, [path.join(HERE, 'make-offline-fixture.mjs'), FIX, fx], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  r = spawnSync(process.execPath, [path.join(HERE, '..', 'check.mjs'), '--offline', fx, '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const md = fs.readFileSync(path.join(out, 'report.md'), 'utf8');
  for (const s of ['## 1. Запросы', '## 3. Матчи', '## 5. Предметы', '## 7. Таймлайн', '## 8. Время путей и смерти', '## 9. Предупреждения', 'Сверка истории с метаданными', 'HTTP 404', 'ответ не JSON', 'нет match_info.players', 'не завершён']) assert.ok(md.includes(s), s);
  assert.ok(md.length < 25000, `отчёт ${md.length} знаков`);
  for (const f of ['report.json', 'digests.json', 'paths-diagnostics.json']) assert.ok(fs.statSync(path.join(out, f)).size < 300000, f);
  r = spawnSync(process.execPath, [path.join(HERE, '..', 'check.mjs'), '--offline', path.join(dir, 'empty'), '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'пустая папка (все запросы 404) не должна ронять инструмент: ' + r.stderr);
  assert.ok(fs.readFileSync(path.join(out, 'report.md'), 'utf8').includes('История не получена'));
  fs.rmSync(dir, { recursive: true, force: true });
});


// ---------- Новое в 0.2.0 ----------
import { pathDiagnostics } from '../lib/diagnostics.js';
import { compareHistory, winRules } from '../lib/crosscheck.js';
import { interpolate } from '../lib/digest.js';
import { watchForNewMatch } from '../lib/watch.js';

test('API-клиент: причина «fetch failed» берётся из cause', async () => {
  const e = new TypeError('fetch failed'); e.cause = { code: 'ENOTFOUND' };
  const c = new ApiClient({ fetchImpl: async () => { throw e; }, delayMs: 0, retries: 0 });
  const r = await c.getJson('https://x.test/a');
  assert.equal(r.ok, false);
  assert.match(r.error, /fetch failed \(ENOTFOUND\)/);
});

test('API-клиент: 304 Not Modified считается успехом без тела', async () => {
  let seen = null;
  const c = new ApiClient({ fetchImpl: async (u, init) => { seen = init.headers['if-none-match']; return new Response(null, { status: 304 }); }, delayMs: 0, retries: 0 });
  const r = await c.getJson('https://x.test/a', { headers: { 'if-none-match': '"abc"' } });
  assert.equal(r.ok, true); assert.equal(r.notModified, true); assert.equal(seen, '"abc"');
});

test('история: исходная запись сохраняется, запись без match_id отбрасывается', () => {
  const h = parseHistory([{ match_id: 5, start_time: 10, match_duration_s: 60, player_kills: 3 }, { start_time: 1 }]);
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].raw.player_kills, 3);
  assert.equal(h.rows[0].durationS, 60);
});

test('сверка истории: совпадение и расхождение', () => {
  const d = { matchId: 1, heroId: 3, durationS: 1800, won: true, totals: { kills: 5, deaths: 2, assists: 7, netWorth: 30000 } };
  const ok = compareHistory({ hero_id: 3, player_kills: 5, player_deaths: 2, player_assists: 7, match_duration_s: 1801, net_worth: 30000, player_team: 0, match_result: 0 }, d);
  assert.deepEqual([ok.heroOk, ok.kdaOk, ok.durOk, ok.netWorthOk], [true, true, true, true]);
  const bad = compareHistory({ hero_id: 4, player_kills: 6, player_deaths: 2, player_assists: 7, match_duration_s: 1900 }, d);
  assert.deepEqual([bad.heroOk, bad.kdaOk, bad.durOk], [false, false, false]);
  const w = winRules([{ wonMeta: true, matchResult: 0, playerTeam: 0, outcome: 1 }, { wonMeta: false, matchResult: 1, playerTeam: 0, outcome: 2 }]);
  assert.equal(w['match_result === player_team'], 2);
  assert.equal(w['match_result !== player_team'], 0);
});

test('калибровка времени: кусочно-линейная интерполяция и экстраполяция', () => {
  const a = [[0, 0], [100, 110], [200, 230]];
  near(interpolate(a, 50), 55); near(interpolate(a, 150), 170); near(interpolate(a, 250), 280); near(interpolate(a, -5), -5);
});

test('диагностика путей: сдвиг находится по падению здоровья до нуля', () => {
  const health = new Array(300).fill(100);
  for (let i = 112; i < 140; i++) health[i] = 0;                    // игрок умер на индексе 112
  const meta = { match_info: { duration_s: 250, match_id: 7, players: [{ player_slot: 1, account_id: 9, death_details: [{ game_time_s: 100 }] }], match_paths: { paths: [{ player_slot: 1, health, x_pos: [], y_pos: [] }] } } };
  const d = pathDiagnostics(meta, 9);
  assert.equal(d.players[0].zeroCrossings, 1);
  assert.deepEqual(d.perDeath[0], [1, 100, 12]);
  assert.equal(d.players[0].lenMinusT, 50);
});

test('наблюдение: 304, новый матч, метаданные появляются позже истории', async () => {
  let clock = 1_000_000; const now = () => clock; const sleep = async (ms) => { clock += ms / 1000; };
  let polls = 0, metaCalls = 0; const events = [];
  const A = { match_id: 1, start_time: 1000, match_duration_s: 1800 };
  const B = { match_id: 2, start_time: clock - 3000, match_duration_s: 1800 };   // закончился за 1200 с до старта наблюдения
  const fetchImpl = async (url, init) => {
    if (url.includes('match-history')) {
      polls++;
      if (polls === 1) return new Response(JSON.stringify([A]), { status: 200, headers: { etag: '"e1"' } });
      if (polls === 2) { assert.equal(init.headers['if-none-match'], '"e1"'); return new Response(null, { status: 304 }); }
      return new Response(JSON.stringify([B, A]), { status: 200, headers: { etag: '"e2"' } });
    }
    metaCalls++;
    return metaCalls === 1 ? new Response('nf', { status: 404 }) : new Response('{"match_info":{}}', { status: 200 });
  };
  const client = new ApiClient({ fetchImpl, delayMs: 0, retries: 0 });
  const res = await watchForNewMatch({ client, urls: { history: 'https://x.test/match-history', meta: (id) => `https://x.test/matches/${id}/metadata` }, intervalMs: 180000, maxMs: 3600000, now, sleep, onEvent: (t, d) => events.push(t) });
  assert.equal(res.newMatches.length, 1);
  const m = res.newMatches[0];
  assert.equal(m.matchId, 2);
  near(m.historyDelayMin, (360 + 1200) / 60, 0.01);        // новый матч виден на 3-м опросе: после двух пауз по 180 с
  near(m.metadataDelayMin, (540 + 1200) / 60, 0.01);       // метаданные только на следующем опросе (ещё +180 с)
  assert.ok(m.metadataDelayMin > m.historyDelayMin);
  assert.ok(events.includes('new-match') && events.includes('metadata'));
});

test('наблюдение: если нового матча нет, возвращает таймаут без ошибки', async () => {
  let clock = 0; const events = [];
  const fetchImpl = async () => new Response(JSON.stringify([{ match_id: 1, start_time: 1, match_duration_s: 1 }]), { status: 200 });
  const client = new ApiClient({ fetchImpl, delayMs: 0, retries: 0 });
  const res = await watchForNewMatch({ client, urls: { history: 'https://x.test/h', meta: () => 'https://x.test/m' }, intervalMs: 600000, maxMs: 1800000, now: () => clock, sleep: async (ms) => { clock += ms / 1000; }, onEvent: (t) => events.push(t) });
  assert.equal(res.newMatches.length, 0);
  assert.ok(events.includes('timeout'));
});

realTest('реальный матч: здоровье падает до 0 почти ровно столько раз, сколько смертей', () => {
  const d = pathDiagnostics(real, 1600662883);
  const zeros = d.players.reduce((s, p) => s + p.zeroCrossings, 0), deaths = d.players.reduce((s, p) => s + p.deaths, 0);
  assert.equal(deaths, 78);
  assert.ok(zeros >= 78 && zeros <= 90, `переходов ${zeros}`);
  assert.equal(d.perDeath.filter((x) => x[2] !== null).length, 78);
});

realTest('реальный матч: калибровка поднимает совпадение со смертями, ненадёжный путь честно помечен', () => {
  const d = buildDigest(real, 1600662883);
  assert.ok(d.positions.overall.share >= 0.85, `совпадение ${d.positions.overall.share}`);
  assert.equal(d.positions.target.slot, 1);
  assert.equal(d.positions.target.reliable, false);
  assert.equal(d.positions.usable, false);
  assert.match(d.positions.unusableReason, /не сходится со смертями/);
  assert.ok(d.positions.unreliableSlots.some((x) => x.startsWith('2 ')));
});

realTest('реальный матч: надёжный путь игрока (слот 5) даёт позиции, но мало надёжных остальных', () => {
  const acc = real.match_info.players.find((p) => p.player_slot === 5).account_id;
  const d = buildDigest(real, acc);
  assert.equal(d.positions.target.reliable, true);
  assert.equal(d.positions.usable, false);
  assert.match(d.positions.unusableReason, /только \d+ из 11/);
  // при ослабленном требовании признаки считаются и лежат в 0..1
  const me = d.lobby.find((l) => l.me).f;
  assert.ok(me.allyShare >= 0 && me.allyShare <= 1 && me.enemyShare >= 0 && me.enemyShare <= 1);
});

// ---------- Справочники /v1/assets (формат проверен 2026-11-23) ----------
import { buildAssetIndex, buildHeroIndex, finalKind, assetKind, classificationReport } from '../lib/items.js';

const IMG = 'https://assets-bucket.deadlock-api.com/assets-api-res/images';
// Урезанные копии настоящих записей https://api.deadlock-api.com/v1/assets/items (оставлены только нужные поля).
const ASSET_ITEMS = [
  { type: 'upgrade', id: 1548066885, class_name: 'upgrade_clip_size', name: 'Extended Magazine', image: `${IMG}/upgrades/mods_weapon/clip_size.png`, image_webp: `${IMG}/upgrades/mods_weapon/clip_size.webp`, shop_image: `${IMG}/items/weapon/basic_magazine.png`, shop_image_webp: `${IMG}/items/weapon/basic_magazine.webp`, item_slot_type: 'weapon', item_tier: 1, cost: 800, shopable: true, is_active_item: false, heroes: [], start_trained: true },
  { type: 'upgrade', id: 619484391, class_name: 'upgrade_targeted_silence', name: 'Silence Wave', image: `${IMG}/upgrades/mods_weapon/targeted_silence.png`, image_webp: `${IMG}/upgrades/mods_weapon/targeted_silence.webp`, shop_image: `${IMG}/items/spirit/silence_glyph.png`, shop_image_webp: `${IMG}/items/spirit/silence_glyph.webp`, item_slot_type: 'spirit', item_tier: 3, cost: 3200, shopable: true, is_active_item: true, heroes: [], start_trained: true },
  { type: 'upgrade', id: 1248737459, class_name: 'upgrade_ammo_scavenger', name: 'Ammo Scavenger', image: `${IMG}/upgrades/mods_weapon/ammo_scavenger.png`, image_webp: `${IMG}/upgrades/mods_weapon/ammo_scavenger.webp`, item_slot_type: 'spirit', item_tier: 1, cost: 800, shopable: false, disabled: true, is_active_item: false, heroes: [], start_trained: true },
  { type: 'ability', id: 3760705623, class_name: 'citadel_ability_stomp', name: 'Kinetic Pulse', image: `${IMG}/abilities/sumo/sumo_stomp.png`, image_webp: `${IMG}/abilities/sumo/sumo_stomp.webp`, ability_type: 'signature', heroes: [11], start_trained: false },
  { type: 'ability', id: 249410288, class_name: 'citadel_ability_self_vacuum', name: 'Singularity', image: `${IMG}/abilities/sumo/sumo_vacuum.png`, image_webp: `${IMG}/abilities/sumo/sumo_vacuum.webp`, ability_type: 'ultimate', heroes: [11], start_trained: false },
  { type: 'weapon', id: 2826225210, class_name: 'weapon_alternative_rmb_activate', name: 'weapon_alternative_rmb_activate', image: `${IMG}/abilities/weapon_damage.png`, image_webp: `${IMG}/abilities/weapon_damage.webp`, heroes: [], start_trained: true },
];
const ASSET_HEROES = [
  { id: 11, class_name: 'hero_dynamo', name: 'Dynamo', player_selectable: true, disabled: false, in_development: false, images: { icon_hero_card: `${IMG}/heroes/dynamo_card.png` } },
  { id: 86, class_name: 'hero_artist', name: 'Violet', player_selectable: true, disabled: false, in_development: true, images: {} },
  { id: 999, class_name: 'hero_old', name: 'Старый', player_selectable: false, disabled: true, in_development: true },
];

test('справочник предметов /v1/assets: ключ id, новые поля и изображения', () => {
  const idx = buildAssetIndex(ASSET_ITEMS, new Set([1548066885, 3760705623]));
  assert.equal(idx.idKey, 'id');
  assert.equal(idx.size, 6);
  assert.equal(idx.hits, 2);
  const mag = idx.map.get(1548066885);
  assert.deepEqual([mag.name, mag.type, mag.slot, mag.tier, mag.cost, mag.shopable, mag.active], ['Extended Magazine', 'upgrade', 'weapon', 1, 800, true, false]);
  assert.equal(mag.image, `${IMG}/upgrades/mods_weapon/clip_size.png`);          // прежнее поле не изменилось
  assert.equal(mag.shopImage, `${IMG}/items/weapon/basic_magazine.png`);
  assert.equal(mag.shopImageWebp, `${IMG}/items/weapon/basic_magazine.webp`);
  assert.equal(mag.icon, `${IMG}/items/weapon/basic_magazine.webp`);           // у магазинного — карточка магазина
  assert.equal(idx.map.get(619484391).active, true);
  const old = idx.map.get(1248737459);
  assert.deepEqual([old.shopable, old.disabled, old.shopImage], [false, true, null]);
  assert.equal(old.icon, `${IMG}/upgrades/mods_weapon/ammo_scavenger.webp`);    // нет shop_image -> обычная иконка
  const ult = idx.map.get(249410288);
  assert.deepEqual([ult.type, ult.abilityType, ult.heroes, ult.slot, ult.cost], ['ability', 'ultimate', [11], null, null]);
  assert.equal(ult.icon, `${IMG}/abilities/sumo/sumo_vacuum.webp`);
});

test('классификация по справочнику /v1/assets: upgrade = магазин, ability = способность, убранный предмет остаётся покупкой', () => {
  const idx = buildAssetIndex(ASSET_ITEMS, new Set());
  const k = (id, up) => finalKind({ id, up }, idx);
  assert.deepEqual([k(1548066885, 1).kind, k(1548066885, 1).source], ['shop', 'assets']);
  assert.equal(k(1248737459, 1).kind, 'shop');                                  // shopable:false, disabled:true
  assert.deepEqual([k(3760705623, 0).kind, k(3760705623, 0).source], ['ability', 'assets']);
  assert.equal(k(249410288, 967703252).kind, 'ability');
  assert.equal(k(2826225210, 0).kind, 'other:weapon');
  // справочник важнее гипотезы, гипотеза — запасной вариант для неизвестных ID
  assert.equal(k(3760705623, 1).kind, 'ability');
  assert.deepEqual([k(123, 1).kind, k(123, 1).source], ['shop', 'heuristic']);
  assert.deepEqual([k(123, 5).kind, k(123, 5).source], ['ability', 'heuristic']);
  assert.equal(assetKind(null), null);
  // сверка гипотезы со справочником на записях в формате сводки матча
  const d = { items: [{ id: 1548066885, up: 1 }, { id: 619484391, up: 1 }, { id: 3760705623, up: 0 }, { id: 249410288, up: 426371878 }, { id: 777, up: 1 }] };
  const rep = classificationReport([d], idx);
  assert.equal(rep.total, 5); assert.equal(rep.found, 4); assert.equal(rep.comparable, 4); assert.equal(rep.agreement, 1);
  assert.deepEqual(rep.missingSample, [{ id: 777, n: 1 }]);
});

test('справочник героев /v1/assets: имена, включая героев в разработке и выключенных', () => {
  const h = buildHeroIndex(ASSET_HEROES, new Set([11, 86]));
  assert.equal(h.idKey, 'id'); assert.equal(h.hits, 2); assert.equal(h.size, 3);
  assert.equal(h.names.get(11), 'Dynamo');
  assert.equal(h.names.get(86), 'Violet');                                     // in_development: true — имя всё равно нужно
  assert.equal(h.names.get(999), 'Старый');
});

test('check.mjs офлайн: справочники запрашиваются по /v1/assets, --api и --assets меняют адрес', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlassets-'));
  try {
    const fx = path.join(dir, 'fx');
    fs.mkdirSync(fx);
    fs.writeFileSync(path.join(fx, 'heroes.json'), JSON.stringify(ASSET_HEROES));
    fs.writeFileSync(path.join(fx, 'items.json'), JSON.stringify(ASSET_ITEMS));
    const run = (extra, out) => {
      const r = spawnSync(process.execPath, [path.join(HERE, '..', 'check.mjs'), '--offline', fx, '--out', out, ...extra], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr + r.stdout);
      const rep = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8'));
      const byLabel = Object.fromEntries(rep.requests.map((e) => [e.label, e]));
      return { rep, byLabel, md: fs.readFileSync(path.join(out, 'report.md'), 'utf8') };
    };
    const a = run([], path.join(dir, 'o1'));
    assert.equal(a.byLabel['справочник героев'].url, 'https://api.deadlock-api.com/v1/assets/heroes');
    assert.equal(a.byLabel['справочник предметов'].url, 'https://api.deadlock-api.com/v1/assets/items');
    assert.equal(a.byLabel['справочник героев'].status, 200);
    assert.equal(a.byLabel['справочник предметов'].status, 200);
    assert.ok(!a.rep.warnings.some((w) => /Справочник (героев|предметов) не получен/.test(w)), a.rep.warnings.join('\n'));
    assert.ok(!a.md.includes('assets.deadlock-api.com'));
    const b = run(['--api', 'https://x.test/'], path.join(dir, 'o2'));
    assert.equal(b.byLabel['справочник героев'].url, 'https://x.test/v1/assets/heroes');
    const c = run(['--assets', 'https://y.test/base/'], path.join(dir, 'o3'));
    assert.equal(c.byLabel['справочник предметов'].url, 'https://y.test/base/items');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const [name, fn] of tests) {
  try { await fn(); passed++; console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n    ', e.message); }
}
// реальные тесты без файла считаются как пропущенные (в passed уже вычтены)
console.log(`\n${passed} прошло, ${failed} упало, ${skipped} пропущено${real ? '' : ' (нет FIXTURE: тесты на реальном матче пропущены)'}`);
process.exit(failed ? 1 : 0);
