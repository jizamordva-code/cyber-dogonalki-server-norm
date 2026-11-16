/*
 * Баннер Рекламной сети Яндекса для веб-версии игры (сайт).
 * Подключается строкой <script src="cc-banner.js"></script> в «Head Include» экспорта Godot (после telegram-web-app.js).
 *
 * Как включить:
 *   1. В кабинете Яндекса (Рекламная сеть → «Сайты») добавьте свой сайт и создайте блок «Баннер» для сайта.
 *   2. Скопируйте ID блока вида R-A-1234567-1 и вставьте в BLOCK_ID ниже.
 *   3. Сохраните файл, сделайте commit и push (файл лежит в server/public).
 * Пока BLOCK_ID пустой — баннера нет и место под него не резервируется.
 */
(function () {
  'use strict';

  // ───────────── НАСТРОЙКИ ─────────────
  var BLOCK_ID = '';          // ← сюда ID блока, например 'R-A-1234567-1'
  var IN_TELEGRAM = false;    // показывать ли баннер внутри Telegram Mini App (сначала проверьте правила Telegram и Яндекса)
  var HEIGHT = 60;            // сколько пикселей занимает баннер внизу окна
  // ─────────────────────────────────────

  var none = { show: function () {}, hide: function () {}, reserved: function () { return 0; } };
  var inTelegram = !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData);
  if (!BLOCK_ID || (inTelegram && !IN_TELEGRAM)) { window.ccBanner = none; return; }

  var wanted = true;   // игра в меню — баннер виден
  var ok = true;       // false, если Яндекс не вернул рекламу или её заблокировали
  var slotId = 'yandex_rtb_' + BLOCK_ID;

  var box = document.createElement('div');
  box.id = 'cc-banner';
  box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:' + HEIGHT +
    'px;z-index:50;background:#04060c;overflow:hidden;text-align:center;';
  var slot = document.createElement('div');
  slot.id = slotId;
  slot.style.cssText = 'width:100%;height:100%;';
  box.appendChild(slot);

  function apply() { box.style.display = (wanted && ok) ? 'block' : 'none'; }

  function mount() {
    document.body.appendChild(box);   // контейнер должен быть ВИДИМЫМ в момент отрисовки рекламы
    window.yaContextCb = window.yaContextCb || [];
    var s = document.createElement('script');
    s.src = 'https://yandex.ru/ads/system/context.js';
    s.async = true;
    document.head.appendChild(s);
    window.yaContextCb.push(function () {
      window.Ya.Context.AdvManager.render({
        blockId: BLOCK_ID,
        renderTo: slotId,
        onError: function () { ok = false; apply(); },
        onRender: function () { ok = true; apply(); }   // onRender — последним параметром (требование Яндекса)
      });
    });
  }

  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  window.ccBanner = {
    show: function () { wanted = true; apply(); },
    hide: function () { wanted = false; apply(); },
    reserved: function () { return (wanted && ok) ? HEIGHT : 0; }
  };
})();
