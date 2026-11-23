import { useMemo, useState } from 'react';
import type { Combat, Dict, MatchDetail, Phase, Profile } from '../../api/types';
import { useMatches } from '../../api/queries';
import { Chart } from '../../components/Chart';
import { MiniMap, type MapPoint } from '../../components/MiniMap';
import { Bar, Card, HeroIcon, Notice, Segmented, Skeleton } from '../../components/ui';
import { C, axisCommon, tooltipBase } from '../../lib/theme';
import { useI18n, type I18n, type MessageKey } from '../../i18n';
import s from './lab.module.css';

interface Props { p: Profile; d: MatchDetail | null; dataVersion: string | undefined }
interface View {
  kills: number; deaths: number; deadS: number; deadShare: number | null; avgDeath: number | null;
  perMinute: { m: number; kills: number; deaths: number; matches: number }[];
  phases: Phase[]; victims: { heroId: number; count: number }[]; killers: { heroId: number; count: number }[];
  deathsByNonHero: number; killTypes: Combat['killTypes']; dict: Dict;
}

export function CombatTab({ p, d, dataVersion }: Props) {
  const i18n = useI18n();
  const { t, f, count } = i18n;
  const single = d != null;
  // Агрегат по выбранным матчам или один матч.
  const view = useMemo(() => (single ? fromMatch(d!) : fromProfile(p)), [single, d, p]);
  const option = useMemo(() => distOption(view.perMinute, single, i18n), [view, single, i18n]);

  return (
    <div className={s.stack}>
      <section className={s.stats} aria-label={t('combat.summary')}>
        <Stat label={t('combat.kills')} value={f.num(view.kills)} sub={single ? undefined : t('combat.perMatch', { v: f.num(view.kills / p.available, 1) })} />
        <Stat label={t('combat.deaths')} value={f.num(view.deaths)} sub={single ? undefined : t('combat.perMatch', { v: f.num(view.deaths / p.available, 1) })} />
        <Stat label={t('combat.deadShare')} value={f.pct(view.deadShare, 1)} sub={t('combat.deadTotal', { v: f.clock(view.deadS) })} />
        <Stat label={t('combat.avgDeath')} value={view.avgDeath == null ? '—' : t('unit.sec', { v: f.num(view.avgDeath, 0) })} sub={t('combat.respawn')} />
      </section>

      <Card title={t('kd.title')} subtitle={single ? t('kd.subSingle') : t('kd.subAll', { count: count(p.available) })} info={single ? t('kd.infoSingle') : t('kd.infoAll')}>
        <Chart option={option} height={260} label={t('kd.chart', { k: view.kills, d: view.deaths })} />
        <div className={s.legend}>
          <span><i style={{ background: C.accent }} />{t('combat.kills')}</span>
          <span><i style={{ background: C.loss }} />{t('combat.deaths')}</span>
        </div>
      </Card>

      <div className={s.grid2}>
        <Card title={t('phase.title')} subtitle={t('phase.sub')} info={t('phase.info')}>
          <PhaseTable phases={view.phases} />
        </Card>
        <Card title={t('kt.title')} subtitle={single ? t('kt.subSingle') : t('kt.subAll')} info={t('kt.info')}>
          <KillTypes kt={view.killTypes} />
        </Card>
      </div>

      <div className={s.grid2}>
        <Card title={t('victims.title')} subtitle={t('victims.sub')}>
          <HeroCounts rows={view.victims} dict={view.dict} empty={t('victims.empty')} color={C.accent} />
        </Card>
        <Card title={t('killers.title')} subtitle={t('killers.sub')} info={t('killers.info')}>
          <HeroCounts rows={view.killers} dict={view.dict} empty={t('killers.empty')} color={C.loss} />
          {view.deathsByNonHero > 0 && <p className={s.note}>{t('killers.nonHero', { n: view.deathsByNonHero })}</p>}
        </Card>
      </div>

      <KillMap p={p} d={d} dataVersion={dataVersion} />

      {single ? <DeathList d={d!} /> : <DeadPerMatch p={p} />}
    </div>
  );
}

