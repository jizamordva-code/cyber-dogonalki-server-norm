'use strict';
const CFG = require('./config');
const send = (p, m) => { if (p && p.out) { try { p.out(m); } catch (_) { /* сокет закрыт */ } } };
const online = (p) => !!(p && p.out);
const isLive = (p, now) => online(p) && p.lat != null && now - p.lastPos < CFG.STALE_POS_MS && p.acc <= CFG.MAX_ACC_M;
function shuffle(a) {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}
const TEAM_RU = { red: 'КРАСНЫЕ', blue: 'СИНИЕ' };
const other = (t) => (t === 'red' ? 'blue' : 'red');
const teamCount = (s, t) => [...s.players.values()].filter((p) => p.team === t).length;
module.exports = { send, online, isLive, shuffle, TEAM_RU, other, teamCount };
