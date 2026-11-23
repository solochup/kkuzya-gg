// Тесты сайта KKUZYA.GG (ядро профиля, справочники, синхронизация, сервер). Без сети и без зависимостей.
// Запуск: node tests/site-tests.mjs        На реальном матче: FIXTURE=путь\metadata.json node tests/site-tests.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describeMode, isNormalMatch } from '../lib/modes.js';
import { slimHeroes, slimItems, slimMap, worldToRelative } from '../lib/assets-slim.js';
import { buildDigest } from '../lib/digest.js';
import { buildProfile, buildMatchDetail, indexFromSlim } from '../lib/profile.js';
import { ApiClient } from '../lib/api.js';
import { MemoryStore } from '../server/store.js';
import { syncOnce, retryDelayMs, DIGEST_SCHEMA } from '../server/sync.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0, skipped = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const ME = 1600662883;

/* ---------- Синтетические данные в формате API ---------- */
const IMG = 'https://assets-bucket.deadlock-api.com/assets-api-res/images';
const ITEMS = [
  { type: 'upgrade', id: 1548066885, name: 'Extended Magazine', image: `${IMG}/a.png`, shop_image_webp: `${IMG}/shop_a.webp`, item_slot_type: 'weapon', item_tier: 1, cost: 800, shopable: true, is_active_item: false, heroes: [] },
  { type: 'upgrade', id: 619484391, name: 'Silence Wave', image: `${IMG}/b.png`, item_slot_type: 'spirit', item_tier: 3, cost: 3200, shopable: true, is_active_item: true, heroes: [] },
  { type: 'upgrade', id: 1248737459, name: 'Ammo Scavenger', image_webp: `${IMG}/c.webp`, item_slot_type: 'spirit', item_tier: 1, cost: 800, shopable: false, disabled: true, heroes: [] },
  { type: 'ability', id: 3760705623, name: 'Kinetic Pulse', image_webp: `${IMG}/k.webp`, ability_type: 'signature', heroes: [11] },
  { type: 'ability', id: 249410288, name: 'Singularity', image_webp: `${IMG}/s.webp`, ability_type: 'ultimate', heroes: [11] },
  { type: 'weapon', id: 2826225210, name: 'weapon_x', heroes: [] },
];
const HEROES = [
  { id: 11, name: 'Dynamo', class_name: 'hero_dynamo', player_selectable: true, disabled: false, in_development: false, images: { icon_image_small_webp: `${IMG}/dyn_sm.webp`, icon_hero_card_webp: `${IMG}/dyn_card.webp` } },
  { id: 86, name: 'Violet', class_name: 'hero_artist', player_selectable: true, disabled: false, in_development: true, images: {} },
  ...[1, 2, 3, 4, 6, 7, 8, 10, 12, 13].map((id) => ({ id, name: `H${id}`, images: {} })),
];
// Карта в формате /v1/assets/map: у объектов есть и мировые, и относительные координаты.
const R = 10752;
const MAP = {
  radius: R, images: { minimap: `${IMG}/maps/minimap.png` },
  neutral_camps: [[3248, -1888], [-9248, 0], [0, 0], [5000, 7000], [-6000, -9000], [100, 200]].map(([x, y]) => ({ position: [x, y, 0], left_relative: (x + R) / (2 * R), top_relative: (R - y) / (2 * R) })),
};

/** Метаданные матча: 12 игроков, kkuzya в слоте 1 (команда 0). Без путей. */
function makeMeta({ id, start, T = 1800, won = true, myKills = 3, myDeaths = 2, gameMode = 1 }) {
  const players = [];
  for (let slot = 1; slot <= 12; slot++) {
    const team = slot <= 6 ? 0 : 1;
    const heroId = slot === 1 ? 11 : [1, 2, 3, 4, 6, 7, 8, 10, 12, 13, 86][slot - 2];
    const stats = [180, 360, 540, 720, 900, 1200, 1500, 1800].filter((t) => t < T).concat([T]).map((t) => ({
      time_stamp_s: t, net_worth: Math.round(t * 20 + slot * 10), level: Math.min(30, Math.round(t / 60)), kills: 0, deaths: 0, assists: 0,
      creep_kills: Math.round(t / 15 + slot), neutral_kills: Math.round(t / 60), possible_creeps: Math.round(t / 10),
      player_damage: Math.round(t * (15 + slot)), player_damage_taken: Math.round(t * 12), player_healing: t, boss_damage: 0,
      gold_lane_creep: t * 3, gold_neutral_creep: t, shots_hit: t, shots_missed: t / 2, hero_bullets_hit: 0,
      bullet_kills: slot === 1 ? 1 : 0, melee_kills: 0, ability_kills: slot === 1 ? 2 : 0, headshot_kills: 0,
    }));
    players.push({ account_id: slot === 1 ? ME : 1000 + slot, player_slot: slot, team, hero_id: heroId, kills: 0, deaths: 0, assists: slot === 1 ? 5 : 1, net_worth: stats.at(-1).net_worth, last_hits: 100, denies: 2, death_details: [], items: [], stats, abandon_match_time_s: 0 });
  }
  const me = players[0];
  // kkuzya убивает слоты 7.. (команда 1)
  for (let k = 0; k < myKills; k++) players[6 + k].death_details.push({ game_time_s: 300 + k * 200, killer_player_slot: 1, death_pos: { x: 100 * k, y: -200, z: 0 }, killer_pos: { x: 100 * k, y: -100, z: 0 }, death_duration_s: 10 });
  for (let k = 0; k < myDeaths; k++) me.death_details.push({ game_time_s: 400 + k * 300, killer_player_slot: 8, death_pos: { x: -500, y: 600 + k, z: 0 }, killer_pos: { x: -400, y: 600, z: 0 }, death_duration_s: 20 });
  for (const p of players) { p.kills = players.reduce((s, v) => s + v.death_details.filter((d) => d.killer_player_slot === p.player_slot).length, 0); p.deaths = p.death_details.length; }
  me.items = [
    { game_time_s: 10, item_id: 3760705623, upgrade_id: 0, sold_time_s: 0 },
    { game_time_s: 60, item_id: 1548066885, upgrade_id: 1, sold_time_s: 900 },
    { game_time_s: 400, item_id: 619484391, upgrade_id: 1, sold_time_s: 0 },
    { game_time_s: 500, item_id: 3760705623, upgrade_id: 12345, sold_time_s: 0 },
    { game_time_s: 1000, item_id: 249410288, upgrade_id: 0, sold_time_s: 0 },
  ];
  return { match_info: { match_id: id, start_time: start, duration_s: T, winning_team: won ? 0 : 1, game_mode: gameMode, match_mode: 4, ranked_type: 1, players } };
}

