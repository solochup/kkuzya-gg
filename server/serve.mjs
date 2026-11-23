#!/usr/bin/env node
// Локальный сервер KKUZYA.GG: отдаёт собранный сайт (web/dist) и данные (data/public),
// а в фоне раз в KK_SYNC_MIN минут (по умолчанию 5) проверяет новые матчи.
// Запуск: node server/serve.mjs            (с синхронизацией)
//         node server/serve.mjs --no-sync  (только показать сохранённые данные)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ApiClient } from '../lib/api.js';
import { FileStore } from './store.js';
import { syncOnce } from './sync.js';
import { config } from './config.js';

const args = new Set(process.argv.slice(2));
const noSync = args.has('--no-sync');
const store = new FileStore(config.dataDir);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

function safeJoin(base, rel) {
  const p = path.resolve(base, '.' + path.posix.normalize('/' + rel));
  return p === base || p.startsWith(base + path.sep) ? p : null;
}

function sendFile(req, res, file, { cache }) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('not found'); return; }
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const headers = { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', etag, 'cache-control': cache, 'x-content-type-options': 'nosniff' };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return; }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  // new URL уже убрал точечные сегменты (/data/../x -> /x); дальше раскодируем %-последовательности
  // и проверяем путь ещё раз в safeJoin. Битое кодирование и нулевой байт — 400, а не падение сервера.
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://local').pathname); } catch { p = null; }
  if (p === null || p.includes('\0')) { res.writeHead(400); res.end(); return; }
  if (p.startsWith('/data/')) {
    const f = safeJoin(store.publicDir, p.slice('/data/'.length));
    if (!f) { res.writeHead(400); res.end(); return; }
    return sendFile(req, res, f, { cache: 'no-cache' });
  }
  if (!fs.existsSync(config.webDist)) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Сайт ещё не собран. Выполни: npm run build (в корне проекта).');
    return;
  }
  let f = safeJoin(config.webDist, p === '/' ? 'index.html' : p.slice(1));
  if (!f) { res.writeHead(400); res.end(); return; }
  // SPA: пути без расширения отдают index.html.
  if (!path.extname(f) || !fs.existsSync(f)) f = path.extname(p) ? f : path.join(config.webDist, 'index.html');
  const immutable = p.startsWith('/assets/');
  sendFile(req, res, f, { cache: immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
});

let running = false;
async function runSync() {
  if (running) return;
  running = true;
  try {
    const client = new ApiClient({ delayMs: config.requestDelayMs, userAgent: config.userAgent, origin: `http://${config.host}:${config.port}` });
    const st = await syncOnce({ client, store, accountId: config.accountId, api: config.api, nickname: config.nickname });
    const t = new Date().toLocaleTimeString('ru-RU');
    console.log(`[${t}] синхронизация: ${st.ok ? 'ок' : 'ошибка'}; матчей ${st.matches ?? 0}; ${st.errors && st.errors.length ? 'проблемы: ' + st.errors.map((e) => e.error).join('; ') : 'без ошибок'}`);
  } catch (e) {
    console.error('Синхронизация упала:', e && e.stack ? e.stack : e);
  } finally { running = false; }
}

server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.error(`Порт ${config.port} уже занят: возможно, KKUZYA.GG уже запущен в другом окне. Другой порт: set PORT=4180`);
    process.exit(3);
  }
  console.error('Сервер не запустился:', e && e.message ? e.message : e);
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  console.log(`KKUZYA.GG: http://${config.host}:${config.port}/`);
  console.log(noSync ? 'Синхронизация выключена (--no-sync): показываются сохранённые данные.' : `Проверка новых матчей каждые ${config.syncIntervalMin} мин.`);
  if (!noSync) { runSync(); setInterval(runSync, config.syncIntervalMin * 60_000).unref(); }
});
