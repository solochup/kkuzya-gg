#!/usr/bin/env node
// Запуск KKUZYA.GG одной командой (его вызывает run-site.bat).
// 1) проверяет версию Node; 2) при первом запуске ставит зависимости сайта; 3) собирает сайт, если сборки нет
// или исходники новее сборки; 4) запускает server/serve.mjs и открывает браузер, когда сервер готов.
// Вся логика здесь, а не в .bat: CMD плохо переносит русский текст в пакетных файлах.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web');
const URL_ = `http://${config.host}:${config.port}/`;
const isWin = process.platform === 'win32';

const say = (s = '') => console.log(s);
const fail = (s) => { console.error(`\n[ОШИБКА] ${s}`); process.exit(1); };

// 1. Версия Node (Vite 8 требует 20.19+).
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 20 || (maj === 20 && min < 19)) fail(`Нужен Node.js 20.19 или новее, сейчас ${process.versions.node}. Установи LTS с https://nodejs.org`);

/** npm через оболочку: на Windows это npm.cmd, а .cmd без shell Node запускать не разрешает. */
function npm(args, cwd) {
  const r = spawnSync(`npm ${args}`, { cwd, stdio: 'inherit', shell: true });
  return r.status === 0;
}

// 2. Зависимости сайта.
if (!fs.existsSync(path.join(WEB, 'node_modules', 'vite'))) {
  say('Первый запуск: устанавливаю зависимости сайта (около минуты, нужен интернет)...');
  if (!npm('install --no-fund --no-audit', WEB)) fail('Не удалось установить зависимости. Проверь интернет и запусти снова.');
}

// 3. Сборка: если её нет или исходники изменились после сборки.
function newestMtime(dir) {
  let t = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newestMtime(p) : fs.statSync(p).mtimeMs);
  }
  return t;
}
const distIndex = path.join(WEB, 'dist', 'index.html');
const sources = Math.max(newestMtime(path.join(WEB, 'src')), newestMtime(path.join(WEB, 'public')), fs.statSync(path.join(WEB, 'index.html')).mtimeMs);
if (!fs.existsSync(distIndex) || fs.statSync(distIndex).mtimeMs < sources) {
  say('Собираю сайт...');
  if (!npm('run build', WEB)) fail('Сборка не удалась. Подробности выше.');
}

// 4. Сервер и браузер.
const openBrowser = () => {
  if (process.env.KK_NO_BROWSER) { say(`(браузер не открывается: KK_NO_BROWSER) ${URL_}`); return; }
  try {
    if (isWin) spawn('explorer.exe', [URL_], { detached: true, stdio: 'ignore' }).unref();
    else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [URL_], { detached: true, stdio: 'ignore' }).unref();
  } catch { say(`Открой в браузере: ${URL_}`); }
};

async function alreadyRunning() {
  try { const r = await fetch(`${URL_}data/status.json`, { signal: AbortSignal.timeout(2000) }); return r.status === 200 || r.status === 404; }
  catch { return false; }
}

say('');
say(`KKUZYA.GG запускается: ${URL_}`);
say('Новые матчи проверяются каждые 5 минут. Чтобы остановить сайт, закрой это окно.');
say('');

const child = spawn(process.execPath, [path.join(ROOT, 'server', 'serve.mjs'), ...process.argv.slice(2)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
let opened = false;
child.stdout.on('data', (b) => {
  process.stdout.write(b);
  if (!opened && String(b).includes('KKUZYA.GG:')) { opened = true; openBrowser(); }
});
child.on('exit', async (code) => {
  if (code === 3 && await alreadyRunning()) {
    say(`\nСайт уже запущен в другом окне — открываю ${URL_}`);
    openBrowser();
    process.exit(0);
  }
  process.exit(code ?? 1);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { child.kill(); process.exit(0); });
