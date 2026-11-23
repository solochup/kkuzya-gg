#!/usr/bin/env node
// Замер времени обработки одного матча ядром (JSON.parse + buildDigest).
// Нужен для выбора хостинга: у бесплатного Cloudflare Workers лимит около 10 мс CPU на вызов.
// Использование: node tools/bench-digest.mjs <metadata.json> [повторов=20]
import fs from 'node:fs';
import { buildDigest } from '../lib/digest.js';

const [file, nArg] = process.argv.slice(2);
if (!file) { console.error('нужно: node tools/bench-digest.mjs <metadata.json> [повторов]'); process.exit(2); }
const N = Math.max(3, Number(nArg) || 20);
const text = fs.readFileSync(file, 'utf8');
const acc = Number(process.env.ACCOUNT || 1600662883);

const stat = (a) => { const s = [...a].sort((x, y) => x - y); return { min: s[0], med: s[s.length >> 1], max: s[s.length - 1] }; };
const parse = [], digest = [], total = [];
for (let i = 0; i < N + 2; i++) {
  const t0 = performance.now();
  const j = JSON.parse(text);
  const t1 = performance.now();
  const d = buildDigest(j, acc);
  const t2 = performance.now();
  if (d.error) { console.error('ошибка сводки:', d.error); process.exit(1); }
  if (i >= 2) { parse.push(t1 - t0); digest.push(t2 - t1); total.push(t2 - t0); }   // 2 прогрева
}
const f = (o) => `мин ${o.min.toFixed(1)} / медиана ${o.med.toFixed(1)} / макс ${o.max.toFixed(1)} мс`;
console.log(`Файл: ${(text.length / 1024).toFixed(0)} КБ, повторов ${N}, Node ${process.versions.node}`);
console.log(`JSON.parse:   ${f(stat(parse))}`);
console.log(`buildDigest:  ${f(stat(digest))}`);
console.log(`Итого:        ${f(stat(total))}`);
const sz = JSON.stringify(buildDigest(JSON.parse(text), acc)).length;
console.log(`Размер сводки: ${(sz / 1024).toFixed(1)} КБ`);
