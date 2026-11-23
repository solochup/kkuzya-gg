// Файловое хранилище: кеш (data/cache) и опубликованные данные для сайта (data/public).
// Запись атомарная: сначала временный файл, потом переименование, чтобы сайт не прочитал половину файла.
import fs from 'node:fs';
import path from 'node:path';

const SAFE_KEY = /^[A-Za-z0-9_.\-/]+$/;

export class FileStore {
  constructor(root) {
    this.root = path.resolve(root);
    this.cacheDir = path.join(this.root, 'cache');
    this.publicDir = path.join(this.root, 'public');
    fs.mkdirSync(this.cacheDir, { recursive: true });
    fs.mkdirSync(this.publicDir, { recursive: true });
  }

  #file(dir, key, ext = '.json') {
    if (!SAFE_KEY.test(key) || key.includes('..')) throw new Error(`недопустимый ключ: ${key}`);
    return path.join(dir, key.endsWith(ext) ? key : key + ext);
  }

  static #write(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, text, 'utf8');
    try { fs.renameSync(tmp, file); }
    catch { fs.writeFileSync(file, text, 'utf8'); try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ } }
  }

  static #read(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  }

  get(key) { return FileStore.#read(this.#file(this.cacheDir, key)); }
  put(key, value) { FileStore.#write(this.#file(this.cacheDir, key), JSON.stringify(value)); }
  has(key) { return fs.existsSync(this.#file(this.cacheDir, key)); }

  /** Публичный файл для сайта (data/public/<key>.json). */
  publish(key, value) { FileStore.#write(this.#file(this.publicDir, key), JSON.stringify(value)); }
  readPublic(key) { return FileStore.#read(this.#file(this.publicDir, key)); }
}

/** Хранилище в памяти: для тестов. */
export class MemoryStore {
  constructor() { this.cache = new Map(); this.pub = new Map(); }
  get(key) { return this.cache.has(key) ? structuredClone(this.cache.get(key)) : null; }
  put(key, value) { this.cache.set(key, structuredClone(value)); }
  has(key) { return this.cache.has(key); }
  publish(key, value) { this.pub.set(key, structuredClone(value)); }
  readPublic(key) { return this.pub.has(key) ? structuredClone(this.pub.get(key)) : null; }
}
