import { Link, useNavigate } from 'react-router-dom';
import type { Profile } from '../../api/types';
import { Badge, Bar, Card, HeroIcon, ResultPill } from '../../components/ui';
import { useMatchCount, withCount } from '../../lib/hooks';
import { useI18n } from '../../i18n';
import s from './dashboard.module.css';

export function HeroesCard({ p }: { p: Profile }) {
  const { t, f, count, hero } = useI18n();
  const max = Math.max(...p.heroes.map((h) => h.matches));
  return (
    <Card title={t('heroes.title')} subtitle={t('heroes.subtitle', { count: count(p.available) })}>
      <ul className={s.heroes}>
        {p.heroes.map((h) => (
          <li key={h.heroId} className={s.heroRow}>
            <HeroIcon heroId={h.heroId} dict={p.dict} size={40} />
            <div className={s.heroMain}>
              <div className={s.heroTop}>
                <span className={s.heroName}>{hero(h.heroId, p.dict)}</span>
                <span className={s.heroGames}>{count(h.matches)}</span>
              </div>
              <Bar value={h.matches} max={max} />
              <div className={s.heroStats}>
                <span>{t('heroes.wr')} <b className={h.winRate != null && h.winRate >= 0.5 ? s.good : s.bad}>{f.pct(h.winRate)}</b></span>
                <span>KDA <b>{f.num(h.kda, 2)}</b></span>
                <span className={s.heroKda}>{h.kills}/{h.deaths}/{h.assists}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function RecentMatches({ p }: { p: Profile }) {
  const { t, f, hero, gameMode, matchMode, posReason, skipped } = useI18n();
  const [n] = useMatchCount();
  const nav = useNavigate();
  const open = (id: number) => nav(withCount('/lab', n, { match: String(id) }));
  const unconfirmed = (m: Profile['matches'][number]) => !m.mode.matchLabelConfirmed;
  return (
    <Card title={t('matches.title')} subtitle={t('matches.subtitle')} info={t('matches.info')}>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <caption className="visually-hidden">{t('matches.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('col.hero')}</th>
              <th scope="col">{t('col.result')}</th>
              <th scope="col" className={s.r}>{t('col.kda')}</th>
              <th scope="col" className={s.r}>{t('col.damage')}</th>
              <th scope="col" className={`${s.r} ${s.hideSm}`}>{t('col.farm')}</th>
              <th scope="col" className={s.r}>{t('col.duration')}</th>
              <th scope="col" className={s.hideSm}>{t('col.date')}</th>
              <th scope="col" className={`${s.r} ${s.hideMd}`}>{t('col.matchId')}</th>
            </tr>
          </thead>
          <tbody>
            {p.matches.map((m) => (
              <tr key={m.matchId} onClick={() => open(m.matchId)} className={s.clickRow}>
                <td>
                  <div className={s.heroCell}>
                    <HeroIcon heroId={m.heroId} dict={p.dict} size={32} />
                    <div>
                      <Link to={withCount('/lab', n, { match: String(m.matchId) })} className={s.rowLink} onClick={(e) => e.stopPropagation()}>
                        {hero(m.heroId, p.dict)}
                      </Link>
                      <div className={s.cellSub}>
                        <span title={unconfirmed(m) ? t('mode.unconfirmed', { n: m.mode.matchMode ?? '—' }) : undefined}>
                          {matchMode(m.mode.matchMode) ?? gameMode(m.mode.gameMode)}{unconfirmed(m) ? '*' : ''}
                        </span>
                        {!m.positions.usable && <> · <span title={posReason(m.positions.reasonCode, m.positions.reason)}>{t('matches.noPos')}</span></>}
                      </div>
                    </div>
                  </div>
                </td>
                <td><ResultPill won={m.won} /></td>
                <td className={`${s.r} tabular`}><span className={s.kda}>{m.kills} <i>/</i> {m.deaths} <i>/</i> {m.assists}</span></td>
                <td className={`${s.r} tabular`}>{f.compact(m.damage)}</td>
                <td className={`${s.r} tabular ${s.hideSm}`}>{f.num(m.csPerMin, 1)}</td>
                <td className={`${s.r} tabular`}>{f.clock(m.durationS)}</td>
                <td className={`tabular ${s.hideSm}`}>{f.date(m.start)}</td>
                <td className={`${s.r} tabular ${s.hideMd} ${s.muted}`}>{m.matchId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {p.matches.some(unconfirmed) && <p className={s.tableNote}>{t('mode.footnote')}</p>}
      {p.quality.skipped.length > 0 && (
        <p className={s.tableNote}>
          {t('matches.hidden', { list: p.quality.skipped.map((x) => `${x.matchId} — ${skipped(x)}`).join('; ') })}{' '}
          <Badge>{p.quality.skipped.length}</Badge>
        </p>
      )}
    </Card>
  );
}
