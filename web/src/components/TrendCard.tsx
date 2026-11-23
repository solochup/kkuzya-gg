import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DnaAxis, Profile, TrendPoint } from '../api/types';
import { Chart } from './Chart';
import { Card, Segmented, ToggleChips } from './ui';
import { C, axisCommon, tooltipBase } from '../lib/theme';
import { DNA_AXES } from '../lib/labels';
import { useMatchCount, withCount } from '../lib/hooks';
import { useI18n, type I18n, type MessageKey } from '../i18n';
import tc from './TrendCard.module.css';

type StatKey = 'kda' | 'dmgPerMin' | 'csPerMin' | 'netWorthPerMin' | 'accuracy';
const STATS: { value: StatKey; unit: string; digits: number }[] = [
  { value: 'kda', unit: '', digits: 2 },
  { value: 'dmgPerMin', unit: '', digits: 0 },
  { value: 'csPerMin', unit: '', digits: 1 },
  { value: 'netWorthPerMin', unit: '', digits: 0 },
  { value: 'accuracy', unit: '%', digits: 1 },
];

export function TrendCard({ p, title, defaultMode = 'dna', dnaOnly = false }: { p: Profile; title?: string; defaultMode?: 'dna' | 'stats'; dnaOnly?: boolean }) {
  const i18n = useI18n();
  const { t, f } = i18n;
  const [mode, setMode] = useState<'dna' | 'stats'>(dnaOnly ? 'dna' : defaultMode);
  const [axes, setAxes] = useState<DnaAxis[]>(['aggression', 'damage', 'survivability']);
  const [stat, setStat] = useState<StatKey>('kda');
  const [n] = useMatchCount();
  const nav = useNavigate();
  const pts = p.trend;

  const option = useMemo(() => buildOption(pts, p, mode, axes, stat, i18n), [pts, p, mode, axes, stat, i18n]);
  const st = STATS.find((x) => x.value === stat)!;
  const statLabel = (k: StatKey) => t(`stat.${k}` as MessageKey);
  const label = mode === 'dna'
    ? t('trend.chartDna', { n: pts.length, axes: axes.map((a) => t(`dna.axis.${a}` as MessageKey)).join(', ') })
    : t('trend.chartStats', { metric: statLabel(stat), n: pts.length, values: pts.map((x) => f.num(x.stats[stat], st.digits)).join(', ') });

  return (
    <Card
      className={tc.card}
      title={title ?? t('trend.title')}
      subtitle={t('trend.subtitle')}
      info={mode === 'dna' ? t('trend.info.dna') : t('trend.info.stats')}
      actions={!dnaOnly && <Segmented label={t('trend.mode')} value={mode} onChange={setMode} size="sm" options={[{ value: 'dna', label: t('trend.mode.dna') }, { value: 'stats', label: t('trend.mode.stats') }]} />}
    >
      <div style={{ marginBottom: 12 }}>
        {mode === 'dna'
          ? <ToggleChips label={t('trend.axesLabel')} values={axes} onChange={setAxes}
              options={DNA_AXES.map((a, i) => ({ value: a, label: t(`dna.axis.${a}` as MessageKey), color: C.series[i] }))} />
          : <Segmented label={t('trend.metric')} value={stat} onChange={setStat} size="sm" options={STATS.map((x) => ({ value: x.value, label: statLabel(x.value) }))} />}
      </div>
      <div className={tc.fill}>
        <Chart option={option} label={label} height="auto" onClickData={(i) => { const m = pts[i]; if (m) nav(withCount('/lab', n, { match: String(m.matchId) })); }} />
      </div>
    </Card>
  );
}

