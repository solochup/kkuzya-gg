import { useMemo, useState } from 'react';
import type { MatchDetail, Profile } from '../../api/types';
import { Chart } from '../../components/Chart';
import { MAX_SPEED, MiniMap } from '../../components/MiniMap';
import { TrendCard } from '../../components/TrendCard';
import { Card, Notice, Segmented } from '../../components/ui';
import { C, axisCommon, tooltipBase } from '../../lib/theme';
import { useI18n, type MessageKey } from '../../i18n';
import s from './lab.module.css';

type SnapKey = 'netWorth' | 'damage' | 'taken' | 'creeps';
const SNAP: SnapKey[] = ['netWorth', 'damage', 'taken', 'creeps'];
type BucketKey = 'dmgPerMin' | 'creepsPerMin' | 'takenPerMin';
const BUCKET: { value: BucketKey; key: MessageKey; digits: number }[] = [
  { value: 'dmgPerMin', key: 'bucket.dmg', digits: 0 },
  { value: 'creepsPerMin', key: 'bucket.cs', digits: 1 },
  { value: 'takenPerMin', key: 'bucket.taken', digits: 0 },
];
const pctAxis = (f: (v: number) => string) => ({ type: 'value', min: 0, max: 1, ...axisCommon, axisLabel: { ...axisCommon.axisLabel, formatter: f } });

export function TimelineTab({ p, d }: { p: Profile; d: MatchDetail | null }) {
  const { t } = useI18n();
  return (
    <div className={s.stack}>
      {d ? <SnapshotCard d={d} /> : <BucketsCard p={p} />}
      {d ? <ProximityMatch d={d} /> : <ProximityAgg p={p} />}
      {d && <MovementCard d={d} />}
      <TrendCard p={p} title={t('trend.dnaTitle')} dnaOnly />
    </div>
  );
}

/* ---------- Один матч: точные снимки ---------- */
function SnapshotCard({ d }: { d: MatchDetail }) {
  const { t, f } = useI18n();
  const [key, setKey] = useState<SnapKey>('netWorth');
  const snaps = d.snapshots;
  const metric = t(`snap.${key}` as MessageKey);
  const option = useMemo(() => {
    const kills = d.killEvents.map((e) => e.t / 60), deaths = d.deathEvents.map((e) => e.t / 60);
    return {
      grid: { left: 8, right: 30, top: 24, bottom: 8, containLabel: true },
      tooltip: {
        ...tooltipBase, trigger: 'item',
        formatter: (q: { seriesName: string; data: [number, number] | { value: [number, number] } }) => {
          const v = Array.isArray(q.data) ? q.data : q.data.value;
          if (q.seriesName === 'kills') return t('snap.kill', { t: f.clock(v[0] * 60) });
          if (q.seriesName === 'deaths') return t('snap.death', { t: f.clock(v[0] * 60) });
          return `<b>${t('snap.point', { t: f.clock(v[0] * 60) })}</b><br/>${metric}: <b>${f.num(v[1])}</b>`;
        },
      },
      xAxis: { type: 'value', min: 0, max: Math.ceil(d.row.durationS / 60), ...axisCommon, name: t('unit.min'), nameGap: 6, splitLine: { show: false } },
      yAxis: { type: 'value', ...axisCommon, axisLabel: { ...axisCommon.axisLabel, formatter: (v: number) => f.compact(v) } },
      series: [
        {
          name: metric, type: 'line', data: [[0, 0], ...snaps.map((x) => [x.t / 60, x[key]])],
          symbol: 'circle', symbolSize: 7, showAllSymbol: true,
          lineStyle: { color: C.accent, width: 1.6, type: [6, 4] }, itemStyle: { color: C.accent, borderColor: C.surface, borderWidth: 2 },
          areaStyle: { color: 'rgba(189,164,122,0.07)' },
        },
        { name: 'kills', type: 'scatter', data: kills.map((x) => [x, 0]), symbol: 'triangle', symbolSize: 9, itemStyle: { color: C.accent }, z: 5 },
        { name: 'deaths', type: 'scatter', data: deaths.map((x) => [x, 0]), symbol: 'diamond', symbolSize: 9, itemStyle: { color: C.loss }, z: 5 },
      ],
    };
  }, [d, snaps, key, metric, t, f]);
  return (
    <Card title={t('snap.title')} subtitle={t('snap.sub', { n: snaps.length })} info={t('snap.info')}
      actions={<Segmented label={t('trend.metric')} value={key} onChange={setKey} size="sm" options={SNAP.map((k) => ({ value: k, label: t(`snap.${k}` as MessageKey) }))} />}>
      <Chart option={option} height={300} label={t('snap.chart', { metric })} />
      <div className={s.legend}>
        <span><i style={{ background: C.accent, borderRadius: '50%' }} />{t('snap.legend.point')}</span>
        <span><i className={s.dash} />{t('snap.legend.line')}</span>
        <span><i style={{ background: C.accent, clipPath: 'polygon(50% 0,100% 100%,0 100%)' }} />{t('snap.legend.kill')}</span>
        <span><i style={{ background: C.loss, transform: 'rotate(45deg) scale(.8)' }} />{t('snap.legend.death')}</span>
      </div>
    </Card>
  );
}

