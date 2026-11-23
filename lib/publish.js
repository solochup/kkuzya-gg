// Решение «публиковать ли сайт» для Cloudflare Pages. Чистые функции без сети и файлов: их проверяют тесты,
// а tools/publish-gate.mjs подаёт им файлы пакета dist-pages и журнал публикаций.
//
// Принципы:
//  - публикуем, только если изменилось то, что видит посетитель: файлы сайта, профили, подробности матчей
//    или состояние «данные актуальны / API недоступен»;
//  - время синхронизации, ETag, число запросов, steps и generatedAt на решение не влияют;
//  - сбой API в одном проходе не публикуется (может быть случайным), публикуется со второго прохода подряд;
//  - раз в heartbeatHours публикуем даже без изменений, чтобы возраст данных на сайте не врал
//    и остановка обновлений была видна посетителю;
//  - жёсткие лимиты публикаций в сутки и в месяц (UTC); лимит сильнее ручного запуска.
import crypto from 'node:crypto';

export const PUBLISH_SCHEMA = 1;
export const DEFAULT_POLICY = Object.freeze({
  checkEveryMin: 15,       // расписание GitHub Actions
  heartbeatHours: 24,      // публикация без изменений не чаще раза в сутки
  failStreakToPublish: 2,  // сколько проходов подряд API должен быть недоступен, чтобы показать это на сайте
  maxPerDay: 20,
  maxPerMonth: 300,        // с запасом от 500 сборок/мес Cloudflare Pages Free (учёт Direct Upload в лимите не описан)
});

const STATUS_FILE = 'data/status.json';
const PUBLISH_FILE = 'data/publish.json';
const PROFILE_RE = /^data\/profile-\d+\.json$/;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Полоса «здоровья», которую видит посетитель: ok | stale (с учётом защиты от случайного одиночного сбоя). */
export function visibleStatus(status, failStreak, policy = DEFAULT_POLICY) {
  const st = status || {};
  const failing = !st.ok || !!st.stale;
  const health = failing && failStreak >= policy.failStreakToPublish ? 'stale' : 'ok';
  const errorKinds = health === 'stale'
    ? [...new Set((st.errors || []).map((e) => `${e.step}:${e.code || 'error'}`))].sort()
    : [];
  return { health, messageCode: health === 'stale' ? st.messageCode ?? null : null, errorKinds };
}

/** Профиль без технических полей (generatedAt меняется при любой пересборке, даже без новых данных). */
function normalizeProfile(buf) {
  try { const p = JSON.parse(buf.toString('utf8')); delete p.generatedAt; return Buffer.from(JSON.stringify(p)); }
  catch { return buf; }
}

/**
 * Отпечаток видимого содержимого пакета.
 * files: Map<относительный путь с '/', Buffer>. status.json и publish.json заменяются видимым состоянием.
 */
export function fingerprint(files, visible) {
  const lines = [];
  for (const rel of [...files.keys()].sort()) {
    if (rel === STATUS_FILE || rel === PUBLISH_FILE) continue;
    const buf = PROFILE_RE.test(rel) ? normalizeProfile(files.get(rel)) : files.get(rel);
    lines.push(`${rel}\0${sha256(buf)}`);
  }
  lines.push(`status\0${JSON.stringify(visible)}`);
  return sha256(lines.join('\n'));
}

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const monthKey = (ms) => new Date(ms).toISOString().slice(0, 7);

export function emptyLedger() {
  return { schema: PUBLISH_SCHEMA, fingerprint: null, publishedAt: null, failStreak: 0, day: null, dayCount: 0, month: null, monthCount: 0, pending: null, recoveredFrom: null };
}

/** Журнал с обнулёнными счётчиками, если начались новые сутки / месяц (UTC). */
export function rollLedger(ledger, nowMs) {
  const l = { ...emptyLedger(), ...(ledger || {}) };
  const d = dayKey(nowMs), m = monthKey(nowMs);
  if (l.day !== d) { l.day = d; l.dayCount = 0; }
  if (l.month !== m) { l.month = m; l.monthCount = 0; }
  return l;
}

/**
 * Решение на один проход.
 * Возвращает { deploy, reason, ledger, visible, fp }: ledger — обновлённый журнал (сохраняется всегда).
 * reason: changed | heartbeat | forced | unchanged | limit_day | limit_month | no_token
 */
