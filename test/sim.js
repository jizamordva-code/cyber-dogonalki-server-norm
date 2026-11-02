'use strict';
// Прогон игровой логики без сети: node test/sim.js
process.env.DATA_FILE = '/tmp/cc_test_data.json';
process.env.TG_INSECURE = '0';
const assert = require('assert');
const router = require('../lib/router');
router.nearest = async () => { throw new Error('offline'); };   // без интернета
router.route = async () => { throw new Error('offline'); };
const { createCore } = require('../core');
const geo = require('../lib/geo');

let T = 1_700_000_000_000;
const core = createCore({ now: () => T });
const tick = async (sec) => { for (let i = 0; i < sec * 2; i++) { T += 500; for (const q of core.players.values()) if (q.lat != null) q.lastPos = T; core.tick(); await new Promise((r) => setImmediate(r)); } };
const BASE = { lat: 52.3676, lon: 4.9041 };

function mk(id, lat, lon, log) {
  const out = (m) => log.push(m);
  const r = core.hello({ t: 'hello', id: id.padEnd(10, 'x') }, out);
  const p = r.player;
  core.handle(p, { t: 'pos', lat, lon, acc: 5 });
  return p;
}
const move = (p, lat, lon) => core.handle(p, { t: 'pos', lat, lon, acc: 5 });
const at = (p, m, brg) => { const q = geo.dest(BASE.lat, BASE.lon, brg, m); return move(p, q.lat, q.lon); };
const last = (log, t) => [...log].reverse().find((m) => m.t === t);
const feeds = (log) => log.filter((m) => m.t === 'feed').map((m) => m.text);
let ok = 0; const pass = (n) => { ok++; console.log('  ✔', n); };