function buildOption(pts: TrendPoint[], p: Profile, mode: 'dna' | 'stats', axes: DnaAxis[], stat: StatKey, i18n: I18n) {
  const { t, f, hero, exclReason } = i18n;
  const cats = pts.map((_x, i) => `${i + 1}`);
  const tipHead = (i: number) => {
    const m = pts[i];
    const res = m.won == null ? '' : m.won ? `<span style="color:${C.win}">${t('result.win')}</span>` : `<span style="color:${C.loss}">${t('result.loss')}</span>`;
    return `<div style="margin-bottom:6px"><b>${hero(m.heroId, p.dict)}</b> · ${res}<br/><span style="color:${C.text3}">${f.date(m.start)} · ${t('trend.match', { id: m.matchId })}</span></div>`;
  };
  const xAxis = {
    type: 'category', data: cats, boundaryGap: mode === 'stats',
    ...axisCommon,
    // Дата подписывается только у первого матча дня, чтобы не повторять одинаковые подписи.
    axisLabel: { ...axisCommon.axisLabel, interval: 0, hideOverlap: true, formatter: (_v: string, i: number) => (i > 0 && f.date(pts[i - 1]?.start) === f.date(pts[i]?.start) ? '' : f.date(pts[i]?.start)) },
  };
  const grid = { left: 8, right: 16, top: 16, bottom: 8, containLabel: true };

  if (mode === 'dna') {
    return {
      grid, xAxis,
      yAxis: { type: 'value', min: 0, max: 100, interval: 25, ...axisCommon },
      tooltip: {
        ...tooltipBase, trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: C.lineStrong } },
        formatter: (ps: { dataIndex: number; seriesName: string; value: number | null; color: string }[]) => {
          const i = ps[0]?.dataIndex ?? 0; const m = pts[i];
          const rows = ps.filter((x) => x.seriesName !== '50').map((x) => `<div style="display:flex;justify-content:space-between;gap:18px"><span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${x.color};margin-right:6px"></span>${x.seriesName}</span><b>${x.value ?? '—'}</b></div>`).join('');
          const note = !m.dnaEligible ? `<div style="color:${C.warn};margin-top:6px">${t('trend.notInDna', { reason: exclReason(m.dnaExcludedCode, m.dnaExcludedReason) })}</div>` : !m.positionsUsable ? `<div style="color:${C.text3};margin-top:6px">${t('trend.noPos')}</div>` : '';
          return tipHead(i) + rows + note;
        },
      },
      series: [
        { name: '50', type: 'line', data: cats.map(() => 50), symbol: 'none', silent: true, lineStyle: { color: C.lineStrong, type: 'dashed', width: 1 }, tooltip: { show: false } },
        ...DNA_AXES.filter((a) => axes.includes(a)).map((a) => {
          const color = C.series[DNA_AXES.indexOf(a)];
          return {
            name: t(`dna.axis.${a}` as MessageKey), type: 'line', smooth: 0.25, connectNulls: false,
            data: pts.map((m) => ({ value: m.dna[a], symbol: 'circle', symbolSize: m.positionsUsable ? 7 : 8, itemStyle: m.positionsUsable ? { color, borderColor: C.surface, borderWidth: 2 } : { color: C.surface, borderColor: color, borderWidth: 2 } })),
            lineStyle: { color, width: 2 }, itemStyle: { color },
            emphasis: { focus: 'series' },
          };
        }),
      ],
    };
  }

  const st = STATS.find((x) => x.value === stat)!;
  const statLabel = t(`stat.${stat}` as MessageKey);
  const vals = pts.map((m) => m.stats[stat]);
  const finite = vals.filter((v): v is number => typeof v === 'number');
  const avg = finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : null;
  return {
    grid, xAxis,
    yAxis: { type: 'value', ...axisCommon, scale: stat !== 'accuracy', axisLabel: { ...axisCommon.axisLabel, formatter: (v: number) => f.num(v, st.digits === 2 ? 1 : 0) + st.unit } },
    tooltip: {
      ...tooltipBase, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(240,237,229,0.03)' } },
      formatter: (ps: { dataIndex: number; value: number | null }[]) => {
        const i = ps[0]?.dataIndex ?? 0; const m = pts[i];
        return tipHead(i) + `<div style="display:flex;justify-content:space-between;gap:18px"><span>${statLabel}</span><b>${f.num(vals[i], st.digits)}${st.unit}</b></div><div style="color:${C.text3}">${t('trend.kdaLine', { k: m.stats.kills, d: m.stats.deaths, a: m.stats.assists, min: f.num(m.stats.durationMin, 0) })}</div>`;
      },
    },
    series: [{
      name: statLabel, type: 'bar', barMaxWidth: 26,
      data: pts.map((m, i) => ({ value: vals[i], itemStyle: { color: m.won ? C.accent : 'rgba(189,164,122,0.38)', borderRadius: [5, 5, 0, 0] } })),
      markLine: avg == null ? undefined : { silent: true, symbol: 'none', lineStyle: { color: C.text3, type: 'dashed' }, label: { color: C.text3, formatter: t('trend.avg', { v: `${f.num(avg, st.digits)}${st.unit}` }), position: 'insideEndTop', fontSize: 11 }, data: [{ yAxis: avg }] },
    }],
  };
}
