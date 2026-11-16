'use strict';
// Проверка хранения в Redis (Upstash REST): данные должны пережить «перезапуск» сервера.  node test/store.test.js
const http = require('http');
const assert = require('assert');
process.env.STORE_DEBOUNCE_MS = '30';

const hashes = new Map();   // имитация Upstash
const srv = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.headers.authorization !== 'Bearer tok') { res.writeHead(401); return res.end('{"error":"unauthorized"}'); }
    const [cmd, key, a, b] = JSON.parse(body);
    let result = null;
    if (cmd === 'HSET') { (hashes.get(key) || hashes.set(key, new Map()).get(key)).set(a, b); result = 1; }
    else if (cmd === 'HGETALL') { result = []; for (const [k, v] of hashes.get(key) || []) result.push(k, v); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ result }));
  });
});

srv.listen(0, async () => {
  try {
    process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${srv.address().port}`;
    process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';
    process.env.DATA_FILE = '/tmp/cc_store_a.json';
    require('fs').rmSync('/tmp/cc_store_a.json', { force: true });
    const s1 = require('../lib/store');
    await s1.ready;
    assert.strictEqual(s1.persistence(), 'redis');
    s1.useFree(['tg42', 'ip:1.2.3.4']);
    s1.grantExtra('tg42');
    s1.addHistory('tg42', { id: 'm1', result: 'win', points: 60 });
    await new Promise((r) => setTimeout(r, 200));
    console.log('  ✔ данные записаны в Redis');

    // «перезапуск сервера»: новый процесс, ДРУГОЙ файл данных (диска нет) — всё должно подняться из Redis
    delete require.cache[require.resolve('../lib/store')];
    process.env.DATA_FILE = '/tmp/cc_store_b_nonexistent.json';
    const s2 = require('../lib/store');
    await s2.ready;
    assert.strictEqual(s2.persistence(), 'redis');
    assert.strictEqual(s2.hasFree(['ip:1.2.3.4']), false);
    assert.strictEqual(s2.hasFree(['tg42']), true, 'сессия за рекламу должна сохраниться');   // extra.n = 1
    s2.useFree(['tg42']);
    assert.strictEqual(s2.hasFree(['tg42']), false);
    assert.strictEqual(s2.getHistory('tg42')[0].points, 60);
    console.log('  ✔ после перезапуска лимиты и история на месте (из Redis, а не из файла)');

    // недоступный Redis не должен ронять сервер
    delete require.cache[require.resolve('../lib/store')];
    process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:1';
    const s3 = require('../lib/store');
    await s3.ready;
    assert.strictEqual(s3.persistence(), 'file');
    console.log('  ✔ Redis недоступен → работаем с файлом, сервер не падает');
    console.log('\nХРАНИЛИЩЕ: все проверки пройдены');
    process.exit(0);
  } catch (e) { console.error('✖ ПРОВАЛ:', e.message); process.exit(1); }
});
