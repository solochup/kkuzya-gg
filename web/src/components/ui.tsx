import { useId, useState, type ReactNode } from 'react';
import type { Dict } from '../api/types';
import { SLOT_VARS } from '../lib/labels';
import { useI18n } from '../i18n';
import s from './ui.module.css';

/* ---------- Карточка ---------- */
export function Card({ title, subtitle, info, actions, children, className, id, as: As = 'section' }: {
  title?: ReactNode; subtitle?: ReactNode; info?: ReactNode; actions?: ReactNode; children: ReactNode;
  className?: string; id?: string; as?: 'section' | 'div' | 'article';
}) {
  const hid = useId();
  const { t } = useI18n();
  return (
    <As className={`${s.card} ${className ?? ''}`} id={id} aria-labelledby={title ? hid : undefined}>
      {(title || actions) && (
        <header className={s.cardHead}>
          <div className={s.cardTitles}>
            {title && (
              <h2 className={s.cardTitle} id={hid}>
                {title}
                {info && <InfoTip label={typeof title === 'string' ? t('ui.infoAbout', { title }) : t('ui.info')}>{info}</InfoTip>}
              </h2>
            )}
            {subtitle && <p className={s.cardSub}>{subtitle}</p>}
          </div>
          {actions && <div className={s.cardActions}>{actions}</div>}
        </header>
      )}
      {children}
    </As>
  );
}

/* ---------- Подсказка (наведение и фокус с клавиатуры) ---------- */
export function InfoTip({ children, label }: { children: ReactNode; label?: string }) {
  const id = useId();
  const { t } = useI18n();
  label ??= t('ui.info');
  const [open, setOpen] = useState(false);
  return (
    <span className={s.tipWrap} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className={s.tipBtn}
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M8 7.2v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /><circle cx="8" cy="4.9" r=".9" fill="currentColor" /></svg>
      </button>
      <span role="tooltip" id={id} className={`${s.tip} ${open ? s.tipOpen : ''}`}>{children}</span>
    </span>
  );
}

/* ---------- Сегментированный переключатель ---------- */
export function Segmented<T extends string | number>({ value, options, onChange, label, size = 'md' }: {
  value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string; size?: 'sm' | 'md';
}) {
  return (
    <div className={`${s.seg} ${size === 'sm' ? s.segSm : ''}`} role="radiogroup" aria-label={label}
      onKeyDown={(e) => {
        const i = options.findIndex((o) => o.value === value);
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); onChange(options[(i + 1) % options.length].value); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); onChange(options[(i - 1 + options.length) % options.length].value); }
      }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={String(o.value)} type="button" role="radio" aria-checked={active} tabIndex={active ? 0 : -1}
            title={o.title} className={`${s.segBtn} ${active ? s.segActive : ''}`} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Чипы-переключатели (несколько значений) ---------- */
export function ToggleChips<T extends string>({ values, options, onChange, label }: {
  values: T[]; options: { value: T; label: string; color?: string }[]; onChange: (v: T[]) => void; label: string;
}) {
  return (
    <div className={s.chips} role="group" aria-label={label}>
      {options.map((o) => {
        const on = values.includes(o.value);
        return (
          <button key={o.value} type="button" aria-pressed={on} className={`${s.chip} ${on ? s.chipOn : ''}`}
            onClick={() => {
              const next = on ? values.filter((v) => v !== o.value) : [...values, o.value];
              if (next.length) onChange(next);
            }}>
            {o.color && <span className={s.chipDot} style={{ background: on ? o.color : 'transparent', borderColor: o.color }} aria-hidden="true" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Иконки ---------- */
function Img({ src, alt, className, fallback }: { src: string | null | undefined; alt: string; className: string; fallback: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <span className={`${className} ${s.imgFallback}`} role="img" aria-label={alt}>{fallback}</span>;
  return <img src={src} alt={alt} className={className} loading="lazy" decoding="async" onError={() => setBroken(true)} referrerPolicy="no-referrer" />;
}

export function HeroIcon({ heroId, dict, size = 32, card = false }: { heroId: number | null | undefined; dict: Dict; size?: number; card?: boolean }) {
  const { hero } = useI18n();
  const h = heroId != null ? dict.heroes[String(heroId)] : undefined;
  const name = hero(heroId, dict);
  return (
    <span className={s.heroIcon} style={{ width: size, height: size }}>
      <Img src={card ? h?.card ?? h?.icon : h?.icon} alt={name} className={s.heroImg} fallback={name.slice(0, 1)} />
    </span>
  );
}

export function ItemIcon({ id, dict, size = 36 }: { id: number; dict: Dict; size?: number }) {
  const { item } = useI18n();
  const it = dict.items[String(id)];
  const name = item(id, dict);
  const slot = it?.slot ?? 'unknown';
  return (
    <span className={s.itemIcon} style={{ width: size, height: size, ['--slot' as string]: SLOT_VARS[slot] }}>
      <Img src={it?.icon} alt={name} className={s.itemImg} fallback={name.slice(0, 1)} />
    </span>
  );
}

/* ---------- Состояния ---------- */
export function Skeleton({ height = 160, className }: { height?: number; className?: string }) {
  return <div className={`${s.skeleton} ${className ?? ''}`} style={{ height }} aria-hidden="true" />;
}

export function LoadingPage({ label }: { label?: string }) {
  const { t } = useI18n();
  label ??= t('loading.default');
  return (
    <div className={s.loadingPage} role="status" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      <Skeleton height={96} />
      <div className={s.loadingGrid}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={92} />)}</div>
      <div className={s.loadingGrid2}><Skeleton height={320} /><Skeleton height={320} /></div>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={s.empty}>
      <div className={s.emptyMark} aria-hidden="true" />
      <h3 className={s.emptyTitle}>{title}</h3>
      {children && <div className={s.emptyText}>{children}</div>}
      {action}
    </div>
  );
}

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'error'; title?: ReactNode; children?: ReactNode }) {
  return (
    <div className={`${s.notice} ${s[`notice_${tone}`]}`} role={tone === 'error' ? 'alert' : 'note'}>
      <span className={s.noticeBar} aria-hidden="true" />
      <div>
        {title && <p className={s.noticeTitle}>{title}</p>}
        {children && <div className={s.noticeText}>{children}</div>}
      </div>
    </div>
  );
}

export function Badge({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'win' | 'loss' | 'warn'; title?: string }) {
  return <span className={`${s.badge} ${s[`badge_${tone}`]}`} title={title}>{children}</span>;
}

export function ResultPill({ won }: { won: boolean | null }) {
  const { t } = useI18n();
  if (won == null) return <Badge title={t('result.unknown')}>—</Badge>;
  return <Badge tone={won ? 'win' : 'loss'}>{won ? t('result.win') : t('result.loss')}</Badge>;
}

/** Горизонтальная полоса-значение (для списков). */
export function Bar({ value, max, color = 'var(--accent)', label }: { value: number; max: number; color?: string; label?: string }) {
  const w = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <span className={s.bar} aria-hidden={label ? undefined : true} aria-label={label}>
      <span className={s.barFill} style={{ width: `${w}%`, background: color }} />
    </span>
  );
}
