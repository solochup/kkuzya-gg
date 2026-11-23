#!/usr/bin/env node
// Решает, нужно ли публиковать dist-pages на Cloudflare Pages. Сам ничего не публикует.
//   node tools/publish-gate.mjs decide [--force]   — после prepare-pages; пишет deploy=true|false в $GITHUB_OUTPUT
//   node tools/publish-gate.mjs commit             — только после успешной публикации: фиксирует отпечаток
// Журнал публикаций: data/cache/publish-ledger.json (сохраняется в кеше GitHub Actions).
// Если кеш потерян, журнал восстанавливается из опубликованного <KK_SITE_URL>/data/publish.json.
// Логика решения — lib/publish.js.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FileStore } from '../server/store.js';
import { config } from '../server/config.js';
import { decide, commit, publicLedger, ledgerFromPublic, statusPublishInfo, policyFromEnv } from '../lib/publish.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = 'publish-ledger';

export function readTree(dir) {
  const files = new Map();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files.set(path.relative(dir, p).split(path.sep).join('/'), fs.readFileSync(p));
    }
  };
  walk(dir);
  return files;
}

async function recoverLedger(siteUrl, fetchImpl, log) {
  if (!siteUrl) { log('журнал публикаций не найден, адрес сайта не задан (KK_SITE_URL) — начинаю новый журнал'); return null; }
  const url = `${siteUrl.replace(/\/+$/, '')}/data/publish.json`;
  try {
    const r = await fetchImpl(url, { headers: { accept: 'application/json', 'user-agent': config.userAgent }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) { log(`журнал не восстановлен: ${url} ответил ${r.status} (первая публикация?)`); return null; }
    const l = ledgerFromPublic(await r.json());
    log(l ? `журнал восстановлен с сайта: публикаций за месяц ${l.monthCount}, за сутки ${l.dayCount}` : 'журнал на сайте в неизвестном формате — начинаю новый');
    return l;
  } catch (e) { log(`журнал не восстановлен (${e.message}) — начинаю новый`); return null; }
}

function lastCommitAgeDays(nowMs) {
  try {
    const ct = Number(execFileSync('git', ['log', '-1', '--format=%ct'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
    return ct ? (nowMs / 1000 - ct) / 86400 : null;
  } catch { return null; }
}

const REASONS = {
  changed: 'изменились видимые данные или файлы сайта',
  heartbeat: 'контрольная публикация: давно не было публикаций',
  forced: 'ручной запуск с force',
  unchanged: 'видимых изменений нет — публикация пропущена',
  limit_day: 'достигнут суточный лимит публикаций — пропущено',
  limit_month: 'достигнут месячный лимит публикаций — пропущено до следующего месяца',
  no_token: 'нет секрета CLOUDFLARE_API_TOKEN — публикация пропущена',
};

export async function runGate({ cmd, distPages = path.join(ROOT, 'dist-pages'), store = new FileStore(config.dataDir), env = process.env, nowMs = Date.now(), fetchImpl = globalThis.fetch, force = false, log = console.log }) {
  const policy = policyFromEnv(env);
  if (cmd === 'commit') {
    const l = commit(store.get(LEDGER), nowMs);
    store.put(LEDGER, l);
    log(`публикация зафиксирована: ${l.fingerprint ? l.fingerprint.slice(0, 12) : '—'}`);
    return { ledger: l };
  }
  if (cmd !== 'decide') throw new Error('команда: decide | commit');

  const statusFile = path.join(distPages, 'data', 'status.json');
  if (!fs.existsSync(statusFile)) throw new Error('нет dist-pages/data/status.json: сначала tools/prepare-pages.mjs');
  const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
  let ledger = store.get(LEDGER);
  if (!ledger) ledger = await recoverLedger(env.KK_SITE_URL, fetchImpl, log);

  const canDeploy = env.KK_HAS_TOKEN !== 'false';
  const res = decide({ ledger, status, files: readTree(distPages), nowMs, policy, force, canDeploy });
  store.put(LEDGER, res.ledger);

  if (res.deploy) {
    // Технические поля для посетителя и для восстановления журнала: в отпечаток не входят.
    fs.writeFileSync(statusFile, JSON.stringify({ ...status, publish: statusPublishInfo(nowMs, policy) }));
    fs.writeFileSync(path.join(distPages, 'data', 'publish.json'), JSON.stringify(publicLedger(res.ledger, policy)));
  }
  const l = res.ledger;
  log(`решение: ${res.deploy ? 'ПУБЛИКОВАТЬ' : 'не публиковать'} — ${REASONS[res.reason]}`);
  log(`отпечаток ${res.fp.slice(0, 12)}; состояние на сайте: ${res.visible.health}; сбоев API подряд: ${l.failStreak}`);
  log(`публикаций: сегодня ${l.dayCount}/${policy.maxPerDay}, в этом месяце ${l.monthCount}/${policy.maxPerMonth} (UTC)`);

  const warnings = [];
  if (res.reason === 'limit_month' || res.reason === 'limit_day') warnings.push(REASONS[res.reason]);
  if (l.monthCount >= policy.maxPerMonth * 0.8 && res.reason !== 'limit_month') warnings.push(`израсходовано ${l.monthCount} из ${policy.maxPerMonth} публикаций месяца`);
  const age = lastCommitAgeDays(nowMs);
  if (age != null && age > 45) warnings.push(`последний коммит ${Math.floor(age)} дн. назад: GitHub отключает расписание в публичном репозитории через 60 дней без активности — сделай любой коммит`);

  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `deploy=${res.deploy}\nreason=${res.reason}\n`);
  for (const w of warnings) log(env.GITHUB_ACTIONS ? `::warning::${w}` : `ВНИМАНИЕ: ${w}`);
  if (env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, [
      `### KKUZYA.GG: ${res.deploy ? 'публикация' : 'без публикации'}`,
      `- Причина: ${REASONS[res.reason]}`,
      `- Данные: ${status.ok ? 'синхронизация успешна' : 'API с ошибками'}; матчей ${status.matches ?? 0}; ждут метаданных ${(status.pending || []).length}`,
      `- Публикаций: сегодня ${l.dayCount}/${policy.maxPerDay}, за месяц ${l.monthCount}/${policy.maxPerMonth}`,
      ...warnings.map((w) => `- ⚠ ${w}`), '',
    ].join('\n'));
  }
  return { ...res, warnings };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [cmd, ...rest] = process.argv.slice(2);
  try { await runGate({ cmd, force: rest.includes('--force') || process.env.KK_FORCE === 'true' }); }
  catch (e) { console.error(e.message); process.exit(1); }
}
