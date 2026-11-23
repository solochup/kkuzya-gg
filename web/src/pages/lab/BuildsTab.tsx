import { useId, useMemo, useState } from 'react';
import type { MatchDetail, Profile } from '../../api/types';
import { Badge, Bar, Card, ItemIcon, Notice, Segmented } from '../../components/ui';
import { ABILITY_TYPES, SLOTS, SLOT_VARS } from '../../lib/labels';
import { useI18n, type MessageKey } from '../../i18n';
import s from './lab.module.css';

type SlotFilter = 'all' | 'weapon' | 'spirit' | 'vitality';

export function BuildsTab({ p, d }: { p: Profile; d: MatchDetail | null }) {
  return d ? <MatchBuild d={d} /> : <AggregateBuild p={p} />;
}

function useSlotOptions() {
  const { t } = useI18n();
  return [{ value: 'all' as const, label: t('common.all') }, ...(['weapon', 'spirit', 'vitality'] as const).map((k) => ({ value: k, label: t(`slot.${k}`) }))];
}

function SlotTag({ slot }: { slot: string | null | undefined }) {
  const { t } = useI18n();
  const k = slot ?? 'unknown';
  return <span className={s.slotTag} style={{ ['--c' as string]: SLOT_VARS[k] }}>{t(`slot.${k}` as MessageKey)}</span>;
}

function SlotSpend({ spend, note }: { spend: Record<string, number>; note?: string }) {
  const { t, f } = useI18n();
  const total = Object.values(spend).reduce((a, b) => a + b, 0);
  const keys = SLOTS.filter((k) => spend[k] > 0);
  return (
    <div className={s.spend}>
      <div className={s.spendBar} aria-hidden="true">
        {keys.map((k) => <span key={k} style={{ width: `${(spend[k] / total) * 100}%`, background: SLOT_VARS[k] }} />)}
      </div>
      <ul className={s.spendList}>
        {keys.map((k) => (
          <li key={k}><i style={{ background: SLOT_VARS[k] }} /><span>{t(`slot.${k}`)}</span><b className="tabular">{f.num(spend[k])}</b><span className={s.muted}>{f.pct(spend[k] / total)}</span></li>
        ))}
      </ul>
      {note && <p className={s.note}>{note}</p>}
    </div>
  );
}