/* ---------- Режимы ---------- */
test('режимы: обычный, Street Brawl, неизвестный честно помечен', () => {
  assert.equal(describeMode(1, 4).gameLabel, 'Обычный 6×6');
  assert.equal(describeMode(1, 4).matchLabel, 'Рейтинговый');
  assert.equal(describeMode(1, 1).matchLabelConfirmed, true);
  assert.equal(describeMode(4, 1).kind, 'brawl');
  assert.equal(describeMode(9, 3).gameLabel, 'Режим 9 (неизвестен)');
  assert.equal(describeMode(9, 3).matchLabel, 'Тип 3 (неизвестен)');
  assert.equal(describeMode(1, 7).matchLabelConfirmed, false);
  assert.equal(isNormalMatch(1), true); assert.equal(isNormalMatch(4), false); assert.equal(isNormalMatch(undefined), false);
});

/* ---------- Справочники ---------- */
test('компактные справочники: weapon отброшен, поля и иконки на месте', () => {
  const it = slimItems(ITEMS);
  assert.equal(Object.keys(it).length, 5);
  assert.equal(it[2826225210], undefined);
  assert.deepEqual([it[1548066885].type, it[1548066885].slot, it[1548066885].tier, it[1548066885].cost, it[1548066885].icon], ['upgrade', 'weapon', 1, 800, `${IMG}/shop_a.webp`]);
  assert.equal(it[1248737459].shopable, false);
  assert.deepEqual([it[249410288].type, it[249410288].abilityType, it[249410288].slot, it[249410288].heroes], ['ability', 'ultimate', null, [11]]);
  const h = slimHeroes(HEROES);
  assert.equal(h[11].icon, `${IMG}/dyn_sm.webp`);
  assert.equal(h[11].card, `${IMG}/dyn_card.webp`);
  assert.equal(h[86].n, 'Violet'); assert.equal(h[86].inDevelopment, true); assert.equal(h[86].icon, null);
  assert.equal(JSON.stringify(slimItems(ITEMS)).length < JSON.stringify(ITEMS).length, true);
});

test('локализованные названия: только официальные из справочника и только отличающиеся', async () => {
  const { slimNames } = await import('../lib/assets-slim.js');
  const items = slimItems(ITEMS), heroes = slimHeroes(HEROES);
  const itemsRu = slimNames([{ id: 1548066885, name: 'Увеличенный магазин' }, { id: 619484391, name: 'Silence Wave' }, { id: 2826225210, name: 'Оружие' }, { id: 5, name: 'Нет в словаре' }], items);
  assert.deepEqual(itemsRu, { 1548066885: 'Увеличенный магазин' });   // совпадающие, служебные и лишние отброшены
  const heroesRu = slimNames([{ id: 11, name: 'Динамо' }], heroes);
  const d = buildDigest(makeMeta({ id: 1, start: 1000 }), ME);
  const p = buildProfile([d], { assets: { heroes, items, itemsRu, heroesRu } });
  assert.equal(p.dict.heroes[11].ru, 'Динамо'); assert.equal(p.dict.heroes[11].n, 'Dynamo');
  assert.equal(p.dict.items[1548066885].ru, 'Увеличенный магазин');
  assert.equal(p.dict.items[619484391].ru, undefined);
  assert.equal(p.dict.heroes[7].ru, undefined);
  // Коды причин для перевода интерфейса.
  assert.deepEqual(p.matches[0].positions.reasonCode, { code: 'no_data' });
  assert.equal(p.builds.classification.fromAssets, true);
});

