'use strict';
const crypto = require('crypto');
const BOT_TOKEN = process.env.BOT_TOKEN || '';

/** Проверка подписи Telegram Mini App initData. Возвращает объект user или null. */
function verifyInitData(initData) {
  try {
    const p = new URLSearchParams(initData);
    const hash = p.get('hash');
    if (!hash) return null;
    p.delete('hash');
    const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
    if (BOT_TOKEN) {
      const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
      const calc = Buffer.from(crypto.createHmac('sha256', secret).update(check).digest('hex'));
      const got = Buffer.from(hash);
      if (calc.length !== got.length || !crypto.timingSafeEqual(calc, got)) return null;
    } else if (process.env.TG_INSECURE !== '1') return null;
    const age = Date.now() / 1000 - Number(p.get('auth_date') || 0);
    if (!(age < 86400)) return null;
    const u = JSON.parse(p.get('user') || 'null');
    return u && Number.isFinite(+u.id) ? u : null;
  } catch (_) { return null; }
}
module.exports = { verifyInitData };
