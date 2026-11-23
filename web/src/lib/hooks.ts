import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/** Текущее время, обновляется раз в intervalMs (для «N мин назад»). */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Сколько матчей анализировать: ?n=5 или ?n=10 (по умолчанию 10). */
export function useMatchCount(): [5 | 10, (n: 5 | 10) => void] {
  const [params, setParams] = useSearchParams();
  const n = params.get('n') === '5' ? 5 : 10;
  const set = (v: 5 | 10) => {
    const next = new URLSearchParams(params);
    if (v === 10) next.delete('n'); else next.set('n', '5');
    setParams(next, { replace: true });
  };
  return [n, set];
}

/** Ссылка с сохранением ?n. */
export function withCount(path: string, n: 5 | 10, extra?: Record<string, string>) {
  const q = new URLSearchParams(extra);
  if (n === 5) q.set('n', '5');
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
