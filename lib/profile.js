// Профиль игрока для сайта KKUZYA.GG: агрегаты по последним N матчам и подробности матча.
// Чистые функции без ввода-вывода. Используют проверенные формулы metrics.js и классификацию items.js.
import { aggregateScores, aggregateTimeline, matchScores, eligibility, COMPONENTS } from './metrics.js';
import { finalKind, classificationReport } from './items.js';
import { positionsUsable } from './digest.js';
import { describeMode } from './modes.js';
import { round } from './util.js';

export const PROFILE_SCHEMA = 1;
export const DNA_AXES = Object.keys(COMPONENTS);   // aggression, farming, teamplay, survivability, damage
export const PHASES = [[0, 10, 'Ранняя игра'], [10, 20, 'Середина'], [20, 30, 'Поздняя'], [30, Infinity, '30+ мин']];

/** Индекс в формате items.js (Map id -> {type,...}) из компактного словаря предметов. */
export function indexFromSlim(slim) {
  if (!slim) return null;
  const map = new Map();
  for (const [id, a] of Object.entries(slim)) map.set(Number(id), { ...a, name: a.n });
  return { map, idKey: 'id', size: map.size, hits: null, sampleKeys: [] };
}

/**
 * Машинные коды причин (для перевода интерфейса). Тексты причин формируют проверенные digest.js/metrics.js,
 * их не меняем, а только сопоставляем с кодами.
 */
export function positionsReasonCode(reason) {
  if (!reason) return null;
  if (reason === 'нет пути игрока') return { code: 'no_path' };
  if (reason === 'путь игрока не сходится со смертями') return { code: 'path_mismatch' };
  const m = /надёжны пути только (\d+) из 11/.exec(reason);
  if (m) return { code: 'few_reliable', n: Number(m[1]) };
  if (reason === 'нет данных о позициях') return { code: 'no_data' };
  return { code: 'other', text: reason };
}
export function eligibilityCode(reason) {
  if (!reason) return null;
  if (/^короче \d+ мин$/.test(reason)) return 'short';
  if (reason === 'игрок покинул матч') return 'abandoned';
  return 'other';
}
const posReason = (d) => (d.positions ? d.positions.unusableReason : 'нет данных о позициях');

const csOf = (d) => d.totals.creepKills + d.totals.neutralKills;
const perMin = (v, d) => (d.durationS > 0 ? v / (d.durationS / 60) : null);
// KDA = (K + A) / D; при нуле смертей — K + A (общепринятое правило).
const kdaOf = (k, dth, a) => (dth > 0 ? (k + a) / dth : k + a);

function matchRow(d) {
  const t = d.totals;
  const why = eligibility(d);
  return {
    matchId: d.matchId, start: d.startTime, durationS: d.durationS,
    heroId: d.heroId, won: d.won, team: d.team,
    kills: t.kills, deaths: t.deaths, assists: t.assists,
    kda: round(kdaOf(t.kills, t.deaths, t.assists), 2),
    damage: t.playerDamage, dmgPerMin: round(perMin(t.playerDamage, d), 0),
    damageTaken: t.damageTaken, healing: t.healing,
    cs: csOf(d), csPerMin: round(perMin(csOf(d), d), 2),
    lastHits: t.lastHits, denies: t.denies,
    netWorth: t.netWorth, netWorthPerMin: round(perMin(t.netWorth, d), 0),
    level: t.level, accuracy: t.accuracy == null ? null : round(t.accuracy, 4),
    deadS: t.deadSeconds,
    mode: describeMode(d.modes && d.modes.gameMode, d.modes && d.modes.matchMode),
    dnaEligible: !why, dnaExcludedReason: why, dnaExcludedCode: eligibilityCode(why),
    positions: { usable: positionsUsable(d), reason: posReason(d), reasonCode: positionsUsable(d) ? null : positionsReasonCode(posReason(d)), share: d.positions && d.positions.overall ? d.positions.overall.share : null },
  };
}