test('карта: формула перевода координат проверяется по объектам справочника', () => {
  const m = slimMap(MAP);
  assert.equal(m.radius, R); assert.equal(m.transformOk, true); assert.equal(m.transformChecked, 6); assert.equal(m.transformMaxError, 0);
  const [l, t] = worldToRelative(3248, -1888, R);
  near(l, 0.6510416666666666); near(t, 0.5877976190476191);
  // Если справочник поменяет систему координат, карта честно отключится.
  const broken = { ...MAP, neutral_camps: MAP.neutral_camps.map((c) => ({ ...c, left_relative: 1 - c.left_relative })) };
  assert.equal(slimMap(broken).transformOk, false);
  assert.equal(slimMap({ images: {} }), null);
});

/* ---------- Сводка и профиль ---------- */
test('сводка: события с координатами и героями, путь без match_paths не выдумывается', () => {
  const d = buildDigest(makeMeta({ id: 1, start: 1000, myKills: 3, myDeaths: 2 }), ME, { keepPath: true });
  assert.equal(d.error, undefined);
  assert.equal(d.killEvents.length, 3);
  // Герои по слотам в makeMeta: слот 7 -> герой 7, слот 8 -> герой 8.
  assert.deepEqual(d.killEvents[0], { t: 300, victim: 7, victimHero: 7, pos: [0, -200], myPos: [0, -100] });
  assert.equal(d.deathEvents[0].killerHero, 8); assert.equal(d.deathEvents[0].killerTeam, 1); assert.deepEqual(d.deathEvents[0].pos, [-500, 600]);
  assert.equal(d.path, null);
  assert.equal(d.positions, null);
  assert.equal(d.totals.abilityKills, 2); assert.equal(d.totals.bulletKills, 1);
  assert.equal(d.players.length, 12); assert.equal(d.players.filter((p) => p.me).length, 1);
});

test('профиль: KPI, герои, бои, сборки и выбор последних N', () => {
  const assets = { heroes: slimHeroes(HEROES), items: slimItems(ITEMS), map: slimMap(MAP) };
  const ds = [
    buildDigest(makeMeta({ id: 1, start: 1000, won: true, myKills: 3, myDeaths: 2 }), ME),
    buildDigest(makeMeta({ id: 2, start: 5000, won: false, myKills: 1, myDeaths: 0, T: 1500 }), ME),
    buildDigest(makeMeta({ id: 3, start: 9000, won: true, myKills: 2, myDeaths: 1 }), ME),
  ];
  const p = buildProfile(ds, { n: 2, assets, generatedAt: 123 });
  assert.equal(p.available, 2);
  assert.deepEqual(p.matches.map((m) => m.matchId), [3, 2]);            // самые новые
  assert.deepEqual(p.trend.map((t) => t.matchId), [2, 3]);              // хронологически
  assert.equal(p.kpi.wins, 1); assert.equal(p.kpi.losses, 1); assert.equal(p.kpi.winRate, 0.5);
  assert.equal(p.kpi.kills, 3); assert.equal(p.kpi.deaths, 1);
  near(p.kpi.kda, (3 + 10) / 1);
  assert.equal(p.heroes.length, 1); assert.equal(p.heroes[0].heroId, 11);
  assert.equal(p.combat.victims.reduce((s, v) => s + v.count, 0), 3);
  assert.equal(p.combat.killers[0].heroId, 8);
  assert.equal(p.combat.killTypes.ability, 4);
  assert.equal(p.builds.shopPurchases, 4); assert.equal(p.builds.abilityUpgrades, 6);
  assert.equal(p.builds.classification.coverage, 1);
  assert.equal(p.builds.slotSpend.weapon.total, 1600); assert.equal(p.builds.slotSpend.spirit.total, 6400);
  assert.equal(p.dict.heroes[11].n, 'Dynamo'); assert.equal(p.dict.items[1548066885].n, 'Extended Magazine');
  assert.equal(p.dict.items[2826225210], undefined);
  for (const a of p.dna.axes) assert.ok(p.dna.scores[a].score == null || (p.dna.scores[a].score >= 0 && p.dna.scores[a].score <= 100), a);
  // KDA без смертей = K + A
  const solo = buildProfile([ds[1]], { n: 10, assets });
  assert.equal(solo.kpi.kda, 1 + 5);
});

test('подробности матча: покупки отделены от способностей, путь и карта только при проверке', () => {
  const assets = { heroes: slimHeroes(HEROES), items: slimItems(ITEMS), map: slimMap(MAP) };
  const d = buildDigest(makeMeta({ id: 1, start: 1000 }), ME);
  const m = buildMatchDetail(d, { assets });
  assert.deepEqual(m.shop.map((x) => x.id), [1548066885, 619484391]);
  assert.deepEqual(m.abilities.map((x) => [x.id, x.step]), [[3760705623, 1], [3760705623, 2], [249410288, 1]]);
  assert.equal(m.positions.path, null);
  assert.equal(m.positions.usable, false);
  assert.equal(m.map.radius, R);
  const noMap = buildMatchDetail(d, { assets: { ...assets, map: slimMap({ ...MAP, neutral_camps: [] }) } });
  assert.equal(noMap.map, null);
  // Без справочника: запасное правило, источник помечен.
  const raw = buildMatchDetail(d, { assets: null });
  assert.ok(raw.shop.every((x) => x.source === 'heuristic'));
  assert.equal(indexFromSlim(null), null);
});

