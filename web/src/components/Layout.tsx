import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { Freshness } from './Freshness';
import { Segmented } from './ui';
import { useMatchCount, withCount } from '../lib/hooks';
import { useI18n, type Lang } from '../i18n';
import s from './Layout.module.css';

export function Layout() {
  const [n, setN] = useMatchCount();
  const { t, lang, setLang } = useI18n();
  const loc = useLocation();

  useEffect(() => {
    const page = loc.pathname.startsWith('/lab') ? t('nav.lab') : t('nav.dashboard');
    document.title = `${page} · KKUZYA.GG`;
  }, [loc.pathname, t]);

  return (
    <div className={s.app}>
      <a href="#main" className="skip-link">{t('app.skip')}</a>
      <header className={s.header}>
        <div className={s.headerInner}>
          <NavLink to={withCount('/', n)} className={s.logo} aria-label={t('nav.home')}>
            <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true" className={s.mark}>
              <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="8" fill="none" stroke="currentColor" strokeOpacity=".35" strokeWidth="1.5" />
              <path d="M11 9v14M11 16l7.5-7M13.5 13.5L19.5 23" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <circle cx="23" cy="21.5" r="1.7" fill="currentColor" />
            </svg>
            <span className={s.logoText}>KKUZYA<span className={s.logoGg}>.GG</span></span>
          </NavLink>
          <nav className={s.nav} aria-label={t('nav.label')}>
            <NavLink to={withCount('/', n)} end className={({ isActive }) => `${s.navLink} ${isActive ? s.navActive : ''}`}>{t('nav.dashboard')}</NavLink>
            <NavLink to={withCount('/lab', n)} className={({ isActive }) => `${s.navLink} ${isActive ? s.navActive : ''}`}>{t('nav.lab')}</NavLink>
          </nav>
          <div className={s.tools}>
            <Segmented label={t('count.label')} value={n} onChange={setN} size="sm"
              options={[{ value: 5, label: '5', title: t('count.title', { n: 5 }) }, { value: 10, label: '10', title: t('count.title', { n: 10 }) }]} />
            <Segmented<Lang> label={t('lang.label')} value={lang} onChange={setLang} size="sm"
              options={[{ value: 'ru', label: <span lang="ru">RU</span>, title: t('lang.ru') }, { value: 'en', label: <span lang="en">EN</span>, title: t('lang.en') }]} />
            <Freshness />
          </div>
        </div>
      </header>
      <main id="main" className={s.main} tabIndex={-1}>
        <Outlet />
      </main>
      <footer className={s.footer}>
        <div className={s.footerInner}>
          <div className={s.footerRow}>
            <span>© 2026 KKUZYA.GG</span>
            <span lang="en">Created by <span className={s.brand}>MiK &amp; Co.</span></span>
          </div>
          <p className={s.legal}>{t('footer.legal')}</p>
        </div>
      </footer>
    </div>
  );
}
