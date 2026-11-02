'use strict';
// «Догоня⚚ки»: две команды, у каждой капитан (его осалить нельзя), раунды по 5 минут.
// Красные догоняют синих; пойманный переходит в команду догнавшего. Каждые 5 минут роли меняются.
const CFG = require('../lib/config');
const C = CFG.TEAM;
const { dist } = require('../lib/geo');
const { send, isLive, shuffle, TEAM_RU, other, teamCount } = require('../lib/util');

const all = (s) => [...s.players.values()];

function finish(s, ctx) {
  const red = teamCount(s, 'red'), blue = teamCount(s, 'blue');
  const winner = red === blue ? 'draw' : (red > blue ? 'red' : 'blue');
  ctx.finish(s, { winner, summary: { red, blue } });
}

function assignLate(s, p) {
  const r = teamCount(s, 'red'), b = teamCount(s, 'blue');
  p.team = r < b ? 'red' : (b < r ? 'blue' : (Math.random() < 0.5 ? 'red' : 'blue'));
  p.cap = false;
}

module.exports = {
  name: 'team',
  start(s, ctx) {
    const list = shuffle(all(s));
    s.g = { round: 1, chasing: 'red', roundStart: ctx.now };
    let r = 0, b = 0;
    list.forEach((p, i) => {
      p.cap = i < 2;
      p.team = i === 0 ? 'red' : i === 1 ? 'blue' : (r <= b ? 'red' : 'blue');
      if (p.team === 'red') r++; else b++;
    });
    const cr = list[0], cb = list[1];
    if (cr && cb) ctx.feed(s, `КАПИТАНЫ: ${cr.name} (КРАСНЫЕ) · ${cb.name} (СИНИЕ)`, 'info');
    ctx.feed(s, `РАУНД 1 · ${TEAM_RU.red} ДОГОНЯЮТ · ФОРА ${Math.round(C.HEAD_MS / 60000)} МИН`, 'round');
    for (const p of list) send(p, { t: 'feed', text: `ВЫ В КОМАНДЕ: ${TEAM_RU[p.team]}${p.cap ? ' · ВЫ КАПИТАН (НЕУЯЗВИМЫ)' : ''}`, kind: p.team });
  },
  join(s, p, ctx) {
    if (s.state !== 'running') return;       // в лобби команды раздаются на старте
    assignLate(s, p);
    send(p, { t: 'feed', text: `ВЫ В КОМАНДЕ: ${TEAM_RU[p.team]}`, kind: p.team });
  },
  leave(s, p, ctx) {
    if (s.state !== 'running' || !p.cap) return;
    const mates = all(s).filter((x) => x.team === p.team && x !== p);
    if (mates.length) {
      const n = mates[Math.floor(Math.random() * mates.length)];
      n.cap = true;
      ctx.feed(s, `${n.name} ТЕПЕРЬ КАПИТАН (${TEAM_RU[p.team]})`, 'info');
    }
  },
  tick(s, ctx) {
    const g = s.g, now = ctx.now;
    if (now - g.roundStart >= C.ROUND_MS) {
      if (g.round >= C.ROUNDS) return finish(s, ctx);
      g.round++; g.chasing = other(g.chasing); g.roundStart = now;
      ctx.feed(s, `РАУНД ${g.round} · ${TEAM_RU[g.chasing]} ДОГОНЯЮТ · ФОРА ${Math.round(C.HEAD_MS / 60000)} МИН`, 'round');
    }
    const list = all(s);
    if (list.length >= 2 && (teamCount(s, 'red') === 0 || teamCount(s, 'blue') === 0)) return finish(s, ctx);
    if (now - g.roundStart < C.HEAD_MS) return; // фора: догоняющие не могут салить

    const live = list.filter((p) => isLive(p, now));
    const chasers = live.filter((p) => p.team === g.chasing);
    for (const r of live) {
      if (r.team === g.chasing) continue;
      for (const c of chasers) {
        if (dist(r.lat, r.lon, c.lat, c.lon) > CFG.TAG_RADIUS_M) continue;
        if (r.cap) { // капитана осалить нельзя — догоняющий получает щит
          if (now - (c.shieldAt || 0) > 4000) { c.shieldAt = now; send(c, { t: 'shield', ms: 3000 }); }
          continue;
        }
        r.team = c.team; c.st.tags++;
        send(r, { t: 'team_changed', team: r.team, by: c.name });
        ctx.feed(s, `${c.name} ДОГНАЛ ${r.name} · ТЕПЕРЬ В КОМАНДЕ: ${TEAM_RU[r.team]}`, 'tag');
        break;
      }
    }
  },
  playerView: (s, p) => ({ team: p.team || null, cap: !!p.cap, role: p.team && s.g.chasing ? (p.team === s.g.chasing ? 'chaser' : 'runner') : 'runner' }),
  stateExtra(s, ctx) {
    const g = s.g;
    if (!g || !g.roundStart) return {};
    const roundLeft = Math.max(0, C.ROUND_MS - (ctx.now - g.roundStart));
    return { team: {
      round: g.round, rounds: C.ROUNDS, chasing: g.chasing, head_ms: C.HEAD_MS, round_ms: C.ROUND_MS,
      round_left_ms: roundLeft, head_left_ms: Math.max(0, C.HEAD_MS - (ctx.now - g.roundStart)),
      total_left_ms: (C.ROUNDS - g.round) * C.ROUND_MS + roundLeft,
      counts: { red: teamCount(s, 'red'), blue: teamCount(s, 'blue') },
    } };
  },
  personalPoints: (p) => p.st.tags * CFG.POINTS.TAG,
};
