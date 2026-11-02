'use strict';
// «Захват флага»: большие жёлтые круги-зоны. Таймер 10 минут, круг сжимается;
// игроки внутри ускоряют таймер и набирают проценты для своей команды.
const CFG = require('../lib/config');
const C = CFG.CTF;
const { dist, d2, dest, centroid } = require('../lib/geo');
const { isLive, shuffle, TEAM_RU, teamCount } = require('../lib/util');

const all = (s) => [...s.players.values()];
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

/** Три стартовые точки вокруг центра участников: симметрично, на близком расстоянии от каждого. */
function pickInitial(ps) {
  const c = centroid(ps);
  let best = null;
  for (let b = 0; b < 360; b += 15) {
    for (let r = 150; r <= 500; r += 50) {
      const pts = [0, 1, 2].map((k) => dest(c.lat, c.lon, b + k * 120, r));   // между собой ≥ r·√3 ≥ 259 м
      let score = r * 0.2;
      for (const q of pts) {
        const ds = ps.map((p) => dist(p.lat, p.lon, q.lat, q.lon));
        score += (Math.max(...ds) - Math.min(...ds)) + Math.sqrt(mean(ds.map((d) => (d - mean(ds)) ** 2)));
      }
      if (!best || score < best.score) best = { score, pts };
    }
  }
  return best.pts;
}

/** Новая точка: в SPAWN_DIST от самого плотного скопления игроков, подальше от активных точек. */
function pickNext(s, ps) {
  let cluster = [ps[0]], bc = 0;
  for (const p of ps) {
    const m = ps.filter((q) => dist(p.lat, p.lon, q.lat, q.lon) <= 200);
    if (m.length > bc) { bc = m.length; cluster = m; }
  }
  const c = centroid(cluster);
  const cands = [];
  const b0 = Math.random() * 360;
  for (let i = 0; i < 16; i++) {
    const q = dest(c.lat, c.lon, b0 + i * 22.5, C.SPAWN_DIST);
    const md = s.g.points.length ? Math.min(...s.g.points.map((pt) => d2(q, pt))) : Infinity;
    cands.push({ q, md });
  }
  const ok = cands.filter((x) => x.md >= C.MIN_SEP);
  if (ok.length) return ok[Math.floor(Math.random() * ok.length)].q;   // «в любую сторону»
  return cands.sort((a, b) => b.md - a.md)[0].q;
}

async function addPoint(s, ctx, pos) {
  const g = s.g;
  g.spawning++;
  let p = pos;
  try { const n = await ctx.nearest(pos.lat, pos.lon); if (dist(pos.lat, pos.lon, n.lat, n.lon) <= 150) p = n; } catch (_) { /* без привязки к дороге */ }
  g.spawning--;
  if (s.state !== 'running') return;
  g.seq++;
  const label = String.fromCharCode(64 + ((g.seq - 1) % 26) + 1);
  g.points.push({ id: 'P' + g.seq, label, lat: p.lat, lon: p.lon, r0: C.R0, total: C.POINT_MS, left: C.POINT_MS,
    pct: { red: 0, blue: 0 }, inside: { red: 0, blue: 0 }, speed: 1 });
  ctx.feed(s, `ПОЯВИЛАСЬ ТОЧКА ${label}`, 'point');
}

function finish(s, ctx) {
  const { red, blue } = s.g.captured;
  const winner = red === blue ? 'draw' : (red > blue ? 'red' : 'blue');
  ctx.finish(s, { winner, summary: { red, blue } });
}

function expire(s, ctx, pt) {
  const g = s.g;
  g.points = g.points.filter((x) => x !== pt);
  ctx.feed(s, `ТОЧКА ${pt.label} ОБНУЛИЛАСЬ`, 'point');
  const w = pt.pct.red > pt.pct.blue ? 'red' : (pt.pct.blue > pt.pct.red ? 'blue' : null);
  if (w) {
    g.captured[w]++;
    ctx.feed(s, `${TEAM_RU[w]} ЗАХВАТИЛИ ТОЧКУ ${pt.label} (${Math.round(pt.pct[w])}%)`, w);
  } else {
    ctx.feed(s, `ТОЧКУ ${pt.label} НИКТО НЕ ЗАХВАТИЛ`, 'info');
  }
  ctx.broadcast(s, { t: 'point_end', id: pt.id, label: pt.label, lat: pt.lat, lon: pt.lon, winner: w });
  return w;
}

