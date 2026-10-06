// Home-screen app support: registers the offline service worker (only on an https page of
// our own, never from file:// or inside an iframe), the title-screen "Install app" chip,
// the iPhone/iPad "Add to Home Screen" hint, and landscape lock for first-person runs.
// Everything here is optional: where the browser blocks it, the game just plays on.
window.SC = window.SC || {};
(function (SC) {
  'use strict';
  const U = SC.util, UI = SC.ui;
  const $ = UI.$;
  const HINT_KEY = 'standclear.iosHintDismissed';
  const mq = (q) => { try { return window.matchMedia(q).matches; } catch (e) { return false; } };
  const topLevel = () => { try { return window.top === window; } catch (e) { return false; } };
  // a file:// page can't load (or install) the manifest; drop the link so Chrome doesn't log a CORS error
  if (location.protocol === 'file:') try { const m = document.querySelector('link[rel="manifest"]'); if (m) m.remove(); } catch (e) { /* ignore */ }

  const pwa = {
    deferred: null, locked: false,

    isStandalone() { return mq('(display-mode: fullscreen)') || mq('(display-mode: standalone)') || mq('(display-mode: minimal-ui)') || navigator.standalone === true; },
    // Safari on iPhone/iPad (iPadOS reports itself as a Mac with a touch screen)
    isIOSSafari() {
      const ua = navigator.userAgent || '';
      const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      return ios && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram/.test(ua);
    },
    isPhone() { return mq('(pointer: coarse)') && Math.min(screen.width, screen.height) < 600; },

    init() {
      try {
        window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); this.deferred = e; this.sync(); });
        window.addEventListener('appinstalled', () => { this.deferred = null; this.sync(); });
        try { window.matchMedia('(display-mode: standalone)').addEventListener('change', () => this.sync()); } catch (e) { /* old Safari */ }
        const btn = $('#btn-install'); if (btn) btn.addEventListener('click', () => this.install());
        const x = $('#ios-install-hint .install-hint-x'); if (x) x.addEventListener('click', () => { U.save(HINT_KEY, true); this.sync(); });
        this.sync();
        this.register();
      } catch (e) { /* never block the game */ }
    },

    sync() {
      const standalone = this.isStandalone();
      const btn = $('#btn-install'); if (btn) btn.hidden = standalone || !this.deferred;
      const hint = $('#ios-install-hint'); if (hint) hint.hidden = standalone || !topLevel() || !this.isIOSSafari() || !!U.load(HINT_KEY, false);
    },

    install() {
      const e = this.deferred; if (!e) return;
      try { SC.audio.click(); } catch (err) { /* no audio */ }
      // a prompt can only be shown once; the browser fires a fresh event if it is dismissed
      this.deferred = null; this.sync();
      try { Promise.resolve(e.prompt()).catch(() => {}); } catch (err) { /* ignore */ }
    },

    register() {
      try {
        const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
        if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || local) || !topLevel()) return;
        const sw = navigator.serviceWorker;
        // the first install takes control silently; later versions say hello once
        const hadController = !!sw.controller; let told = false;
        sw.addEventListener('controllerchange', () => { if (hadController && !told) { told = true; UI.toast('Updated to the latest version', 'good'); } });
        const go = () => { try { sw.register('./sw.js').catch(() => {}); } catch (e) { /* blocked */ } };
        if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
      } catch (e) { /* storage blocked (sandbox, private mode): no offline support */ }
    },

    // first-person runs read best sideways; only an installed app on a phone may lock
    lockLandscape() {
      try {
        const o = screen.orientation;
        if (!o || !o.lock || !this.isStandalone() || !this.isPhone()) return;
        this.locked = true;
        o.lock('landscape').catch(() => {});
      } catch (e) { /* not supported */ }
    },
    unlockOrientation() {
      if (!this.locked) return; this.locked = false;
      try { screen.orientation.unlock(); } catch (e) { /* not supported */ }
    },
  };
  SC.pwa = pwa;
})(window.SC);
