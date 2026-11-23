import { useEffect, useRef, useState } from 'react';
import { useStatus, DataError } from '../api/queries';
import { useNow } from '../lib/hooks';
import { useI18n } from '../i18n';
import { freshStateOf } from '../lib/freshness';
import s from './Freshness.module.css';

export type FreshState = 'loading' | 'fresh' | 'aging' | 'stale' | 'offline' | 'missing';

export function useFreshness() {
  const status = useStatus();
  const now = useNow();
  const st = status.data;
  let state: FreshState = 'loading';
  if (status.isError && !st) state = status.error instanceof DataError && status.error.kind === 'missing' ? 'missing' : 'offline';
  else if (status.isError && st) state = 'offline';
  else if (st) state = freshStateOf(st, now);
  return { state, status: st, now, query: status };
}

export function Freshness() {
  const { state, status, now } = useFreshness();
  const { t, f, syncError } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  const when = status?.lastSuccessAt ?? null;
  const label = state === 'fresh' ? t('fresh.fresh', { age: f.age(when, now) })
    : state === 'aging' ? t('fresh.aging', { time: f.timeMs(when) })
    : state === 'stale' ? t('fresh.stale', { time: f.timeMs(when) })
    : t(`fresh.${state}`);
  // Короткая подпись для узких экранов: только суть (возраст или время), без обрезки текста.
  const short = state === 'fresh' ? f.age(when, now) : state === 'aging' || state === 'stale' ? f.timeMs(when) : label;

  return (
    <div className={s.wrap} ref={ref}>
      <button type="button" className={s.btn} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((v) => !v)} title={`${t('fresh.button')}: ${label}`} aria-label={`${t('fresh.button')}: ${label}`}>
        <span className={`${s.dot} ${s[state]}`} aria-hidden="true" />
        <span className={s.text} aria-hidden="true">{label}</span>
        <span className={s.short} aria-hidden="true">{short}</span>
      </button>
      {open && (
        <div className={s.pop} role="dialog" aria-label={t('fresh.button')}>
          <dl className={s.list}>
            <div><dt>{t('fresh.lastSuccess')}</dt><dd>{when ? `${f.dateTime(when / 1000)} (${f.age(when, now)})` : t('fresh.never')}</dd></div>
            {status && (status.publish
              ? <div><dt>{t('fresh.published')}</dt><dd>{f.dateTime(status.publish.publishedAt / 1000)}</dd></div>
              : <div><dt>{t('fresh.lastCheck')}</dt><dd>{f.dateTime(status.lastAttemptAt / 1000)}</dd></div>)}
            {status && <div><dt>{t('fresh.changed')}</dt><dd>{f.dateTime(status.dataChangedAt / 1000)}</dd></div>}
            {status && <div><dt>{t('fresh.cached')}</dt><dd>{f.num(status.matches)}</dd></div>}
          </dl>
          {status && status.pending.length > 0 && <p className={s.note}>{t('fresh.pending', { ids: status.pending.map((p) => p.matchId).join(', ') })}</p>}
          {status && status.messageCode === 'no_history' && <p className={s.note}>{t('err.noHistory')}</p>}
          {status && status.errors.length > 0 && <ul className={s.errors}>{status.errors.slice(0, 4).map((e, i) => <li key={i}>{syncError(e)}</li>)}</ul>}
          {state === 'offline' && <p className={s.note}>{t('fresh.offlineNote')}</p>}
          {state === 'missing' && <p className={s.note}>{t('fresh.missingNote')}</p>}
          <p className={s.foot}>{status?.publish
            ? t('fresh.footPublished', { every: f.num(status.publish.checkEveryMin), hours: f.num(status.publish.heartbeatHours) })
            : t('fresh.foot')}</p>
        </div>
      )}
    </div>
  );
}