function kpiOf(digests) {
  const n = digests.length;
  if (!n) return null;
  const sum = (f) => digests.reduce((s, d) => s + f(d), 0);
  const mins = sum((d) => d.durationS / 60);
  const known = digests.filter((d) => d.won != null);
  const wins = known.filter((d) => d.won).length;
  const K = sum((d) => d.totals.kills), D = sum((d) => d.totals.deaths), A = sum((d) => d.totals.assists);
  const hit = sum((d) => d.totals.shotsHit), miss = sum((d) => d.totals.shotsMissed);
  const possible = sum((d) => d.totals.possibleCreeps);
  return {
    matches: n, wins, losses: known.length - wins, unknownResult: n - known.length,
    winRate: known.length ? wins / known.length : null,
    kills: K, deaths: D, assists: A,
    killsAvg: K / n, deathsAvg: D / n, assistsAvg: A / n,
    kda: kdaOf(K, D, A),
    avgDurationS: sum((d) => d.durationS) / n,
    minutes: mins,
    dmgPerMin: mins ? sum((d) => d.totals.playerDamage) / mins : null,
    dmgTakenPerMin: mins ? sum((d) => d.totals.damageTaken) / mins : null,
    csPerMin: mins ? sum(csOf) / mins : null,
    netWorthPerMin: mins ? sum((d) => d.totals.netWorth) / mins : null,
    healingPerMin: mins ? sum((d) => d.totals.healing) / mins : null,
    lastHitsAvg: sum((d) => d.totals.lastHits) / n,
    accuracy: hit + miss > 0 ? hit / (hit + miss) : null,
    creepEfficiency: possible ? sum((d) => d.totals.creepKills) / possible : null,
    deadShare: mins ? sum((d) => d.totals.deadSeconds) / (mins * 60) : null,
  };
}

function heroesOf(digests) {
  const m = new Map();
  for (const d of digests) {
    const r = m.get(d.heroId) || { heroId: d.heroId, matches: 0, wins: 0, known: 0, kills: 0, deaths: 0, assists: 0, minutes: 0, damage: 0 };
    r.matches++; r.minutes += d.durationS / 60; r.damage += d.totals.playerDamage;
    if (d.won != null) { r.known++; if (d.won) r.wins++; }
    r.kills += d.totals.kills; r.deaths += d.totals.deaths; r.assists += d.totals.assists;
    m.set(d.heroId, r);
  }
  return [...m.values()]
    .map((r) => ({ heroId: r.heroId, matches: r.matches, wins: r.wins, winRate: r.known ? r.wins / r.known : null, kda: kdaOf(r.kills, r.deaths, r.assists), kills: r.kills, deaths: r.deaths, assists: r.assists, dmgPerMin: r.minutes ? r.damage / r.minutes : null }))
    .sort((a, b) => b.matches - a.matches || (b.winRate ?? 0) - (a.winRate ?? 0));
}

function trendOf(digests) {
  // Хронологически: от старого к новому.
  return [...digests].sort((a, b) => a.startTime - b.startTime).map((d) => {
    const why = eligibility(d);
    const s = why ? null : matchScores(d);
    const t = d.totals;
    return {
      matchId: d.matchId, start: d.startTime, heroId: d.heroId, won: d.won,
      dnaEligible: !why, dnaExcludedReason: why, dnaExcludedCode: eligibilityCode(why), positionsUsable: positionsUsable(d),
      dna: Object.fromEntries(DNA_AXES.map((k) => [k, s && s[k].score != null ? round(s[k].score, 0) : null])),
      dnaPositional: s ? { allyShare: s.teamplay.parts.allyShare ?? null, enemyShare: s.aggression.parts.enemyShare ?? null } : null,
      stats: {
        kda: round(kdaOf(t.kills, t.deaths, t.assists), 2), kills: t.kills, deaths: t.deaths, assists: t.assists,
        dmgPerMin: round(perMin(t.playerDamage, d), 0), csPerMin: round(perMin(csOf(d), d), 2),
        netWorthPerMin: round(perMin(t.netWorth, d), 0), accuracy: t.accuracy == null ? null : round(t.accuracy * 100, 1),
        durationMin: round(d.durationS / 60, 1),
      },
    };
  });
}

