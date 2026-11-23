// Сжатие метаданных матча (1,2 МБ) в компактную сводку (около 15-25 КБ) для одного игрока.
// Чистая функция без ввода-вывода: подходит для Cloudflare Functions.
import { num, median } from './util.js';

export const SNAP_FIELDS = [
  'net_worth', 'level', 'kills', 'deaths', 'assists', 'creep_kills', 'neutral_kills', 'possible_creeps',
  'player_damage', 'player_damage_taken', 'player_healing', 'boss_damage',
  'gold_lane_creep', 'gold_neutral_creep', 'shots_hit', 'shots_missed', 'hero_bullets_hit',
];

/** Радиус «рядом» в игровых единицах. ПРЕДВАРИТЕЛЬНОЕ значение, не из документации. */
export const NEAR_RADIUS = 1500;

/**
 * Накопительный счётчик из нерегулярных снимков -> значение по каждой минуте матча.
 * Прирост окна равномерно размазывается по минутам окна (внутри окна реального распределения нет).
 */
export function spreadWindows(snaps, field, T) {
  const M = Math.ceil(T / 60);
  const out = new Array(M).fill(0);
  let t0 = 0, v0 = 0;
  for (const s of snaps) {
    const t1 = Math.min(num(s.t), T);
    const v1 = num(s[field]);
    const len = t1 - t0;
    if (len <= 0) continue;
    const delta = Math.max(0, v1 - v0);
    const first = Math.floor(t0 / 60);
    const last = Math.min(M - 1, Math.floor((t1 - 1e-9) / 60));
    for (let m = first; m <= last; m++) {
      const ov = Math.min(t1, (m + 1) * 60) - Math.max(t0, m * 60);
      if (ov > 0) out[m] += (delta * ov) / len;
    }
    t0 = t1; v0 = v1;
  }
  return out;
}

function perMinuteEvents(times, M) {
  const out = new Array(M).fill(0);
  for (const t of times) {
    const m = Math.floor(t / 60);
    if (m >= 0 && m < M) out[m]++;
  }
  return out;
}

function buildPaths(mi) {
  const mp = mi.match_paths;
  if (!mp || !Array.isArray(mp.paths)) return null;
  const resX = num(mp.x_resolution) || 16383, resY = num(mp.y_resolution) || resX;
  const P = new Map();
  for (const pa of mp.paths) {
    if (!pa || !Array.isArray(pa.x_pos) || !Array.isArray(pa.y_pos) || !Array.isArray(pa.health)) continue;
    const n = Math.min(pa.x_pos.length, pa.y_pos.length, pa.health.length);
    const wx = new Float32Array(n), wy = new Float32Array(n);
    const kx = (pa.x_max - pa.x_min) / resX, ky = (pa.y_max - pa.y_min) / resY;
    for (let i = 0; i < n; i++) { wx[i] = pa.x_min + pa.x_pos[i] * kx; wy[i] = pa.y_min + pa.y_pos[i] * ky; }
    P.set(pa.player_slot, { n, wx, wy, health: pa.health, combat: Array.isArray(pa.combat_type) ? pa.combat_type : [] });
  }
  return P.size >= 2 ? P : null;
}

// ---- Калибровка времени путей ----
// Факт из реальных матчей: путь игрока растянут относительно игрового времени (его длина в точках
// не равна длительности матча, а смещение растёт по ходу матча). Опорные точки: момент смерти в
// death_details и момент, когда в пути здоровье падает с >0 до 0. Между опорными точками время
// переводится линейно. Проверка идёт «без подглядывания»: каждая опорная точка по очереди убирается
// и предсказывается по остальным.
const PAIR_SEARCH_S = 90;
const LOO_TOLERANCE_S = 3;

function zeroCrossings(health) {
  const z = [];
  for (let i = 1; i < health.length; i++) if (health[i - 1] > 0 && health[i] === 0) z.push(i);
  return z;
}