/* ---------- Агрегат: 5-минутные отрезки ---------- */
function BucketsCard({ p }: { p: Profile }) {
  const { t, f } = useI18n();
  const [key, setKey] = useState<BucketKey>('dmgPerMin');
  const b = p.timeline;
  const meta = BUCKET.find((x) => x.value === key)!;
  const metric = t(meta.key);
  const option = useMemo(() => ({
    grid: { left: 8, right: 12, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      ...tooltipBase, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(240,237,229,0.03)' } },
      formatter: (ps: { dataIndex: number }[]) => { const r = b[ps[0]?.dataIndex ?? 0]; return `<b>${t('range.min', { a: r.from, b: r.to })}</b><br/>${metric}: <b>≈ ${f.num(r[key], meta.digits)}</b><br/><span style="color:${C.text3}">${t('bucket.tipMatches', { n: r.n, m: r.minutes })}</span>`; },
    },
    xAxis: { type: 'category', data: b.map((r) => `${r.from}–${r.to}`), ...axisCommon },
    yAxis: { type: 'value', ...axisCommon, axisLabel: { ...axisCommon.axisLabel, formatter: (v: number) => f.num(v) } },
    series: [{ type: 'bar', data: b.map((r) => ({ value: r[key], itemStyle: { color: r.n < 3 ? 'rgba(189,164,122,0.35)' : C.accent, borderRadius: [5, 5, 0, 0] } })), barMaxWidth: 34 }],
  }), [b, key, meta, metric, t, f]);
  return (
    <Card title={t('bucket.title')} subtitle={t('bucket.sub')} info={t('bucket.info')}
      actions={<Segmented label={t('trend.metric')} value={key} onChange={setKey} size="sm" options={BUCKET.map((x) => ({ value: x.value, label: t(x.key) }))} />}>
      <Chart option={option} height={280} label={t('bucket.chart', { metric, values: b.map((r) => `${r.from}–${r.to}: ${f.num(r[key], meta.digits)}`).join('; ') })} />
      <p className={s.note}>{t('bucket.note')}</p>
    </Card>
  );
}

/* ---------- Близость: только при надёжных позициях ---------- */
function ProximityAgg({ p }: { p: Profile }) {
  const { t, f } = useI18n();
  const b = p.timeline.filter((r) => r.nPos > 0 && r.allyShare != null);
  const used = p.quality.positions.filter((x) => x.usable).length;
  const option = useMemo(() => ({
    grid: { left: 8, right: 12, top: 16, bottom: 8, containLabel: true },
    tooltip: { ...tooltipBase, trigger: 'axis', formatter: (ps: { dataIndex: number }[]) => { const r = b[ps[0]?.dataIndex ?? 0]; return `<b>${t('range.min', { a: r.from, b: r.to })}</b><br/>${t('prox.ally')}: <b>${f.pct(r.allyShare)}</b><br/>${t('prox.enemy')}: <b>${f.pct(r.enemyShare)}</b><br/><span style="color:${C.text3}">${t('prox.posMatches', { n: r.nPos })}</span>`; } },
    xAxis: { type: 'category', data: b.map((r) => `${r.from}–${r.to}`), ...axisCommon, boundaryGap: false },
    yAxis: pctAxis((v) => f.pct(v)),
    series: [
      { name: t('prox.ally'), type: 'line', data: b.map((r) => r.allyShare), smooth: 0.2, symbolSize: 6, lineStyle: { color: C.win, width: 2 }, itemStyle: { color: C.win } },
      { name: t('prox.enemy'), type: 'line', data: b.map((r) => r.enemyShare), smooth: 0.2, symbolSize: 6, lineStyle: { color: C.loss, width: 2 }, itemStyle: { color: C.loss } },
    ],
  }), [b, t, f]);
  if (!b.length) return <Card title={t('prox.title')}><Notice title={t('prox.none.title')}>{t('prox.none.text')}</Notice></Card>;
  return (
    <Card title={t('prox.title')} subtitle={t('prox.subAgg', { u: used, n: p.available })} info={t('prox.infoAgg')}>
      <Chart option={option} height={240} label={t('prox.chartAgg')} />
      <div className={s.legend}><span><i style={{ background: C.win }} />{t('prox.ally')}</span><span><i style={{ background: C.loss }} />{t('prox.enemy')}</span></div>
    </Card>
  );
}

