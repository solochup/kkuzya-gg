// Предварительные показатели и усреднение по матчам. Это НЕ официальные рейтинги игры.
// Правила:
//  - каждый признак сравнивается с остальными 11 игроками того же матча (процентиль 0..100);
//  - показатели матчей усредняются с весом по длительности (минуты), а не поровну;
//  - короткие матчи (< minMinutes) и матчи с выходом игрока из игры в показатели не входят;
//  - признаки по позициям используются только если время путей сошлось со смертями (positionsUsable).
import { pctRank, mean, round } from './util.js';
import { positionsUsable } from './digest.js';

// [признак, знак]; знак -1 означает «чем меньше, тем лучше».
export const COMPONENTS = {
  aggression: [['killsPerMin', 1], ['takenPerMin', 1], ['enemyShare', 1]],
  farming: [['creepsPerMin', 1], ['goldCreepsPerMin', 1]],
  teamplay: [['assistsPerMin', 1], ['allyShare', 1]],
  survivability: [['deathsPerMin', -1], ['deadShare', -1]],
  damage: [['dmgPerMin', 1], ['dmgPer1000', 1], ['accuracy', 1]],
};
const POSITIONAL = new Set(['allyShare', 'enemyShare']);

export function matchScores(d) {
  const usePos = positionsUsable(d);
  const me = d.lobby.find((l) => l.me);
  const out = {};
  for (const [comp, parts] of Object.entries(COMPONENTS)) {
    const vals = {};
    for (const [feat, sign] of parts) {
      if (POSITIONAL.has(feat) && !usePos) continue;
      const pr = pctRank(me.f[feat], d.lobby.map((l) => l.f[feat]));
      if (pr == null) continue;
      vals[feat] = sign > 0 ? pr : 100 - pr;
    }
    const v = Object.values(vals);
    out[comp] = { score: v.length ? mean(v) : null, parts: vals };
  }
  return out;
}

export function eligibility(d, minMinutes = 10) {
  if (d.durationS < minMinutes * 60) return `короче ${minMinutes} мин`;
  if (d.abandonS > 0) return 'игрок покинул матч';
  return null;
}

const wmean = (pairs) => {
  let sw = 0, s = 0;
  for (const [v, w] of pairs) if (v != null && Number.isFinite(v)) { s += v * w; sw += w; }
  return sw ? s / sw : null;
};

export function aggregateScores(digests, { minMinutes = 10 } = {}) {
  const used = [], excluded = [];
  for (const d of digests) {
    const why = eligibility(d, minMinutes);
    if (why) excluded.push({ matchId: d.matchId, reason: why }); else used.push(d);
  }
  const per = used.map((d) => ({ d, w: d.durationS / 60, s: matchScores(d) }));
  const scores = {};
  for (const [comp, parts] of Object.entries(COMPONENTS)) {
    const partsAgg = {};
    for (const [feat] of parts) {
      partsAgg[feat] = round(wmean(per.map((p) => [p.s[comp].parts[feat], p.w])), 0);
    }
    scores[comp] = {
      score: round(wmean(per.map((p) => [p.s[comp].score, p.w])), 0),
      parts: partsAgg,
      matchesWithScore: per.filter((p) => p.s[comp].score != null).length,
    };
  }
  const posMatches = used.filter(positionsUsable).length;
  // Простые суммы по времени: Σ показателя / Σ минут (а не среднее средних).
  const mins = used.reduce((s, d) => s + d.durationS / 60, 0);
  const sum = (f) => used.reduce((s, d) => s + f(d), 0);
  const raw = mins ? {
    dmgPerMin: sum((d) => d.totals.playerDamage) / mins,
    creepsPerMin: sum((d) => d.totals.creepKills + d.totals.neutralKills) / mins,
    goldCreepsPerMin: sum((d) => d.totals.goldCreeps) / mins,
    killsPerMin: sum((d) => d.totals.kills) / mins,
    assistsPerMin: sum((d) => d.totals.assists) / mins,
    deathsPerMin: sum((d) => d.totals.deaths) / mins,
    kda: sum((d) => d.totals.deaths) ? (sum((d) => d.totals.kills) + sum((d) => d.totals.assists)) / sum((d) => d.totals.deaths) : null,
    creepEfficiency: sum((d) => d.totals.possibleCreeps) ? sum((d) => d.totals.creepKills) / sum((d) => d.totals.possibleCreeps) : null,
  } : null;
  return { used: used.length, excluded, scores, raw, minutes: mins, positionMatches: posMatches };
}

/**
 * Таймлайн по 5-минутным корзинам (по умолчанию).
 * В минуту m матч учитывается только если эта минута ПОЛНОСТЬЮ прошла в матче и покрыта снимками.
 * Числа считаются как Σ / Σ (по всем включённым минутам), n = сколько матчей участвовало.
 * Урон, крипы и полученный урон известны только по окнам снимков (3 мин до 15-й минуты, затем 5 мин):
 * внутри окна они распределены равномерно. Убийства, смерти и позиции точные (по секундам).
 */
export function aggregateTimeline(digests, bucketMin = 5) {
  const maxM = Math.max(0, ...digests.map((d) => d.minutes.cover.length));
  const buckets = [];
  for (let b = 0; b * bucketMin < maxM; b++) {
    const from = b * bucketMin, to = (b + 1) * bucketMin;
    const acc = { matches: new Set(), posMatches: new Set(), minutes: 0, posMinutes: 0, dmg: 0, creeps: 0, taken: 0, kills: 0, deaths: 0, alive: 0, ally: 0, enemy: 0, combat: 0 };
    for (const d of digests) {
      const mm = d.minutes, usePos = positionsUsable(d) && mm.alive;
      for (let m = from; m < to && m < mm.cover.length; m++) {
        if (mm.cover[m] < 60 || mm.snapCover[m] < 60) continue;
        acc.matches.add(d.matchId); acc.minutes++;
        acc.dmg += mm.damage[m]; acc.creeps += mm.creeps[m]; acc.taken += mm.taken[m];
        acc.kills += mm.kills[m]; acc.deaths += mm.deaths[m];
        if (usePos) {
          acc.posMatches.add(d.matchId); acc.posMinutes++;
          acc.alive += mm.alive[m]; acc.ally += mm.ally[m]; acc.enemy += mm.enemy[m]; acc.combat += mm.combat[m];
        }
      }
    }
    if (!acc.minutes) continue;
    buckets.push({
      from, to, n: acc.matches.size, nPos: acc.posMatches.size, minutes: acc.minutes,
      dmgPerMin: acc.dmg / acc.minutes, creepsPerMin: acc.creeps / acc.minutes, takenPerMin: acc.taken / acc.minutes,
      killsPer10: (acc.kills / acc.minutes) * 10, deathsPer10: (acc.deaths / acc.minutes) * 10,
      allyShare: acc.alive ? acc.ally / acc.alive : null, enemyShare: acc.alive ? acc.enemy / acc.alive : null,
      combatShare: acc.alive ? acc.combat / acc.alive : null,
    });
  }
  return buckets;
}
