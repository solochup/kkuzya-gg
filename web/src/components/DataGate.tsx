import type { ReactNode } from 'react';
import { useProfile, DataError } from '../api/queries';
import type { Profile, Status } from '../api/types';
import { useFreshness } from './Freshness';
import { EmptyState, LoadingPage, Notice } from './ui';
import { useMatchCount } from '../lib/hooks';
import { useI18n } from '../i18n';

/**
 * Загружает профиль на выбранные 5/10 матчей и показывает честные состояния:
 * загрузка, данные не подготовлены, ошибка, пустой профиль; над содержимым — предупреждение об устаревших данных.
 */
export function DataGate({ children }: { children: (p: Profile, status: Status | undefined) => ReactNode }) {
  const [n] = useMatchCount();
  const fresh = useFreshness();
  const profile = useProfile(n, fresh.status?.dataVersion);
  const { t, f, count, syncError } = useI18n();

  if (profile.isPending) return <LoadingPage />;

  if (profile.isError && !profile.data) {
    const e = profile.error;
    const missing = e instanceof DataError && e.kind === 'missing';
    return (
      <EmptyState title={missing ? t('gate.missing.title') : t('gate.error.title')}>
        <p>{e instanceof DataError ? t(e.key, { status: e.status ?? '' }) : t('data.err.network')}</p>
        <p>{missing ? t('gate.missing.hint') : t('gate.error.hint')}</p>
      </EmptyState>
    );
  }

  const p = profile.data!;
  if (!p.available || !p.kpi) {
    return (
      <EmptyState title={t('gate.empty.title')}>
        <p>{t('gate.empty.text')}</p>
        {fresh.status && fresh.status.pending.length > 0 && <p>{t('gate.empty.pending', { count: count(fresh.status.pending.length) })}</p>}
      </EmptyState>
    );
  }

  const st = fresh.status;
  const warn = fresh.state === 'stale' || fresh.state === 'offline' || fresh.state === 'aging';
  return (
    <>
      {warn && (
        <div style={{ marginBottom: 'var(--space-5)' }}>
          <Notice tone="warn" title={t(fresh.state === 'offline' ? 'gate.stale.offline' : fresh.state === 'stale' ? 'gate.stale.stale' : 'gate.stale.aging')}>
            <p>
              {t('gate.stale.text')}
              {st?.lastSuccessAt ? t('gate.stale.when', { date: f.dateTime(st.lastSuccessAt / 1000), age: f.age(st.lastSuccessAt, fresh.now) }) : ''}.
              {st && st.errors[0] ? t('gate.stale.cause', { cause: syncError(st.errors[0]) }) : ''}
            </p>
          </Notice>
        </div>
      )}
      {children(p, st)}
    </>
  );
}