function ProximityMatch({ d }: { d: MatchDetail }) {
  const { t, f, posReason } = useI18n();
  const pos = d.positions;
  const usable = pos.usable && !!d.minutes.alive;
  const rows = useMemo(() => {
    const out: { from: number; to: number; ally: number | null; enemy: number | null }[] = [];
    if (!usable) return out;
    const M = d.minutes.alive!.length;
    for (let b = 0; b * 5 < M; b++) {
      let al = 0, a = 0, e = 0;
      for (let m = b * 5; m < Math.min(M, b * 5 + 5); m++) { al += d.minutes.alive![m]; a += d.minutes.ally![m]; e += d.minutes.enemy![m]; }
      out.push({ from: b * 5, to: b * 5 + 5, ally: al ? a / al : null, enemy: al ? e / al : null });
    }
    return out;
  }, [d, usable]);
  const option = useMemo(() => ({
    grid: { left: 8, right: 12, top: 16, bottom: 8, containLabel: true },
    tooltip: { ...tooltipBase, trigger: 'axis', formatter: (ps: { dataIndex: number }[]) => { const r = rows[ps[0]?.dataIndex ?? 0]; return `<b>${t('range.min', { a: r.from, b: r.to })}</b><br/>${t('prox.ally')}: <b>${f.pct(r.ally)}</b><br/>${t('prox.enemy')}: <b>${f.pct(r.enemy)}</b>`; } },
    xAxis: { type: 'category', data: rows.map((r) => `${r.from}–${r.to}`), ...axisCommon, boundaryGap: false },
    yAxis: pctAxis((v) => f.pct(v)),
    series: [
      { name: t('prox.ally'), type: 'line', data: rows.map((r) => r.ally), smooth: 0.2, symbolSize: 6, lineStyle: { color: C.win, width: 2 }, itemStyle: { color: C.win } },
      { name: t('prox.enemy'), type: 'line', data: rows.map((r) => r.enemy), smooth: 0.2, symbolSize: 6, lineStyle: { color: C.loss, width: 2 }, itemStyle: { color: C.loss } },
    ],
  }), [rows, t, f]);
  if (!usable) {
    return (
      <Card title={t('prox.title')}>
        <Notice tone="warn" title={t('prox.unreliable.title')}>
          <p>{t('prox.unreliable.text', { reason: posReason(pos.reasonCode, pos.reason) })}</p>
        </Notice>
      </Card>
    );
  }
  return (
    <Card title={t('prox.title')} subtitle={t('prox.subMatch', { a: f.pct(pos.allyShare), e: f.pct(pos.enemyShare) })} info={t('prox.infoMatch')}>
      <Chart option={option} height={220} label={t('prox.chartMatch')} />
      <div className={s.legend}><span><i style={{ background: C.win }} />{t('prox.ally')}</span><span><i style={{ background: C.loss }} />{t('prox.enemy')}</span></div>
    </Card>
  );
}

/* ---------- Карта перемещений: только надёжный путь ---------- */
function MovementCard({ d }: { d: MatchDetail }) {
  const { t, posReason } = useI18n();
  const path = d.positions.path;
  return (
    <Card title={t('move.title')} subtitle={path ? t('move.sub', { s: path.stepS }) : undefined} info={t('move.info', { speed: MAX_SPEED })}>
      {!path || !d.map ? (
        <Notice tone="warn" title={t('move.hidden.title')}>
          <p>{!path ? t('move.hidden.path', { reason: posReason(d.positions.reasonCode, d.positions.reason) }) : t('move.hidden.map')}</p>
        </Notice>
      ) : (
        <div className={s.mapWrap}>
          <MiniMap radius={d.map.radius} image={d.map.minimap} path={path}
            points={d.deathEvents.filter((e) => e.pos).map((e) => ({ x: e.pos![0], y: e.pos![1], kind: 'death' as const, t: e.t, label: t('map.deathPoint') }))}
            label={t('move.label')} />
          <div className={s.legend}><span><i className={s.lineIcon} />{t('move.legend.path')}</span><span><i style={{ background: C.loss, transform: 'rotate(45deg) scale(.8)' }} />{t('snap.legend.death')}</span></div>
        </div>
      )}
    </Card>
  );
}
