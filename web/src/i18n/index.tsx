import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ru, ruPlurals, type MessageKey, type PluralKey } from './ru';
import { en, enPlurals } from './en';
import { createFormat, LOCALES, type Formatter, type Lang } from '../lib/format';
import type { Dict, Skipped, Status } from '../api/types';

export type { Lang, MessageKey };
type Params = Record<string, string | number>;

const MESSAGES: Record<Lang, Record<MessageKey, string>> = { ru, en };
const PLURALS: Record<Lang, Record<PluralKey, Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }>> = { ru: ruPlurals, en: enPlurals };
export const STORAGE_KEY = 'kkuzya.lang';
export const DEFAULT_LANG: Lang = 'ru';

/** Подстановка {name} -> значение. Неизвестные плейсхолдеры остаются как есть (их ловит тест). */
export function interpolate(s: string, params?: Params) {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

export function readStoredLang(): Lang {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'en' || v === 'ru' ? v : DEFAULT_LANG;
  } catch { return DEFAULT_LANG; }
}

/** Всё, что зависит от языка, собрано здесь: тексты, формы чисел, Intl-форматы, игровые названия, причины. */
export function createI18n(lang: Lang) {
  const msgs = MESSAGES[lang];
  const rules = new Intl.PluralRules(LOCALES[lang]);
  const t = (key: MessageKey, params?: Params) => interpolate(msgs[key] ?? key, params);
  const f: Formatter = createFormat(lang, { min: msgs['unit.min'], hour: msgs['unit.hour'], justNow: msgs['age.justNow'], never: msgs['age.never'] });
  const plural = (n: number, key: PluralKey) => {
    const forms = PLURALS[lang][key];
    return forms[rules.select(n)] ?? forms.other;
  };
  /** «10 матчей» / «10 matches». */
  const count = (n: number, key: PluralKey = 'match') => `${f.num(n)} ${plural(n, key)}`;

  /** Официальное локализованное название из справочника (?language=russian), иначе оригинал. */
  const localized = (e: { n: string | null; ru?: string } | undefined) => (e ? (lang === 'ru' && e.ru ? e.ru : e.n) : null);
  const hero = (id: number | null | undefined, dict: Dict) =>
    id == null ? t('hero.unknown') : localized(dict.heroes[String(id)]) ?? t('hero.id', { id });
  const item = (id: number, dict: Dict) => localized(dict.items[String(id)]) ?? t('item.id', { id });

  const gameMode = (g: number | null | undefined) =>
    g == null ? t('mode.game.none') : g === 1 || g === 4 ? t(`mode.game.${g}` as MessageKey) : t('mode.game.unknown', { n: g });
  const matchMode = (m: number | null | undefined) =>
    m == null ? null : m === 1 || m === 4 || m === 7 ? t(`mode.match.${m}` as MessageKey) : t('mode.match.unknown', { n: m });

  const posReason = (rc: { code: string; n?: number; text?: string } | null | undefined, fallback?: string | null) => {
    if (!rc) return fallback ?? t('pos.no_data');
    if (rc.code === 'few_reliable') return t('pos.few_reliable', { n: rc.n ?? 0 });
    if (rc.code === 'no_path' || rc.code === 'path_mismatch' || rc.code === 'no_data') return t(`pos.${rc.code}` as MessageKey);
    return rc.text ?? fallback ?? t('pos.no_data');
  };
  const exclReason = (code: string | null | undefined, fallback?: string | null) =>
    code === 'short' ? t('reason.short') : code === 'abandoned' ? t('reason.abandoned') : fallback ?? '';

  /** Технические тексты ApiClient: числа и коды HTTP не переводятся, словесные части — да. */
  const tech = (s: string | null | undefined) => {
    if (!s) return '';
    const m = /^таймаут (\d+) мс$/.exec(s);
    if (m) return t('tech.timeout', { ms: m[1] });
    if (s === 'ответ не JSON') return t('tech.notJson');
    return s;
  };
  const syncError = (e: Status['errors'][number]) => {
    const step = e.step === 'history' ? t('err.step.history')
      : e.step === 'assets' ? t('err.step.assets', { asset: e.asset ?? '' })
      : e.step === 'steam' ? t('err.step.steam')
      : e.step === 'metadata' ? t('err.step.metadata', { id: e.matchId ?? '' })
      : t('err.step.other');
    const detail = e.code === 'format' ? t('err.format') : tech(e.detail ?? e.status?.toString() ?? '');
    return detail ? `${step}: ${detail}` : step;
  };
  const skipped = (s: Skipped) =>
    s.kind === 'mode' ? (s.gameMode !== undefined ? gameMode(s.gameMode) : s.reason)
      : s.code === 'meta_unavailable' ? t('skip.meta_unavailable', { detail: tech(s.detail) })
      : s.code === 'digest_failed' ? t('skip.digest_failed', { detail: s.detail ?? '' })
      : s.detail ?? s.reason;

  return { lang, t, f, plural, count, hero, item, gameMode, matchMode, posReason, exclReason, syncError, skipped, tech };
}
export type I18n = ReturnType<typeof createI18n> & { setLang: (l: Lang) => void };

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLangState] = useState<Lang>(() => initial ?? readStoredLang());
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { window.localStorage.setItem(STORAGE_KEY, l); } catch { /* приватный режим: язык просто не запомнится */ }
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const value = useMemo(() => ({ ...createI18n(lang), setLang }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n вне I18nProvider');
  return v;
}
