/* ============================================================
   CUNALINGUS ($CUNA) — live data + interactions
   Static site. No build step, no secrets, no backend.
   Everything below is read client-side from public APIs.
   ============================================================ */

(function () {
  'use strict';

  // ──────────────────────────────────────────────────────────
  // CONFIG — the only place you should ever need to edit.
  // ──────────────────────────────────────────────────────────
  var CONFIG = {
    // On-chain identity. Verified live; never displayed from memory.
    mint: '4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc',
    pair: '2pxxjL96USyv6WPbrF2xkoKt16UdueyTuzr3CLwwTb1G', // main Orca pool
    chain: 'solana',

    // Burn tracker. burnGoal is the announced target.
    // launchSupply is a fixed launch-time constant used ONLY to size the
    // progress bar (how far along the road we are). It is not live data.
    burnGoal: 6900000000,
    launchSupply: 10000000000,

    // Approximate amount locked in Jupiter locks. Update if the locks change.
    // The percentage shown next to it is computed against live supply.
    lockedApprox: 7000000000,

    // Public RPCs, tried in order. Both are CORS-open and keyless.
    rpcEndpoints: [
      'https://solana-rpc.publicnode.com',
      'https://api.mainnet-beta.solana.com'
    ],

    refreshMs: 30000,

    // Community links. Leave a value empty ('') and its button is not rendered.
    socials: {
      telegram: '',
      x: ''
    },

    // Meme gallery. Drop files in assets/memes/ and list them here.
    // The whole section stays hidden while this array is empty.
    // e.g. { src: 'assets/memes/eat-that-chart.jpg', caption: 'gonna eat that chart' }
    memes: []
  };

  CONFIG.buyUrl = 'https://jup.ag/tokens/' + CONFIG.mint;
  CONFIG.chartUrl = 'https://dexscreener.com/' + CONFIG.chain + '/' + CONFIG.mint;
  CONFIG.explorerUrl = 'https://solscan.io/token/' + CONFIG.mint;

  // ──────────────────────────────────────────────────────────
  // Tiny DOM helpers. Text is ALWAYS set via textContent, never
  // innerHTML — nothing fetched from an API can become markup.
  // ──────────────────────────────────────────────────────────
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function setField(name, text, className) {
    $$('[data-field="' + name + '"]').forEach(function (el) {
      el.textContent = text;
      el.classList.remove('is-up', 'is-down');
      if (className) el.classList.add(className);
    });
  }

  // ──────────────────────────────────────────────────────────
  // Formatting
  // ──────────────────────────────────────────────────────────
  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function toNum(v) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : null;
  }

  function fmtInt(n) {
    if (!isNum(n)) return '—';
    return Math.round(n).toLocaleString('en-US');
  }

  function fmtCompact(n) {
    if (!isNum(n)) return '—';
    if (n >= 1e9) return (n / 1e9).toFixed(2).replace(/\.00$/, '') + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.00$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(Math.round(n));
  }

  function fmtUsd(n) {
    if (!isNum(n)) return '—';
    if (n >= 1000) return '$' + fmtCompact(n);
    if (n >= 1) return '$' + n.toFixed(2);
    return '$' + n.toLocaleString('en-US', { maximumSignificantDigits: 4 });
  }

  function fmtPct(n) {
    if (!isNum(n)) return '—';
    var sign = n > 0 ? '+' : '';
    return sign + n.toFixed(n >= 100 || n <= -100 ? 0 : 2) + '%';
  }

  // ──────────────────────────────────────────────────────────
  // Count-up animation for big numbers
  // ──────────────────────────────────────────────────────────
  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var lastValues = {};

  function animateField(name, value, formatter) {
    if (!isNum(value)) { setField(name, '—'); return; }
    var from = isNum(lastValues[name]) ? lastValues[name] : value * 0.985;
    lastValues[name] = value;

    if (reduceMotion || from === value) { setField(name, formatter(value)); return; }

    var start = null;
    var duration = 900;
    function step(ts) {
      if (start === null) start = ts;
      var t = Math.min((ts - start) / duration, 1);
      var eased = 1 - Math.pow(1 - t, 3);
      setField(name, formatter(from + (value - from) * eased));
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // ──────────────────────────────────────────────────────────
  // Data: DexScreener (price / market cap / volume / liquidity)
  // ──────────────────────────────────────────────────────────
  function fetchMarket() {
    var url = 'https://api.dexscreener.com/latest/dex/pairs/' +
      encodeURIComponent(CONFIG.chain) + '/' + encodeURIComponent(CONFIG.pair);

    return fetch(url, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('DexScreener responded ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var pair = (data && data.pair) ||
          (data && Array.isArray(data.pairs) && data.pairs[0]);
        if (!pair) throw new Error('No pair data');
        return pair;
      });
  }

  function renderMarket(pair) {
    var price = toNum(pair.priceUsd);
    var mcap = toNum(pair.marketCap) || toNum(pair.fdv);
    var change = pair.priceChange ? toNum(pair.priceChange.h24) : null;
    var volume = pair.volume ? toNum(pair.volume.h24) : null;
    var liq = pair.liquidity ? toNum(pair.liquidity.usd) : null;

    setField('price', fmtUsd(price));
    setField('fdv', fmtUsd(mcap));
    setField('volume24', fmtUsd(volume));
    setField('liquidity', fmtUsd(liq));

    setField('change24', fmtPct(change),
      isNum(change) ? (change >= 0 ? 'is-up' : 'is-down') : null);

    var buys = pair.txns && pair.txns.h24 ? toNum(pair.txns.h24.buys) : null;
    var sells = pair.txns && pair.txns.h24 ? toNum(pair.txns.h24.sells) : null;
    setField('txns24',
      isNum(buys) && isNum(sells) ? fmtInt(buys) + ' / ' + fmtInt(sells) : '—');
  }

  // ──────────────────────────────────────────────────────────
  // Data: live token supply straight off a public Solana RPC
  // ──────────────────────────────────────────────────────────
  function rpcSupply(endpoint) {
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTokenSupply',
        params: [CONFIG.mint]
      })
    })
      .then(function (res) {
        if (!res.ok) throw new Error('RPC responded ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (data && data.error) throw new Error('RPC error');
        var v = data && data.result && data.result.value;
        var amount = v && (v.uiAmountString || v.uiAmount);
        var n = toNum(amount);
        if (n === null || n <= 0) throw new Error('Bad supply payload');
        return n;
      });
  }

  function fetchSupply() {
    var endpoints = CONFIG.rpcEndpoints.slice();
    function attempt() {
      if (!endpoints.length) return Promise.reject(new Error('All RPCs failed'));
      return rpcSupply(endpoints.shift()).catch(attempt);
    }
    return attempt();
  }

  function renderSupply(supply) {
    animateField('supply', supply, fmtInt);

    var burned = Math.max(CONFIG.launchSupply - supply, 0);
    var remaining = Math.max(supply - CONFIG.burnGoal, 0);
    var span = CONFIG.launchSupply - CONFIG.burnGoal;
    var pct = span > 0 ? Math.min(Math.max((burned / span) * 100, 0), 100) : 0;

    animateField('burned', burned, fmtInt);
    animateField('remaining', remaining, fmtInt);
    setField('goal', fmtInt(CONFIG.burnGoal));

    var lockedPct = supply > 0 ? (CONFIG.lockedApprox / supply) * 100 : null;
    setField('locked', fmtCompact(CONFIG.lockedApprox) +
      (isNum(lockedPct) ? ' · ' + lockedPct.toFixed(1) + '%' : ''));

    setField('burnPct', pct.toFixed(2) + '% there');

    var fill = $('[data-bar-fill]');
    var rider = $('[data-bar-rider]');
    var bar = $('[data-bar]');
    if (fill) fill.style.width = pct.toFixed(2) + '%';
    if (rider) rider.style.left = Math.min(Math.max(pct, 2), 98).toFixed(2) + '%';
    if (bar) bar.setAttribute('aria-valuenow', pct.toFixed(1));
  }

  // ──────────────────────────────────────────────────────────
  // Refresh loop
  // ──────────────────────────────────────────────────────────
  var noteEls = $$('[data-live-note]');
  var failures = 0;

  function note(text) {
    noteEls.forEach(function (el) { el.textContent = text; });
  }

  function timeNote() {
    var now = new Date();
    note('Live · updated ' +
      now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) +
      ' · price from DexScreener, supply from a public Solana RPC');
  }

  function refresh() {
    return Promise.all([
      fetchMarket().then(renderMarket),
      fetchSupply().then(renderSupply)
    ]).then(function () {
      failures = 0;
      timeNote();
    }).catch(function (err) {
      failures += 1;
      note(failures > 1
        ? 'Live data is having a moment. Retrying — the chart is still out there.'
        : 'Reaching for live data…');
      if (window.console && console.warn) console.warn('[CUNA]', err);
    });
  }

  // ──────────────────────────────────────────────────────────
  // Static wiring: links, contract, memes
  // ──────────────────────────────────────────────────────────
  function wireLinks() {
    $$('[data-buy-link]').forEach(function (a) { a.href = CONFIG.buyUrl; });
    $$('[data-chart-link]').forEach(function (a) { a.href = CONFIG.chartUrl; });
    setField('mint', CONFIG.mint);
  }

  function makeLink(href, emoji, label, cls) {
    var a = document.createElement('a');
    a.className = 'btn ' + cls;
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    var e = document.createElement('span');
    e.className = 'btn-emoji';
    e.setAttribute('aria-hidden', 'true');
    e.textContent = emoji;
    a.appendChild(e);
    a.appendChild(document.createTextNode(label));
    return a;
  }

  function buildLinks() {
    var row = $('[data-links-row]');
    if (!row) return;

    var items = [];
    if (CONFIG.socials.telegram) items.push([CONFIG.socials.telegram, '💬', 'Telegram', 'btn-buy']);
    if (CONFIG.socials.x) items.push([CONFIG.socials.x, '🐦', 'X / Twitter', 'btn-buy']);
    items.push([CONFIG.buyUrl, '👅', 'Buy on Jupiter', 'btn-ghost']);
    items.push([CONFIG.chartUrl, '📈', 'DexScreener', 'btn-ghost']);
    items.push([CONFIG.explorerUrl, '🔎', 'Solscan', 'btn-ghost']);

    items.forEach(function (it) {
      row.appendChild(makeLink(it[0], it[1], it[2], it[3]));
    });
  }

  function wireCopy() {
    var btn = $('[data-copy-mint]');
    if (!btn) return;
    var label = $('[data-copy-text]', btn);
    var timer = null;

    btn.addEventListener('click', function () {
      var done = function (ok) {
        if (label) label.textContent = ok ? 'Copied!' : 'Select it';
        btn.classList.toggle('is-done', ok);
        clearTimeout(timer);
        timer = setTimeout(function () {
          if (label) label.textContent = 'Copy';
          btn.classList.remove('is-done');
        }, 1800);
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(CONFIG.mint).then(function () { done(true); },
          function () { done(false); });
      } else {
        done(false);
      }
    });
  }

  function buildMemes() {
    var section = $('[data-memes-section]');
    var grid = $('[data-meme-grid]');
    var nav = $('[data-memes-nav]');
    if (!section || !grid) return;
    if (!Array.isArray(CONFIG.memes) || !CONFIG.memes.length) return;

    CONFIG.memes.forEach(function (m) {
      if (!m || !m.src) return;
      var fig = document.createElement('figure');
      fig.className = 'meme';

      var img = document.createElement('img');
      img.src = m.src;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = m.alt || m.caption || 'CUNALINGUS meme';
      fig.appendChild(img);

      if (m.caption) {
        var cap = document.createElement('figcaption');
        cap.textContent = m.caption;
        fig.appendChild(cap);
      }
      grid.appendChild(fig);
    });

    section.hidden = false;
    if (nav) nav.hidden = false;
  }

  // ──────────────────────────────────────────────────────────
  // Go
  // ──────────────────────────────────────────────────────────
  wireLinks();
  buildLinks();
  wireCopy();
  buildMemes();
  refresh();

  setInterval(function () {
    if (!document.hidden) refresh();
  }, CONFIG.refreshMs);

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refresh();
  });
})();