/* ---------- Данные вида ---------- */
function fromProfile(p: Profile): View {
  const c = p.combat;
  return {
    kills: p.kpi!.kills, deaths: p.kpi!.deaths,
    deadS: c.dead.seconds, deadShare: c.dead.share, avgDeath: c.dead.avgDeathS,
    perMinute: c.perMinute.map((x) => ({ m: x.m, kills: x.matches ? x.kills / x.matches : 0, deaths: x.matches ? x.deaths / x.matches : 0, matches: x.matches })),
    phases: c.phases, victims: c.victims, killers: c.killers, deathsByNonHero: c.deathsByNonHero,
    killTypes: c.killTypes, dict: p.dict,
  };
}

function fromMatch(d: MatchDetail): View {
  const T = d.row.durationS;
  const perMinute = d.minutes.kills.map((k, m) => ({ m, kills: k, deaths: d.minutes.deaths[m], matches: 1 }));
  const phases: Phase[] = ([[0, 10], [10, 20], [20, 30], [30, Infinity]] as const).map(([from, to]) => {
    let kills = 0, deaths = 0, sec = 0;
    for (let m = from; m < Math.min(to, d.minutes.cover.length); m++) { kills += d.minutes.kills[m]; deaths += d.minutes.deaths[m]; sec += d.minutes.cover[m]; }
    const mins = sec / 60;
    return { from, to: Number.isFinite(to) ? to : null, label: '', kills, deaths, minutes: mins, matches: sec > 0 ? 1 : 0, killsPer10: mins ? (kills / mins) * 10 : null, deathsPer10: mins ? (deaths / mins) * 10 : null };
  }).filter((x) => x.matches > 0);
  const tally = (arr: (number | null)[]) => {
    const m = new Map<number, number>();
    for (const h of arr) if (h != null) m.set(h, (m.get(h) || 0) + 1);
    return [...m.entries()].map(([heroId, count]) => ({ heroId, count })).sort((a, b) => b.count - a.count);
  };
  const enemy = d.deathEvents.filter((e) => e.killerHero != null && e.killerTeam != null && e.killerTeam !== d.row.team);
  return {
    kills: d.row.kills, deaths: d.row.deaths,
    deadS: d.row.deadS, deadShare: T ? d.row.deadS / T : null,
    avgDeath: d.deathEvents.length ? d.row.deadS / d.deathEvents.length : null,
    perMinute, phases,
    victims: tally(d.killEvents.map((e) => e.victimHero)),
    killers: tally(enemy.map((e) => e.killerHero)),
    deathsByNonHero: d.deathEvents.length - enemy.length,
    killTypes: null,
    dict: d.dict,
  };
}

/* ---------- Блоки ---------- */
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className={s.stat}><p className={s.statLabel}>{label}</p><p className={s.statValue}>{value}</p>{sub && <p className={s.statSub}>{sub}</p>}</div>;
}

function distOption(rows: View['perMinute'], single: boolean, { t, f }: I18n) {
  const digits = single ? 0 : 2;
  const line = (label: string, v: string) => `<div style="display:flex;justify-content:space-between;gap:18px"><span>${label}</span><b>${v}</b></div>`;
  return {
    grid: { left: 8, right: 30, top: 12, bottom: 8, containLabel: true },
    tooltip: {
      ...tooltipBase, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(240,237,229,0.03)' } },
      formatter: (ps: { dataIndex: number }[]) => {
        const r = rows[ps[0]?.dataIndex ?? 0];
        const few = !single && r.matches < 3 ? `<div style="color:${C.warn};margin-top:4px">${t('kd.few', { n: r.matches })}</div>` : '';
        return `<b>${t('range.min', { a: r.m, b: r.m + 1 })}</b>${line(t('combat.kills'), f.num(r.kills, digits))}${line(t('combat.deaths'), f.num(r.deaths, digits))}${single ? '' : `<div style="color:${C.text3};margin-top:4px">${t('kd.reached', { n: r.matches })}</div>`}${few}`;
      },
    },
    xAxis: { type: 'category', data: rows.map((r) => String(r.m)), ...axisCommon, name: t('unit.min'), nameLocation: 'end', nameGap: 6,
      axisLabel: { ...axisCommon.axisLabel, interval: (i: number) => i % 5 === 0 } },
    yAxis: { type: 'value', ...axisCommon, minInterval: single ? 1 : undefined, axisLabel: { ...axisCommon.axisLabel, formatter: (v: number) => f.num(Math.abs(v), single ? 0 : 1) } },
    series: [
      { name: t('combat.kills'), type: 'bar', stack: 'kd', data: rows.map((r) => ({ value: r.kills, itemStyle: { opacity: !single && r.matches < 3 ? 0.35 : 1 } })), itemStyle: { color: C.accent, borderRadius: [3, 3, 0, 0] }, barCategoryGap: '22%' },
      { name: t('combat.deaths'), type: 'bar', stack: 'kd', data: rows.map((r) => ({ value: -r.deaths, itemStyle: { opacity: !single && r.matches < 3 ? 0.35 : 1 } })), itemStyle: { color: C.loss, borderRadius: [0, 0, 3, 3] } },
    ],
  };
}