/* ---------- Синхронизация (поддельный API) ---------- */
function fakeApi() {
  const api = {
    history: [
      { match_id: 105, start_time: 9500, match_duration_s: 0, game_mode: 1, match_mode: 4 },           // не завершён
      { match_id: 104, start_time: 9000, match_duration_s: 1800, game_mode: 1, match_mode: 4 },
      { match_id: 103, start_time: 7000, match_duration_s: 700, game_mode: 4, match_mode: 1 },          // Street Brawl
      { match_id: 102, start_time: 5000, match_duration_s: 1800, game_mode: 1, match_mode: 1 },
      { match_id: 101, start_time: 1000, match_duration_s: 1800, game_mode: 1, match_mode: 4 },
    ],
    etag: '"h1"',
    metaStatus: {},        // matchId -> HTTP-статус вместо метаданных
    historyStatus: null,   // например 503
    calls: [],
  };
  api.fetch = async (url, init = {}) => {
    const u = new URL(url);
    api.calls.push(u.pathname);
    const json = (o, h = {}) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json', ...h } });
    if (u.pathname.endsWith('/match-history')) {
      if (api.historyStatus) return new Response('down', { status: api.historyStatus });
      if (init.headers && init.headers['if-none-match'] === api.etag) return new Response(null, { status: 304 });
      return json(api.history, { etag: api.etag });
    }
    if (u.pathname.endsWith('/assets/heroes')) return json(HEROES, { etag: '"hh"' });
    if (u.pathname.endsWith('/assets/items')) return json(ITEMS, { etag: '"ii"' });
    if (u.pathname.endsWith('/assets/map')) return json(MAP);
    if (u.pathname.endsWith('/steam')) return json({ account_id: ME, personaname: 'kkuzya', avatarfull: 'https://avatars.steamstatic.com/x_full.jpg', profileurl: 'https://steamcommunity.com/profiles/76561199560928611/' });
    const m = u.pathname.match(/\/matches\/(\d+)\/metadata$/);
    if (m) {
      const id = Number(m[1]);
      if (api.metaStatus[id]) return new Response('nf', { status: api.metaStatus[id] });
      const row = api.history.find((r) => r.match_id === id);
      return json(makeMeta({ id, start: row.start_time, T: row.match_duration_s, gameMode: row.game_mode, won: id % 2 === 0 }));
    }
    return new Response('nf', { status: 404 });
  };
  return api;
}

const runSync = (api, store, nowMs) => syncOnce({ client: new ApiClient({ fetchImpl: api.fetch, delayMs: 0, retries: 0 }), store, accountId: ME, api: 'https://x.test', nickname: 'kkuzya', now: () => nowMs });

test('синхронизация: первый проход — профили, Street Brawl и незавершённый матч не входят', async () => {
  const api = fakeApi(), store = new MemoryStore();
  const st = await runSync(api, store, 1_000_000);
  assert.equal(st.ok, true); assert.equal(st.stale, false); assert.equal(st.matches, 3);
  assert.deepEqual(st.skipped.map((s) => [s.matchId, s.kind]), [[103, 'mode']]);
  const p10 = store.readPublic('profile-10'), p5 = store.readPublic('profile-5');
  assert.deepEqual(p10.matches.map((m) => m.matchId), [104, 102, 101]);
  assert.equal(p5.available, 3);
  assert.equal(p10.player.name, 'kkuzya'); assert.equal(p10.player.steamId64, '76561199560928611');
  assert.ok(p10.player.avatar.startsWith('https://avatars.steamstatic.com/'));
  assert.ok(store.readPublic('matches/104'));
  assert.ok(store.has(`digests/v${DIGEST_SCHEMA}-104`));
  assert.ok(!api.calls.some((c) => c.includes('/matches/103/')), 'метаданные Brawl не запрашиваются');
  assert.ok(!api.calls.some((c) => c.includes('/matches/105/')), 'незавершённый матч не запрашивается');
});

test('синхронизация: повторный проход — 304 по ETag, сводки и справочники из кеша', async () => {
  const api = fakeApi(), store = new MemoryStore();
  await runSync(api, store, 1_000_000);
  api.calls.length = 0;
  const st = await runSync(api, store, 1_000_000 + 5 * 60_000);
  assert.equal(st.ok, true);
  assert.equal(st.steps.history, 'без изменений (304)');
  assert.deepEqual(api.calls, ['/v1/players/1600662883/match-history']);
  assert.equal(st.dataVersion, store.readPublic('status').dataVersion);
  // Через час справочники обновляются.
  api.calls.length = 0;
  await runSync(api, store, 1_000_000 + 61 * 60_000);
  assert.ok(api.calls.some((c) => c.endsWith('/assets/items')));
});

