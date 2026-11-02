'use strict';
const R = 6371000;
const rad = (d) => d * Math.PI / 180;
const deg = (r) => r * 180 / Math.PI;

function dist(aLat, aLon, bLat, bLon) {
  const dLat = rad(bLat - aLat), dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
const d2 = (a, b) => dist(a.lat, a.lon, b.lat, b.lon);
function bearing(aLat, aLon, bLat, bLon) {
  const y = Math.sin(rad(bLon - aLon)) * Math.cos(rad(bLat));
  const x = Math.cos(rad(aLat)) * Math.sin(rad(bLat)) - Math.sin(rad(aLat)) * Math.cos(rad(bLat)) * Math.cos(rad(bLon - aLon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
function dest(lat, lon, brg, m) {
  const d = m / R, b = rad(brg), la = rad(lat), lo = rad(lon);
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return { lat: deg(la2), lon: ((deg(lo2) + 540) % 360) - 180 };
}
const validPos = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
function centroid(list) {
  let la = 0, lo = 0;
  for (const p of list) { la += p.lat; lo += p.lon; }
  return { lat: la / list.length, lon: lo / list.length };
}
module.exports = { dist, d2, bearing, dest, validPos, centroid };
