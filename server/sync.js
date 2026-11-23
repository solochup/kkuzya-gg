// Синхронизация данных KKUZYA.GG: история -> новые матчи -> сводки -> готовые профили для сайта.
// Тяжёлые метаданные (1–1,5 МБ на матч) обрабатываются только здесь; в браузер уходят готовые JSON.
// Правила:
//  - история опрашивается с If-None-Match (ETag), справочники — не чаще раза в час, Steam-профиль — раз в 6 часов;
//  - сводка матча строится один раз и хранится всегда (метаданные матча не меняются);
//  - если метаданных ещё нет (матч только закончился) или API ответил ошибкой, матч ждёт повтора
//    с растущей паузой (2, 4, 8 … 60 мин); через 12 часов ожидания он помечается недоступным;
//  - при любой ошибке API сайт продолжает показывать последний удачный профиль, а status.json
//    честно сообщает возраст данных и причину.
import { parseHistory } from '../lib/history.js';
import { buildDigest } from '../lib/digest.js';
import { slimHeroes, slimItems, slimMap, slimNames } from '../lib/assets-slim.js';
import { buildProfile, buildMatchDetail } from '../lib/profile.js';
import { describeMode, isNormalMatch } from '../lib/modes.js';
import { STEAM_BASE } from '../lib/util.js';

/** Версия формата сводки. Меняется при изменении buildDigest: тогда сводки пересобираются (новые запросы метаданных). */
export const DIGEST_SCHEMA = 2;
/** Версия логики профиля (profile.js, modes.js). Меняется — профили пересобираются из сохранённых сводок, без запросов к API. */
export const PROFILE_LOGIC = 3;
export const VIEWS = [5, 10];
const MIN = 60_000;
export const ASSETS_MAX_AGE_MS = 60 * MIN;
export const STEAM_MAX_AGE_MS = 6 * 60 * MIN;
export const PENDING_GIVE_UP_MS = 12 * 60 * MIN;
const MAX_NEW_FETCHES = 12;      // за один проход, чтобы не нагружать API
const SCAN_EXTRA = 15;           // сколько лишних строк истории просматривать сверх N

const HISTORY_KEEP = ['match_id', 'hero_id', 'start_time', 'match_duration_s', 'game_mode', 'match_mode', 'player_team', 'match_result', 'player_kills', 'player_deaths', 'player_assists', 'net_worth', 'last_hits', 'abandoned_time_s'];

export function retryDelayMs(attempts) {
  return Math.min(60, 2 ** Math.max(1, attempts)) * MIN;
}

function slimHistoryRows(rows, limit = 120) {
  return rows.slice(0, limit).map((r) => Object.fromEntries(HISTORY_KEEP.filter((k) => k in r.raw).map((k) => [k, r.raw[k]])));
}

/**
 * Один проход синхронизации. Никогда не бросает исключение из-за API: ошибки попадают в status.
 * deps: { client: ApiClient, store, accountId, api, nickname, now(): мс, log(строка) }
 */