test('синхронизация: метаданных ещё нет (404) — матч ждёт с растущей паузой, затем загружается', async () => {
  const api = fakeApi(), store = new MemoryStore();
  api.metaStatus[104] = 404;
  let st = await runSync(api, store, 1_000_000);
  assert.equal(st.ok, true);
  assert.deepEqual(st.pending.map((p) => [p.matchId, p.attempts]), [[104, 1]]);
  assert.equal(st.pending[0].nextTryAt, 1_000_000 + retryDelayMs(1));
  assert.equal(st.errors.length, 0, '404 для свежего матча — ожидаемо, не ошибка');
  assert.deepEqual(store.readPublic('profile-10').matches.map((m) => m.matchId), [102, 101]);
  // Раньше срока повтора — не запрашивается.
  api.calls.length = 0;
  st = await runSync(api, store, 1_000_000 + 60_000);
  assert.ok(!api.calls.some((c) => c.includes('/matches/104/')));
  // После срока — появляется.
  delete api.metaStatus[104];
  st = await runSync(api, store, 1_000_000 + retryDelayMs(1) + 1);
  assert.equal(st.pending.length, 0);
  assert.deepEqual(store.readPublic('profile-10').matches.map((m) => m.matchId), [104, 102, 101]);
  assert.deepEqual([retryDelayMs(1), retryDelayMs(3), retryDelayMs(10)], [2 * 60_000, 8 * 60_000, 60 * 60_000]);
});

test('синхронизация: метаданные недоступны больше 12 часов — матч помечается, профиль строится без него', async () => {
  const api = fakeApi(), store = new MemoryStore();
  api.metaStatus[104] = 500;
  let st = await runSync(api, store, 0);
  assert.equal(st.errors.some((e) => e.step === 'metadata'), true, '5xx — это ошибка, в отличие от 404');
  st = await runSync(api, store, 12 * 3600_000 + 2 * 3600_000);
  assert.deepEqual(st.skipped.find((s) => s.matchId === 104)?.kind, 'failed');
  assert.deepEqual(store.readPublic('profile-10').matches.map((m) => m.matchId), [102, 101]);
});

test('синхронизация: API недоступен (503) — показывается последний кеш, статус честно устаревший', async () => {
  const api = fakeApi(), store = new MemoryStore();
  const first = await runSync(api, store, 1_000_000);
  api.historyStatus = 503;
  const st = await runSync(api, store, 2_000_000);
  assert.equal(st.ok, false); assert.equal(st.stale, true);
  assert.equal(st.lastSuccessAt, first.lastSuccessAt);
  assert.match(st.errors[0].error, /HTTP 503/);
  assert.equal(store.readPublic('profile-10').matches.length, 3, 'профиль из кеша на месте');
  // Совсем без кеша — профиль не появляется, статус объясняет почему.
  const empty = new MemoryStore();
  const st2 = await runSync(api, empty, 1);
  assert.equal(st2.ok, false); assert.equal(empty.readPublic('profile-10'), null); assert.ok(st2.message);
});

test('синхронизация: старая версия не перезаписывает профили, собранные более новой логикой', async () => {
  const api = fakeApi(), store = new MemoryStore();
  await runSync(api, store, 1_000_000);
  const before = store.readPublic('profile-10');
  store.publish('status', { ...store.readPublic('status'), profileLogic: 999, dataVersion: 'newer' });
  store.publish('profile-10', { ...before, marker: 'newer' });
  const st = await runSync(api, store, 2_000_000);
  assert.equal(st.skippedPublish, true);
  assert.equal(store.readPublic('profile-10').marker, 'newer');
  assert.equal(store.readPublic('status').dataVersion, 'newer');
});

test('синхронизация: ответ 429 с Retry-After повторяется и не ломает проход', async () => {
  const api = fakeApi(), store = new MemoryStore();
  let first = true;
  const fetchImpl = async (url, init) => {
    if (first && url.endsWith('/match-history')) { first = false; return new Response('slow', { status: 429, headers: { 'retry-after': '0' } }); }
    return api.fetch(url, init);
  };
  const st = await syncOnce({ client: new ApiClient({ fetchImpl, delayMs: 0, retries: 1 }), store, accountId: ME, api: 'https://x.test', now: () => 1 });
  assert.equal(st.ok, true); assert.equal(st.matches, 3);
});

/* ---------- Сервер ---------- */
test('сервер: отдаёт данные, не выпускает за пределы папки, SPA-маршруты ведут на сайт', async () => {
  const port = 4300 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, [path.join(HERE, '..', 'server', 'serve.mjs'), '--no-sync'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('сервер не запустился')), 8000);
      child.stdout.on('data', (b) => { if (String(b).includes('KKUZYA.GG:')) { clearTimeout(t); res(); } });
    });
    const base = `http://127.0.0.1:${port}`;
    for (const bad of ['/data/..%2Fcache%2Fstate.json', '/data/../cache/state.json', '/data/%2e%2e/%2e%2e/package.json']) {
      const r = await fetch(base + bad);
      assert.ok([400, 404].includes(r.status), `${bad} -> ${r.status}`);
      const body = await r.text();
      assert.ok(!body.includes('historyEtag') && !body.includes('"name"'), `${bad}: утечка файла`);
    }
    const post = await fetch(`${base}/data/status.json`, { method: 'POST' });
    assert.equal(post.status, 405);
    const spa = await fetch(`${base}/lab`);
    assert.ok([200, 503].includes(spa.status));   // 503 — если сайт ещё не собран
  } finally { child.kill(); }
});

