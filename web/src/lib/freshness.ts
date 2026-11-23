import type { Status } from '../api/types';

/** Локальный сервер: синхронизация каждые 5 мин, данные «свежие» 20 мин. */
export const LOCAL_FRESH_MIN = 20;
/** Запас сверх интервала контрольной публикации: задержки расписания GitHub и время сборки. */
export const PUBLISHED_SLACK_MIN = 120;

/**
 * Сколько минут данные считаются свежими.
 * На Cloudflare Pages сайт публикуется только при изменениях и не реже раза в heartbeatHours,
 * поэтому возраст опубликованного status.json до этого срока — норма, а не устаревание.
 */
export function freshLimitMin(p: Status['publish'] | null | undefined): number {
  if (p && p.mode === 'on-change' && p.heartbeatHours > 0) return p.heartbeatHours * 60 + PUBLISHED_SLACK_MIN;
  return LOCAL_FRESH_MIN;
}

export function freshStateOf(st: Pick<Status, 'ok' | 'stale' | 'lastSuccessAt' | 'publish'>, now: number): 'fresh' | 'aging' | 'stale' {
  if (!st.ok || st.stale) return 'stale';
  const age = st.lastSuccessAt ? (now - st.lastSuccessAt) / 60_000 : Infinity;
  return age > freshLimitMin(st.publish) ? 'aging' : 'fresh';
}