module.exports = {
  name: 'ctf',
  start(s, ctx) {
    const list = shuffle(all(s));
    list.forEach((p, i) => { p.team = i % 2 === 0 ? 'red' : 'blue'; });
    s.g = { points: [], captured: { red: 0, blue: 0 }, spawning: 0, seq: 0, endsAt: ctx.now + C.TOTAL_MS };
    for (const p of list) ctx.send(p, { t: 'feed', text: `ВЫ В КОМАНДЕ: ${TEAM_RU[p.team]}`, kind: p.team });
    const ps = list.filter((p) => p.lat != null);
    if (ps.length) for (const q of pickInitial(ps)) addPoint(s, ctx, q);
  },
  join(s, p, ctx) {
    if (s.state !== 'running') return;
    const r = teamCount(s, 'red'), b = teamCount(s, 'blue');
    p.team = r < b ? 'red' : (b < r ? 'blue' : (Math.random() < 0.5 ? 'red' : 'blue'));
    ctx.send(p, { t: 'feed', text: `ВЫ В КОМАНДЕ: ${TEAM_RU[p.team]}`, kind: p.team });
  },
  leave() {},
  tick(s, ctx, dt) {
    const g = s.g, now = ctx.now;
    const live = all(s).filter((p) => isLive(p, now));

    for (const pt of [...g.points]) {
      const curR = Math.max(C.R0 * (pt.left / pt.total), C.MIN_R);
      const inside = { red: 0, blue: 0 };
      const who = [];
      for (const p of live) if (p.team && dist(p.lat, p.lon, pt.lat, pt.lon) <= curR) { inside[p.team]++; who.push(p); }
      const n = inside.red + inside.blue;
      const f = n === 0 ? 1 : Math.min(Math.pow(C.ACCEL, n), C.ACCEL_CAP);      // прогрессия: 1.5, 2.25, 3.4 …
      pt.speed = f; pt.inside = inside;
      pt.left -= dt * 1000 * f;
      if (n > 0) {
        const per = (C.PCT_PER_MIN / 60) * (f / C.ACCEL) * dt;                    // % на игрока за тик
        for (const t of ['red', 'blue']) pt.pct[t] = Math.min(100, pt.pct[t] + inside[t] * per);
        for (const p of who) p.st.pct += per;
      }
      if (pt.left <= 0) {
        const w = expire(s, ctx, pt);
        if (w && g.captured[w] >= C.WIN_POINTS) return finish(s, ctx);
      }
    }
    // всегда минимум две активные точки (стартовые три «сгорают» до двух)
    if (g.points.length + g.spawning < C.ACTIVE_MIN && live.length) addPoint(s, ctx, pickNext(s, live));
    if (now >= g.endsAt) finish(s, ctx);
  },
  playerView: (s, p) => ({ team: p.team || null, cap: false, role: 'runner' }),
  stateExtra(s, ctx) {
    const g = s.g;
    if (!g || !g.points) return {};
    const r1 = (v) => Math.round(v * 10) / 10;
    return { ctf: {
      captured: g.captured, win: C.WIN_POINTS, left_ms: Math.max(0, g.endsAt - ctx.now),
      points: g.points.map((p) => ({ id: p.id, label: p.label, lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), r0: p.r0,
        total: p.total, left: Math.max(0, Math.round(p.left)), speed: r1(p.speed),
        pct: { red: r1(p.pct.red), blue: r1(p.pct.blue) }, inside: p.inside })),
    } };
  },
  personalPoints: (p) => Math.round(p.st.pct),
};
