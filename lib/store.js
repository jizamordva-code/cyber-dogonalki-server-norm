'use strict';
// Постоянное хранилище: лимит «1 бесплатная сессия в месяц» и история матчей.
// ВНИМАНИЕ: на бесплатном Render диск временный — для продакшена замените на Postgres/Redis.
const fs = require('fs');
const FILE = process.env.DATA_FILE || './data.json';
let data = { quota: {}, history: {}, extra: {} };
try {
  const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  data = j.quota ? { quota: j.quota, history: j.history || {}, extra: j.extra || {} } : { quota: j, history: {}, extra: {} }; // старый формат = только квоты
} catch (_) { /* нет файла */ }
let timer = null;
const save = () => { clearTimeout(timer); timer = setTimeout(() => fs.writeFile(FILE, JSON.stringify(data), () => {}), 500); };

const monthKey = () => new Date().toISOString().slice(0, 7);
const MAX_AD_EXTRA = Number(process.env.MAX_AD_EXTRA || 3);   // сколько доп. сессий в месяц можно получить за рекламу
const extraOf = (id) => { const e = data.extra[id]; return e && e.month === monthKey() ? e : { month: monthKey(), n: 0, granted: 0 }; };

module.exports = {
  monthKey,
  // бесплатная сессия доступна, если в этом месяце ещё не использована или есть сессии, полученные за рекламу
  hasFree: (id) => data.quota[id] !== monthKey() || extraOf(id).n > 0,
  useFree: (id) => {
    if (data.quota[id] !== monthKey()) data.quota[id] = monthKey();
    else { const e = extraOf(id); e.n = Math.max(0, e.n - 1); data.extra[id] = e; }
    save();
  },
  /** Награда за просмотр рекламы: +1 сессия (не больше MAX_AD_EXTRA в месяц). */
  grantExtra: (id) => {
    const e = extraOf(id);
    if (e.granted >= MAX_AD_EXTRA) return false;
    e.n++; e.granted++; data.extra[id] = e; save();
    return true;
  },
  addHistory: (id, entry) => {
    const h = data.history[id] || (data.history[id] = []);
    h.unshift(entry);
    if (h.length > 200) h.length = 200;
    save();
  },
  getHistory: (id) => (data.history[id] || []).slice(0, 100),
};
