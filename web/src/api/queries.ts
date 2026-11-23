import { useQueries, useQuery } from '@tanstack/react-query';
import type { MatchDetail, Profile, Status } from './types';

/** Ошибка загрузки данных сайта. Текст не хранится: интерфейс переводит его по ключу (data.err.*). */
export class DataError extends Error {
  readonly key: 'data.err.network' | 'data.err.missing' | 'data.err.http' | 'data.err.format';
  constructor(readonly kind: 'network' | 'missing' | 'format', readonly status?: number) {
    super(`data error: ${kind}${status ? ` ${status}` : ''}`);
    this.key = kind === 'missing' ? 'data.err.missing' : kind === 'format' ? 'data.err.format' : status ? 'data.err.http' : 'data.err.network';
  }
}

async function getJson<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { cache: 'no-cache', headers: { accept: 'application/json' } });
  } catch {
    throw new DataError('network');
  }
  if (res.status === 404) throw new DataError('missing', 404);
  if (!res.ok) throw new DataError('network', res.status);
  try {
    return (await res.json()) as T;
  } catch {
    throw new DataError('format', res.status);
  }
}

const retry = (count: number, e: unknown) => !(e instanceof DataError && e.kind === 'missing') && count < 3;

/** Статус синхронизации: маленький файл, опрашивается раз в минуту. */
export function useStatus() {
  return useQuery({
    queryKey: ['status'],
    queryFn: () => getJson<Status>('/data/status.json'),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry,
    staleTime: 30_000,
  });
}

/** Профиль перезапрашивается только когда меняется dataVersion из статуса. */
export function useProfile(n: 5 | 10, dataVersion: string | undefined) {
  return useQuery({
    queryKey: ['profile', n, dataVersion ?? 'none'],
    queryFn: () => getJson<Profile>(`/data/profile-${n}.json`),
    staleTime: Infinity,
    placeholderData: (prev) => prev,
    retry,
  });
}

/** Подробности нескольких матчей (для карты по всем выбранным матчам). */
export function useMatches(ids: number[], dataVersion: string | undefined, enabled = true) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: ['match', id, dataVersion ?? 'none'],
      queryFn: () => getJson<MatchDetail>(`/data/matches/${id}.json`),
      enabled,
      staleTime: Infinity,
      retry,
    })),
  });
}

export function useMatch(matchId: number | null, dataVersion: string | undefined) {
  return useQuery({
    queryKey: ['match', matchId, dataVersion ?? 'none'],
    queryFn: () => getJson<MatchDetail>(`/data/matches/${matchId}.json`),
    enabled: matchId != null,
    staleTime: Infinity,
    placeholderData: (prev) => (prev && prev.row.matchId === matchId ? prev : undefined),
    retry,
  });
}
