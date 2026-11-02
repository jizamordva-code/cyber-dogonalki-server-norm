'use strict';
// Маршруты по дорогам для ботов и привязка точек к дорогам (OSRM-совместимый API).
const ROUTER = (process.env.ROUTER_URL || 'https://routing.openstreetmap.de/routed-foot').replace(/\/$/, '');
const PROFILE = process.env.ROUTE_PROFILE || 'driving'; // для OSRM имя профиля в URL игнорируется
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const queue = [];
let busy = false;

function routerFetch(path) {
  return new Promise((resolve, reject) => {
    if (queue.length > 30) return reject(new Error('router queue full'));
    queue.push({ path, resolve, reject });
    pump();
  });
}
async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const job = queue.shift();
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(ROUTER + job.path, { signal: ctl.signal, headers: { 'User-Agent': 'CyberChase/1.0' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      job.resolve(await r.json());
    } catch (e) { job.reject(e); }
    clearTimeout(to);
    await sleep(250);
  }
  busy = false;
}
async function nearest(lat, lon) {
  const j = await routerFetch(`/nearest/v1/${PROFILE}/${lon},${lat}`);
  const loc = j.waypoints && j.waypoints[0] && j.waypoints[0].location;
  if (!loc) throw new Error('no snap');
  return { lat: loc[1], lon: loc[0] };
}
async function route(aLat, aLon, bLat, bLon) {
  const j = await routerFetch(`/route/v1/${PROFILE}/${aLon},${aLat};${bLon},${bLat}?overview=full&geometries=geojson`);
  const c = j.routes && j.routes[0] && j.routes[0].geometry.coordinates;
  if (!c || c.length < 2) throw new Error('no route');
  return c.map((x) => [x[1], x[0]]);
}
module.exports = { nearest, route };
