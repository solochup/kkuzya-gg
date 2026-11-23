import { useSearchParams } from 'react-router-dom';
import { useRef, type KeyboardEvent } from 'react';
import { DataGate } from '../components/DataGate';
import { useMatch, DataError } from '../api/queries';
import { useFreshness } from '../components/Freshness';
import type { Profile } from '../api/types';
import { HeroIcon, Notice, Skeleton } from '../components/ui';
import { useI18n } from '../i18n';
import { CombatTab } from './lab/CombatTab';
import { TimelineTab } from './lab/TimelineTab';
import { BuildsTab } from './lab/BuildsTab';
import s from './lab/lab.module.css';

const TABS = ['combat', 'timeline', 'builds'] as const;
type TabId = (typeof TABS)[number];

export default function Lab() {
  return <DataGate>{(p) => <LabView p={p} />}</DataGate>;
}

function LabView({ p }: { p: Profile }) {
  const { t, f, count, hero } = useI18n();
  const [params, setParams] = useSearchParams();
  const tab: TabId = TABS.find((x) => x === params.get('tab')) ?? 'combat';
  const wanted = params.get('match') ? Number(params.get('match')) : null;
  const inScope = wanted != null && p.matches.some((m) => m.matchId === wanted);
  const matchId = inScope ? wanted : null;
  const { status } = useFreshness();
  const detail = useMatch(matchId, status?.dataVersion);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v == null) next.delete(k); else next.set(k, v);
    setParams(next, { replace: k === 'tab' });
  };
  const onTabKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const j = (i + d + TABS.length) % TABS.length;
    set('tab', TABS[j]);
    tabRefs.current[j]?.focus();
  };

  const row = matchId != null ? p.matches.find((m) => m.matchId === matchId) : null;
  const result = (won: boolean | null) => (won == null ? t('result.unknown') : won ? t('result.win') : t('result.loss'));

  return (
    <div className={s.page}>
      <header className={s.head}>
        <div>
          <p className={s.eyebrow}>{t('lab.eyebrow')}</p>
          <h1 className={s.title}>{row ? `${hero(row.heroId, p.dict)} · ${f.date(row.start)}` : t('lab.titleAll', { count: count(p.available) })}</h1>
          <p className={s.lead}>{row
            ? `${result(row.won)} · ${row.kills}/${row.deaths}/${row.assists} · ${f.clock(row.durationS)} · ${t('lab.match', { id: row.matchId })}`
            : t('lab.leadAll')}</p>
        </div>
      </header>

      <div className={s.picker} role="group" aria-label={t('lab.picker')}>
        <button type="button" className={`${s.pick} ${matchId == null ? s.pickOn : ''}`} aria-pressed={matchId == null} onClick={() => set('match', null)}>
          <span className={s.pickAll}>{t('common.all')}</span>
          <span className={s.pickText}><b>{count(p.available)}</b><small>{t('lab.aggregate')}</small></span>
        </button>
        {p.matches.map((m) => (
          <button key={m.matchId} type="button" className={`${s.pick} ${matchId === m.matchId ? s.pickOn : ''}`} aria-pressed={matchId === m.matchId}
            onClick={() => set('match', String(m.matchId))} title={t('lab.matchTitle', { id: m.matchId })}>
            <HeroIcon heroId={m.heroId} dict={p.dict} size={28} />
            <span className={s.pickText}>
              <b className={m.won ? s.w : m.won === false ? s.l : ''}>{m.won == null ? '—' : m.won ? t('result.short.win') : t('result.short.loss')} · {m.kills}/{m.deaths}/{m.assists}</b>
              <small>{f.date(m.start)}</small>
            </span>
          </button>
        ))}
      </div>

      {wanted != null && !inScope && (
        <Notice tone="warn" title={t('lab.outOfScope.title')}>
          <p>{t('lab.outOfScope.text', { id: wanted, n: p.n })}</p>
        </Notice>
      )}

      <div className={s.tabs} role="tablist" aria-label={t('lab.tabs')}>
        {TABS.map((id, i) => (
          <button key={id} ref={(el) => { tabRefs.current[i] = el; }} type="button" role="tab" id={`tab-${id}`} aria-controls={`panel-${id}`}
            aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} className={`${s.tab} ${tab === id ? s.tabOn : ''}`}
            data-tab={id} onClick={() => set('tab', id)} onKeyDown={(e) => onTabKey(e, i)}>
            {t(`lab.tab.${id}`)}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className={s.panel}>
        {matchId != null && detail.isPending && <div className={s.stack}><Skeleton height={120} /><Skeleton height={320} /></div>}
        {matchId != null && detail.isError && (
          <Notice tone="error" title={t('lab.loadError.title')}>
            <p>{t('lab.loadError.text', { msg: detail.error instanceof DataError ? t(detail.error.key, { status: detail.error.status ?? '' }) : t('data.err.network') })}</p>
          </Notice>
        )}
        {(matchId == null || detail.data) && (
          tab === 'combat' ? <CombatTab p={p} d={detail.data ?? null} dataVersion={status?.dataVersion} />
          : tab === 'timeline' ? <TimelineTab p={p} d={detail.data ?? null} />
          : <BuildsTab p={p} d={detail.data ?? null} />
        )}
      </div>
    </div>
  );
}
