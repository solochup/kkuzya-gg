import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, RadarChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, MarkLineComponent, MarkAreaComponent, RadarComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import { FONT, prefersReducedMotion } from '../lib/theme';
import styles from './Chart.module.css';

echarts.use([BarChart, LineChart, RadarChart, ScatterChart, GridComponent, LegendComponent, MarkLineComponent, MarkAreaComponent, RadarComponent, TooltipComponent, SVGRenderer]);

interface Props {
  option: EChartsCoreOption;
  /** Короткое текстовое описание графика для экранного диктора. */
  label: string;
  height?: number | string;
  className?: string;
  onClickData?: (dataIndex: number, seriesIndex: number) => void;
}

export function Chart({ option, label, height = 280, className, onClickData }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);
  const clickRef = useRef(onClickData);
  clickRef.current = onClickData;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: 'svg' });
    inst.current = chart;
    chart.on('click', (p) => {
      const e = p as { dataIndex?: number; seriesIndex?: number };
      if (clickRef.current && typeof e.dataIndex === 'number') clickRef.current(e.dataIndex, e.seriesIndex ?? 0);
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => { ro.disconnect(); chart.dispose(); inst.current = null; };
  }, []);

  useEffect(() => {
    const chart = inst.current;
    if (!chart) return;
    const reduced = prefersReducedMotion();
    chart.setOption({
      textStyle: { fontFamily: FONT },
      animation: !reduced,
      animationDuration: 320,
      animationDurationUpdate: 260,
      animationEasing: 'cubicOut',
      ...option,
    }, { notMerge: true });
  }, [option]);

  return (
    <div className={`${styles.wrap} ${className ?? ''}`} style={{ height }} role="img" aria-label={label}>
      <div ref={ref} className={styles.canvas} />
    </div>
  );
}