/* ---------- Публикация на Cloudflare Pages: только при видимых изменениях ---------- */
const { fingerprint, visibleStatus, decide, commit, policyFromEnv, ledgerFromPublic, DEFAULT_POLICY } = await import('../lib/publish.js');
const { preparePages } = await import('../tools/prepare-pages.mjs');
const { runGate } = await import('../tools/publish-gate.mjs');
const { FileStore } = await import('../server/store.js');
const os = await import('node:os');

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 23, 12, 0, 0);
const okStatus = (extra = {}) => ({ ok: true, stale: false, lastAttemptAt: 1, finishedAt: 2, lastSuccessAt: 3, apiRequests: 1, steps: { history: '304' }, dataVersion: 'v', errors: [], pending: [], ...extra });
const pack = (extra = {}) => new Map(Object.entries({
  'index.html': Buffer.from('<html>'), 'assets/app-1.js': Buffer.from('js'),
  'data/profile-10.json': Buffer.from(JSON.stringify({ generatedAt: 1, matches: [{ matchId: 1 }] })),
  'data/status.json': Buffer.from(JSON.stringify(okStatus())), ...extra,
}));

test('публикация: время синхронизации, ETag, steps и generatedAt не меняют отпечаток', () => {
  const v = visibleStatus(okStatus(), 0);
  const a = fingerprint(pack(), v);
  const b = fingerprint(pack({
    'data/status.json': Buffer.from(JSON.stringify(okStatus({ lastAttemptAt: 99, finishedAt: 99, lastSuccessAt: 99, apiRequests: 7, steps: { history: 'получена' }, dataVersion: 'other', pending: [{ matchId: 5 }] }))),
    'data/profile-10.json': Buffer.from(JSON.stringify({ generatedAt: 999, matches: [{ matchId: 1 }] })),
    'data/publish.json': Buffer.from('{"x":1}'),
  }), visibleStatus(okStatus({ lastSuccessAt: 99 }), 0));
  assert.equal(a, b);
  assert.notEqual(a, fingerprint(pack({ 'data/profile-10.json': Buffer.from(JSON.stringify({ generatedAt: 1, matches: [{ matchId: 2 }] })) }), v), 'новый матч — изменение');
  assert.notEqual(a, fingerprint(pack({ 'data/matches/2.json': Buffer.from('{}') }), v), 'новый файл матча — изменение');
  assert.notEqual(a, fingerprint(pack({ 'assets/app-2.js': Buffer.from('js2') }), v), 'новая версия сайта — изменение');
});

test('публикация: без изменений пропускается, отпечаток фиксируется только после успешной публикации', () => {
  let r = decide({ ledger: null, status: okStatus(), files: pack(), nowMs: T0 });
  assert.equal(r.deploy, true); assert.equal(r.reason, 'changed');
  // Публикация не удалась (commit не вызван) — в следующем проходе снова пробуем.
  r = decide({ ledger: r.ledger, status: okStatus(), files: pack(), nowMs: T0 + 15 * 60_000 });
  assert.equal(r.deploy, true); assert.equal(r.ledger.dayCount, 2, 'неудачная попытка тоже засчитана в лимит');
  let l = commit(r.ledger, T0 + 15 * 60_000);
  for (let i = 2; i < 20; i++) {
    r = decide({ ledger: l, status: okStatus({ lastAttemptAt: i }), files: pack(), nowMs: T0 + i * 15 * 60_000 });
    assert.equal(r.deploy, false); assert.equal(r.reason, 'unchanged'); l = r.ledger;
  }
  assert.equal(l.dayCount, 2);
  // Через сутки без изменений — одна контрольная публикация.
  r = decide({ ledger: l, status: okStatus(), files: pack(), nowMs: T0 + 15 * 60_000 + 24 * HOUR });
  assert.equal(r.reason, 'heartbeat'); assert.equal(r.deploy, true);
});

test('публикация: одиночный сбой API не публикуется, второй подряд — публикуется, восстановление — тоже', () => {
  let l = commit(decide({ ledger: null, status: okStatus(), files: pack(), nowMs: T0 }).ledger, T0);
  const down = okStatus({ ok: false, stale: true, errors: [{ step: 'history', code: 'request', error: 'история: HTTP 503' }] });
  let r = decide({ ledger: l, status: down, files: pack(), nowMs: T0 + 15 * 60_000 });
  assert.equal(r.deploy, false); assert.equal(r.visible.health, 'ok'); l = r.ledger;
  r = decide({ ledger: l, status: down, files: pack(), nowMs: T0 + 30 * 60_000 });
  assert.equal(r.deploy, true); assert.equal(r.visible.health, 'stale'); l = commit(r.ledger, T0 + 30 * 60_000);
  r = decide({ ledger: l, status: { ...down, errors: [{ step: 'history', code: 'request', error: 'история: HTTP 502' }] }, files: pack(), nowMs: T0 + 45 * 60_000 });
  assert.equal(r.deploy, false, 'другой текст той же ошибки — не повод публиковать'); l = r.ledger;
  r = decide({ ledger: l, status: okStatus(), files: pack(), nowMs: T0 + 60 * 60_000 });
  assert.equal(r.deploy, true); assert.equal(r.visible.health, 'ok');
});