function pairDeaths(deaths, zeros, n, T) {
  const used = new Set(), pairs = [];
  for (const t of deaths) {
    const prior = (t * n) / T;
    let best = -1, bd = Infinity;
    for (let k = 0; k < zeros.length; k++) {
      if (used.has(k)) continue;
      const dd = Math.abs(zeros[k] - prior);
      if (dd < bd) { bd = dd; best = k; }
    }
    if (best >= 0 && bd <= PAIR_SEARCH_S) { used.add(best); pairs.push([t, zeros[best]]); }
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const mono = [];
  for (const pr of pairs) if (!mono.length || pr[1] > mono[mono.length - 1][1]) mono.push(pr);
  return mono;
}

export function interpolate(anchors, t) {
  const a = anchors;
  if (t <= a[0][0]) return a[0][1] + (t - a[0][0]);
  const last = a[a.length - 1];
  if (t >= last[0]) return last[1] + (t - last[0]);
  for (let i = 1; i < a.length; i++) {
    if (t <= a[i][0]) {
      const [t0, z0] = a[i - 1], [t1, z1] = a[i];
      return t1 === t0 ? z0 : z0 + ((z1 - z0) * (t - t0)) / (t1 - t0);
    }
  }
  return last[1];
}

/** Для каждого игрока: индексы пути по секундам игры и оценка надёжности. */
function calibrate(P, players, T) {
  const info = new Map();
  for (const p of players) {
    const pa = P.get(p.player_slot);
    if (!pa) continue;
    const deaths = (p.death_details || []).map((d) => d.game_time_s).filter(Number.isFinite);
    const pairs = pairDeaths(deaths, zeroCrossings(pa.health), pa.n, T);
    const anchors = [[0, 0], ...pairs, [T, pa.n]];
    let checked = 0, ok = 0;
    for (let k = 0; k < pairs.length; k++) {
      const without = [[0, 0], ...pairs.filter((_, j) => j !== k), [T, pa.n]];
      checked++;
      if (Math.abs(interpolate(without, pairs[k][0]) - pairs[k][1]) <= LOO_TOLERANCE_S) ok++;
    }
    const idx = new Int32Array(T);
    for (let s = 0; s < T; s++) idx[s] = Math.max(0, Math.min(pa.n - 1, Math.round(interpolate(anchors, s))));
    pa.idx = idx;
    const lenMinusT = pa.n - T;
    // Надёжен: либо проверка по смертям >= 80%, либо мало смертей для проверки, но путь почти равен матчу.
    const reliable = checked >= 2 ? ok / checked >= 0.8 : Math.abs(lenMinusT) <= 30;
    info.set(p.player_slot, { slot: p.player_slot, lenMinusT, anchors: pairs.length, checked, within3: ok, reliable });
  }
  return info;
}

/** Для каждого игрока: сколько секунд жив, рядом с союзником, рядом с врагом, в бою; по минутам. Ненадёжные пути пропускаются. */
function proximity(P, T, teamBySlot, radius, reliableSlots) {
  const M = Math.ceil(T / 60), R2 = radius * radius;
  const acc = new Map();
  for (const slot of P.keys()) {
    acc.set(slot, { alive: 0, ally: 0, enemy: 0, combat: 0, min: { alive: new Array(M).fill(0), ally: new Array(M).fill(0), enemy: new Array(M).fill(0), combat: new Array(M).fill(0) } });
  }
  const slots = [...P.keys()].filter((s) => reliableSlots.has(s));
  for (let s = 0; s < T; s++) {
    const m = (s / 60) | 0;
    for (const a of slots) {
      const pa = P.get(a), ia = pa.idx[s];
      if (!(pa.health[ia] > 0)) continue;
      let ally = false, enemy = false;
      for (const b of slots) {
        if (b === a || (ally && enemy)) continue;
        const pb = P.get(b), ib = pb.idx[s];
        if (!(pb.health[ib] > 0)) continue;
        const dx = pa.wx[ia] - pb.wx[ib], dy = pa.wy[ia] - pb.wy[ib];
        if (dx * dx + dy * dy <= R2) { if (teamBySlot.get(b) === teamBySlot.get(a)) ally = true; else enemy = true; }
      }
      const r = acc.get(a);
      r.alive++; r.min.alive[m]++;
      if (ally) { r.ally++; r.min.ally[m]++; }
      if (enemy) { r.enemy++; r.min.enemy[m]++; }
      if (pa.combat[ia] > 0) { r.combat++; r.min.combat[m]++; }
    }
  }
  return acc;
}

const lastStat = (p) => (Array.isArray(p.stats) && p.stats.length ? p.stats[p.stats.length - 1] : null);

function totalsOf(p, T) {
  const L = lastStat(p) || {};
  const deadSeconds = (p.death_details || []).reduce((s, d) => s + num(d.death_duration_s), 0);
  const hit = num(L.shots_hit), miss = num(L.shots_missed);
  return {
    kills: num(p.kills), deaths: num(p.deaths), assists: num(p.assists),
    netWorth: num(L.net_worth ?? p.net_worth), level: num(L.level ?? p.level),
    lastHits: num(p.last_hits), denies: num(p.denies),
    creepKills: num(L.creep_kills), neutralKills: num(L.neutral_kills), possibleCreeps: num(L.possible_creeps),
    playerDamage: num(L.player_damage), damageTaken: num(L.player_damage_taken),
    healing: num(L.player_healing), bossDamage: num(L.boss_damage),
    goldCreeps: num(L.gold_lane_creep) + num(L.gold_neutral_creep),
    shotsHit: hit, shotsMissed: miss, accuracy: hit + miss > 0 ? hit / (hit + miss) : null,
    deadSeconds, deadShare: T > 0 ? deadSeconds / T : null,
    // Способ убийства из последнего снимка (поля есть в stats; null, если поля нет).
    bulletKills: L.bullet_kills ?? null, meleeKills: L.melee_kills ?? null,
    abilityKills: L.ability_kills ?? null, headshotKills: L.headshot_kills ?? null,
  };
}

/** Координаты события {x,y,z} -> [x, y] (целые игровые единицы) или null. */
const xy = (p) => (p && Number.isFinite(p.x) && Number.isFinite(p.y) ? [Math.round(p.x), Math.round(p.y)] : null);

/** Сколько секунд между точками сохранённого пути игрока (опция keepPath). */
export const PATH_STEP_S = 5;

/**
 * Главная функция. meta: ответ /v1/matches/{id}/metadata. accountId: число.
 * Возвращает сводку или { error }.
 * keepPath: сохранить откалиброванный путь игрока (точка раз в PATH_STEP_S с) — только если путь надёжен.
 */
export function buildDigest(meta, accountId, { radius = NEAR_RADIUS, keepPath = false } = {}) {
  const mi = meta && meta.match_info;
  if (!mi || !Array.isArray(mi.players) || !mi.players.length) return { error: 'нет match_info.players' };
  const T = num(mi.duration_s);
  if (!(T > 0)) return { error: 'нет duration_s (матч не завершён?)' };
  const players = mi.players;
  const me = players.find((p) => Number(p.account_id) === accountId);
  if (!me) return { error: 'игрока нет в этом матче' };

  const warnings = [];
  const M = Math.ceil(T / 60);
  const teamBySlot = new Map(players.map((p) => [p.player_slot, p.team]));
  const heroBySlot = new Map(players.map((p) => [p.player_slot, p.hero_id ?? null]));

  // Убийства выводятся из смертей противников (время смерти = время убийства).
  // Координаты берутся из death_details (позиция жертвы и убийцы в момент смерти), а не из путей.
  const killTimes = [];
  const killEvents = [];
  for (const v of players) {
    for (const d of v.death_details || []) {
      if (d.killer_player_slot === me.player_slot && teamBySlot.get(v.player_slot) !== me.team) {
        killTimes.push(d.game_time_s);
        killEvents.push({ t: d.game_time_s, victim: v.player_slot, victimHero: heroBySlot.get(v.player_slot) ?? null, pos: xy(d.death_pos), myPos: xy(d.killer_pos) });
      }
    }
  }
  killTimes.sort((a, b) => a - b);
  killEvents.sort((a, b) => a.t - b.t);
  const deathEvents = (me.death_details || []).map((d) => ({
    t: d.game_time_s, dur: d.death_duration_s, killer: d.killer_player_slot,
    killerHero: heroBySlot.get(d.killer_player_slot) ?? null,
    killerTeam: teamBySlot.has(d.killer_player_slot) ? teamBySlot.get(d.killer_player_slot) : null,
    pos: xy(d.death_pos), killerPos: xy(d.killer_pos),
  }));
  if (killTimes.length !== num(me.kills)) warnings.push(`убийств по смертям врагов ${killTimes.length}, в итогах ${num(me.kills)}`);
  if (deathEvents.length !== num(me.deaths)) warnings.push(`смертей по death_details ${deathEvents.length}, в итогах ${num(me.deaths)}`);

  // Снимки статистики.
  const snapshots = (Array.isArray(me.stats) ? me.stats : []).map((s) => {
    const o = { t: num(s.time_stamp_s) };
    for (const f of SNAP_FIELDS) o[f] = num(s[f]);
    return o;
  });
  if (!snapshots.length) warnings.push('нет снимков статистики по времени');
  const lastSnapT = snapshots.length ? Math.min(T, snapshots[snapshots.length - 1].t) : 0;

  // Позиции.
  const P = buildPaths(mi);
  let prox = null, calib = null, usable = false, unusableReason = null;
  const reliableSlots = new Set();
  if (P) {
    calib = calibrate(P, players, T);
    for (const c of calib.values()) if (c.reliable) reliableSlots.add(c.slot);
    prox = proximity(P, T, teamBySlot, radius, reliableSlots);
    const target = calib.get(me.player_slot);
    const othersOk = [...reliableSlots].filter((x) => x !== me.player_slot).length;
    usable = !!(target && target.reliable) && othersOk >= 8;
    if (!usable) unusableReason = !target ? 'нет пути игрока' : !target.reliable ? 'путь игрока не сходится со смертями' : `надёжны пути только ${othersOk} из 11 остальных игроков`;
  } else warnings.push('нет match_paths (позиции)');
  const posShare = (slot, key) => {
    if (!prox || !prox.get(slot) || !reliableSlots.has(slot)) return null;
    const r = prox.get(slot);
    return r.alive >= 60 ? r[key] / r.alive : null;
  };

  const lobby = players.map((p) => {
    const t = totalsOf(p, T), Tm = T / 60;
    return {
      slot: p.player_slot, team: p.team, me: p === me,
      f: {
        killsPerMin: t.kills / Tm, assistsPerMin: t.assists / Tm, deathsPerMin: t.deaths / Tm,
        takenPerMin: t.damageTaken / Tm, dmgPerMin: t.playerDamage / Tm,
        dmgPer1000: t.netWorth > 0 ? t.playerDamage / (t.netWorth / 1000) : null,
        creepsPerMin: (t.creepKills + t.neutralKills) / Tm, goldCreepsPerMin: t.goldCreeps / Tm,
        accuracy: t.accuracy, deadShare: t.deadShare,
        allyShare: posShare(p.player_slot, 'ally'), enemyShare: posShare(p.player_slot, 'enemy'),
      },
    };
  });

  const mine = prox ? prox.get(me.player_slot) : null;
  const cover = Array.from({ length: M }, (_, m) => Math.max(0, Math.min(60, T - m * 60)));
  const snapCover = Array.from({ length: M }, (_, m) => Math.max(0, Math.min(60, lastSnapT - m * 60)));
  const minutes = {
    cover, snapCover,
    kills: perMinuteEvents(killTimes, M),
    deaths: perMinuteEvents(deathEvents.map((d) => d.t), M),
    damage: spreadWindows(snapshots, 'player_damage', T),
    taken: spreadWindows(snapshots, 'player_damage_taken', T),
    creeps: spreadWindows(snapshots.map((s) => ({ ...s, cn: s.creep_kills + s.neutral_kills })), 'cn', T),
    alive: mine ? mine.min.alive : null, ally: mine ? mine.min.ally : null,
    enemy: mine ? mine.min.enemy : null, combat: mine ? mine.min.combat : null,
  };

  const items = (me.items || []).map((i) => ({
    t: num(i.game_time_s), id: i.item_id, up: i.upgrade_id, sold: num(i.sold_time_s), flags: num(i.flags), imb: num(i.imbued_ability_id),
  }));

  // Путь игрока для карты: только надёжный (сходится со смертями) и только по запросу.
  let path = null;
  if (keepPath && P && calib) {
    const target = calib.get(me.player_slot);
    const pa = P.get(me.player_slot);
    if (target && target.reliable && pa && pa.idx) {
      const x = [], y = [], alive = [];
      for (let s = 0; s < T; s += PATH_STEP_S) {
        const i = pa.idx[s];
        x.push(Math.round(pa.wx[i])); y.push(Math.round(pa.wy[i])); alive.push(pa.health[i] > 0 ? 1 : 0);
      }
      path = { stepS: PATH_STEP_S, x, y, alive };
    }
  }

  return {
    matchId: mi.match_id, startTime: mi.start_time, durationS: T, endTime: num(mi.start_time) + T,
    team: me.team, winningTeam: mi.winning_team ?? null,
    won: mi.winning_team == null ? null : me.team === mi.winning_team,
    heroId: me.hero_id, slot: me.player_slot, abandonS: num(me.abandon_match_time_s),
    modes: { gameMode: mi.game_mode ?? null, matchMode: mi.match_mode ?? null, rankedType: mi.ranked_type ?? null },
    buildId: meta.hero_build_ids ? meta.hero_build_ids[String(accountId)] ?? null : null,
    totals: totalsOf(me, T),
    snapshots, snapshotTimes: snapshots.map((s) => s.t),
    killTimes, deathEvents, items,
    killEvents,
    players: players.map((p) => ({ slot: p.player_slot, team: p.team, heroId: p.hero_id ?? null, me: p === me })),
    path,
    minutes, lobby,
    positions: P ? {
      players: P.size, usable, unusableReason, radius,
      target: calib.get(me.player_slot) || null,
      overall: (() => {
        let checked = 0, within3 = 0;
        for (const c of calib.values()) { checked += c.checked; within3 += c.within3; }
        return { checked, within3, share: checked ? within3 / checked : null };
      })(),
      unreliableSlots: [...calib.values()].filter((c) => !c.reliable).map((c) => `${c.slot} (длина пути ${c.lenMinusT >= 0 ? '+' : ''}${c.lenMinusT} с к матчу)`),
    } : null,
    counts: { players: players.length },
    warnings,
  };
}

/** Можно ли доверять признакам по позициям в этом матче. */
export function positionsUsable(d) {
  return !!(d.positions && d.positions.usable);
}
