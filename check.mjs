#!/usr/bin/env node
// Проверочный инструмент Deadlock API. Запуск: node check.mjs   (или двойной клик по run-check.bat)
// Что делает: история матчей -> метаданные последних N матчей -> справочники -> расчёты -> отчёт.
import fs from 'node:fs';
import dns from 'node:dns/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ApiClient } from './lib/api.js';
import { parseHistory } from './lib/history.js';
import { buildDigest, NEAR_RADIUS } from './lib/digest.js';
import { buildAssetIndex, buildHeroIndex, collectItemIds, classificationReport, aggregateItems, finalKind } from './lib/items.js';
import { aggregateScores, aggregateTimeline, eligibility } from './lib/metrics.js';
import { pathDiagnostics, summarizeDiagnostics } from './lib/diagnostics.js';
import { compareHistory, winRules, countBy } from './lib/crosscheck.js';
import { renderReport } from './lib/report.js';
import { toAccountId, STEAM_BASE } from './lib/util.js';

const VERSION = '0.2.0';
const HERE = path.dirname(fileURLToPath(import.meta.url));

const HELP = `
Использование: node check.mjs [параметры]
  --steamid <число>   SteamID64 (по умолчанию 76561199560928611)
  --account <число>   Account ID вместо SteamID64
  --matches <N>       сколько матчей разобрать (по умолчанию 10)
  --delay <мс>        пауза между запросами (по умолчанию 400)
  --out <папка>       куда писать отчёт (по умолчанию ./out)
  --history-query <строка>  добавить к URL истории, например "only_stored_history=true"
  --api <url>         адрес API (по умолчанию https://api.deadlock-api.com)
  --assets <url>      адрес справочников (по умолчанию <api>/v1/assets, то есть https://api.deadlock-api.com/v1/assets;
                      к нему добавляются /heroes и /items. Старый assets.deadlock-api.com больше не существует)
  --heroes-file <файл>  взять справочник героев из файла (если сайт справочников не открывается из программы)
  --items-file <файл>   то же для предметов
  --offline <папка>   не ходить в сеть: читать history.json, heroes.json, items.json, metadata_<id>.json
`;

function parseArgs(argv) {
  const o = { steamid: '76561199560928611', matches: 10, delay: 400, out: path.join(HERE, 'out'), api: 'https://api.deadlock-api.com', assets: null, historyQuery: '', offline: null, account: null, heroesFile: null, itemsFile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i];
    if (a === '--help' || a === '-h') { console.log(HELP); process.exit(0); }
    else if (a === '--steamid') o.steamid = v();
    else if (a === '--account') o.account = v();
    else if (a === '--matches') o.matches = Math.max(1, Math.min(30, Number(v()) || 10));
    else if (a === '--delay') o.delay = Math.max(0, Number(v()) || 0);
    else if (a === '--out') o.out = path.resolve(v());
    else if (a === '--history-query') o.historyQuery = v();
    else if (a === '--api') o.api = v().replace(/\/+$/, '');
    else if (a === '--assets') o.assets = v().replace(/\/+$/, '');
    else if (a === '--heroes-file') o.heroesFile = path.resolve(v());
    else if (a === '--items-file') o.itemsFile = path.resolve(v());
    else if (a === '--offline') o.offline = path.resolve(v());
    else if (/^\d+$/.test(a)) o.steamid = a;
    else { console.error(`Неизвестный параметр: ${a}`); console.log(HELP); process.exit(2); }
  }
  // Справочники теперь живут в основном API: https://api.deadlock-api.com/v1/assets/{heroes,items}
  if (!o.assets) o.assets = `${o.api}/v1/assets`;
  return o;
}