test('публикация: лимиты в сутки и в месяц нельзя превысить даже вручную; новый месяц — новый счёт', () => {
  const policy = { ...DEFAULT_POLICY, maxPerDay: 2, maxPerMonth: 3 };
  let l = null, n = 0;
  for (let i = 0; i < 5; i++) {
    const r = decide({ ledger: l, status: okStatus(), files: pack({ 'data/matches/x.json': Buffer.from(String(i)) }), nowMs: T0 + i * 60_000, policy, force: true });
    if (r.deploy) { n++; l = commit(r.ledger, T0); } else { assert.equal(r.reason, 'limit_day'); l = r.ledger; }
  }
  assert.equal(n, 2);
  let r = decide({ ledger: l, status: okStatus(), files: pack({ 'data/matches/x.json': Buffer.from('a') }), nowMs: T0 + 24 * HOUR, policy });
  assert.equal(r.deploy, true); l = commit(r.ledger, T0 + 24 * HOUR);
  r = decide({ ledger: l, status: okStatus(), files: pack({ 'data/matches/x.json': Buffer.from('b') }), nowMs: T0 + 48 * HOUR, policy });
  assert.equal(r.deploy, false); assert.equal(r.reason, 'limit_month');
  r = decide({ ledger: r.ledger, status: okStatus(), files: pack({ 'data/matches/x.json': Buffer.from('b') }), nowMs: Date.UTC(2026, 11, 1, 0, 5), policy });
  assert.equal(r.deploy, true, '1 декабря счёт обнулён'); assert.equal(r.ledger.monthCount, 1);
  // Без токена публикация не выполняется и не тратит лимит.
  r = decide({ ledger: null, status: okStatus(), files: pack(), nowMs: T0, canDeploy: false });
  assert.equal(r.reason, 'no_token'); assert.equal(r.ledger.monthCount, 0);
  // Переменные окружения не могут поднять лимит выше бесплатного запаса.
  assert.equal(policyFromEnv({ KK_DEPLOY_MAX_MONTH: '5000', KK_DEPLOY_MAX_DAY: '999' }).maxPerMonth, 450);
  assert.equal(policyFromEnv({ KK_DEPLOY_MAX_DAY: '999' }).maxPerDay, 100);
  assert.equal(policyFromEnv({}).maxPerMonth, 300);
  assert.equal(ledgerFromPublic({ schema: 99 }), null);
});