function PhaseTable({ phases }: { phases: Phase[] }) {
  const { t, f, count } = useI18n();
  if (!phases.length) return <p className={s.note}>{t('common.noData')}</p>;
  const max = Math.max(...phases.flatMap((x) => [x.killsPer10 ?? 0, x.deathsPer10 ?? 0]), 0.1);
  return (
    <div className={s.phases}>
      {phases.map((ph) => (
        <div key={ph.from} className={s.phase}>
          <div className={s.phaseHead}>
            <b>{t(`phase.${ph.from}` as MessageKey)}</b>
            <span>{ph.to == null ? t('range.minOpen', { a: ph.from }) : t('range.min', { a: ph.from, b: ph.to })} · {count(ph.matches)}</span>
          </div>
          <div className={s.phaseRow}><span>{t('combat.kills')}</span><Bar value={ph.killsPer10 ?? 0} max={max} color={C.accent} /><b className="tabular">{f.num(ph.killsPer10, 1)}</b></div>
          <div className={s.phaseRow}><span>{t('combat.deaths')}</span><Bar value={ph.deathsPer10 ?? 0} max={max} color={C.loss} /><b className="tabular">{f.num(ph.deathsPer10, 1)}</b></div>
        </div>
      ))}
    </div>
  );
}

function KillTypes({ kt }: { kt: View['killTypes'] }) {
  const { t, f } = useI18n();
  if (!kt) return <p className={s.note}>{t('kt.single')}</p>;
  const rows = [[t('kt.ability'), kt.ability], [t('kt.bullet'), kt.bullet], [t('kt.melee'), kt.melee]] as const;
  const max = Math.max(...rows.map((r) => r[1]), 1);
  return (
    <div className={s.types}>
      {rows.map(([l, v]) => (
        <div key={l} className={s.typeRow}><span>{l}</span><Bar value={v} max={max} /><b className="tabular">{f.num(v)}</b></div>
      ))}
      <p className={s.note}>{t('kt.foot', { h: f.num(kt.headshot), k: f.num(kt.kills) })}</p>
    </div>
  );
}

function HeroCounts({ rows, dict, empty, color }: { rows: { heroId: number; count: number }[]; dict: Dict; empty: string; color: string }) {
  const { hero } = useI18n();
  if (!rows.length) return <p className={s.note}>{empty}</p>;
  const max = rows[0].count;
  return (
    <ul className={s.heroCounts}>
      {rows.slice(0, 8).map((r) => (
        <li key={r.heroId}>
          <HeroIcon heroId={r.heroId} dict={dict} size={28} />
          <span className={s.hcName}>{hero(r.heroId, dict)}</span>
          <Bar value={r.count} max={max} color={color} />
          <b className="tabular">{r.count}</b>
        </li>
      ))}
    </ul>
  );
}

