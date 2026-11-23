#!/usr/bin/env node
// Один проход синхронизации: node server/sync-cli.mjs
// Пишет кеш в data/cache и готовые JSON для сайта в data/public. Подходит для запуска по расписанию.
import { ApiClient } from '../lib/api.js';
import { FileStore } from './store.js';
import { syncOnce } from './sync.js';
import { config } from './config.js';

const client = new ApiClient({ delayMs: config.requestDelayMs, userAgent: config.userAgent, origin: config.syncOrigin });
const store = new FileStore(config.dataDir);
const status = await syncOnce({ client, store, accountId: config.accountId, api: config.api, nickname: config.nickname, log: (s) => console.log(s) });
console.log(`\nГотово: ${status.ok ? 'успешно' : 'с ошибками'}; матчей ${status.matches ?? 0}; запросов к API ${status.apiRequests ?? 0}`);
for (const [k, v] of Object.entries(status.steps || {})) console.log(`  ${k}: ${v}`);
for (const e of status.errors || []) console.log(`  ! ${e.error}`);
for (const p of status.pending || []) console.log(`  … матч ${p.matchId} ждёт метаданных (попыток ${p.attempts})`);
console.log(`Данные: ${store.publicDir}`);
process.exit(status.ok ? 0 : 1);