export function decide({ ledger, status, files, nowMs, policy = DEFAULT_POLICY, force = false, canDeploy = true }) {
  const l = rollLedger(ledger, nowMs);
  const failing = !status || !status.ok || !!status.stale;
  l.failStreak = failing ? (l.failStreak || 0) + 1 : 0;
  const visible = visibleStatus(status, l.failStreak, policy);
  const fp = fingerprint(files, visible);

  let reason;
  if (l.fingerprint !== fp) reason = 'changed';
  else if (!l.publishedAt || nowMs - l.publishedAt >= policy.heartbeatHours * 3_600_000) reason = 'heartbeat';
  else if (force) reason = 'forced';
  else reason = 'unchanged';

  let deploy = reason !== 'unchanged';
  if (deploy && l.monthCount >= policy.maxPerMonth) { deploy = false; reason = 'limit_month'; }
  else if (deploy && l.dayCount >= policy.maxPerDay) { deploy = false; reason = 'limit_day'; }
  else if (deploy && !canDeploy) { deploy = false; reason = 'no_token'; }

  if (deploy) {
    // Попытка считается сразу (даже неудачная загрузка могла засчитаться у Cloudflare),
    // а отпечаток фиксируется только после успешной публикации (commit).
    l.dayCount++; l.monthCount++;
    l.pending = { fingerprint: fp, at: nowMs, reason };
  } else l.pending = null;
  return { deploy, reason, ledger: l, visible, fp };
}

/** Публикация прошла успешно: фиксируем отпечаток. */
export function commit(ledger, nowMs) {
  const l = { ...emptyLedger(), ...(ledger || {}) };
  if (!l.pending) return l;
  l.fingerprint = l.pending.fingerprint;
  l.publishedAt = l.pending.at ?? nowMs;
  l.pending = null;
  return l;
}

/** Что кладём на сайт (data/publish.json): позволяет восстановить журнал, если кеш GitHub Actions потерян. */
export function publicLedger(ledger, policy = DEFAULT_POLICY) {
  const l = ledger;
  return {
    schema: PUBLISH_SCHEMA,
    fingerprint: l.pending ? l.pending.fingerprint : l.fingerprint,
    publishedAt: l.pending ? l.pending.at : l.publishedAt,
    day: l.day, dayCount: l.dayCount, month: l.month, monthCount: l.monthCount,
    limits: { perDay: policy.maxPerDay, perMonth: policy.maxPerMonth },
  };
}

/** Журнал из опубликованного publish.json (после потери кеша). Счётчики берутся как есть — это не меньше реальных. */
export function ledgerFromPublic(pub) {
  if (!pub || pub.schema !== PUBLISH_SCHEMA || typeof pub.fingerprint !== 'string') return null;
  return { ...emptyLedger(), fingerprint: pub.fingerprint, publishedAt: Number(pub.publishedAt) || null, day: pub.day ?? null, dayCount: Number(pub.dayCount) || 0, month: pub.month ?? null, monthCount: Number(pub.monthCount) || 0, recoveredFrom: 'site' };
}

/** Поле publish в status.json: клиент по нему понимает, что сайт обновляется «по изменениям». */
export function statusPublishInfo(nowMs, policy = DEFAULT_POLICY) {
  return { mode: 'on-change', publishedAt: nowMs, checkEveryMin: policy.checkEveryMin, heartbeatHours: policy.heartbeatHours };
}

export function policyFromEnv(env = process.env) {
  const num = (k, d, min) => { const v = Number(env[k]); return Number.isFinite(v) && v >= min ? Math.floor(v) : d; };
  return {
    checkEveryMin: num('KK_CHECK_EVERY_MIN', DEFAULT_POLICY.checkEveryMin, 1),
    heartbeatHours: num('KK_HEARTBEAT_HOURS', DEFAULT_POLICY.heartbeatHours, 1),
    failStreakToPublish: num('KK_FAIL_STREAK', DEFAULT_POLICY.failStreakToPublish, 1),
    // Лимиты нельзя поднять выше бесплатных 500/мес даже переменной окружения.
    maxPerDay: Math.min(num('KK_DEPLOY_MAX_DAY', DEFAULT_POLICY.maxPerDay, 0), 100),
    maxPerMonth: Math.min(num('KK_DEPLOY_MAX_MONTH', DEFAULT_POLICY.maxPerMonth, 0), 450),
  };
}