test('публикация целиком: синхронизация → пакет → решение; потеря кеша Actions — данные и журнал восстанавливаются', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kk-pub-'));
  try {
    const dist = path.join(tmp, 'dist');
    fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>KKUZYA.GG</title>');
    fs.writeFileSync(path.join(dist, 'assets', 'index-abc.js'), 'console.log(1)');
    const out = path.join(tmp, 'dist-pages');
    const quiet = () => {};
    const site = new Map();   // «опубликованный сайт»: путь -> содержимое
    const deployIfNeeded = async (store, nowMs, extraEnv = {}) => {
      preparePages({ dist, data: store.publicDir, out });
      const g = await runGate({ cmd: 'decide', distPages: out, store, env: { KK_SITE_URL: 'https://kk.test', ...extraEnv }, nowMs, log: quiet,
        fetchImpl: async (u) => (site.has(new URL(u).pathname) ? new Response(site.get(new URL(u).pathname), { status: 200 }) : new Response('nf', { status: 404 })) });
      if (g.deploy) {
        site.clear();
        for (const [rel, buf] of (await import('../tools/publish-gate.mjs')).readTree(out)) site.set(`/${rel}`, buf.toString('utf8'));
        await runGate({ cmd: 'commit', store, nowMs, log: quiet });
      }
      return g;
    };

    const api = fakeApi();
    let store = new FileStore(path.join(tmp, 'data'));
    await runSync(api, store, T0);
    let g = await deployIfNeeded(store, T0);
    assert.equal(g.deploy, true); assert.equal(g.reason, 'changed');
    const pub = JSON.parse(site.get('/data/status.json'));
    assert.equal(pub.publish.mode, 'on-change'); assert.equal(pub.publish.heartbeatHours, 24);
    assert.ok(site.has('/data/publish.json') && site.has('/data/matches/104.json') && !site.has('/data/matches/103.json'));

    // 15 минут спустя: API ответил 304, ничего не изменилось — публикации нет.
    await runSync(api, store, T0 + 15 * 60_000);
    g = await deployIfNeeded(store, T0 + 15 * 60_000);
    assert.equal(g.deploy, false); assert.equal(g.reason, 'unchanged');

    // Новый матч — публикация.
    api.history.unshift({ match_id: 106, start_time: 9900, match_duration_s: 1800, game_mode: 1, match_mode: 4 });
    api.etag = '"h2"';
    await runSync(api, store, T0 + 30 * 60_000);
    g = await deployIfNeeded(store, T0 + 30 * 60_000);
    assert.equal(g.deploy, true); assert.ok(site.has('/data/matches/106.json'));

    // Кеш GitHub Actions потерян: пустая папка data. Данные заново загружаются из API,
    // журнал публикаций восстанавливается с сайта — повторной публикации того же содержимого нет.
    fs.rmSync(path.join(tmp, 'data'), { recursive: true, force: true });
    store = new FileStore(path.join(tmp, 'data'));
    const st = await runSync(api, store, T0 + 45 * 60_000);
    assert.equal(st.ok, true); assert.equal(st.matches, 4);
    g = await deployIfNeeded(store, T0 + 45 * 60_000);
    assert.equal(g.ledger.recoveredFrom, 'site');
    assert.equal(g.deploy, false, 'то же содержимое после восстановления не публикуется');
    assert.equal(g.ledger.monthCount, 2, 'счётчик публикаций взят с сайта, а не обнулён');

    // Потерян и кеш, и API недоступен: пакет не собирается, опубликованный сайт остаётся как был.
    fs.rmSync(path.join(tmp, 'data'), { recursive: true, force: true });
    store = new FileStore(path.join(tmp, 'data'));
    api.historyStatus = 503;
    const down = await runSync(api, store, T0 + 60 * 60_000);
    assert.equal(down.ok, false);
    assert.throws(() => preparePages({ dist, data: store.publicDir, out }), /profile-10/);
    assert.ok(site.has('/data/profile-10.json'));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

/* ---------- Реальный матч ---------- */
const FIX = process.env.FIXTURE;
const real = FIX && fs.existsSync(FIX) ? JSON.parse(fs.readFileSync(FIX, 'utf8')) : null;
const realTest = (name, fn) => test(name, async () => { if (!real) { skipped++; passed--; return; } await fn(); });

realTest('реальный матч: события совпадают с итогами, координаты в пределах карты', () => {
  const d = buildDigest(real, ME, { keepPath: true });
  assert.equal(d.killEvents.length, d.totals.kills);
  assert.equal(d.deathEvents.length, d.totals.deaths);
  for (const e of [...d.killEvents.map((x) => x.pos), ...d.deathEvents.map((x) => x.pos)]) {
    assert.ok(e && Math.abs(e[0]) <= R && Math.abs(e[1]) <= R, `координата ${e}`);
  }
  assert.ok(d.killEvents.every((e) => e.victimHero != null));
  assert.equal(d.path, null, 'путь kkuzya в этом матче ненадёжен — не сохраняется');
});

realTest('реальный матч: надёжный путь (слот 5) сохраняется с шагом 5 с и лежит в пределах карты', () => {
  const acc = real.match_info.players.find((p) => p.player_slot === 5).account_id;
  const d = buildDigest(real, acc, { keepPath: true });
  assert.ok(d.path);
  assert.equal(d.path.stepS, 5);
  assert.equal(d.path.x.length, Math.ceil(d.durationS / 5));
  assert.ok(d.path.x.every((x) => Math.abs(x) <= R) && d.path.y.every((y) => Math.abs(y) <= R));
  assert.ok(JSON.stringify(d).length < 60000, 'сводка с путём компактна');
  const m = buildMatchDetail(d, { assets: { map: slimMap(MAP) } });
  assert.ok(m.positions.path);
});

realTest('реальный матч: коды причин соответствуют проверенным текстам digest.js', async () => {
  const { positionsReasonCode, eligibilityCode } = await import('../lib/profile.js');
  const d = buildDigest(real, ME);
  assert.deepEqual(positionsReasonCode(d.positions.unusableReason), { code: 'path_mismatch' });
  const acc = real.match_info.players.find((p) => p.player_slot === 5).account_id;
  assert.deepEqual(positionsReasonCode(buildDigest(real, acc).positions.unusableReason).code, 'few_reliable');
  assert.equal(eligibilityCode('короче 10 мин'), 'short');
  assert.equal(eligibilityCode('игрок покинул матч'), 'abandoned');
});

realTest('реальный матч: профиль строится, способности не путаются с покупками', () => {
  const d = buildDigest(real, ME);
  const p = buildProfile([d], { n: 10 });
  assert.equal(p.available, 1);
  assert.equal(p.builds.shopPurchases, 19);
  assert.equal(p.builds.abilityUpgrades, 15);
  assert.equal(p.matches[0].mode.matchLabel, 'Рейтинговый');
  assert.equal(p.matches[0].positions.usable, false);
});

for (const [name, fn] of tests) {
  try { await fn(); passed++; console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n    ', e.message); }
}
console.log(`\n${passed} прошло, ${failed} упало, ${skipped} пропущено${real ? '' : ' (нет FIXTURE: тесты на реальном матче пропущены)'}`);
process.exit(failed ? 1 : 0);