function combatOf(digests) {
  const maxM = Math.max(0, ...digests.map((d) => d.minutes.cover.length));
  const perMinute = [];
  for (let m = 0; m < maxM; m++) {
    let kills = 0, deaths = 0, matches = 0;
    for (const d of digests) {
      if (m >= d.minutes.cover.length) continue;
      matches++; kills += d.minutes.kills[m]; deaths += d.minutes.deaths[m];
    }
    perMinute.push({ m, kills, deaths, matches });
  }
  const phases = PHASES.map(([from, to, label]) => {
    let kills = 0, deaths = 0, seconds = 0;
    const ms = new Set();
    for (const d of digests) {
      for (let m = from; m < Math.min(to, d.minutes.cover.length); m++) {
        seconds += d.minutes.cover[m]; kills += d.minutes.kills[m]; deaths += d.minutes.deaths[m]; ms.add(d.matchId);
      }
    }
    const mins = seconds / 60;
    return { from, to: Number.isFinite(to) ? to : null, label, kills, deaths, minutes: round(mins, 1), matches: ms.size, killsPer10: mins ? (kills / mins) * 10 : null, deathsPer10: mins ? (deaths / mins) * 10 : null };
  }).filter((p) => p.matches > 0);
  const count = (arr) => {
    const m = new Map();
    for (const h of arr) if (h != null) m.set(h, (m.get(h) || 0) + 1);
    return [...m.entries()].map(([heroId, count]) => ({ heroId, count })).sort((a, b) => b.count - a.count);
  };
  const victims = count(digests.flatMap((d) => (d.killEvents || []).map((e) => e.victimHero)));
  // Смерти от врагов-героев; смерть без убийцы-героя (крипы, башня, падение) считается отдельно.
  const allDeaths = digests.flatMap((d) => (d.deathEvents || []).map((e) => ({ ...e, myTeam: d.team })));
  const byHero = allDeaths.filter((e) => e.killerHero != null && e.killerTeam != null && e.killerTeam !== e.myTeam);
  const killers = count(byHero.map((e) => e.killerHero));
  const kt = { bullet: 0, melee: 0, ability: 0, headshot: 0, matchesWithData: 0, kills: 0 };
  for (const d of digests) {
    if (d.totals.bulletKills == null) continue;
    kt.matchesWithData++; kt.kills += d.totals.kills;
    kt.bullet += d.totals.bulletKills ?? 0; kt.melee += d.totals.meleeKills ?? 0; kt.ability += d.totals.abilityKills ?? 0; kt.headshot += d.totals.headshotKills ?? 0;
  }
  const deadS = digests.reduce((s, d) => s + d.totals.deadSeconds, 0);
  const totalS = digests.reduce((s, d) => s + d.durationS, 0);
  const deathCount = allDeaths.length;
  return {
    perMinute, phases, victims, killers,
    deathsByNonHero: allDeaths.length - byHero.length,
    killTypes: kt.matchesWithData ? kt : null,
    dead: {
      seconds: deadS, share: totalS ? deadS / totalS : null, avgDeathS: deathCount ? deadS / deathCount : null, deaths: deathCount,
      perMatch: [...digests].sort((a, b) => a.startTime - b.startTime).map((d) => ({ matchId: d.matchId, deadS: d.totals.deadSeconds, share: d.totals.deadShare, deaths: d.totals.deaths })),
    },
  };
}