export async function syncOnce({ client, store, accountId, api = 'https://api.deadlock-api.com', nickname = null, now = () => Date.now(), log = () => {}, maxMatches = 10 }) {
  const t0 = now();
  const prev = store.readPublic('status') || {};
  const state = store.get('state') || { historyEtag: null, pending: {}, failed: {}, assets: {}, steam: null };
  state.pending ||= {}; state.failed ||= {}; state.assets ||= {};
  const errors = [];
  const steps = {};

  // 1. История матчей (лёгкий запрос с ETag).
  const histUrl = `${api}/v1/players/${accountId}/match-history`;
  let history = store.get('history');
  const hr = await client.getJson(histUrl, { label: 'история', headers: state.historyEtag && history ? { 'if-none-match': state.historyEtag } : {} });
  let historyOk = false;
  if (hr.ok && hr.notModified) { historyOk = true; steps.history = 'без изменений (304)'; }
  else if (hr.ok) {
    const h = parseHistory(hr.json);
    if (h.ok) {
      history = { fetchedAt: now(), total: h.total, rows: slimHistoryRows(h.rows) };
      store.put('history', history);
      state.historyEtag = hr.entry && hr.entry.headers.etag ? hr.entry.headers.etag : null;
      historyOk = true; steps.history = `получена, записей ${h.total}`;
    } else errors.push({ step: 'history', code: 'format', error: `история не разобрана: ${h.error}`, detail: h.error });
  } else errors.push({ step: 'history', code: 'request', error: `история: ${hr.error}`, detail: hr.error, status: hr.status ?? null });
  if (historyOk && history) { history.checkedAt = now(); store.put('history', history); }

  // 2. Справочники (раз в час, с ETag).
  const assets = store.get('assets') || { heroes: null, items: null, map: null };
  // heroesRu/itemsRu — официальная русская локализация названий из того же справочника (?language=russian).
  const ASSET_DEFS = [
    ['heroes', `${api}/v1/assets/heroes`, slimHeroes],
    ['items', `${api}/v1/assets/items`, slimItems],
    ['map', `${api}/v1/assets/map`, slimMap],
    ['heroesRu', `${api}/v1/assets/heroes?language=russian`, (j) => (assets.heroes ? slimNames(j, assets.heroes) : null)],
    ['itemsRu', `${api}/v1/assets/items?language=russian`, (j) => (assets.items ? slimNames(j, assets.items) : null)],
  ];
  let assetsChanged = false;
  for (const [key, url, slim] of ASSET_DEFS) {
    const meta = state.assets[key] || {};
    if (assets[key] && meta.fetchedAt && now() - meta.fetchedAt < ASSETS_MAX_AGE_MS) continue;
    const r = await client.getJson(url, { label: `справочник ${key}`, timeoutMs: 60000, headers: meta.etag && assets[key] ? { 'if-none-match': meta.etag } : {} });
    if (r.ok && r.notModified) { state.assets[key] = { ...meta, fetchedAt: now() }; steps[key] = '304'; continue; }
    const value = r.ok ? slim(r.json) : null;
    if (value) {
      assets[key] = value; assetsChanged = true;
      state.assets[key] = { fetchedAt: now(), etag: r.entry && r.entry.headers.etag ? r.entry.headers.etag : null, version: now() };
      steps[key] = 'обновлён';
    } else errors.push({ step: 'assets', asset: key, code: r.ok ? 'format' : 'request', error: `справочник ${key}: ${r.ok ? 'неожиданный формат' : r.error}`, detail: r.ok ? null : r.error, status: r.status ?? null });
  }
  if (assetsChanged) store.put('assets', assets);

  // 3. Steam-профиль (имя и аватар) из /v1/players/{id}/steam.
  let steam = store.get('steam');
  if (!steam || !state.steam || now() - state.steam.fetchedAt >= STEAM_MAX_AGE_MS) {
    const r = await client.getJson(`${api}/v1/players/${accountId}/steam`, { label: 'steam-профиль' });
    const j = r.ok ? (Array.isArray(r.json) ? r.json[0] : r.json) : null;
    if (j && Number(j.account_id) === accountId) {
      steam = { personaname: j.personaname ?? null, avatar: j.avatarfull ?? j.avatarmedium ?? j.avatar ?? null, avatarSmall: j.avatarmedium ?? j.avatar ?? null, profileUrl: j.profileurl ?? null };
      store.put('steam', steam); state.steam = { fetchedAt: now() };
    } else if (!r.ok) errors.push({ step: 'steam', code: 'request', error: `steam-профиль: ${r.error}`, detail: r.error, status: r.status ?? null });
  }

  if (!history || !history.rows) {
    const status = { ...prev, lastAttemptAt: t0, finishedAt: now(), ok: false, stale: !!prev.lastSuccessAt, errors, steps, message: 'Нет ни свежей, ни сохранённой истории матчей.', messageCode: 'no_history' };
    store.put('state', state); store.publish('status', status);
    return status;
  }

  // 4. Матчи: последние N обычных (6×6), каждая сводка строится один раз.
  const rows = history.rows.filter((r) => Number(r.match_duration_s) > 0);
  const skipped = [];
  const digests = [];
  let fetched = 0;
  const pendingNow = [];
  // state.failed[id]: { code, detail, reason } (раньше — строка; поддерживается при чтении).
  const failedEntry = (id, start) => {
    const f = state.failed[id];
    const o = typeof f === 'string' ? { code: 'failed', detail: f, reason: f } : f;
    return { matchId: id, start, reason: o.reason, kind: 'failed', code: o.code, detail: o.detail ?? null };
  };
  const modeEntry = (id, start, gm, mm) => ({ matchId: id, start, reason: describeMode(gm, mm).gameLabel, kind: 'mode', gameMode: gm ?? null, matchMode: mm ?? null });
  for (const r of rows.slice(0, maxMatches + SCAN_EXTRA)) {
    if (digests.length >= maxMatches) break;
    const id = Number(r.match_id);
    if (!isNormalMatch(r.game_mode)) { skipped.push(modeEntry(id, r.start_time, r.game_mode, r.match_mode)); continue; }
    if (state.failed[id]) { skipped.push(failedEntry(id, r.start_time)); continue; }
    const key = `digests/v${DIGEST_SCHEMA}-${id}`;
    let d = store.get(key);
    if (!d) {
      const p = state.pending[id];
      if (p && p.nextTryAt > now()) { pendingNow.push({ matchId: id, start: r.start_time, attempts: p.attempts, nextTryAt: p.nextTryAt, lastError: p.lastError }); continue; }
      if (fetched >= MAX_NEW_FETCHES) { pendingNow.push({ matchId: id, start: r.start_time, attempts: p ? p.attempts : 0, nextTryAt: now(), lastError: 'отложено до следующего прохода' }); continue; }
      fetched++;
      log(`метаданные ${id}…`);
      const mr = await client.getJson(`${api}/v1/matches/${id}/metadata`, { label: `метаданные ${id}`, timeoutMs: 60000 });
      if (mr.ok && mr.json) {
        const built = buildDigest(mr.json, accountId, { keepPath: true });
        if (built.error) { state.failed[id] = { code: 'digest_failed', detail: built.error, reason: `сводка не построена: ${built.error}` }; delete state.pending[id]; skipped.push(failedEntry(id, r.start_time)); continue; }
        d = built; store.put(key, d); delete state.pending[id];
      } else {
        const first = p ? p.firstSeenAt : now();
        const attempts = (p ? p.attempts : 0) + 1;
        if (now() - first > PENDING_GIVE_UP_MS) {
          state.failed[id] = { code: 'meta_unavailable', detail: mr.error, reason: `метаданные недоступны больше 12 ч (${mr.error})` }; delete state.pending[id];
          skipped.push(failedEntry(id, r.start_time));
        } else {
          state.pending[id] = { firstSeenAt: first, attempts, nextTryAt: now() + retryDelayMs(attempts), lastError: mr.error };
          pendingNow.push({ matchId: id, start: r.start_time, ...state.pending[id] });
          if (mr.status !== 404) errors.push({ step: 'metadata', matchId: id, code: 'request', error: `метаданные ${id}: ${mr.error}`, detail: mr.error, status: mr.status ?? null });
        }
        continue;
      }
    }
    // Двойная проверка режима по метаданным.
    if (d.modes && d.modes.gameMode != null && !isNormalMatch(d.modes.gameMode)) { skipped.push(modeEntry(id, r.start_time, d.modes.gameMode, d.modes.matchMode)); continue; }
    digests.push(d);
  }
  steps.matches = `сводок ${digests.length}, новых запросов метаданных ${fetched}, ожидают ${pendingNow.length}`;

  // 5. Профили и подробности матчей.
  const steamId64 = String(BigInt(accountId) + STEAM_BASE);
  const player = {
    accountId, steamId64,
    name: (steam && steam.personaname) || nickname || String(accountId),
    nickname: nickname || null,
    avatar: steam ? steam.avatar : null, avatarSmall: steam ? steam.avatarSmall : null,
    profileUrl: steam ? steam.profileUrl : `https://steamcommunity.com/profiles/${steamId64}/`,
    avatarSource: steam && steam.avatar ? '/v1/players/{id}/steam' : null,
  };
  const generatedAt = now();
  const dataVersion = [`p${PROFILE_LOGIC}`, digests.map((d) => d.matchId).join(','), ...['heroes', 'items', 'map', 'heroesRu', 'itemsRu'].map((k) => (state.assets[k] && state.assets[k].version) || 0), steam ? steam.personaname : ''].join('|');
  const oldest = digests.length ? Math.min(...digests.map((d) => d.startTime)) : 0;
  const visibleSkipped = skipped.filter((s) => (s.start ?? 0) >= oldest);
  // Защита от «отката»: если данные уже опубликованы более новой версией логики (например, старый
  // экземпляр сайта ещё работает рядом с обновлённым), старая версия их не перезаписывает.
  const newerPublished = Number(prev.profileLogic) > PROFILE_LOGIC;
  if (newerPublished) steps.profiles = `пропущено: данные собраны более новой версией (логика ${prev.profileLogic}), перезапусти сайт`;
  if (!newerPublished && (dataVersion !== prev.dataVersion || !store.readPublic('profile-10'))) {
    for (const n of VIEWS) {
      const used = digests.slice(0, n);
      const cut = used.length ? Math.min(...used.map((d) => d.startTime)) : 0;
      store.publish(`profile-${n}`, buildProfile(used, { n, player, assets, generatedAt, skipped: skipped.filter((s) => (s.start ?? 0) >= cut) }));
    }
    for (const d of digests) store.publish(`matches/${d.matchId}`, buildMatchDetail(d, { assets }));
  }

  const ok = historyOk;
  if (newerPublished) { store.put('state', state); return { ...prev, steps, skippedPublish: true }; }
  const status = {
    schema: 1,
    profileLogic: PROFILE_LOGIC,
    lastAttemptAt: t0,
    finishedAt: now(),
    ok,
    stale: !ok,
    lastSuccessAt: ok ? now() : prev.lastSuccessAt ?? null,
    historyCheckedAt: history.checkedAt ?? history.fetchedAt ?? null,
    dataVersion: dataVersion !== prev.dataVersion ? dataVersion : prev.dataVersion,
    dataChangedAt: dataVersion !== prev.dataVersion ? generatedAt : prev.dataChangedAt ?? generatedAt,
    newestMatchStart: digests.length ? digests[0].startTime : null,
    matches: digests.length,
    pending: pendingNow,
    skipped: visibleSkipped,
    errors,
    steps,
    apiRequests: client.log.length,
  };
  store.put('state', state);
  store.publish('status', status);
  return status;
}
