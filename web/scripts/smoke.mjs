#!/usr/bin/env node
// Дымовой тест собранного сайта в настоящем браузере (Chrome/Edge через puppeteer-core, без скачивания браузера).
// Поднимает server/serve.mjs --no-sync на отдельном порту, проходит по страницам и вкладкам на RU и EN,
// собирает ошибки консоли, проверяет отсутствие кириллицы в EN и делает скриншоты. Использование:
//   node scripts/smoke.mjs [папка-для-скриншотов]
// Переменные: CHROME_PATH — путь к браузеру; SMOKE_PORT — порт (по умолчанию 4199).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'kkuzya-smoke'));
const PORT = Number(process.env.SMOKE_PORT || 4199);
const BASE = `http://127.0.0.1:${PORT}`;
const CANDIDATES = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
const exe = CANDIDATES.find((p) => fs.existsSync(p));
if (!exe) { console.error('Не найден Chrome/Edge. Укажи CHROME_PATH.'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, [path.join(ROOT, 'server', 'serve.mjs'), '--no-sync'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('сервер не запустился')), 10000);
  server.stdout.on('data', (b) => { if (String(b).includes('KKUZYA.GG:')) { clearTimeout(t); res(); } });
  server.on('exit', (c) => rej(new Error(`сервер завершился: ${c}`)));
});

const problems = [];
const external = [];
let checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) problems.push(`ПРОВЕРКА: ${msg}`); };
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));

/** Видимый текст + доступные подписи (aria-label, title, alt, placeholder), без <noscript>. */
const collectText = (page) => page.evaluate(() => {
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('noscript').forEach((n) => n.remove());
  const attrs = [...document.body.querySelectorAll('[aria-label],[title],[alt],[aria-valuetext]')]
    .filter((el) => !el.closest('[lang="ru"]'))
    .flatMap((el) => ['aria-label', 'title', 'alt', 'aria-valuetext'].map((a) => el.getAttribute(a)).filter(Boolean));
  return { text: clone.textContent, attrs, title: document.title, lang: document.documentElement.lang };
});
const CYR = /[А-Яа-яЁё]+/g;
const cyrIn = async (page) => {
  const { text, attrs, title } = await collectText(page);
  const hits = [...(text.match(CYR) || []), ...attrs.flatMap((a) => a.match(CYR) || []), ...(title.match(CYR) || [])];
  // «Русский» — самоназвание языка в переключателе (lang="ru"), это норма.
  return [...new Set(hits.filter((w) => w !== 'Русский'))];
};
const clickTab = (page, id) => page.evaluate((x) => document.querySelector(`[role="tab"][data-tab="${x}"]`)?.click(), id);
const clickLang = (page, l) => page.evaluate((x) => [...document.querySelectorAll('[role="radiogroup"] [role="radio"]')].find((b) => b.textContent === x)?.click(), l.toUpperCase());

