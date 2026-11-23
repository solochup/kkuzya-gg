// Компактные справочники для сайта: из 6,5 МБ /v1/assets/items и 2 МБ /v1/assets/heroes
// остаются только поля, которые нужны интерфейсу. Классификация та же, что в items.js (buildAssetIndex).
import { buildAssetIndex } from './items.js';

const str = (v) => (typeof v === 'string' && v ? v : null);

/** Предметы: { [id]: { n, type, slot, tier, cost, icon, active, shopable, abilityType, heroes } }. Служебные weapon отброшены. */
export function slimItems(json) {
  const idx = buildAssetIndex(json, new Set());
  if (!idx) return null;
  const out = {};
  for (const [id, a] of idx.map) {
    if (a.type !== 'upgrade' && a.type !== 'ability') continue;
    out[id] = {
      n: a.name, type: a.type,
      slot: a.type === 'upgrade' ? a.slot : null,
      tier: a.type === 'upgrade' ? a.tier : null,
      cost: a.type === 'upgrade' ? a.cost : null,
      icon: a.icon ?? null,
      active: a.type === 'upgrade' ? a.active : null,
      shopable: a.type === 'upgrade' ? a.shopable : null,
      abilityType: a.type === 'ability' ? a.abilityType : null,
      heroes: a.type === 'ability' ? a.heroes : null,
    };
  }
  return out;
}

/**
 * Локализованные названия из того же справочника с ?language=<язык> (официальная локализация игры):
 * { [id]: name } только для записей, где название отличается от оригинала. Ничего не переводится вручную.
 */
export function slimNames(json, original) {
  const list = Array.isArray(json) ? json : [];
  const out = {};
  for (const o of list) {
    const id = Number(o && o.id);
    const name = str(o && o.name);
    if (!Number.isFinite(id) || !name) continue;
    if (original && !original[id]) continue;          // только то, что есть в основном словаре
    if (original && original[id].n === name) continue; // совпадает с оригиналом — не дублируем
    out[id] = name;
  }
  return out;
}

/** Герои: { [id]: { n, className, icon, card, selectable } }. Фильтра по доступности нет: нужны и старые герои. */
export function slimHeroes(json) {
  const list = Array.isArray(json) ? json : [];
  const out = {};
  for (const h of list) {
    const id = Number(h && h.id);
    if (!Number.isFinite(id)) continue;
    const im = (h.images && typeof h.images === 'object') ? h.images : {};
    out[id] = {
      n: str(h.name) ?? str(h.class_name) ?? `#${id}`,
      className: str(h.class_name),
      icon: str(im.icon_image_small_webp) ?? str(im.icon_image_small) ?? str(im.icon_hero_card_webp) ?? str(im.icon_hero_card),
      card: str(im.icon_hero_card_webp) ?? str(im.icon_hero_card),
      selectable: h.player_selectable === true && h.disabled !== true,
      inDevelopment: h.in_development === true,
    };
  }
  return out;
}

/**
 * Карта: радиус мира и миникарта. Перевод координат проверен по самому справочнику
 * (neutral_camps/entities содержат и position, и left/top_relative):
 *   left = (x + radius) / (2 * radius),  top = (radius - y) / (2 * radius).
 */
export function slimMap(json) {
  if (!json || typeof json !== 'object' || !Number.isFinite(json.radius)) return null;
  const im = json.images || {};
  const check = [];
  for (const c of [...(json.neutral_camps || []), ...((json.entities && json.entities.crates) || [])]) {
    if (Array.isArray(c.position) && Number.isFinite(c.left_relative) && Number.isFinite(c.top_relative)) check.push(c);
    if (check.length >= 40) break;
  }
  // Проверка формулы на точках справочника: максимум отклонения в долях карты.
  let maxErr = null;
  for (const c of check) {
    const [l, t] = worldToRelative(c.position[0], c.position[1], json.radius);
    const e = Math.max(Math.abs(l - c.left_relative), Math.abs(t - c.top_relative));
    maxErr = maxErr == null ? e : Math.max(maxErr, e);
  }
  return {
    radius: json.radius,
    minimap: str(im.minimap) ?? str(im.plain) ?? null,
    transformChecked: check.length,
    transformMaxError: maxErr,
    transformOk: check.length >= 5 && maxErr != null && maxErr < 0.005,
  };
}

/** Мировые координаты -> доли ширины/высоты миникарты (0..1). */
export function worldToRelative(x, y, radius) {
  return [(x + radius) / (2 * radius), (radius - y) / (2 * radius)];
}
