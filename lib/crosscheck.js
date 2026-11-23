// Сверка строки истории матчей с метаданными того же матча.
// Нужна, чтобы понять, можно ли показывать список матчей, победы и KDA только по истории (она лёгкая).

export function compareHistory(raw, d) {
  if (!raw) return null;
  const num = (v) => (v == null ? null : Number(v));
  return {
    matchId: d.matchId,
    heroOk: num(raw.hero_id) === num(d.heroId),
    kdaOk: num(raw.player_kills) === d.totals.kills && num(raw.player_deaths) === d.totals.deaths && num(raw.player_assists) === d.totals.assists,
    durOk: raw.match_duration_s != null && Math.abs(Number(raw.match_duration_s) - d.durationS) <= 2,
    netWorthOk: raw.net_worth != null ? num(raw.net_worth) === d.totals.netWorth : null,
    playerTeam: raw.player_team ?? null,
    matchResult: raw.match_result ?? null,
    outcome: raw.player_match_outcome ?? null,
    wonMeta: d.won,
    gameMode: raw.game_mode ?? null,
    matchMode: raw.match_mode ?? null,
    abandoned: raw.abandoned_time_s ?? null,
  };
}

/** Какое правило определения победы по истории совпадает с метаданными. */
export function winRules(rows) {
  const have = rows.filter((r) => r && r.wonMeta != null);
  const test = (fn) => have.filter((r) => fn(r) === r.wonMeta).length;
  return {
    total: have.length,
    'match_result === player_team': test((r) => r.matchResult === r.playerTeam),
    'match_result !== player_team': test((r) => r.matchResult !== r.playerTeam),
    'player_match_outcome === 1': test((r) => r.outcome === 1),
    'player_match_outcome === 2 (поражение)': test((r) => r.outcome !== 2),
  };
}

export function countBy(rows, key) {
  const m = new Map();
  for (const r of rows) m.set(String(r[key]), (m.get(String(r[key])) || 0) + 1);
  return [...m.entries()].map(([k, v]) => `${k}×${v}`).join(', ');
}