function buildsOf(digests, idx) {
  const n = digests.length;
  const per = new Map();
  const slots = { weapon: 0, spirit: 0, vitality: 0, unknown: 0 };
  let shopTotal = 0, abilityTotal = 0, unknownCost = 0;
  for (const d of digests) {
    const seen = new Map();
    for (const it of d.items) {
      const k = finalKind(it, idx);
      if (k.kind === 'shop') {
        shopTotal++;
        const a = k.asset;
        const slot = a && a.slot && slots[a.slot] != null ? a.slot : 'unknown';
        if (a && Number.isFinite(a.cost)) slots[slot] += a.cost; else unknownCost++;
        if (!seen.has(it.id)) seen.set(it.id, { t: it.t, sold: !!it.sold });
      } else if (k.kind === 'ability') abilityTotal++;
    }
    for (const [id, v] of seen) {
      const r = per.get(id) || { id, matches: 0, times: [], soldMatches: 0, matchIds: [] };
      r.matches++; r.times.push(v.t); if (v.sold) r.soldMatches++; r.matchIds.push(d.matchId);
      per.set(id, r);
    }
  }
  const items = [...per.values()].map((r) => ({
    id: r.id, matches: r.matches, share: n ? r.matches / n : 0,
    avgMin: r.times.reduce((s, x) => s + x, 0) / r.times.length / 60,
    soldMatches: r.soldMatches, matchIds: r.matchIds,
  })).sort((a, b) => b.matches - a.matches || a.avgMin - b.avgMin);
  const cls = classificationReport(digests, idx);
  return {
    items,
    slotSpend: Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, { total: v, perMatch: n ? v / n : 0 }])),
    unknownCostPurchases: unknownCost,
    shopPurchases: shopTotal, abilityUpgrades: abilityTotal,
    classification: { total: cls.total, found: cls.found, coverage: cls.coverage, agreement: cls.agreement, source: idx ? 'справочник /v1/assets/items' : 'запасное правило upgrade_id = 1', fromAssets: !!idx },
  };
}

/** Словари только для ID, которые реально встречаются (чтобы не тащить в браузер весь справочник). */
function dictFor(digests, assets) {
  const heroes = {}, items = {};
  const H = (assets && assets.heroes) || {}, I = (assets && assets.items) || {};
  // Официальные русские названия из справочника ?language=russian (только отличающиеся от оригинала).
  const HR = (assets && assets.heroesRu) || {}, IR = (assets && assets.itemsRu) || {};
  // Неизвестный герой: n = null, интерфейс сам подпишет «Герой #id» / «Hero #id».
  const addHero = (id) => { if (id != null && !heroes[id]) heroes[id] = H[id] ? { n: H[id].n, ...(HR[id] ? { ru: HR[id] } : {}), icon: H[id].icon, card: H[id].card } : { n: null, icon: null, card: null }; };
  for (const d of digests) {
    addHero(d.heroId);
    for (const p of d.players || []) addHero(p.heroId);
    for (const it of d.items) if (!items[it.id] && I[it.id]) items[it.id] = IR[it.id] ? { ...I[it.id], ru: IR[it.id] } : I[it.id];
  }
  return { heroes, items };
}

/**
 * Профиль по последним N подходящим матчам.
 * digests — сводки (buildDigest), уже отфильтрованные по режиму; берутся N самых новых.
 * context: { player, assets, requested, skipped: [{matchId, reason}], generatedAt }
 */
