// Наблюдение за появлением нового матча: измеряет задержку между концом матча и его появлением в API.
// Чистая логика с подставляемыми sleep/now, чтобы её можно было проверить без сети и без ожидания.
import { parseHistory } from './history.js';

/**
 * client: ApiClient; urls: { history, meta(matchId) }.
 * События (onEvent): 'baseline', 'poll', 'new-match', 'metadata', 'timeout'.
 * Возвращает { baseline, newMatches: [{ matchId, endTs, historySeenTs, historyDelayMin, metadataSeenTs, metadataDelayMin }] }.
 */
export async function watchForNewMatch({ client, urls, intervalMs, maxMs, now, sleep, onEvent = () => {} }) {
  let etag = null, lastRows = null;
  const readHistory = async () => {
    const r = await client.getJson(urls.history, { label: 'история (наблюдение)', headers: etag ? { 'if-none-match': etag } : {} });
    if (!r.ok) return { ok: false, error: r.error };
    if (r.notModified) return { ok: true, rows: lastRows, notModified: true };
    etag = r.entry.headers.etag || null;
    const h = parseHistory(r.json);
    if (!h.ok) return { ok: false, error: h.error };
    lastRows = h.rows;
    return { ok: true, rows: h.rows };
  };

  const first = await readHistory();
  if (!first.ok) { onEvent('error', { error: first.error }); return { baseline: null, newMatches: [], error: first.error }; }
  const known = new Set(first.rows.map((r) => r.matchId));
  const baseline = first.rows[0] || null;
  onEvent('baseline', { newest: baseline, total: first.rows.length, etag: !!etag });

  const started = now();
  const pending = new Map();   // matchId -> запись ожидания метаданных
  const done = [];
  while (now() - started < maxMs / 1000) {
    await sleep(intervalMs);
    const h = await readHistory();
    onEvent('poll', { ok: h.ok, notModified: !!h.notModified, error: h.error });
    if (h.ok) {
      for (const row of h.rows) {
        if (known.has(row.matchId)) continue;
        known.add(row.matchId);
        const ts = now();
        const endTs = row.startTime != null && row.durationS != null ? row.startTime + row.durationS : null;
        const rec = { matchId: row.matchId, endTs, historySeenTs: ts, historyDelayMin: endTs != null ? (ts - endTs) / 60 : null, metadataSeenTs: null, metadataDelayMin: null };
        pending.set(row.matchId, rec);
        onEvent('new-match', rec);
      }
    }
    for (const [id, rec] of pending) {
      const r = await client.getJson(urls.meta(id), { label: `метаданные ${id} (наблюдение)`, timeoutMs: 60000 });
      if (r.ok) {
        rec.metadataSeenTs = now();
        rec.metadataDelayMin = rec.endTs != null ? (rec.metadataSeenTs - rec.endTs) / 60 : null;
        pending.delete(id); done.push(rec);
        onEvent('metadata', rec);
      }
    }
    if (done.length && !pending.size) break;
  }
  for (const rec of pending.values()) done.push(rec);
  if (!done.length) onEvent('timeout', { waitedMin: (now() - started) / 60 });
  return { baseline, newMatches: done };
}
