import { useMemo, useState } from 'react';
import type { DnaAxis, Profile } from '../../api/types';
import { Chart } from '../../components/Chart';
import { Card, InfoTip } from '../../components/ui';
import { C, FONT, tooltipBase } from '../../lib/theme';
import { POSITIONAL_PARTS } from '../../lib/labels';
import { useI18n, type MessageKey } from '../../i18n';
import s from './dashboard.module.css';

export function DnaCard({ p }: { p: Profile }) {
  const { t, f, count, exclReason } = useI18n();
  const axes = p.dna.axes;
  const [focus, setFocus] = useState<DnaAxis>(axes[0]);
  const scores = p.dna.scores;
  const axisName = (a: DnaAxis) => t(`dna.axis.${a}` as MessageKey);

  const option = useMemo(() => ({
    tooltip: {
      ...tooltipBase,
      trigger: 'item',
      formatter: () => axes.map((a) => `<div style="display:flex;justify-content:space-between;gap:18px"><span style="color:${C.text2}">${axisName(a)}</span><b>${scores[a].score ?? '—'}</b></div>`).join(''),
    },
    radar: {
      indicator: axes.map((a) => ({ name: axisName(a), max: 100, min: 0 })),
      radius: '64%',
      center: ['50%', '54%'],
      axisNameGap: 10,
      splitNumber: 4,
      shape: 'polygon',
      axisName: { color: C.text2, fontFamily: FONT, fontSize: 12, fontWeight: 500 },
      axisLine: { lineStyle: { color: C.line } },
      splitLine: { lineStyle: { color: [C.line, C.line, C.line, C.lineStrong] } },
      splitArea: { areaStyle: { color: ['rgba(240,237,229,0.012)', 'transparent'] } },
    },
    series: [
      {
        type: 'radar',
        symbol: 'circle',
        symbolSize: 6,
        data: [
          { value: axes.map(() => 50), name: t('dna.lobbyAvg'), lineStyle: { color: C.text3, type: 'dashed', width: 1 }, itemStyle: { color: 'transparent' }, symbolSize: 0, areaStyle: { color: 'transparent' }, emphasis: { disabled: true }, silent: true },
          {
            value: axes.map((a) => scores[a].score ?? 0), name: 'kkuzya',
            lineStyle: { color: C.accent, width: 2 },
            itemStyle: { color: C.accent, borderColor: C.surface, borderWidth: 2 },
            areaStyle: { color: 'rgba(189,164,122,0.18)' },
          },
        ],
      },
    ],
  }), [axes, scores, t]);   // axisName зависит только от t

  const parts = Object.entries(scores[focus].parts);
  const label = t('dna.chartLabel', { list: axes.map((a) => `${axisName(a)} ${scores[a].score ?? t('dna.noData')}`).join(', ') });
  const excluded = p.dna.excluded.map((e) => `${e.matchId} (${exclReason(e.code, e.reason)})`).join(', ');

  return (
    <Card
      title={t('dna.title')}
      subtitle={t('dna.subtitle', { matches: count(p.dna.used), min: f.num(p.dna.minutes), pos: p.dna.positionMatches, used: p.dna.used })}
      info={<><p>{t('dna.method')}</p><p style={{ marginTop: 8 }}>{t('dna.note50')}</p></>}
      className={s.dnaCard}
    >
      <div className={s.dnaBody}>
        <Chart option={option} label={label} height={300} className={s.dnaChart} />
        <div className={s.dnaSide}>
          <ul className={s.axisList} role="tablist" aria-label={t('dna.axesLabel')}>
            {axes.map((a) => {
              const v = scores[a].score;
              const sub = t(`dna.axis.${a}.sub` as MessageKey);
              return (
                <li key={a}>
                  <button type="button" role="tab" aria-selected={focus === a} className={`${s.axisBtn} ${focus === a ? s.axisOn : ''}`} onClick={() => setFocus(a)}>
                    <span className={s.axisName}>{axisName(a)}{sub && <small>{sub}</small>}</span>
                    <span className={s.axisScore}>{v ?? '—'}</span>
                    <span className={s.axisTrack} aria-hidden="true"><span style={{ width: `${v ?? 0}%` }} /><i /></span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className={s.parts} role="tabpanel" aria-label={t('dna.partsOf', { axis: axisName(focus) })}>
            <p className={s.partsHead}>
              {t('dna.partsOf', { axis: axisName(focus) })}
              <InfoTip>
                <p>{t(`dna.axis.${focus}.hint` as MessageKey)}</p>
                <p style={{ marginTop: 6 }}>{t('dna.matchesWithScore', { n: scores[focus].matchesWithScore })}{excluded ? ` ${t('dna.excluded', { list: excluded })}` : ''}</p>
              </InfoTip>
            </p>
            <ul>
              {parts.map(([k, v]) => (
                <li key={k} className={v == null ? s.partOff : ''}>
                  <span>{t(`part.${k}` as MessageKey)}</span>
                  <span className="tabular">{v == null ? (POSITIONAL_PARTS.has(k) ? t('dna.noPositions') : '—') : v}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Card>
  );
}