const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-first-run', '--no-default-browser-check'] });
try {
  for (const vp of [{ name: 'desktop', width: 1440, height: 900, dpr: 1 }, { name: 'mobile', width: 390, height: 844, dpr: 2, mobile: true }]) {
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, isMobile: !!vp.mobile, hasTouch: !!vp.mobile });
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${vp.name}] console.${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`[${vp.name}] pageerror: ${e.message}`));
    page.on('requestfailed', (r) => {
      const u = r.url();
      if (u.startsWith(BASE)) problems.push(`[${vp.name}] запрос не удался: ${u} ${r.failure()?.errorText}`);
      else external.push(`${u} ${r.failure()?.errorText}`);
    });
    page.on('response', (r) => { if (r.url().startsWith(BASE) && r.status() >= 400) problems.push(`[${vp.name}] HTTP ${r.status()} ${r.url()}`); });
    const shot = async (name) => page.screenshot({ path: path.join(OUT, `${vp.name}-${name}.png`), fullPage: true });
    const noOverflow = async (where) => ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `[${vp.name}] нет горизонтальной прокрутки (${where})`);

    // ---------- RU (по умолчанию, язык ещё не выбран) ----------
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
    await page.evaluate(() => localStorage.removeItem('kkuzya.lang'));
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('h1');
    await settle();
    const dash = await page.evaluate(() => ({
      h1: document.querySelector('h1')?.textContent,
      rows: document.querySelectorAll('table tbody tr').length,
      footer: document.querySelector('footer')?.textContent,
      lang: document.documentElement.lang,
      body: document.body.textContent,
      art: !!document.querySelector('figure img'),
    }));
    ok(dash.lang === 'ru', `[${vp.name}] язык по умолчанию — русский (html lang=${dash.lang})`);
    ok(dash.h1 === 'kkuzya', `[${vp.name}] заголовок профиля: ${dash.h1}`);
    ok(dash.rows === 10, `[${vp.name}] строк в Recent Matches: ${dash.rows}`);
    ok(/© 2026 KKUZYA\.GG/.test(dash.footer) && /Created by MiK & Co\./.test(dash.footer) && /Не связан с Valve/.test(dash.footer), `[${vp.name}] футер RU`);
    ok(/Последние 10 матчей/.test(dash.body), `[${vp.name}] RU: склонение «10 матчей»`);
    ok(/Виндикта|Скиталец|Динамо|Семь|Пелена/.test(dash.body), `[${vp.name}] RU: официальные русские имена героев`);
    if (vp.name === 'desktop') ok(dash.art, 'арт героя последнего матча виден на ПК');
    await noOverflow('Dashboard RU');
    await shot('ru-dashboard');

    // 5/10
    await page.click('[role="radiogroup"][aria-label^="Сколько"] [role="radio"]:first-child');
    await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length === 5, { timeout: 5000 }).catch(() => {});
    ok(await page.evaluate(() => document.querySelectorAll('table tbody tr').length) === 5, `[${vp.name}] 5 матчей — 5 строк`);
    ok(page.url().includes('n=5'), `[${vp.name}] n=5 в адресе`);
    await page.click('[role="radiogroup"][aria-label^="Сколько"] [role="radio"]:last-child');
    await settle();

    // Клик по матчу -> Lab
    await page.click('table tbody tr:first-child');
    await page.waitForFunction(() => location.pathname === '/lab' && location.search.includes('match='), { timeout: 5000 });
    await page.waitForSelector('[role="tab"][data-tab="combat"]');
    await settle();
    ok(await page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab')) === 'combat', `[${vp.name}] Lab открыт на Combat`);
    await shot('ru-lab-match-combat');
    for (const tab of ['timeline', 'builds']) { await clickTab(page, tab); await settle(); await noOverflow(`${tab} RU`); await shot(`ru-lab-match-${tab}`); }
    await page.evaluate(() => { const s = document.querySelector('input[type="range"]'); if (s) { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(s, s.max); s.dispatchEvent(new Event('input', { bubbles: true })); } });
    await settle();
    ok(await page.evaluate(() => document.querySelectorAll('[data-testid="inventory"] li').length) > 0, `[${vp.name}] инвентарь на последней минуте не пуст`);
    ok(/Увеличенный|Добавочн|Улучшенн|Спешн|Ртутн/.test(await page.evaluate(() => document.body.textContent)), `[${vp.name}] RU: официальные русские названия предметов`);

    await page.evaluate(() => document.querySelector('[aria-label="Выбор матча"] button')?.click());
    await settle();
    for (const tab of ['combat', 'timeline', 'builds']) { await clickTab(page, tab); await settle(1200); await shot(`ru-lab-all-${tab}`); }

    await page.goto(`${BASE}/lab?match=140650454&tab=timeline`, { waitUntil: 'networkidle0' });
    await settle();
    ok(await page.evaluate(() => document.body.textContent.includes('Карта перемещений не показывается')), `[${vp.name}] RU: карта перемещений скрыта для ненадёжного пути`);

    // ---------- EN: переключение без перезагрузки ----------
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
    await settle();
    await page.evaluate(() => { window.__noReload = 1; });
    await clickLang(page, 'en');
    await settle();
    ok(await page.evaluate(() => window.__noReload === 1), `[${vp.name}] язык переключён без перезагрузки страницы`);
    ok(await page.evaluate(() => localStorage.getItem('kkuzya.lang')) === 'en', `[${vp.name}] выбор языка сохранён в localStorage`);
    const enDash = await page.evaluate(() => ({ lang: document.documentElement.lang, body: document.body.textContent }));
    ok(enDash.lang === 'en', `[${vp.name}] html lang=en`);
    ok(/Not affiliated with Valve/.test(enDash.body) && /Created by MiK & Co\./.test(enDash.body), `[${vp.name}] футер EN`);
    ok(/Last 10 matches/.test(enDash.body), `[${vp.name}] EN: «Last 10 matches»`);
    let cyr = await cyrIn(page);
    ok(cyr.length === 0, `[${vp.name}] EN Dashboard без кириллицы: ${cyr.slice(0, 12).join(', ')}`);
    await noOverflow('Dashboard EN');
    await shot('en-dashboard');

    // Тултипы ⓘ на EN (наведение/фокус): текст подсказки тоже на английском.
    await page.focus('[aria-label^="About"]').catch(() => {});
    await settle(300);
    const tip = await page.evaluate(() => [...document.querySelectorAll('[role="tooltip"]')].map((x) => x.textContent).join(' '));
    ok(!/[А-Яа-яЁё]/.test(tip), `[${vp.name}] EN: подсказки без кириллицы`);

    await page.reload({ waitUntil: 'networkidle0' });
    await settle();
    ok(await page.evaluate(() => document.documentElement.lang) === 'en', `[${vp.name}] EN сохраняется после перезагрузки`);

    for (const url of ['/lab?tab=combat', '/lab?tab=timeline', '/lab?tab=builds', '/lab?match=142102823&tab=combat', '/lab?match=142102823&tab=timeline', '/lab?match=142102823&tab=builds', '/lab?match=140650454&tab=timeline', '/nope']) {
      await page.goto(BASE + url, { waitUntil: 'networkidle0' });
      await settle(1200);
      cyr = await cyrIn(page);
      ok(cyr.length === 0, `[${vp.name}] EN ${url} без кириллицы: ${cyr.slice(0, 12).join(', ')}`);
      await noOverflow(`EN ${url}`);
      if (!url.includes('nope')) await shot(`en-lab-${url.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`);
    }
    // Обратно на RU.
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
    await clickLang(page, 'ru');
    await settle();
    ok(await page.evaluate(() => document.documentElement.lang === 'ru' && localStorage.getItem('kkuzya.lang') === 'ru'), `[${vp.name}] обратное переключение на RU`);
    await page.close();
  }

  // Состояние «нет связи»: сервер данных отвечает ошибкой (на обоих языках).
  for (const lang of ['ru', 'en']) {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument((l) => localStorage.setItem('kkuzya.lang', l), lang);
    await page.setRequestInterception(true);
    page.on('request', (r) => (r.url().includes('/data/') ? r.respond({ status: 503, body: 'down' }) : r.continue()));
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
    await settle(9000);   // повторы запросов
    const text = await page.evaluate(() => document.body.textContent);
    ok(lang === 'ru' ? /Не удалось загрузить статистику/.test(text) : /Could not load statistics/.test(text), `[${lang}] состояние ошибки при недоступном сервере данных`);
    if (lang === 'en') { const c = await cyrIn(page); ok(c.length === 0, `[en] состояние ошибки без кириллицы: ${c.join(', ')}`); }
    ok(errs.length === 0, `[${lang}] нет исключений JS при недоступных данных: ${errs.join('; ')}`);
    await page.screenshot({ path: path.join(OUT, `desktop-${lang}-error-state.png`) });
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}

const extUniq = [...new Set(external.map((x) => x.replace(/\?.*/, '')))];
console.log(`Проверок: ${checks}, проблем: ${problems.length}`);
for (const p of problems) console.log(' - ' + p);
if (extUniq.length) { console.log(`Внешние ресурсы не загрузились (${extUniq.length}):`); extUniq.slice(0, 8).forEach((x) => console.log('   ' + x)); }
console.log(`Скриншоты: ${OUT}`);
process.exit(problems.length ? 1 : 0);
