// Делает папку для офлайн-прогона из ОДНОГО реального файла метаданных.
// Матчи-клоны отличаются ID, временем и длительностью (обрезка по моментам снимков).
// Справочники СИНТЕТИЧЕСКИЕ: проверяют код, а не реальный формат API.
// Использование: node tests/make-offline-fixture.mjs <metadata.json> <папка>
import fs from 'node:fs';
import path from 'node:path';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('нужно: <metadata.json> <папка>'); process.exit(2); }
const base = JSON.parse(fs.readFileSync(src, 'utf8'));
fs.mkdirSync(out, { recursive: true });
const ME = 1600662883;

function trim(meta, Tn) {
  const m = structuredClone(meta);
  const mi = m.match_info;
  mi.duration_s = Tn;
  for (const p of mi.players) {
    p.stats = p.stats.filter((s) => s.time_stamp_s <= Tn);
    const L = p.stats[p.stats.length - 1];
    p.death_details = p.death_details.filter((d) => d.game_time_s <= Tn);
    p.kills = L.kills; p.deaths = L.deaths; p.assists = L.assists; p.net_worth = L.net_worth;
    p.items = p.items.filter((i) => i.game_time_s <= Tn).map((i) => ({ ...i, sold_time_s: i.sold_time_s > Tn ? 0 : i.sold_time_s }));
  }
  return m;
}
const clone = (meta, id, shiftH) => {
  const m = structuredClone(meta);
  m.match_info.match_id = id;
  m.match_info.start_time = base.match_info.start_time - shiftH * 3600;
  return m;
};

const full = base.match_info.duration_s;
const plan = [
  { id: 900000001, T: full, h: 0 }, { id: 900000002, T: full, h: 5 }, { id: 900000003, T: 1500, h: 9 },
  { id: 900000004, T: 900, h: 20 }, { id: 900000005, T: 540, h: 30 }, { id: 900000006, T: 1800, h: 40 },
  { id: 900000007, T: full, h: 50 }, { id: 900000008, T: 1500, h: 60 },
];
const history = [];
const allItemIds = new Set();
for (const p of plan) {
  let m = p.T === full ? base : trim(base, p.T);
  m = clone(m, p.id, p.h);
  fs.writeFileSync(path.join(out, `metadata_${p.id}.json`), JSON.stringify(m));
  history.push({ match_id: p.id, start_time: m.match_info.start_time, duration_s: p.T, hero_id: 11, match_result: 0 });
  for (const pl of m.match_info.players) if (pl.account_id === ME) for (const i of pl.items) allItemIds.add(i.item_id);
}
// Намеренные поломки:
history.push({ match_id: 900000009, start_time: base.match_info.start_time - 70 * 3600, duration_s: 1800, hero_id: 11 }); // нет файла -> 404
history.push({ match_id: 900000010, start_time: base.match_info.start_time - 80 * 3600, duration_s: 1800, hero_id: 11 }); // не JSON
fs.writeFileSync(path.join(out, 'metadata_900000010.json'), '<html>oops</html>');
history.push({ match_id: 900000011, start_time: base.match_info.start_time - 90 * 3600, duration_s: 1800, hero_id: 11 }); // нет players
fs.writeFileSync(path.join(out, 'metadata_900000011.json'), JSON.stringify({ match_info: { duration_s: 1800, players: [] } }));
history.push({ ...history[0] }); // дубликат записи истории
history.push({ match_id: 900000012, start_time: base.match_info.start_time - 100 * 3600, duration_s: 0, hero_id: 11 }); // не завершён
fs.writeFileSync(path.join(out, 'history.json'), JSON.stringify(history));

// Синтетические справочники.
const ids = [...allItemIds];
const heroes = [{ id: 11, name: 'Тестовый герой', class_name: 'hero_test' }, { id: 1, name: 'Другой' }];
// Предметы: тип по гипотезе upgrade_id===1 (это тавтология, проверяем только код), 1 ID пропущен.
const kindById = new Map();
for (const pl of base.match_info.players) if (pl.account_id === ME) for (const i of pl.items) kindById.set(i.item_id, i.upgrade_id === 1 ? 'upgrade' : 'ability');
const items = ids.slice(1).map((id) => ({ id, class_name: `item_${id}`, name: `Тест-предмет ${id}`, type: kindById.get(id) === 'upgrade' || (kindById.get(id) === undefined) ? 'upgrade' : 'ability', cost: 800, item_slot_type: 'weapon' }));
fs.writeFileSync(path.join(out, 'heroes.json'), JSON.stringify(heroes));
fs.writeFileSync(path.join(out, 'items.json'), JSON.stringify(items));
console.log(`fixture: ${plan.length} матчей + 4 дефектных записи в ${out}`);
