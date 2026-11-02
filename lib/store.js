'use strict';
// Постоянное хранилище: лимит «1 бесплатная сессия в месяц» и история матчей.
// ВНИМАНИЕ: на бесплатном Render диск временный — для продакшена замените на Postgres/Redis.
const fs = require('fs');
const FILE = process.env.DATA_FILE || './data.json';
let data = { quota: {}, history: {} };
try {
  const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  data = j.quota ? { quota: j.quota, history: j.history || {} } : { quota: j, history: {} }; // старый формат = только квоты
} catch (_) { /* нет файла */ }
let timer = null;
const save = () => { clearTimeout(timer); timer = setTimeout(() => fs.writeFile(FILE, JSON.stringify(data), () => {}), 500); };

const monthKey = () => new Date().toISOString().slice(0, 7);
module.exports = {
  monthKey,
  hasFree: (id) => data.quota[id] !== monthKey(),
  useFree: (id) => { data.quota[id] = monthKey(); save(); },
  addHistory: (id, entry) => {
    const h = data.history[id] || (data.history[id] = []);
    h.unshift(entry);
    if (h.length > 200) h.length = 200;
    save();
  },
  getHistory: (id) => (data.history[id] || []).slice(0, 100),
};
