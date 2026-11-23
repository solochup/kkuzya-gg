// Настройки KKUZYA.GG. Можно переопределить переменными окружения.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Публичный адрес сайта (в GitHub Actions — KK_SITE_URL). Локально не задан. */
const siteUrl = (process.env.KK_SITE_URL || '').trim().replace(/\/+$/, '') || null;

export const config = {
  root: ROOT,
  accountId: Number(process.env.KK_ACCOUNT_ID || 1600662883),
  nickname: process.env.KK_NICKNAME || 'kkuzya',
  api: (process.env.KK_API || 'https://api.deadlock-api.com').replace(/\/+$/, ''),
  dataDir: path.resolve(process.env.KK_DATA_DIR || path.join(ROOT, 'data')),
  webDist: path.resolve(process.env.KK_WEB_DIST || path.join(ROOT, 'web', 'dist')),
  port: Number(process.env.PORT || 4173),
  host: process.env.HOST || '127.0.0.1',
  syncIntervalMin: Math.max(2, Number(process.env.KK_SYNC_MIN || 5)),
  requestDelayMs: Number(process.env.KK_DELAY_MS || 350),
  siteUrl,
  // Честная подпись запросов к Deadlock API: какой сайт и откуда спрашивает.
  userAgent: siteUrl
    ? `kkuzya.gg/0.3 (personal Deadlock stats, scheduled sync; +${siteUrl})`
    : 'kkuzya.gg/0.3 (personal Deadlock stats, local run)',
  /** Origin для синхронизации: адрес сайта или локальный. */
  syncOrigin: siteUrl || 'http://localhost',
};