function KillMap({ p, d, dataVersion }: Props) {
  const { t, count, hero } = useI18n();
  const [show, setShow] = useState<'both' | 'kill' | 'death'>('both');
  const ids = d ? [] : p.matches.map((m) => m.matchId);
  const all = useMatches(ids, dataVersion, !d);
  const details: MatchDetail[] = d ? [d] : all.map((q) => q.data).filter((x): x is MatchDetail => !!x);
  const loading = !d && all.some((q) => q.isPending);
  const map = details.find((x) => x.map)?.map ?? null;
  const points: MapPoint[] = [];
  for (const m of details) {
    if (show !== 'death') for (const e of m.killEvents) if (e.pos) points.push({ x: e.pos[0], y: e.pos[1], kind: 'kill', t: e.t, label: `${hero(e.victimHero, m.dict)}${d ? '' : ` · ${hero(m.row.heroId, m.dict)}`}` });
    if (show !== 'kill') for (const e of m.deathEvents) if (e.pos) points.push({ x: e.pos[0], y: e.pos[1], kind: 'death', t: e.t, label: e.killerHero != null ? t('map.killedBy', { hero: hero(e.killerHero, m.dict) }) : t('map.noKiller') });
  }
  return (
    <Card title={t('map.title')} subtitle={d ? t('map.subSingle') : t('map.subAll', { count: count(details.length) })} info={t('map.info')}
      actions={<Segmented label={t('map.events')} value={show} onChange={setShow} size="sm" options={[{ value: 'both', label: t('common.all') }, { value: 'kill', label: t('map.kills') }, { value: 'death', label: t('map.deaths') }]} />}>
      {loading && <Skeleton height={320} />}
      {!loading && !map && <Notice title={t('map.unavailable.title')}>{t('map.unavailable.text')}</Notice>}
      {!loading && map && (
        <div className={s.mapWrap}>
          <MiniMap radius={map.radius} image={map.minimap} points={points} label={t('map.label', { k: points.filter((x) => x.kind === 'kill').length, d: points.filter((x) => x.kind === 'death').length })} />
          <div className={s.legend}>
            <span><i style={{ background: C.accent, borderRadius: '50%' }} />{t('map.legend.kill')}</span>
            <span><i style={{ background: C.loss, transform: 'rotate(45deg)' }} />{t('map.legend.death')}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

function DeathList({ d }: { d: MatchDetail }) {
  const { t, f, hero } = useI18n();
  return (
    <Card title={t('deaths.title')} subtitle={t('deaths.sub')}>
      {d.deathEvents.length === 0 ? <p className={s.note}>{t('deaths.none')}</p> : (
        <ol className={s.deaths}>
          {d.deathEvents.map((e, i) => (
            <li key={i}>
              <span className={`${s.time} tabular`}>{f.clock(e.t)}</span>
              {e.killerHero != null ? <HeroIcon heroId={e.killerHero} dict={d.dict} size={24} /> : <span className={s.dotIcon} aria-hidden="true" />}
              <span>{e.killerHero != null ? hero(e.killerHero, d.dict) : t('map.noKiller')}</span>
              <span className={`${s.muted} tabular`}>{t('unit.sec', { v: e.dur })}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function DeadPerMatch({ p }: { p: Profile }) {
  const i18n = useI18n();
  const { t, f, hero } = i18n;
  const rows = p.combat.dead.perMatch;
  const option = useMemo(() => ({
    grid: { left: 8, right: 12, top: 12, bottom: 8, containLabel: true },
    tooltip: { ...tooltipBase, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(240,237,229,0.03)' } },
      formatter: (ps: { dataIndex: number }[]) => {
        const r = rows[ps[0]?.dataIndex ?? 0]; const m = p.matches.find((x) => x.matchId === r.matchId);
        return `<b>${m ? hero(m.heroId, p.dict) : ''}</b> · ${t('lab.match', { id: r.matchId })}<br/>${t('deadpm.tip', { t: f.clock(r.deadS), p: f.pct(r.share, 1) })}<br/>${t('deadpm.deaths', { n: r.deaths })}`;
      } },
    xAxis: { type: 'category', data: rows.map((_, i) => String(i + 1)), ...axisCommon, name: t('unit.match'), nameGap: 6 },
    yAxis: { type: 'value', ...axisCommon, axisLabel: { ...axisCommon.axisLabel, formatter: (v: number) => f.pct(v) } },
    series: [{ type: 'bar', data: rows.map((r) => r.share), barMaxWidth: 26, itemStyle: { color: 'rgba(201,138,126,0.7)', borderRadius: [5, 5, 0, 0] } }],
  }), [rows, p, t, f, hero]);
  return (
    <Card title={t('deadpm.title')} subtitle={t('deadpm.sub')}>
      <Chart option={option} height={220} label={t('deadpm.chart', { values: rows.map((r) => f.pct(r.share)).join(', ') })} />
    </Card>
  );
}
