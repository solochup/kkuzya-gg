// Предметы: что считать покупкой, а что улучшением способности. Справочник предметов и героев.
import { extractList } from './history.js';
import { mean } from './util.js';

/**
 * Запасное правило, когда ID нет в справочнике: у покупок в магазине upgrade_id === 1, у способностей иначе.
 * Сверено с https://api.deadlock-api.com/v1/assets/items: 326 из 326 записей (10 матчей, 7 героев) совпали.
 * Основное правило — тип из справочника (см. assetKind).
 */
export function heuristicKind(it) {
  return it.up === 1 ? 'shop' : 'ability';
}

function listFrom(json) {
  const l = extractList(json);
  if (l) return l.filter((x) => x && typeof x === 'object');
  if (json && typeof json === 'object') return Object.values(json).filter((x) => x && typeof x === 'object');
  return [];
}

/**
 * Справочник по числовому ID. Ключ ID выбирается автоматически по числу совпадений с реальными ID.
 * Формат /v1/assets/items: массив, type = 'upgrade' (магазин) | 'ability' (способность героя) | 'weapon' (служебное).
 * У upgrade: item_slot_type, item_tier, cost, shopable, disabled, is_active_item, shop_image(_webp).
 * У ability: ability_type (signature/ultimate/innate/melee…), heroes.
 * shopable:false / disabled:true на классификацию НЕ влияют: убранный из магазина предмет в старом матче всё равно покупка.
 */
export function buildAssetIndex(json, wantedIds) {
  const list = listFrom(json);
  if (!list.length) return null;
  let best = { key: 'id', hits: -1 };
  for (const key of ['id', 'item_id', 'itemId', 'class_id', 'hero_id']) {
    let hits = 0;
    for (const o of list) if (wantedIds.has(Number(o[key]))) hits++;
    if (hits > best.hits) best = { key, hits };
  }
  const map = new Map();
  for (const o of list) {
    const id = Number(o[best.key]);
    if (!Number.isFinite(id)) continue;
    const type = ((o.type ?? o.item_type ?? '') + '').toLowerCase() || null;
    const str = (v) => (typeof v === 'string' && v ? v : null);
    const bool = (v) => (typeof v === 'boolean' ? v : null);
    const image = str(o.image), imageWebp = str(o.image_webp), shopImage = str(o.shop_image), shopImageWebp = str(o.shop_image_webp);
    map.set(id, {
      name: o.name ?? o.class_name ?? null, className: o.class_name ?? null,
      type,
      slot: o.item_slot_type ?? o.slot ?? null, cost: o.cost ?? null, tier: o.item_tier ?? o.tier ?? null,
      // Прежнее поле image сохранено как было.
      image: image ?? shopImage ?? imageWebp ?? null,
      imageWebp, shopImage, shopImageWebp,
      // Картинка для показа: у магазинных — карточка магазина, у остальных — обычная иконка.
      icon: type === 'upgrade' ? (shopImageWebp ?? shopImage ?? imageWebp ?? image) : (imageWebp ?? image),
      shopable: bool(o.shopable), disabled: bool(o.disabled), active: bool(o.is_active_item),
      abilityType: str(o.ability_type),
      heroes: Array.isArray(o.heroes) ? o.heroes.map(Number).filter(Number.isFinite) : null,
    });
  }
  return { map, idKey: best.key, size: list.length, sampleKeys: Object.keys(list[0]).slice(0, 30), hits: best.hits };
}

export const assetKind = (a) => (!a ? null : a.type === 'ability' ? 'ability' : a.type === 'upgrade' ? 'shop' : a.type ? `other:${a.type}` : 'unknown');

/** Итоговый вид записи: по справочнику, если нашлась; иначе по гипотезе. */
export function finalKind(it, idx) {
  const a = idx && idx.map.get(Number(it.id));
  const ak = assetKind(a);
  if (ak && ak !== 'unknown') return { kind: ak, source: 'assets', asset: a };
  return { kind: heuristicKind(it), source: 'heuristic', asset: a || null };
}