export function buildProfile(allDigests, { n = 10, player = null, assets = null, skipped = [], generatedAt = null } = {}) {
  const digests = [...allDigests].sort((a, b) => b.startTime - a.startTime).slice(0, n);
  const idx = indexFromSlim(assets && assets.items);
  const agg = aggregateScores(digests);
  return {
    schema: PROFILE_SCHEMA,
    generatedAt,
    n, available: digests.length,
    player,
    kpi: kpiOf(digests),
    dna: {
      axes: DNA_AXES,
      scores: agg.scores, used: agg.used, minutes: round(agg.minutes, 1),
      positionMatches: agg.positionMatches, excluded: agg.excluded.map((e) => ({ ...e, code: eligibilityCode(e.reason) })),
      method: 'Каждый признак сравнивается с остальными 11 игроками того же матча (процентиль 0–100), затем матчи усредняются с весом по длительности. Матчи короче 10 минут и с выходом из игры не учитываются. Признаки по позициям (рядом с союзником / врагом) учитываются только в матчах с надёжными путями.',
      components: COMPONENTS,
    },
    trend: trendOf(digests),
    heroes: heroesOf(digests),
    matches: digests.map(matchRow),
    combat: combatOf(digests),
    timeline: aggregateTimeline(digests, 5),
    builds: buildsOf(digests, idx),
    dict: dictFor(digests, assets),
    quality: {
      skipped,
      positions: digests.map((d) => ({ matchId: d.matchId, usable: positionsUsable(d), reason: posReason(d), reasonCode: positionsUsable(d) ? null : positionsReasonCode(posReason(d)) })),
      assets: { heroes: !!(assets && assets.heroes), items: !!(assets && assets.items), map: !!(assets && assets.map) },
    },
  };
}

/** Подробности одного матча для Performance Lab. */
export function buildMatchDetail(d, { assets = null } = {}) {
  const idx = indexFromSlim(assets && assets.items);
  const why = eligibility(d);
  const s = why ? null : matchScores(d);
  const shop = [], abilities = [];
  const level = new Map();
  for (const it of [...d.items].sort((a, b) => a.t - b.t)) {
    const k = finalKind(it, idx);
    if (k.kind === 'shop') shop.push({ t: it.t, id: it.id, sold: it.sold || 0, imbued: it.imb || 0, source: k.source });
    else if (k.kind === 'ability') {
      const lv = (level.get(it.id) || 0) + 1;
      level.set(it.id, lv);
      abilities.push({ t: it.t, id: it.id, step: lv, source: k.source });
    }
  }
  const me = d.lobby.find((l) => l.me);
  const usable = positionsUsable(d);
  const map = assets && assets.map;
  return {
    schema: PROFILE_SCHEMA,
    row: matchRow(d),
    snapshots: d.snapshots.map((x) => ({ t: x.t, netWorth: x.net_worth, damage: x.player_damage, taken: x.player_damage_taken, creeps: x.creep_kills + x.neutral_kills, level: x.level, kills: x.kills, deaths: x.deaths, assists: x.assists })),
    minutes: { kills: d.minutes.kills, deaths: d.minutes.deaths, cover: d.minutes.cover, alive: usable ? d.minutes.alive : null, ally: usable ? d.minutes.ally : null, enemy: usable ? d.minutes.enemy : null },
    killEvents: d.killEvents || [], deathEvents: d.deathEvents || [],
    players: d.players || [],
    shop, abilities,
    dna: s ? Object.fromEntries(DNA_AXES.map((k) => [k, { score: s[k].score == null ? null : round(s[k].score, 0), parts: Object.fromEntries(Object.entries(s[k].parts).map(([p, v]) => [p, round(v, 0)])) }])) : null,
    dnaExcludedReason: why, dnaExcludedCode: eligibilityCode(why),
    positions: {
      usable, reason: posReason(d), reasonCode: usable ? null : positionsReasonCode(posReason(d)),
      targetReliable: !!(d.positions && d.positions.target && d.positions.target.reliable),
      share: d.positions && d.positions.overall ? d.positions.overall.share : null,
      allyShare: usable && me ? me.f.allyShare : null, enemyShare: usable && me ? me.f.enemyShare : null,
      path: d.path && d.positions && d.positions.target && d.positions.target.reliable ? d.path : null,
    },
    map: map && map.transformOk ? { radius: map.radius, minimap: map.minimap } : null,
    dict: dictFor([d], assets),
  };
}
