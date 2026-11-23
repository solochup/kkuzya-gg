import { useState } from 'react';
import { useI18n } from '../i18n';
import s from './MiniMap.module.css';

/** Скорость (игровых единиц в секунду), выше которой соседние точки пути не соединяются линией. */
export const MAX_SPEED = 500;

export interface MapPoint { x: number; y: number; kind: 'kill' | 'death'; t: number; label: string }

/**
 * Миникарта Deadlock с точками событий. Перевод координат проверен по справочнику /v1/assets/map:
 * left = (x + R) / 2R, top = (R − y) / 2R (совпадает с left/top_relative объектов справочника).
 */
export function worldToPct(x: number, y: number, radius: number): [number, number] {
  return [((x + radius) / (2 * radius)) * 100, ((radius - y) / (2 * radius)) * 100];
}

export function MiniMap({ radius, image, points = [], path = null, label }: {
  radius: number; image: string | null; points?: MapPoint[];
  path?: { x: number[]; y: number[]; alive: number[]; stepS: number } | null; label: string;
}) {
  const { t, f } = useI18n();
  const [ratio, setRatio] = useState<number | null>(null);
  const [broken, setBroken] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  // Путь: отрезки только между точками, где игрок жив (смерть разрывает линию),
  // и только если скачок между соседними точками правдоподобен для бега (иначе — телепорт/возрождение/зиплайн:
  // прямая линия изобразила бы маршрут, которого не было).
  const segments: string[] = [];
  if (path) {
    const maxJump = MAX_SPEED * path.stepS;
    let cur: string[] = [];
    const flush = () => { if (cur.length > 1) segments.push(cur.join(' ')); cur = []; };
    for (let i = 0; i < path.x.length; i++) {
      if (!path.alive[i]) { flush(); continue; }
      if (i > 0 && path.alive[i - 1] && Math.hypot(path.x[i] - path.x[i - 1], path.y[i] - path.y[i - 1]) > maxJump) flush();
      const [l, tp] = worldToPct(path.x[i], path.y[i], radius);
      cur.push(`${l.toFixed(2)},${tp.toFixed(2)}`);
    }
    flush();
  }
  const hp = hover != null ? points[hover] : null;
  const kindLabel = (k: MapPoint['kind']) => (k === 'kill' ? t('map.point.kill') : t('map.point.death'));

  return (
    <figure className={s.fig} aria-label={label}>
      <div className={s.box} style={{ aspectRatio: ratio ? String(ratio) : '1 / 1' }}>
        {image && !broken
          ? <img src={image} alt="" className={s.img} referrerPolicy="no-referrer" onLoad={(e) => { const im = e.currentTarget; if (im.naturalWidth && im.naturalHeight) setRatio(im.naturalWidth / im.naturalHeight); }} onError={() => setBroken(true)} />
          : <div className={s.noImg}>{t('map.noImage')}</div>}
        {segments.length > 0 && (
          <svg className={s.svg} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {segments.map((pts, i) => <polyline key={i} points={pts} className={s.path} vectorEffect="non-scaling-stroke" />)}
          </svg>
        )}
        {points.map((p, i) => {
          const [l, tp] = worldToPct(p.x, p.y, radius);
          return (
            <button key={i} type="button" className={`${s.pt} ${p.kind === 'kill' ? s.kill : s.death}`}
              style={{ left: `${l}%`, top: `${tp}%` }}
              aria-label={t('map.point.aria', { kind: kindLabel(p.kind), time: f.clock(p.t), label: p.label })}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
          );
        })}
        {hp && (() => {
          const [l, tp] = worldToPct(hp.x, hp.y, radius);
          return (
            <div className={s.tip} style={{ left: `${l}%`, top: `${tp}%` }} role="status">
              <b>{kindLabel(hp.kind)} · {f.clock(hp.t)}</b><span>{hp.label}</span>
            </div>
          );
        })()}
      </div>
    </figure>
  );
}