export function collectItemIds(digests) {
  const s = new Set();
  for (const d of digests) for (const it of d.items) s.add(Number(it.id));
  return s;
}

/** Таблица согласия «гипотеза» и «справочник». */
export function classificationReport(digests, idx) {
  const pairs = new Map();
  let total = 0, found = 0;
  const missing = new Map();
  for (const d of digests) {
    for (const it of d.items) {
      total++;
      const a = idx && idx.map.get(Number(it.id));
      const ak = assetKind(a);
      if (a) found++; else missing.set(it.id, (missing.get(it.id) || 0) + 1);
      const key = `${heuristicKind(it)} | ${ak ?? 'нет в справочнике'}`;
      pairs.set(key, (pairs.get(key) || 0) + 1);
    }
  }
  const agree = [...pairs.entries()].filter(([k]) => /^shop \| shop$|^ability \| ability$/.test(k)).reduce((s, [, v]) => s + v, 0);
  const comparable = [...pairs.entries()].filter(([k]) => !k.endsWith('нет в справочнике') && !k.endsWith('| unknown')).reduce((s, [, v]) => s + v, 0);
  return {
    total, found, coverage: total ? found / total : null,
    pairs: [...pairs.entries()].sort((a, b) => b[1] - a[1]),
    agreement: comparable ? agree / comparable : null, comparable,
    missingSample: [...missing.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, n]) => ({ id, n })),
  };
}

/** Состояние инвентаря на секунду t: куплено до t и не продано к t. Только покупки из магазина. */
export function inventoryAt(items, t, idx) {
  return items.filter((it) => it.t <= t && (!it.sold || it.sold > t) && finalKind(it, idx).kind === 'shop');
}

export function aggregateItems(digests, idx, topN = 15) {
  const per = new Map();
  const finalCounts = [], soldCounts = [], shopCounts = [], abilityCounts = [];
  for (const d of digests) {
    const seen = new Map();
    let shop = 0, ability = 0, sold = 0, finalInv = 0;
    for (const it of d.items) {
      const k = finalKind(it, idx);
      if (k.kind === 'shop') {
        shop++;
        if (it.sold) sold++; else finalInv++;
        if (!seen.has(it.id)) seen.set(it.id, { t: it.t, sold: !!it.sold, name: k.asset && k.asset.name });
      } else if (k.kind === 'ability') ability++;
    }
    finalCounts.push(finalInv); soldCounts.push(sold); shopCounts.push(shop); abilityCounts.push(ability);
    for (const [id, v] of seen) {
      const r = per.get(id) || { id, name: v.name, matches: 0, times: [], soldMatches: 0 };
      r.matches++; r.times.push(v.t); if (v.sold) r.soldMatches++;
      per.set(id, r);
    }
  }
  const n = digests.length;
  const rows = [...per.values()]
    .map((r) => ({ id: r.id, name: r.name, matches: r.matches, share: n ? r.matches / n : 0, avgMin: mean(r.times) / 60, soldMatches: r.soldMatches }))
    .sort((a, b) => b.matches - a.matches || a.avgMin - b.avgMin);
  return {
    top: rows.slice(0, topN),
    almostAlways: rows.filter((r) => r.share >= 0.8).length,
    perMatch: { shop: shopCounts, ability: abilityCounts, soldShop: soldCounts, finalShop: finalCounts },
  };
}

/** Справочник героев: ID -> название. */
export function buildHeroIndex(json, wantedIds) {
  const idx = buildAssetIndex(json, wantedIds);
  if (!idx) return null;
  const names = new Map([...idx.map.entries()].map(([id, a]) => [id, a.name]));
  return { names, idKey: idx.idKey, size: idx.size, hits: idx.hits, sampleKeys: idx.sampleKeys };
}
