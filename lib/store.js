'use strict';
/**
 * Постоянное хранилище: лимит «1 бесплатная сессия в месяц», сессии за рекламу и история матчей.
 *
 * ВАЖНО: на бесплатном Render локальный диск стирается при каждом перезапуске/засыпании сервиса,
 * поэтому файл data.json НЕ сохраняет счётчики надёжно. Чтобы лимит не обнулялся, подключите бесплатный Redis
 * (Upstash): задайте переменные окружения UPSTASH_REDIS_REST_URL и UPSTASH_REDIS_REST_TOKEN.
 * Тогда все данные хранятся в Redis, а файл остаётся только запасным вариантом.
 */
const fs = require('fs');
const FILE = process.env.DATA_FILE || './data.json';
const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const useRedis = !!(REDIS_URL && REDIS_TOKEN);
const DEBOUNCE_MS = Number(process.env.STORE_DEBOUNCE_MS || 2000);

const monthKey = () => new Date().toISOString().slice(0, 7);
let data = { quota: {}, history: {}, extra: {} };
try {
  const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  data = j.quota ? { quota: j.quota, history: j.history || {}, extra: j.extra || {} } : { quota: j, history: {}, extra: {} }; // старый формат = только квоты
} catch (_) { /* нет файла */ }

// ───────── файл (запасной вариант) ─────────
let fileTimer = null;
const saveFile = () => { clearTimeout(fileTimer); fileTimer = setTimeout(() => fs.writeFile(FILE, JSON.stringify(data), () => {}), 500); };

// ───────── Redis (Upstash REST) ─────────
async function redis(cmd) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
async function hgetall(key) {
  const a = (await redis(['HGETALL', key])) || [];
  const o = {};
  for (let i = 0; i + 1 < a.length; i += 2) o[a[i]] = a[i + 1];
  return o;
}
const rset = (hash, field, value) => {
  if (!useRedis) return;
  redis(['HSET', hash, field, String(value)]).catch((e) => console.error('[store] Redis HSET:', e.message));
};

let loaded = 'file';
/** Выполнится, когда данные загружены. Сервер должен дождаться его перед приёмом игроков. */
const ready = (async () => {
  if (!useRedis) return;
  try {
    const q = await hgetall('cc:quota');
    const ex = await hgetall('cc:extra');
    const hi = await hgetall('cc:history');
    Object.assign(data.quota, q);
    for (const k of Object.keys(ex)) { try { data.extra[k] = JSON.parse(ex[k]); } catch (_) { /* битая запись */ } }
    for (const k of Object.keys(hi)) { try { data.history[k] = JSON.parse(hi[k]); } catch (_) { /* битая запись */ } }
    loaded = 'redis';
    console.log(`[store] Redis: загружено квот ${Object.keys(q).length}, игроков с историей ${Object.keys(hi).length}`);
  } catch (e) {
    console.error('[store] Redis недоступен — работаем с локальным файлом (данные пропадут при перезапуске):', e.message);
  }
})();

// история пишется с задержкой (несколько записей подряд — одним запросом)
const histTimers = new Map();
function persistHistory(id) {
  if (!useRedis) return;
  clearTimeout(histTimers.get(id));
  histTimers.set(id, setTimeout(() => { histTimers.delete(id); rset('cc:history', id, JSON.stringify(data.history[id] || [])); }, DEBOUNCE_MS));
}

// ───────── квоты ─────────
const MAX_AD_EXTRA = Number(process.env.MAX_AD_EXTRA || 3);   // сколько доп. сессий в месяц можно получить за рекламу
const extraOf = (id) => { const e = data.extra[id]; return e && e.month === monthKey() ? e : { month: monthKey(), n: 0, granted: 0 }; };
const keysOf = (k) => (Array.isArray(k) ? k : [k]);

module.exports = {
  monthKey,
  ready,
  /** 'redis' — данные переживают перезапуск; 'file' — нет (на бесплатном Render) */
  persistence: () => (loaded === 'redis' ? 'redis' : 'file'),
  /**
   * keys — ключ игрока или массив ключей (id аккаунта и, для гостей сайта, 'ip:адрес').
   * Бесплатная сессия доступна, если НИ ОДИН из ключей не использован в этом месяце, либо есть сессии, полученные за рекламу.
   */
  hasFree: (keys) => {
    const ks = keysOf(keys);
    return ks.every((k) => data.quota[k] !== monthKey()) || extraOf(ks[0]).n > 0;
  },
  useFree: (keys) => {
    const ks = keysOf(keys);
    if (ks.every((k) => data.quota[k] !== monthKey())) {
      for (const k of ks) { data.quota[k] = monthKey(); rset('cc:quota', k, monthKey()); }
    } else {
      const e = extraOf(ks[0]); e.n = Math.max(0, e.n - 1); data.extra[ks[0]] = e; rset('cc:extra', ks[0], JSON.stringify(e));
    }
    saveFile();
  },
  /** Награда за просмотр рекламы: +1 сессия (не больше MAX_AD_EXTRA в месяц). */
  grantExtra: (id) => {
    const e = extraOf(id);
    if (e.granted >= MAX_AD_EXTRA) return false;
    e.n++; e.granted++; data.extra[id] = e; rset('cc:extra', id, JSON.stringify(e)); saveFile();
    return true;
  },
  addHistory: (id, entry) => {
    const h = data.history[id] || (data.history[id] = []);
    h.unshift(entry);
    if (h.length > 200) h.length = 200;
    persistHistory(id); saveFile();
  },
  getHistory: (id) => (data.history[id] || []).slice(0, 100),
};
