// Те же значения, что в styles/tokens.css: ECharts нужны конкретные цвета.
export const C = {
  bg: '#141412',
  surface: '#20201d',
  surface2: '#272723',
  surface3: '#2f2f2a',
  line: 'rgba(240,237,229,0.08)',
  lineStrong: 'rgba(240,237,229,0.14)',
  text: '#f0ede5',
  text2: '#a8a69d',
  text3: '#8f8d85',
  accent: '#bda47a',
  accentStrong: '#d4bd93',
  accentSoft: 'rgba(189,164,122,0.14)',
  win: '#8fae8b',
  loss: '#c98a7e',
  warn: '#d2b26a',
  info: '#8ea3b8',
  series: ['#bda47a', '#8ea3b8', '#8fae8b', '#c98a7e', '#a993b8'],
  slot: { weapon: '#d39b5f', spirit: '#a98bc9', vitality: '#8fb07a', unknown: '#8f8d85' } as Record<string, string>,
} as const;

export const FONT = "'Inter Variable', Inter, system-ui, sans-serif";

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Общие настройки подсказки ECharts в стиле сайта. */
export const tooltipBase = {
  backgroundColor: '#272723',
  borderColor: 'rgba(240,237,229,0.14)',
  borderWidth: 1,
  padding: [10, 12],
  textStyle: { color: C.text, fontFamily: FONT, fontSize: 13 },
  extraCssText: 'border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.45);',
  confine: true,
} as const;

export const axisCommon = {
  axisLine: { lineStyle: { color: C.lineStrong } },
  axisTick: { show: false },
  axisLabel: { color: C.text3, fontFamily: FONT, fontSize: 12 },
  splitLine: { lineStyle: { color: C.line } },
  nameTextStyle: { color: C.text3, fontFamily: FONT, fontSize: 12 },
} as const;
