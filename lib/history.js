// Разбор ответа истории матчей. Формат ответа не подтверждён, поэтому поиск полей гибкий,
// а в отчёт попадает список реально найденных полей.
import { toUnixSeconds } from './util.js';

const ID_KEYS = ['match_id', 'matchId', 'id'];
const START_KEYS = ['start_time', 'start_time_s', 'startTime', 'started_at', 'created_at'];
const DUR_KEYS = ['duration_s', 'match_duration_s', 'duration'];
const HERO_KEYS = ['hero_id', 'heroId'];

const pick = (o, keys) => {
  for (const k of keys) if (o && o[k] != null) return { key: k, value: o[k] };
  return { key: null, value: null };
};

/** Находит массив записей в ответе (сам массив или первый массив объектов внутри объекта). */
export function extractList(json) {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    for (const k of ['matches', 'history', 'data', 'results', 'items']) {
      if (Array.isArray(json[k])) return json[k];
    }
    for (const v of Object.values(json)) {
      if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v;
    }
  }
  return null;
}

export function parseHistory(json) {
  const list = extractList(json);
  if (!list) return { ok: false, error: 'в ответе не найден список матчей', topKeys: json && typeof json === 'object' ? Object.keys(json).slice(0, 20) : [] };
  const first = list.find((x) => x && typeof x === 'object') || null;
  const fields = { id: null, start: null, duration: null, hero: null };
  const rows = [];
  const seen = new Set();
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const id = pick(r, ID_KEYS), st = pick(r, START_KEYS), du = pick(r, DUR_KEYS), he = pick(r, HERO_KEYS);
    fields.id ||= id.key; fields.start ||= st.key; fields.duration ||= du.key; fields.hero ||= he.key;
    const matchId = id.value == null || id.value === '' ? NaN : Number(id.value);
    if (!Number.isFinite(matchId) || matchId <= 0 || seen.has(matchId)) continue;
    seen.add(matchId);
    rows.push({
      raw: r,
      matchId,
      startTime: toUnixSeconds(st.value),
      durationS: Number.isFinite(Number(du.value)) ? Number(du.value) : null,
      heroId: he.value != null ? Number(he.value) : null,
    });
  }
  rows.sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0));
  return {
    ok: rows.length > 0,
    error: rows.length ? null : 'список пуст или без match_id',
    total: list.length,
    rows,
    fields,
    firstRecordKeys: first ? Object.keys(first) : [],
  };
}