function offlineFetch(dir) {
  return async (url) => {
    const u = new URL(url);
    let file = null, m;
    if (u.pathname.endsWith('/match-history')) file = 'history.json';
    else if ((m = u.pathname.match(/\/matches\/(\d+)\/metadata$/))) file = `metadata_${m[1]}.json`;
    else if (u.pathname.endsWith('/heroes')) file = 'heroes.json';
    else if (u.pathname.endsWith('/items')) file = 'items.json';
    const p = file && path.join(dir, file);
    if (!p || !fs.existsSync(p)) return new Response('not found', { status: 404 });
    return new Response(fs.readFileSync(p), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

async function dnsCheck(url) {
  const host = new URL(url).hostname;
  try {
    const r = await dns.lookup(host, { all: true });
    return { host, ok: true, addrs: r.map((x) => x.address).slice(0, 3) };
  } catch (e) {
    return { host, ok: false, error: e.code || e.message };
  }
}

const log = (s) => console.log(s);
const readJsonFile = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

async function main() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) { console.error(`Нужен Node.js 18 или новее, сейчас ${process.versions.node}. Установи LTS с https://nodejs.org`); process.exit(1); }
  const opt = parseArgs(process.argv.slice(2));

  const input = opt.account ?? opt.steamid;
  const accountId = toAccountId(input);
  const isSteam64 = BigInt(input) >= STEAM_BASE;
  const expected = 1600662883;
  const idCheck = isSteam64
    ? `(${input} − ${STEAM_BASE} = ${accountId}${accountId === expected ? ', совпадает с ожидаемым ' + expected : ', НЕ совпадает с ожидаемым ' + expected})`
    : '(введён сразу Account ID)';
  log(`Account ID: ${accountId} ${idCheck}`);

  const client = new ApiClient({ delayMs: opt.offline ? 0 : opt.delay, fetchImpl: opt.offline ? offlineFetch(opt.offline) : globalThis.fetch });
  const warnings = [];
  const R = {
    version: VERSION, startedAt: new Date().toISOString(), node: process.versions.node,
    steamInput: input, accountId, idCheck, delayMs: opt.delay, radius: NEAR_RADIUS,
    requests: client.log, history: null, matches: [], warnings, newestAgeMin: null,
    cross: [], winRules: null, historyModes: null, firstRaw: [], pathDiags: [], dns: [], assetsSource: { heroes: 'сеть', items: 'сеть' },
  };

  // 2. История
  const histUrl = `${opt.api}/v1/players/${accountId}/match-history${opt.historyQuery ? '?' + opt.historyQuery : ''}`;
  log('Запрашиваю историю матчей…');
  const hr = await client.getJson(histUrl, { label: 'история матчей' });
  if (!hr.ok) {
    warnings.push(`История матчей не получена: ${hr.error}${hr.snippet ? ' | ' + hr.snippet : ''}`);
  } else {
    R.history = parseHistory(hr.json);
    if (!R.history.ok) warnings.push(`История получена, но не разобрана: ${R.history.error}`);
    else {
      R.firstRaw = R.history.rows.slice(0, 2).map((r) => r.raw);
      R.historyModes = {
        gameMode: countBy(R.history.rows.map((r) => ({ v: r.raw.game_mode })), 'v'),
        matchMode: countBy(R.history.rows.map((r) => ({ v: r.raw.match_mode })), 'v'),
      };
    }
  }

  // 3. Метаданные
  const digests = [];
  if (R.history && R.history.ok) {
    const candidates = R.history.rows.slice(0, opt.matches + 5);
    for (const c of candidates) {
      if (digests.length >= opt.matches) break;
      if (c.durationS === 0) { R.matches.push({ matchId: c.matchId, error: 'в истории длительность 0 (не завершён)' }); continue; }
      log(`[${digests.length + 1}/${opt.matches}] метаданные матча ${c.matchId}…`);
      const r = await client.getJson(`${opt.api}/v1/matches/${c.matchId}/metadata`, { label: `метаданные ${c.matchId}`, timeoutMs: 60000 });
      const base = { matchId: c.matchId, bytes: r.entry && r.entry.bytes, ms: r.entry && r.entry.ms };
      if (!r.ok) { R.matches.push({ ...base, error: r.error }); continue; }
      const d = buildDigest(r.json, accountId);
      if (d.error) { R.matches.push({ ...base, error: d.error }); continue; }
      const diag = pathDiagnostics(r.json, accountId);
      if (diag) R.pathDiags.push(diag);
      digests.push(d);
      R.matches.push({ ...base, d, kinds: { shop: 0, ability: 0 }, flags: [] });
      const cc = compareHistory(c.raw, d);
      if (cc) R.cross.push(cc);
    }
    const first = digests.slice().sort((a, b) => b.endTime - a.endTime)[0];
    if (first && !opt.offline) R.newestAgeMin = (Date.now() / 1000 - first.endTime) / 60;
    R.winRules = winRules(R.cross);
  }

  // 4. Справочники (из сети или из файла)
  const heroIds = new Set(digests.map((d) => Number(d.heroId)));
  let heroIdx = null, itemIdx = null;
  if (opt.heroesFile) {
    try { heroIdx = buildHeroIndex(readJsonFile(opt.heroesFile), heroIds); R.assetsSource.heroes = `файл ${path.basename(opt.heroesFile)}`; }
    catch (e) { warnings.push(`Файл героев не прочитан: ${e.message}`); }
  } else {
    const hRes = await client.getJson(`${opt.assets}/heroes`, { label: 'справочник героев', timeoutMs: 60000 });
    if (hRes.ok) heroIdx = buildHeroIndex(hRes.json, heroIds); else warnings.push(`Справочник героев не получен: ${hRes.error}`);
  }
  if (opt.itemsFile) {
    try { itemIdx = buildAssetIndex(readJsonFile(opt.itemsFile), collectItemIds(digests)); R.assetsSource.items = `файл ${path.basename(opt.itemsFile)}`; }
    catch (e) { warnings.push(`Файл предметов не прочитан: ${e.message}`); }
  } else {
    const iRes = await client.getJson(`${opt.assets}/items`,{ label: 'справочник предметов', timeoutMs: 60000 });
    if (iRes.ok) itemIdx = buildAssetIndex(iRes.json, collectItemIds(digests)); else warnings.push(`Справочник предметов не получен: ${iRes.error}`);
  }
  if (!opt.offline && (!heroIdx || !itemIdx) && !(opt.heroesFile && opt.itemsFile)) {
    R.dns = [await dnsCheck(opt.api)];
    if (new URL(opt.assets).hostname !== new URL(opt.api).hostname) R.dns.push(await dnsCheck(opt.assets));
    const a = R.dns[R.dns.length - 1];
    warnings.push(`Проверка DNS: ${a.host} ${a.ok ? 'найден (' + a.addrs.join(', ') + '), значит блокировка или обрыв на этапе соединения/сертификата, смотри причину в таблице запросов' : 'НЕ найден: ' + a.error + ' (имя не разрешается: DNS, провайдер или фильтр)'}.`);
    warnings.push(`Что делать: открой ${opt.assets}/heroes и ${opt.assets}/items в браузере. Если открываются, сохрани страницы (Ctrl+S) в папку инструмента как heroes.json и items.json и запусти: node check.mjs --heroes-file heroes.json --items-file items.json`);
  }
  R.itemsIndex = itemIdx;
  R.heroName = (id) => (heroIdx && heroIdx.names.get(Number(id))) || `#${id}`;
  if (heroIdx && heroIdx.hits === 0) warnings.push('Справочник героев загружен, но ни один hero_id матчей в нём не найден: проверь формат.');

  // 5. Анализ
  for (const m of R.matches) {
    if (!m.d) continue;
    for (const it of m.d.items) m.kinds[finalKind(it, itemIdx).kind === 'shop' ? 'shop' : 'ability']++;
    const why = eligibility(m.d);
    if (why) m.flags.push(`не входит в показатели: ${why}`);
    if (m.d.positions && !m.d.positions.usable) m.flags.push(`позиции не используются: ${m.d.positions.unusableReason}`);
    for (const w of m.d.warnings) m.flags.push(w);
  }
  if (digests.length) {
    R.classification = classificationReport(digests, itemIdx);
    R.itemAgg = aggregateItems(digests, itemIdx);
    R.scores = aggregateScores(digests);
    R.timeline = aggregateTimeline(digests, 5);
    R.pathSummary = R.pathDiags.map(summarizeDiagnostics);
    if (digests.length < opt.matches) warnings.push(`Получено матчей: ${digests.length} из ${opt.matches}.`);
    const failed = R.matches.filter((m) => m.error).length;
    if (failed) warnings.push(`Матчей с ошибкой: ${failed}.`);
    if (itemIdx && R.classification.coverage != null && R.classification.coverage < 0.9) warnings.push(`Справочник предметов покрывает только ${Math.round(R.classification.coverage * 100)}% записей игрока.`);
    if (R.classification.agreement != null && R.classification.agreement < 0.95) warnings.push(`Гипотеза «upgrade_id = 1 это покупка» совпала со справочником только на ${Math.round(R.classification.agreement * 100)}%: классификацию по гипотезе использовать нельзя.`);
    if (!itemIdx) warnings.push('Без справочника предметов разделение покупок и способностей только по гипотезе.');
    // Расписание снимков: сравниваем без последнего снимка (он всегда равен концу матча).
    const schedules = new Set(digests.map((d) => d.snapshotTimes.slice(0, -1).join(',')));
    const prefixOk = digests.every((d) => d.snapshotTimes.slice(0, -1).every((t, i) => t === [180, 360, 540, 720, 900][i] || (i >= 5 && t === 900 + (i - 4) * 300)));
    if (!prefixOk) warnings.push(`Расписание снимков статистики не совпало с правилом «3 мин до 15-й минуты, затем 5 мин» (разных расписаний: ${schedules.size}).`);
    if (R.requests.some((e) => e.status === 429)) warnings.push('Были ответы 429 (лимит запросов). Увеличь --delay.');
    const noPos = digests.filter((d) => !d.positions || !d.positions.usable).length;
    if (noPos) warnings.push(`Признаки по позициям недоступны в ${noPos} из ${digests.length} матчей (путь игрока не сходится со смертями).`);
    if (R.cross.some((c) => !c.heroOk || !c.kdaOk || !c.durOk)) warnings.push('История и метаданные расходятся по герою, KDA или длительности хотя бы в одном матче: см. раздел 2.');
  } else {
    warnings.push('Не удалось получить ни одного матча. Показатели не рассчитаны.');
    R.classification = { pairs: [], missingSample: [], total: 0, found: 0, coverage: null, agreement: null, comparable: 0 };
    R.itemAgg = { top: [], almostAlways: 0, perMatch: { shop: [0], ability: [0], soldShop: [0], finalShop: [0] } };
    R.scores = { used: 0, minutes: 0, positionMatches: 0, excluded: [], scores: {}, raw: null };
    R.timeline = [];
    R.pathSummary = [];
  }

  // 6. Отчёт
  fs.mkdirSync(opt.out, { recursive: true });
  const md = renderReport(R);
  fs.writeFileSync(path.join(opt.out, 'report.md'), md, 'utf8');
  const slim = {
    version: VERSION, startedAt: R.startedAt, accountId, requests: R.requests,
    history: R.history && R.history.ok ? { total: R.history.total, fields: R.history.fields, firstRecordKeys: R.history.firstRecordKeys, newest: { ...R.history.rows[0], raw: undefined }, oldest: { ...R.history.rows[R.history.rows.length - 1], raw: undefined } } : R.history,
    matches: R.matches.map((m) => (m.d ? { matchId: m.matchId, bytes: m.bytes, ms: m.ms, flags: m.flags, kinds: m.kinds } : m)),
    cross: R.cross, winRules: R.winRules, scores: R.scores, timeline: R.timeline, classification: R.classification, items: R.itemAgg, pathSummary: R.pathSummary, warnings,
  };
  fs.writeFileSync(path.join(opt.out, 'report.json'), JSON.stringify(slim), 'utf8');
  fs.writeFileSync(path.join(opt.out, 'digests.json'), JSON.stringify(digests), 'utf8');
  fs.writeFileSync(path.join(opt.out, 'paths-diagnostics.json'), JSON.stringify(R.pathDiags), 'utf8');

  log('');
  log(md.split('\n').filter((l) => /^(#|Игрок|Записей|Использовано|Всего запросов)/.test(l)).slice(0, 12).join('\n'));
  log('');
  log(`Готово. Отчёт: ${path.join(opt.out, 'report.md')}`);
  if (warnings.length) { log('Предупреждения:'); warnings.forEach((w) => log(' - ' + w)); }
}

main().catch((e) => {
  console.error('\nНеожиданная ошибка инструмента:', e && e.stack ? e.stack : e);
  process.exit(1);
});