/* ---------- Один матч ---------- */
function MatchBuild({ d }: { d: MatchDetail }) {
  const { t, f, item } = useI18n();
  const slotOptions = useSlotOptions();
  const T = d.row.durationS;
  const maxMin = Math.ceil(T / 60);
  const [minute, setMinute] = useState(Math.min(20, maxMin));
  const [filter, setFilter] = useState<SlotFilter>('all');
  const sliderId = useId();

  const spend = useMemo(() => {
    const r: Record<string, number> = { weapon: 0, spirit: 0, vitality: 0, unknown: 0 };
    for (const x of d.shop) { const it = d.dict.items[String(x.id)]; if (it?.cost != null) r[it.slot ?? 'unknown'] += it.cost; }
    return r;
  }, [d]);
  const sec = minute * 60;
  const inv = d.shop.filter((x) => x.t <= sec && (!x.sold || x.sold > sec));
  const invCost = inv.reduce((a, x) => a + (d.dict.items[String(x.id)]?.cost ?? 0), 0);
  const heuristic = d.shop.some((x) => x.source === 'heuristic') || d.abilities.some((x) => x.source === 'heuristic');
  const list = d.shop.filter((x) => filter === 'all' || d.dict.items[String(x.id)]?.slot === filter);

  return (
    <div className={s.stack}>
      {heuristic && <Notice tone="warn" title={t('builds.heuristic.title')}>{t('builds.heuristic.text')}</Notice>}
      <div className={s.grid2}>
        <Card title={t('inv.title')} subtitle={t('inv.sub')} info={t('inv.info')}>
          <div className={s.sliderRow}>
            <label htmlFor={sliderId} className={s.sliderLabel}>{t('inv.slider', { m: minute, max: maxMin })}</label>
            <input id={sliderId} type="range" min={0} max={maxMin} step={1} value={minute} onChange={(e) => setMinute(Number(e.target.value))} className={s.slider}
              aria-valuetext={t('inv.sliderValue', { m: minute, n: inv.length })} />
          </div>
          {inv.length === 0 ? <p className={s.note}>{t('inv.empty')}</p> : (
            <ul className={s.invGrid} data-testid="inventory">
              {inv.map((x, i) => (
                <li key={`${x.id}-${i}`} title={t('inv.boughtAt', { name: item(x.id, d.dict), t: f.clock(x.t) })}>
                  <ItemIcon id={x.id} dict={d.dict} size={44} />
                  <span>{item(x.id, d.dict)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className={s.note}>{t('inv.foot', { n: inv.length, c: f.num(invCost) })}</p>
        </Card>
        <Card title={t('spend.title')} subtitle={t('spend.subMatch')}>
          <SlotSpend spend={spend} note={t('spend.note')} />
        </Card>
      </div>

      <Card title={t('bi.title')} subtitle={t('bi.sub', { n: d.shop.length })}
        actions={<Segmented label={t('bi.category')} value={filter} onChange={setFilter} size="sm" options={slotOptions} />}>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <caption className="visually-hidden">{t('bi.caption')}</caption>
            <thead><tr><th scope="col">{t('col.time')}</th><th scope="col">{t('col.item')}</th><th scope="col">{t('col.category')}</th><th scope="col" className={s.r}>{t('col.tier')}</th><th scope="col" className={s.r}>{t('col.cost')}</th><th scope="col" className={s.r}>{t('col.sold')}</th></tr></thead>
            <tbody>
              {list.map((x, i) => {
                const it = d.dict.items[String(x.id)];
                return (
                  <tr key={`${x.id}-${i}`} className={x.sold ? s.soldRow : ''}>
                    <td className="tabular">{f.clock(x.t)}</td>
                    <td><div className={s.itemCell}><ItemIcon id={x.id} dict={d.dict} size={30} /><span>{item(x.id, d.dict)}</span>{it?.active && <Badge title={t('bi.activeTitle')}>{t('bi.active')}</Badge>}{x.imbued ? <Badge tone="accent" title={t('bi.imbueTitle', { name: item(x.imbued, d.dict) })}>{t('bi.imbue')}</Badge> : null}</div></td>
                    <td><SlotTag slot={it?.slot} /></td>
                    <td className={`${s.r} tabular`}>{it?.tier ?? '—'}</td>
                    <td className={`${s.r} tabular`}>{f.num(it?.cost)}</td>
                    <td className={`${s.r} tabular ${s.muted}`}>{x.sold ? f.clock(x.sold) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={t('ab.title')} subtitle={t('ab.sub', { n: d.abilities.length })} info={t('ab.info')}>
        <ol className={s.abilities}>
          {d.abilities.map((a, i) => {
            const it = d.dict.items[String(a.id)];
            const type = it?.abilityType && ABILITY_TYPES.has(it.abilityType) ? t(`abt.${it.abilityType}` as MessageKey) : it?.abilityType ?? '';
            return (
              <li key={i} className={it?.abilityType === 'ultimate' ? s.ult : ''}>
                <span className={`${s.time} tabular`}>{f.clock(a.t)}</span>
                <ItemIcon id={a.id} dict={d.dict} size={34} />
                <span className={s.abName}>{item(a.id, d.dict)}<small>{type ? `${type} · ` : ''}{a.step === 1 ? t('ab.opened') : t('ab.upgrade', { n: a.step - 1 })}</small></span>
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}

/* ---------- Агрегат по 5/10 матчам ---------- */
function AggregateBuild({ p }: { p: Profile }) {
  const { t, f, count, item } = useI18n();
  const slotOptions = useSlotOptions();
  const b = p.builds;
  const [slot, setSlot] = useState<SlotFilter>('all');
  const rows = b.items.filter((x) => slot === 'all' || p.dict.items[String(x.id)]?.slot === slot).slice(0, 20);
  const spend = Object.fromEntries(Object.entries(b.slotSpend).map(([k, v]) => [k, v.perMatch]));
  const fromAssets = b.classification.fromAssets ?? b.classification.coverage != null;
  return (
    <div className={s.stack}>
      <div className={s.grid2}>
        <Card title={t('spend.title')} subtitle={t('spend.subAgg', { count: count(p.available) })}>
          <SlotSpend spend={spend} />
        </Card>
        <Card title={t('cls.title')} subtitle={t('cls.sub')}>
          <div className={s.classif}>
            <div><b className="tabular">{f.num(b.shopPurchases)}</b><span>{t('cls.shop')}</span></div>
            <div><b className="tabular">{f.num(b.abilityUpgrades)}</b><span>{t('cls.ability')}</span></div>
            <div><b className="tabular">{f.pct(b.classification.coverage)}</b><span>{t('cls.coverage')}</span></div>
          </div>
          <p className={s.note}>{fromAssets ? t('cls.source.assets') : t('cls.source.heuristic')} {t('cls.note')}</p>
        </Card>
      </div>
      <Card title={t('freq.title')} subtitle={t('freq.sub', { count: count(p.available) })}
        actions={<Segmented label={t('bi.category')} value={slot} onChange={setSlot} size="sm" options={slotOptions} />}>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <caption className="visually-hidden">{t('freq.caption')}</caption>
            <thead><tr><th scope="col">{t('col.item')}</th><th scope="col">{t('col.category')}</th><th scope="col" className={s.r}>{t('col.tier')}</th><th scope="col" className={s.r}>{t('col.cost')}</th><th scope="col">{t('col.matches')}</th><th scope="col" className={s.r}>{t('col.avgMin')}</th><th scope="col" className={s.r}>{t('col.sold')}</th></tr></thead>
            <tbody>
              {rows.map((x) => {
                const it = p.dict.items[String(x.id)];
                return (
                  <tr key={x.id}>
                    <td><div className={s.itemCell}><ItemIcon id={x.id} dict={p.dict} size={30} /><span>{item(x.id, p.dict)}</span></div></td>
                    <td><SlotTag slot={it?.slot} /></td>
                    <td className={`${s.r} tabular`}>{it?.tier ?? '—'}</td>
                    <td className={`${s.r} tabular`}>{f.num(it?.cost)}</td>
                    <td><div className={s.shareCell}><Bar value={x.matches} max={p.available} /><span className="tabular">{x.matches}/{p.available}</span></div></td>
                    <td className={`${s.r} tabular`}>{f.num(x.avgMin, 1)}</td>
                    <td className={`${s.r} tabular ${s.muted}`}>{x.soldMatches ? t('freq.soldIn', { n: x.soldMatches }) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <p className={s.note}>{t('freq.empty')}</p>}
      </Card>
    </div>
  );
}
