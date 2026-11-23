#!/usr/bin/env node
// Измеряет задержку появления нового матча в API.
// Запусти ДО или сразу после начала матча и оставь окно открытым. Инструмент сам заметит новый матч.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiClient } from './lib/api.js';
import { watchForNewMatch } from './lib/watch.js';
import { toAccountId } from './lib/util.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const o = { steamid: '76561199560928611', interval: 180, hours: 4, api: 'https://api.deadlock-api.com', out: path.join(HERE, 'out') };
const a = process.argv.slice(2);
for (let i = 0; i < a.length; i++) {
  if (a[i] === '--interval') o.interval = Math.max(60, Number(a[++i]) || 180);
  else if (a[i] === '--hours') o.hours = Math.max(0.1, Number(a[++i]) || 4);
  else if (a[i] === '--steamid') o.steamid = a[++i];
  else if (a[i] === '--out') o.out = path.resolve(a[++i]);
  else if (a[i] === '--help') { console.log('node watch.mjs [--interval секунд (мин. 60, по умолч. 180)] [--hours часов (по умолч. 4)]'); process.exit(0); }
}
const id = toAccountId(o.steamid);
const fmt = (ts) => new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
const f1 = (x) => (x == null ? 'н/д' : x.toFixed(1));
const lines = [];
const say = (s) => { console.log(s); lines.push(s); };

const client = new ApiClient({ delayMs: 300 });
say(`Наблюдение за новым матчем игрока ${id}. Проверка истории каждые ${o.interval} с, максимум ${o.hours} ч. Останови окном или Ctrl+C.`);
say('История матчей кешируется сервером до 5 минут, поэтому точность измерения около ±5 минут.');
const res = await watchForNewMatch({
  client, intervalMs: o.interval * 1000, maxMs: o.hours * 3600 * 1000,
  now: () => Date.now() / 1000, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  urls: { history: `${o.api}/v1/players/${id}/match-history`, meta: (m) => `${o.api}/v1/matches/${m}/metadata` },
  onEvent: (type, d) => {
    if (type === 'baseline') say(`[${fmt(Date.now() / 1000)}] Старт. Самый новый матч сейчас: ${d.newest && d.newest.matchId}, записей ${d.total}, ETag ${d.etag ? 'есть' : 'нет'}.`);
    else if (type === 'poll') say(`[${fmt(Date.now() / 1000)}] проверка: ${d.ok ? (d.notModified ? 'без изменений (304)' : 'ответ получен') : 'ошибка ' + d.error}`);
    else if (type === 'new-match') say(`[${fmt(d.historySeenTs)}] НОВЫЙ МАТЧ ${d.matchId} появился в истории. Окончание матча ${d.endTs ? fmt(d.endTs) : 'н/д'}, задержка ${f1(d.historyDelayMin)} мин.`);
    else if (type === 'metadata') say(`[${fmt(d.metadataSeenTs)}] Метаданные матча ${d.matchId} доступны, задержка от конца матча ${f1(d.metadataDelayMin)} мин.`);
    else if (type === 'timeout') say(`Новый матч за ${f1(d.waitedMin)} мин не появился.`);
    else if (type === 'error') say(`Ошибка: ${d.error}`);
  },
});
fs.mkdirSync(o.out, { recursive: true });
const md = ['# Измерение задержки появления матча', '', ...lines, '', '## Итог',
  ...(res.newMatches.length ? res.newMatches.map((m) => `- матч ${m.matchId}: в истории через ${f1(m.historyDelayMin)} мин после конца, метаданные через ${f1(m.metadataDelayMin)} мин`) : ['- новых матчей не было'])].join('\n');
fs.writeFileSync(path.join(o.out, 'watch.md'), md, 'utf8');
console.log(`\nГотово. Отчёт: ${path.join(o.out, 'watch.md')}`);
