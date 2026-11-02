'use strict';
// «Догонялки»: догоняющие и убегающие, боты по дорогам (боты — только здесь).
const CFG = require('../lib/config');
const C = CFG.CLASSIC;
const { dist, bearing, dest } = require('../lib/geo');
const { send, isLive, shuffle } = require('../lib/util');

const real = (s) => [...s.players.values()];

function manageBots(s, ctx) {
  const list = real(s);
  s.g.spawning = s.g.spawning || 0;
  // боты нужны только публичной сессии с ОДНИМ живым игроком
  if (s.kind !== 'public' || list.length !== 1) { s.bots = []; return; }
  const need = C.BOTS - s.bots.length - s.g.spawning;
  for (let i = 0; i < need; i++) spawnBot(s, ctx).catch(() => {});
}

async function spawnBot(s, ctx) {
  s.g.spawning++;
  try {
    const me = real(s).find((p) => p.lat != null);
    if (!me) return;
    let pos = null, raw = null;
    for (let i = 0; i < 3 && !pos; i++) {
      raw = dest(me.lat, me.lon, Math.random() * 360, C.BOT_MIN_M + Math.random() * (C.BOT_MAX_M - C.BOT_MIN_M));
      try {
        const n = await ctx.nearest(raw.lat, raw.lon);
        const d = dist(me.lat, me.lon, n.lat, n.lon);
        if (d >= 150 && d <= 1500) pos = n;
      } catch (_) { /* роутер недоступен */ }
    }
    if (!pos) pos = raw;
    if (s.mode !== 'classic' || real(s).length !== 1) return;
    s.bots.push({
      id: 'bot-' + Math.random().toString(16).slice(2, 8), name: 'AI-' + (10 + Math.floor(Math.random() * 90)),
      lat: pos.lat, lon: pos.lon, role: 'runner', bot: true, path: [], pi: 0, mode: 'wander', planning: false, lastPlan: 0,
    });
  } finally { s.g.spawning--; }
}

async function planBot(b, threat, now, ctx) {
  b.planning = true; b.lastPlan = now;
  let brg, d;
  if (threat) { brg = bearing(threat.lat, threat.lon, b.lat, b.lon) + (Math.random() * 70 - 35); d = 500 + Math.random() * 300; }
  else { brg = Math.random() * 360; d = 300 + Math.random() * 600; }
  const t = dest(b.lat, b.lon, brg, d);
  try { b.path = await ctx.route(b.lat, b.lon, t.lat, t.lon); b.pi = 0; }
  catch (_) { b.path = threat ? [[t.lat, t.lon]] : []; b.pi = 0; } // при бегстве — хоть по прямой
  b.planning = false;
}

function moveBot(b, meters) {
  while (meters > 0 && b.pi < b.path.length) {
    const [tl, tn] = b.path[b.pi];
    const d = dist(b.lat, b.lon, tl, tn);
    if (d <= meters) { b.lat = tl; b.lon = tn; meters -= d; b.pi++; }
    else { const f = meters / d; b.lat += (tl - b.lat) * f; b.lon += (tn - b.lon) * f; meters = 0; }
  }
}

function botStep(s, b, dt, ctx) {
  const now = ctx.now;
  let threat = null, td = Infinity;
  for (const c of real(s)) {
    if (c.role !== 'chaser' || !isLive(c, now)) continue;
    const d = dist(b.lat, b.lon, c.lat, c.lon);
    if (d < td) { td = d; threat = c; }
  }
  if (threat && td < C.BOT_TRIGGER_M) {
    if (b.mode !== 'flee') { b.mode = 'flee'; b.path = []; b.pi = 0; b.lastPlan = 0; }
    if (!b.planning && (b.pi >= b.path.length || now - b.lastPlan > 3000)) planBot(b, threat, now, ctx);
  } else {
    if (b.mode === 'flee' && (!threat || td > C.BOT_TRIGGER_M * 1.5)) { b.mode = 'wander'; b.path = []; b.pi = 0; }
    if (!b.planning && b.pi >= b.path.length && now - b.lastPlan > 2000) planBot(b, null, now, ctx);
  }
  moveBot(b, (b.mode === 'flee' ? C.BOT_FLEE_MS : C.BOT_WALK_MS) * dt);
}

function processTags(s, ctx) {
  const now = ctx.now;
  const live = real(s).filter((p) => isLive(p, now));
  const chasers = live.filter((p) => p.role === 'chaser');
  for (const r of live) {
    if (r.role !== 'runner' || (r.immuneUntil || 0) > now) continue;
    for (const c of chasers) {
      if (c.role !== 'chaser') continue;
      if (dist(r.lat, r.lon, c.lat, c.lon) <= CFG.TAG_RADIUS_M) {
        r.role = 'chaser'; c.st.tags++;
        send(r, { t: 'tagged', by: c.name, role: 'chaser' });
        ctx.feed(s, `${c.name} ДОГНАЛ ${r.name}`, 'tag');
        if (C.TAGGER_BECOMES_RUNNER) { c.role = 'runner'; c.immuneUntil = now + 8000; send(c, { t: 'role', role: 'runner' }); }
        break;
      }
    }
  }
  for (const c of chasers) {
    if (c.role !== 'chaser') continue;
    for (const b of [...s.bots]) {
      if (dist(b.lat, b.lon, c.lat, c.lon) <= CFG.TAG_RADIUS_M) {
        s.bots = s.bots.filter((x) => x !== b);
        c.st.bots++;
        send(c, { t: 'bot_caught', name: b.name });
        manageBots(s, ctx);
      }
    }
  }
}

function maybeResetRound(s, ctx) {
  const now = ctx.now;
  const list = real(s).filter((p) => p.out);
  if (list.length < 2 || list.some((p) => p.role === 'runner')) { s.g.allChasersSince = null; return; }
  if (!s.g.allChasersSince) { s.g.allChasersSince = now; return; }
  if (now - s.g.allChasersSince < C.ROUND_RESET_MS) return;
  const sh = shuffle(list);
  const nCh = Math.max(1, Math.floor(list.length * C.CHASER_RATIO));
  sh.forEach((p, i) => { p.role = i < nCh ? 'chaser' : 'runner'; send(p, { t: 'role', role: p.role }); });
  ctx.feed(s, 'НОВЫЙ РАУНД — РОЛИ ПЕРЕРАСПРЕДЕЛЕНЫ', 'round');
  s.g.allChasersSince = null;
}

module.exports = {
  name: 'classic',
  start() {},
  join(s, p, ctx) {
    const others = real(s).filter((x) => x !== p);
    const ch = others.filter((x) => x.role === 'chaser').length;
    p.role = (others.length === 0 || ch / others.length < C.CHASER_RATIO) ? 'chaser' : 'runner';
    manageBots(s, ctx);
  },
  leave(s, p, ctx) { manageBots(s, ctx); },
  tick(s, ctx, dt) {
    for (const b of s.bots) botStep(s, b, dt, ctx);
    processTags(s, ctx);
    maybeResetRound(s, ctx);
  },
  playerView: (s, p) => ({ role: p.role }),
  stateExtra: () => ({}),
  personalPoints: (p) => p.st.tags * CFG.POINTS.TAG + p.st.bots * CFG.POINTS.BOT,
};
