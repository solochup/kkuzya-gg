#!/usr/bin/env node
// Готовит папку dist-pages/ для Cloudflare Pages: собранный сайт (web/dist) + данные (data/public -> /data).
// Ничего не публикует. Публикация — отдельный шаг (см. deploy/CLOUDFLARE.md) и требует согласования.
// Подробности матчей копируются только для матчей из текущих профилей: старые файлы в data/public/matches
// остаются на диске, но на сайт не попадают.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function preparePages({ dist = path.join(ROOT, 'web', 'dist'), data = path.join(ROOT, 'data', 'public'), out = path.join(ROOT, 'dist-pages') } = {}) {
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('Нет web/dist: сначала npm run build');
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(data, f), 'utf8')); } catch { return null; } };
  const profiles = fs.readdirSync(data).filter((f) => /^profile-\d+\.json$/.test(f));
  if (!profiles.includes('profile-10.json') || !read('profile-10.json')) throw new Error('Нет data/public/profile-10.json: сначала npm run sync');
  if (!read('status.json')) throw new Error('Нет data/public/status.json: сначала npm run sync');

  const ids = new Set();
  for (const f of profiles) for (const m of (read(f)?.matches || [])) ids.add(Number(m.matchId));
  const missing = [...ids].filter((id) => !fs.existsSync(path.join(data, 'matches', `${id}.json`)));

  fs.rmSync(out, { recursive: true, force: true });   // dist-pages — только сгенерированные файлы
  fs.cpSync(dist, out, { recursive: true });
  fs.mkdirSync(path.join(out, 'data', 'matches'), { recursive: true });
  for (const f of [...profiles, 'status.json']) fs.copyFileSync(path.join(data, f), path.join(out, 'data', f));
  for (const id of ids) if (!missing.includes(id)) fs.copyFileSync(path.join(data, 'matches', `${id}.json`), path.join(out, 'data', 'matches', `${id}.json`));

  let files = 0, bytes = 0, maxFile = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { const s = fs.statSync(p).size; files++; bytes += s; maxFile = Math.max(maxFile, s); } } };
  walk(out);
  return { out, files, bytes, maxFile, matches: ids.size - missing.length, missing };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const r = preparePages();
    console.log(`Готово: ${r.out} — ${r.files} файлов, ${(r.bytes / 1024 / 1024).toFixed(2)} МБ, крупнейший ${(r.maxFile / 1024).toFixed(0)} КБ; матчей ${r.matches} (лимит Pages: 20 000 файлов, 25 МиБ на файл).`);
    if (r.missing.length) console.log(`Внимание: нет подробностей матчей ${r.missing.join(', ')} — на сайте они покажутся как недоступные.`);
    if (r.files > 19000 || r.maxFile > 25 * 1024 * 1024) { console.error('Пакет превышает лимиты Cloudflare Pages Free.'); process.exit(1); }
  } catch (e) { console.error(e.message); process.exit(1); }
}
