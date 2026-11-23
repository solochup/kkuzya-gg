// Диагностика привязки времени путей (match_paths) к игровому времени.
// Идея: смерть игрока в death_details имеет точное время t. В путях это момент, когда health падает с >0 до 0.
// Разница между ними (offset) показывает, насколько путь сдвинут относительно игрового времени.
import { num, median } from './util.js';

export function pathDiagnostics(meta, accountId, { searchS = 150 } = {}) {
  const mi = meta && meta.match_info;
  if (!mi || !Array.isArray(mi.players)) return null;
  const T = num(mi.duration_s);
  const bySlot = new Map();
  for (const pa of (mi.match_paths && mi.match_paths.paths) || []) {
    if (pa && Array.isArray(pa.health)) bySlot.set(pa.player_slot, pa);
  }
  const perDeath = [];   // [слот, время смерти, сдвиг в секундах или null]
  const players = [];
  for (const p of mi.players) {
    const pa = bySlot.get(p.player_slot);
    if (!pa) continue;
    const h = pa.health, zeros = [];
    for (let i = 1; i < h.length; i++) if (h[i - 1] > 0 && h[i] === 0) zeros.push(i);
    const offs = [];
    for (const d of p.death_details || []) {
      const t = d.game_time_s;
      let best = null;
      for (const z of zeros) {
        const off = z - t;
        if (Math.abs(off) <= searchS && (best === null || Math.abs(off) < Math.abs(best))) best = off;
      }
      perDeath.push([p.player_slot, t, best]);
      if (best !== null) offs.push(best);
    }
    players.push({
      slot: p.player_slot, me: Number(p.account_id) === accountId,
      lenMinusT: h.length - T, zeroCrossings: zeros.length, deaths: (p.death_details || []).length,
      found: offs.length, medianOffset: median(offs),
    });
  }
  return { matchId: mi.match_id, durationS: T, players, perDeath };
}

/** Короткая сводка для отчёта. */
export function summarizeDiagnostics(diag) {
  if (!diag) return null;
  const n = diag.perDeath.length;
  const within = (s) => diag.perDeath.filter((x) => x[2] !== null && Math.abs(x[2]) <= s).length;
  const offs = diag.perDeath.map((x) => x[2]).filter((x) => x !== null);
  return {
    matchId: diag.matchId, deaths: n, within3: within(3), within15: within(15), foundAny: offs.length,
    medianOffset: median(offs),
    zeroVsDeaths: diag.players.reduce((s, p) => s + p.zeroCrossings, 0) + '/' + diag.players.reduce((s, p) => s + p.deaths, 0),
    longPaths: diag.players.filter((p) => Math.abs(p.lenMinusT) > 30).map((p) => `${p.slot}:${p.lenMinusT}`),
  };
}
