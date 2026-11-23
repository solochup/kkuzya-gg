// Не текстовые константы интерфейса. Все тексты — в словарях i18n/ru.ts и i18n/en.ts.
import type { DnaAxis } from '../api/types';

export const DNA_AXES: DnaAxis[] = ['aggression', 'farming', 'teamplay', 'survivability', 'damage'];
export const POSITIONAL_PARTS = new Set(['enemyShare', 'allyShare']);
export const SLOTS = ['weapon', 'spirit', 'vitality', 'unknown'] as const;
export type Slot = (typeof SLOTS)[number];
export const SLOT_VARS: Record<string, string> = { weapon: 'var(--slot-weapon)', spirit: 'var(--slot-spirit)', vitality: 'var(--slot-vitality)', unknown: 'var(--text-3)' };
export const ABILITY_TYPES = new Set(['signature', 'ultimate', 'innate', 'melee']);
