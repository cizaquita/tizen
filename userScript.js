/* Tizen TV - TizenBrew mod for https://www.tiktok.com (Tizen 3.0 compatible patch) */
(function () {
  'use strict';
  if (window.__tttvLoaded) return;
  window.__tttvLoaded = true;

  var VERSION = '0.1.1-tizen3';
  var KEY = {
    UP: 38, DOWN: 40, LEFT: 37, RIGHT: 39, OK: 13,
    BACK: 10009, ESC: 27,
    PLAYPAUSE: 10252, PLAY: 415, PAUSE: 19,
    NEXT: 10233, PREV: 10232, FF: 417, REW: 412,
    RED: 403, GREEN: 404
  };
  var SEEK_SECONDS = 5;

  var STATS_KEY = 'tttv.stats2';
  var stats = loadStats();
  stats.launches = (stats.launches || 0) + 1;
  stats.lastLaunch = new Date().toISOString();
  stats.version = VERSION;
  saveStats();

  function loadStats() {
    try { return JSON.parse(localStorage.getItem(STATS_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveStats() {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) { /* storage blocked */ }
  }
  function count(name, n) {
    stats[name] = (stats[name] || 0) + (n || 1);
    saveStats();
  }
  function log() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[TikTokTV]');
    if (typeof console !== 'undefined' && console.log) {
      console.log.apply(console, args);
    }
  }

  // Selector seguro para motores antiguos de Tizen 3.0 (evita SyntaxError por selectores no soportados)
  function safeQuery(selector, root) {
    if (!selector || typeof selector !== 'string') return null;
    try {
      return (root || document).querySelector(selector);
    } catch (err) {
      count('selectorErrors');
      stats.lastSelectorError = String(err && err.message || err).slice(0, 160);
      saveStats();
      return null;
    }
  }

  function safeQueryAll(selector, root) {
    if (!selector || typeof selector !== 'string') return [];
    try {
      return (root || document).querySelectorAll(selector);
    } catch (err) {
      count('selectorErrors');
      return [];
    }
  }

  window.addEventListener('error', function (e) {
    count('jsErrors');
    var msg = (e && (e.message || (e.error && e.error.message))) || 'Unknown error';
    recordJsError(msg, e && e.filename, e && e.lineno, e && e.colno);
    stats.lastError = String(msg).slice(0, 200);
    saveStats();
  });

  window.addEventListener('unhandledrejection', function (e) {
    var reason = e && e.reason;
    var msg = (reason && (reason.message || reason.toString())) || 'Unhandled Promise rejection';
    recordJsError('Promise: ' + msg, '', '', '');
  });

  var toastEl, toastTimer;
  function toast(text, ms) {
    if (!document.body) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = 'position:fixed;left:50%;bottom:8%;transform:translateX(-50%);' +
        'background:rgba(0,0,0,.75);color:#fff;font:600 28px/1.3 sans-serif;padding:14px 28px;' +
        'border-radius:14px;z-index:2147483647;pointer-events:none;transition:opacity .3s';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.style.opacity = '0'; }, ms || 1200);
  }

  var css = [
    '[data-e2e="download-app"]', '[data-e2e="top-get-app"]', '[class*="DownloadApp"]',
    '[class*="BottomBanner"]', '[class*="GetAppButton"]', '[class*="PromotionBanner"]'
  ].join(',') + '{display:none!important}' +
    'html,body{cursor:none!important}';

  function injectCss() {
    if (!document.head || safeQuery('#tttv-css')) return;
    try {
      var s = document.createElement('style');
      s.id = 'tttv-css';
      s.textContent = css;
      document.head.appendChild(s);
    } catch (e) { /* ignore css error on older engine */ }
  }

  function byText(selector, re, root) {
    var els = safeQueryAll(selector, root);
    for (var i = 0; i < els.length; i++) {
      if (els[i].offsetParent !== null && re.test((els[i].textContent || '').trim())) return els[i];
    }
    return null;
  }

  function loginModal() {
    var m = safeQuery('[data-e2e="login-modal"]');
    return m && m.offsetParent !== null ? m : null;
  }

  function closeToasts() {
    var t = safeQuery('button[aria-label="Close toast"]');
    if (t && t.offsetParent !== null) { t.click(); count('toastsClosed'); }
  }

  var qrShownFor = null;
  function handleLoginModal() {
    var m = loginModal();
    if (!m || qrShownFor === m) return;
    var qr = byText('[role="button"], button, a, div', /^use qr code$/i, m);
    if (qr) {
      qr.click();
      qrShownFor = m;
      count('loginQrShown');
      log('login popup: switched to QR code');
      toast('Scan the QR code with the TikTok app on your phone · Back = skip', 8000);
    }
  }

  var sendingEscape = false;
  function closePopup() {
    var m = loginModal();
    if (!m) return false;
    var container = (m.closest && m.closest('[class*="Modal"]')) || (m.parentElement && m.parentElement.parentElement) || document;
    var skip = byText('[role="button"], button, div', /^skip$/i, container);
    if (skip) {
      skip.click();
      count('loginSkipped');
      log('login popup: skipped');
    } else {
      sendingEscape = true;
      try {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      } catch (e) { /* fallback */ }
      sendingEscape = false;
      count('loginEscape');
      log('login popup: no skip button, sent Escape');
    }
    return true;
  }

  function visibleArea(el) {
    var r = el.getBoundingClientRect();
    var w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    var h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return w * h;
  }

  function currentVideo() {
    var vids = safeQueryAll('video');
    var best = null, bestArea = 0;
    for (var i = 0; i < vids.length; i++) {
      var a = visibleArea(vids[i]);
      if (a > bestArea) { bestArea = a; best = vids[i]; }
    }
    return best;
  }

  function videoId(v) {
    if (!v) return null;
    var item = v.closest ? v.closest('article, [data-e2e="recommend-list-item-container"]') : null;
    return (item && (item.id || item.getAttribute('data-scroll-index'))) || v.currentSrc || v.src || null;
  }

  function scrollableAncestor(el) {
    while (el && el !== document.body) {
      var st = getComputedStyle(el);
      if (/(auto|scroll|hidden)/.test(st.overflowY) && el.scrollHeight > el.clientHeight * 1.5) return el;
      el = el.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  // Sin modificador "i" dentro de selectores de atributo para evitar SyntaxError en Tizen 3.0
  function findNavButton(dir) {
    var selectors = dir > 0
      ? ['[data-e2e="feed-navigation-next"]', '[data-e2e="arrow-down"]', 'button[aria-label*="Next"]', 'button[aria-label*="next"]']
      : ['[data-e2e="feed-navigation-prev"]', '[data-e2e="arrow-up"]', 'button[aria-label*="Previous"]', 'button[aria-label*="previous"]'];
    for (var i = 0; i < selectors.length; i++) {
      var el = safeQuery(selectors[i]);
      if (el) return el;
    }
    return null;
  }

  var NAV_METHODS = {
    button: function (dir) {
      var b = findNavButton(dir);
      if (!b || b.disabled) return false;
      b.click();
      return true;
    },
    scroll: function (dir) {
      var v = currentVideo();
      var box = scrollableAncestor(v || document.body);
      if (typeof box.scrollBy === 'function') {
        box.scrollBy({ top: dir * box.clientHeight, behavior: 'smooth' });
      } else {
        box.scrollTop += dir * box.clientHeight;
      }
      return true;
    }
  };

  var navBusy = false;
  function navigate(dir) {
    if (navBusy) return;
    navBusy = true;
    var before = videoId(currentVideo());
    var order = ['button', 'scroll'];
    var start = Date.now();
    (function attempt(i) {
      if (i >= order.length) {
        log('navigation failed', dir > 0 ? 'next' : 'prev');
        count('navFailed');
        toast('Could not change video');
        navBusy = false;
        return;
      }
      var name = order[i];
      if (!NAV_METHODS[name](dir)) return attempt(i + 1);
      setTimeout(function () {
        var after = videoId(currentVideo());
        if (after && after !== before) {
          count('nav.' + name);
          log('nav', dir > 0 ? 'next' : 'prev', 'via', name, (Date.now() - start) + 'ms');
          var v = currentVideo();
          if (v && v.paused && v.play) {
            var p = v.play();
            if (p && p.catch) p.catch(function () { });
          }
          navBusy = false;
        } else {
          attempt(i + 1);
        }
      }, 900);
    })(0);
  }

  function togglePlay() {
    var v = currentVideo();
    if (!v) { toast('No video'); count('noVideo'); return; }
    if (v.muted) { v.muted = false; count('unmuted'); }
    if (v.paused) {
      if (v.play) {
        var p = v.play();
        if (p && p.catch) p.catch(function () { });
      }
      toast('▶ Play');
    } else {
      if (v.pause) v.pause();
      toast('❚❚ Pause');
    }
  }

  function seek(sec) {
    var v = currentVideo();
    if (!v || !isFinite(v.duration)) return;
    v.currentTime = Math.max(0, Math.min(v.duration - 0.5, v.currentTime + sec));
    toast((sec > 0 ? '+' : '') + sec + 's');
  }

  function goBack() {
    if (closePopup()) return;
    if (location.pathname.indexOf('/foryou') !== 0 && history.length > 1) {
      history.back();
      return;
    }
    try {
      if (typeof tizen !== 'undefined' && tizen.application) {
        tizen.application.getCurrentApplication().exit();
      }
    } catch (e) {
      log('exit not available outside the TV');
    }
  }

  var statsEl;
  function toggleStats() {
    if (statsEl) {
      if (statsEl.remove) statsEl.remove();
      else if (statsEl.parentNode) statsEl.parentNode.removeChild(statsEl);
      statsEl = null;
      return;
    }
    if (!document.body) return;
    statsEl = document.createElement('pre');
    statsEl.style.cssText = 'position:fixed;top:5%;right:3%;max-width:40%;background:rgba(0,0,0,.85);' +
      'color:#0f0;font:20px/1.4 monospace;padding:20px;border-radius:12px;z-index:2147483647;white-space:pre-wrap';
    statsEl.textContent = 'Tizen TV ' + VERSION + ' stats\n' + JSON.stringify(stats, null, 2);
    document.body.appendChild(statsEl);
    count('statsViewed');
  }
  
  var jsErrorsEl;
  function toggleJSErrors() {
    if (jsErrorsEl) {
      if (jsErrorsEl.remove) jsErrorsEl.remove();
      else if (jsErrorsEl.parentNode) jsErrorsEl.parentNode.removeChild(jsErrorsEl);
      jsErrorsEl = null;
      return;
    }
    if (!document.body) return;

    var list = Array.isArray(stats.errorList) ? stats.errorList : [];
    var header = 'Tizen TV ' + VERSION + ' JS Errors (' + (stats.jsErrors || 0) + ')\n';
    var bodyText = list.length > 0
      ? list.map(function (item, idx) { return (idx + 1) + '. ' + item; }).join('\n')
      : 'Sin errores JS registrados.';

    jsErrorsEl = document.createElement('pre');
    jsErrorsEl.style.cssText = 'position:fixed;top:5%;left:3%;max-width:44%;max-height:85%;overflow:auto;' +
      'background:rgba(20,0,0,.9);color:#ff6b6b;font:18px/1.4 monospace;padding:20px;' +
      'border:1px solid #ff6b6b;border-radius:12px;z-index:2147483647;white-space:pre-wrap';
    jsErrorsEl.textContent = header + '\n' + bodyText;
    document.body.appendChild(jsErrorsEl);
    count('jsErrorsViewed');
  }


  var ACTIONS = {};
  ACTIONS[KEY.DOWN] = ['next', function () { navigate(1); }];
  ACTIONS[KEY.NEXT] = ['next', function () { navigate(1); }];
  ACTIONS[KEY.UP] = ['prev', function () { navigate(-1); }];
  ACTIONS[KEY.PREV] = ['prev', function () { navigate(-1); }];
  ACTIONS[KEY.OK] = ['playpause', togglePlay];
  ACTIONS[KEY.PLAYPAUSE] = ['playpause', togglePlay];
  ACTIONS[KEY.PLAY] = ['playpause', togglePlay];
  ACTIONS[KEY.PAUSE] = ['playpause', togglePlay];
  ACTIONS[KEY.RIGHT] = ['seek', function () { seek(SEEK_SECONDS); }];
  ACTIONS[KEY.FF] = ['seek', function () { seek(SEEK_SECONDS); }];
  ACTIONS[KEY.LEFT] = ['seek', function () { seek(-SEEK_SECONDS); }];
  ACTIONS[KEY.REW] = ['seek', function () { seek(-SEEK_SECONDS); }];
  ACTIONS[KEY.BACK] = ['back', goBack];
  ACTIONS[KEY.ESC] = ['back', goBack];
  ACTIONS[KEY.RED] = ['stats', toggleStats];
  ACTIONS[KEY.GREEN] = ['jsErrors', toggleJSErrors];

  document.addEventListener('keydown', function (e) {
    if (sendingEscape) return;
    var t = e.target;
    var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if ((typing || loginModal()) && e.keyCode !== KEY.BACK) { count('key.passedToPopup'); return; }
    var action = ACTIONS[e.keyCode];
    if (!action) { count('key.unmapped'); return; }
    if (e.preventDefault) e.preventDefault();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    count('key.' + action[0]);
    action[1]();
  }, true);

  function init() {
    injectCss();
    closeToasts();
    handleLoginModal();
    log('loaded v' + VERSION, 'launch #' + stats.launches);
    toast('TikTok TV ready  ·  ▲▼ swipe  ·  OK play/pause', 4000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  setInterval(function () { injectCss(); closeToasts(); handleLoginModal(); }, 2000);
})();