(async () => {
  console.log('1) CAPTURE POINTS (ctf)');
  const L = [[], [], [], []];
  const P = [0, 1, 2, 3].map((i) => { const q = geo.dest(BASE.lat, BASE.lon, i * 90, 150 + i * 40); return mk('ctfplayer' + i, q.lat, q.lon, L[i]); });
  core.handle(P[0], { t: 'join_public', mode: 'ctf', lat: P[0].lat, lon: P[0].lon, acc: 5 });
  core.handle(P[1], { t: 'join_public', mode: 'ctf', lat: P[1].lat, lon: P[1].lon, acc: 5 });
  assert.strictEqual(core.sessions.size, 1); pass('два игрока попали в одну комнату режима ctf');
  assert(feeds(L[0]).some((f) => f.includes('подключился к игре'))); pass('в логе: «подключился к игре»');
  core.handle(P[2], { t: 'join_public', mode: 'ctf', lat: P[2].lat, lon: P[2].lon, acc: 5 });
  core.handle(P[3], { t: 'join_public', mode: 'ctf', lat: P[3].lat, lon: P[3].lon, acc: 5 });
  const s = [...core.sessions.values()][0];
  assert.strictEqual(s.state, 'lobby');
  await tick(46);
  assert.strictEqual(s.state, 'running'); pass('лобби: старт через 45 с после набора минимума');
  const teams = P.map((p) => p.team); assert.strictEqual(teams.filter((t) => t === 'red').length, 2); pass('команды красных/синих поровну: ' + teams.join(','));
  await tick(2);
  assert.strictEqual(s.g.points.length, 3); pass('3 стартовые точки');
  let minSep = Infinity;
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) minSep = Math.min(minSep, geo.d2(s.g.points[i], s.g.points[j]));
  assert(minSep >= 250); pass(`точки не рядом: мин. расстояние ${Math.round(minSep)} м`);
  for (const pt of s.g.points) {
    const ds = P.map((p) => geo.dist(p.lat, p.lon, pt.lat, pt.lon));
    assert(Math.max(...ds) - Math.min(...ds) <= 600, 'разброс > ±300');
  }
  pass('расстояние от каждого участника до точки одинаково в пределах ±300 м');

  // игрок внутри точки A
  const A = s.g.points[0];
  P.forEach((p, i) => at(p, 4000, 45 + i * 90));   // все далеко от кругов
  const redP = P.find((p) => p.team === 'red'), redP2 = P.filter((p) => p.team === 'red')[1] || redP;
  move(redP, A.lat, A.lon);
  const leftBefore = A.left; await tick(60);
  const spent = leftBefore - A.left;
  assert(Math.abs(spent - 90000) < 1500, 'ожидали ×1.5, потрачено ' + spent); pass('один игрок: таймер идёт ×1.5');
  assert(Math.abs(A.pct.red - 10) < 0.6, 'pct ' + A.pct.red); pass(`+10% красных за минуту (факт ${A.pct.red.toFixed(1)}%)`);
  const reds = P.filter((p) => p.team === 'red');
  move(reds[1], A.lat, A.lon);
  const p0 = A.pct.red; const l0 = A.left; await tick(60);
  assert(Math.abs((l0 - A.left) - 135000) < 2000); pass('двое одной команды: таймер ×2.25');
  assert(Math.abs((A.pct.red - p0) - 30) < 1.2, 'прирост ' + (A.pct.red - p0)); pass(`процент быстрее (2 игрока: +${(A.pct.red - p0).toFixed(0)}% за минуту)`);
  const blue = P.find((p) => p.team === 'blue'); move(blue, A.lat, A.lon);
  await tick(30);
  assert(A.pct.blue > 0); pass(`чужая команда тоже набирает % (синие ${A.pct.blue.toFixed(1)}%)`);
  // дожигаем точку A
  await tick(400);
  assert(!s.g.points.includes(A)); pass('точка A обнулилась и пропала');
  const f = feeds(L[0]);
  assert(f.some((x) => x.includes('ОБНУЛИЛАСЬ'))); pass('лог: «точка обнулилась»');
  assert(f.some((x) => x.includes('ЗАХВАТИЛИ ТОЧКУ A'))); pass('лог: кто захватил — ' + f.find((x) => x.includes('ЗАХВАТИЛИ')));
  assert(last(L[0], 'point_end')); pass('событие point_end (анимация исчезновения)');
  assert.strictEqual(s.g.points.length, 2); pass('активных точек стало 2, новая НЕ появилась');
  // убираем людей из остальных кругов, ждём истечения
  P.forEach((p, i) => at(p, 60, i * 90));
  const before = s.g.points.map((x) => x.id);
  await tick(600);
  assert(s.g.points.length >= 1);
  await tick(5);
  assert.strictEqual(s.g.points.length, 2); pass('после исчезновения следующих появилась новая — активных снова 2');
  const nw = s.g.points.find((x) => !before.includes(x.id));
  if (nw) {
    const c = geo.centroid(P);
    const d = geo.dist(c.lat, c.lon, nw.lat, nw.lon);
    assert(d > 600 && d < 1000, 'расстояние от игроков ' + d); pass(`новая точка на ${Math.round(d)} м от скопления игроков`);
  }

  console.log('2) TEAM CHASE (догоня⚚ки)');
  const L2 = [[], [], [], [], []];
  const Q = [0, 1, 2, 3, 4].map((i) => mk('teamplayr' + i, BASE.lat + 0.01, BASE.lon + 0.01, L2[i]));
  core.handle(Q[0], { t: 'create', kind: 'private', mode: 'team', lat: Q[0].lat, lon: Q[0].lon, acc: 5 });
  const code = last(L2[0], 'joined').session.code;
  for (let i = 1; i < 5; i++) core.handle(Q[i], { t: 'join_code', code, lat: Q[i].lat, lon: Q[i].lon, acc: 5 });
  const ts = [...core.sessions.values()].find((x) => x.code === code);
  assert.strictEqual(ts.state, 'lobby');
  core.handle(Q[1], { t: 'start' }); assert.strictEqual(ts.state, 'lobby'); pass('старт только у владельца');
  core.handle(Q[0], { t: 'start' }); assert.strictEqual(ts.state, 'running');
  const caps = Q.filter((p) => p.cap); assert.strictEqual(caps.length, 2); assert.notStrictEqual(caps[0].team, caps[1].team); pass('выбраны 2 капитана из разных команд');
  const cnt = (t) => Q.filter((p) => p.team === t).length; assert(Math.abs(cnt('red') - cnt('blue')) <= 1); pass(`команды выровнены: ${cnt('red')}:${cnt('blue')}`);
  assert.strictEqual(ts.bots.length, 0); pass('ботов нет');
  const chaser = Q.find((p) => p.team === 'red' && !p.cap) || Q.find((p) => p.team === 'red');
  let runner = Q.find((p) => p.team === 'blue' && !p.cap);
  const bcap = Q.find((p) => p.team === 'blue' && p.cap);
  move(chaser, BASE.lat, BASE.lon); move(runner, BASE.lat, BASE.lon);
  await tick(10);
  assert.strictEqual(runner.team, 'blue'); pass('в начале раунда фора: поймать нельзя');
  await tick(175);
  assert.strictEqual(runner.team, 'red'); pass('после форы красный догнал синего → тот в красной команде');
  assert(last(L2[Q.indexOf(runner)], 'team_changed')); pass('игрок получил «вас догнали» (team_changed)');
  move(chaser, BASE.lat + 0.02, BASE.lon); move(bcap, BASE.lat + 0.02, BASE.lon);
  await tick(3);
  assert.strictEqual(bcap.team, 'blue'); assert(last(L2[Q.indexOf(chaser)], 'shield')); pass('капитана не осалить; догоняющий получил щит');
  const st = last(L2[0], 'state').team; assert.strictEqual(st.round, 1);
  // 10 секунд отсчёта: state содержит round_left_ms
  assert(st.round_left_ms < 300000); pass('state отдаёт round_left_ms для отсчёта 10 секунд');
  await tick(125);
  const st2 = last(L2[0], 'state').team; assert.strictEqual(st2.round, 2); assert.strictEqual(st2.chasing, 'blue'); pass('ровно через 5 минут: раунд 2, догоняют синие');
  await tick(300 * 3 + 5);
  assert.strictEqual(ts.state, 'over');
  const me = last(L2[0], 'match_end'); assert(me && ['win', 'loss', 'draw'].includes(me.result)); pass(`игра окончена: ${me.result}, очки ${me.points}, счёт ${me.summary.red}:${me.summary.blue}`);

  console.log('3) ОБЪЕДИНЕНИЕ КОМНАТ');
  const L3 = [[], []];
  const far = geo.dest(BASE.lat, BASE.lon, 90, 300000);
  const a = mk('mergerAAAA', far.lat, far.lon, L3[0]), b = mk('mergerBBBB', BASE.lat - 0.05, BASE.lon, L3[1]);
  core.handle(a, { t: 'create', kind: 'public', mode: 'ctf', lat: a.lat, lon: a.lon, acc: 5 });
  core.handle(b, { t: 'create', kind: 'public', mode: 'ctf', lat: b.lat, lon: b.lon, acc: 5 });
  assert.notStrictEqual(a.sid, b.sid); pass('две сессии > 100 км — отдельные');
  move(a, BASE.lat - 0.04, BASE.lon);
  core.tryMerge();
  assert.strictEqual(a.sid, b.sid); pass('сошлись в радиус 100 км — комнаты объединились');
  assert(feeds(L3[0]).some((x) => x.includes('mergerBBBB'.slice(0, 16)) || x.includes('подключился')) ); pass('обоим пишется «подключился к игре»');
  const c1 = mk('creatorCCCC', BASE.lat - 0.045, BASE.lon, []);
  core.handle(c1, { t: 'create', kind: 'public', mode: 'ctf', lat: c1.lat, lon: c1.lon, acc: 5 });
  assert.strictEqual(c1.sid, a.sid); pass('создатель с теми же настройками сразу попал в существующую комнату');
  const d1 = mk('creatorDDDD', BASE.lat - 0.045, BASE.lon, []);
  core.handle(d1, { t: 'join_public', mode: 'team', lat: d1.lat, lon: d1.lon, acc: 5 });
  assert.notStrictEqual(d1.sid, a.sid); pass('другой режим — другая комната');

  console.log('4) КЛАССИКА (боты только здесь)');
  const L4 = []; const k = mk('classicAAAA', BASE.lat + 0.3, BASE.lon, L4);
  core.handle(k, { t: 'join_public', mode: 'classic', lat: k.lat, lon: k.lon, acc: 5 });
  assert.strictEqual(k.role, 'chaser'); pass('первый игрок — догоняющий');
  await tick(3);
  assert(last(L4, 'state').players.some((p) => p.bot)); pass('боты появляются в классике');
  core.handle(k, { t: 'stats' }); assert(Array.isArray(last(L4, 'stats').history)); pass('история матчей отдаётся по запросу stats');
  console.log(`\nГОТОВО: ${ok} проверок пройдено`);
  process.exit(0);
})().catch((e) => { console.error('\n✖ ПРОВАЛ:', e.message); console.error(e.stack.split('\n').slice(0, 4).join('\n')); process.exit(1); });
