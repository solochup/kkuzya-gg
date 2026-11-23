import { useState } from 'react';
import type { Profile } from '../../api/types';
import { Badge, InfoTip } from '../../components/ui';
import { useI18n } from '../../i18n';
import s from './dashboard.module.css';

/** Компактный арт героя последнего матча (портрет из справочника героев). Без баннера и не за статистикой. */
function LastHeroArt({ p }: { p: Profile }) {
  const { t, hero } = useI18n();
  const [broken, setBroken] = useState(false);
  const last = p.matches[0];
  const art = last ? p.dict.heroes[String(last.heroId)]?.card : null;
  if (!last || !art || broken) return null;
  const name = hero(last.heroId, p.dict);
  return (
    <figure className={s.heroArt}>
      <img src={art} alt={t('profile.heroArtAlt', { hero: name })} loading="eager" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      <figcaption><span>{t('profile.lastHero')}</span><b>{name}</b></figcaption>
    </figure>
  );
}

export function ProfileHeader({ p }: { p: Profile }) {
  const { t, f, count } = useI18n();
  const pl = p.player;
  const name = pl?.name || 'kkuzya';
  const starts = p.matches.map((m) => m.start);
  const from = Math.min(...starts), to = Math.max(...starts);
  const brawl = p.quality.skipped.filter((x) => x.kind === 'mode').length;
  const failed = p.quality.skipped.filter((x) => x.kind === 'failed');
  return (
    <section className={s.profile} aria-label={t('profile.label')}>
      <div className={s.avatar}>
        {pl?.avatar
          ? <img src={pl.avatar} alt={t('profile.avatarAlt', { name })} width={72} height={72} referrerPolicy="no-referrer" />
          : <span aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>}
      </div>
      <div className={s.profileMain}>
        <p className={s.eyebrow}>{t('profile.eyebrow')}</p>
        <h1 className={s.name}>{name}</h1>
        <p className={s.profileMeta}>
          <span>{t('profile.accountId')} <span className="tabular">{pl?.accountId ?? '—'}</span></span>
          {pl?.profileUrl && <a href={pl.profileUrl} target="_blank" rel="noreferrer noopener" className={s.extLink}>{t('profile.steam')}</a>}
        </p>
      </div>
      <div className={s.scope}>
        <p className={s.scopeMain}>
          {p.available < p.n ? t('profile.available', { a: p.available, n: p.n }) : t('profile.last', { count: count(p.available) })}
        </p>
        <p className={s.scopeSub}>{t('profile.scope', { from: f.date(from), to: f.date(to) })}</p>
        <div className={s.scopeBadges}>
          {brawl > 0 && <Badge title={t('profile.noBrawlTitle')}>{t('profile.noBrawl', { n: brawl })}</Badge>}
          {failed.length > 0 && <Badge tone="warn" title={failed.map((x) => String(x.matchId)).join(', ')}>{t('profile.failed', { n: failed.length })}</Badge>}
        </div>
      </div>
      <LastHeroArt p={p} />
    </section>
  );
}

function Kpi({ label, value, sub, info, tone }: { label: string; value: string; sub?: string; info?: string; tone?: 'accent' }) {
  const { t } = useI18n();
  return (
    <div className={`${s.kpi} ${tone === 'accent' ? s.kpiAccent : ''}`}>
      <p className={s.kpiLabel}>{label}{info && <InfoTip label={t('kpi.infoAbout', { label })}>{info}</InfoTip>}</p>
      <p className={s.kpiValue}>{value}</p>
      {sub && <p className={s.kpiSub}>{sub}</p>}
    </div>
  );
}

export function KpiGrid({ p }: { p: Profile }) {
  const { t, f, count } = useI18n();
  const k = p.kpi!;
  return (
    <section className={s.kpis} aria-label={t('kpi.label')}>
      <Kpi tone="accent" label={t('kpi.winRate')} value={f.pct(k.winRate)} sub={`${count(k.wins, 'win')} · ${count(k.losses, 'loss')}`} info={t('kpi.winRate.info')} />
      <Kpi label={t('kpi.kda')} value={f.num(k.kda, 2)} sub={t('kpi.kda.sub', { k: f.num(k.killsAvg, 1), d: f.num(k.deathsAvg, 1), a: f.num(k.assistsAvg, 1) })} info={t('kpi.kda.info')} />
      <Kpi label={t('kpi.dmg')} value={f.num(k.dmgPerMin)} sub={t('kpi.dmg.sub', { v: f.num(k.dmgTakenPerMin) })} info={t('kpi.dmg.info')} />
      <Kpi label={t('kpi.duration')} value={f.duration(k.avgDurationS)} sub={t('kpi.duration.sub', { v: f.num(k.minutes) })} />
      <Kpi label={t('kpi.cs')} value={f.num(k.csPerMin, 1)} sub={t('kpi.cs.sub', { v: f.pct(k.creepEfficiency) })} info={t('kpi.cs.info')} />
      <Kpi label={t('kpi.souls')} value={f.num(k.netWorthPerMin)} sub={t('kpi.souls.sub', { v: f.num(k.lastHitsAvg) })} info={t('kpi.souls.info')} />
      <Kpi label={t('kpi.acc')} value={f.pct(k.accuracy, 1)} sub={t('kpi.acc.sub')} info={t('kpi.acc.info')} />
      <Kpi label={t('kpi.dead')} value={f.pct(k.deadShare, 1)} sub={t('kpi.dead.sub', { v: f.num(k.deathsAvg, 1) })} info={t('kpi.dead.info')} />
    </section>
  );
}
