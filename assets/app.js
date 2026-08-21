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
      telegram: 'https://t.me/cunaonsol',
      x: 'https://x.com/cunatoken'
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

  // Latest good readings, shared with the wallet panel.
  var state = { price: null, supply: null };

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

    state.price = price;
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
  function rpcOnce(endpoint, method, params) {
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params })
    })
      .then(function (res) {
        if (!res.ok) throw new Error('RPC responded ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (data && data.error) throw new Error('RPC error on ' + method);
        return data && data.result;
      });
  }

  // Walks the endpoint list until one answers, so a single rate-limited
  // public RPC doesn't take the page down.
  function rpc(method, params) {
    var endpoints = CONFIG.rpcEndpoints.slice();
    function attempt() {
      if (!endpoints.length) return Promise.reject(new Error('All RPCs failed'));
      return rpcOnce(endpoints.shift(), method, params).catch(attempt);
    }
    return attempt();
  }

  function fetchSupply() {
    return rpc('getTokenSupply', [CONFIG.mint]).then(function (result) {
      var v = result && result.value;
      var n = toNum(v && (v.uiAmountString || v.uiAmount));
      if (n === null || n <= 0) throw new Error('Bad supply payload');
      return n;
    });
  }

  function renderSupply(supply) {
    state.supply = supply;
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
      // Price and supply just moved, so a connected bag is now worth
      // something slightly different.
      refreshBag();
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
  // Wallet: READ-ONLY, and it stays that way.
  //
  // The only wallet method this file ever calls is connect() (plus
  // disconnect()). It never calls signTransaction, signAllTransactions,
  // signMessage, or signAndSendTransaction, and it never builds a
  // transaction — so connecting cannot move a user's funds. The balance is
  // read from a public RPC using nothing but the public address the wallet
  // hands back. Keep it that way: if a future change needs a signature,
  // that is a different feature with a different threat model.
  // ──────────────────────────────────────────────────────────

  // Solana addresses are base58 and 32-44 chars. Anything else is not
  // something we hand to an RPC or print on the page.
  var BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

  var wallet = { provider: null, name: '', address: '' };

  var els = {
    connectWrap: $('[data-bag-connect]'),
    connectBtn: $('[data-connect]'),
    picker: $('[data-wallet-picker]'),
    result: $('[data-bag-result]'),
    disconnectBtn: $('[data-disconnect]'),
    msg: $('[data-bag-msg]')
  };

  function bagMsg(text, isError) {
    if (!els.msg) return;
    els.msg.textContent = text || '';
    els.msg.classList.toggle('is-error', !!isError);
  }

  // Injected providers, in the order we'd rather find them. Detection is
  // read-only: we look, we never call anything here.
  function detectWallets() {
    var w = window;
    var found = [];
    var seen = [];

    function add(name, provider) {
      if (!provider || typeof provider.connect !== 'function') return;
      if (seen.indexOf(provider) !== -1) return;
      seen.push(provider);
      found.push({ name: name, provider: provider });
    }

    add('Phantom', w.phantom && w.phantom.solana);
    add('Solflare', w.solflare && w.solflare.isSolflare ? w.solflare : null);
    add('Backpack', w.backpack && w.backpack.isBackpack ? w.backpack : null);
    add('Glow', w.glow && w.glow.solana);

    if (w.solana) {
      if (w.solana.isPhantom) add('Phantom', w.solana);
      else if (w.solana.isSolflare) add('Solflare', w.solana);
      else add('Solana wallet', w.solana);
    }
    return found;
  }

  function readAddress(provider, connectResult) {
    var key = (connectResult && connectResult.publicKey) || provider.publicKey;
    if (!key) return '';
    var addr = typeof key.toString === 'function' ? key.toString() : String(key);
    return BASE58_ADDRESS.test(addr) ? addr : '';
  }

  function shortAddress(addr) {
    return addr.slice(0, 4) + '…' + addr.slice(-4);
  }

  function rankFor(amount, share) {
    if (!isNum(amount) || amount <= 0) return 'Dry mouth — no $CUNA in here';
    if (isNum(share) && share >= 1) return 'Tongue Overlord';
    if (isNum(share) && share >= 0.1) return 'Diamond Tongue';
    if (isNum(share) && share >= 0.01) return 'Certified Tongue Holder';
    return 'Tastebud';
  }

  // Sums every $CUNA token account the address owns.
  function fetchBag(address) {
    return rpc('getTokenAccountsByOwner', [
      address,
      { mint: CONFIG.mint },
      { encoding: 'jsonParsed' }
    ]).then(function (result) {
      var accounts = (result && result.value) || [];
      var total = 0;
      accounts.forEach(function (entry) {
        var info = entry && entry.account && entry.account.data &&
          entry.account.data.parsed && entry.account.data.parsed.info;
        var amount = info && info.tokenAmount &&
          (info.tokenAmount.uiAmountString || info.tokenAmount.uiAmount);
        var n = toNum(amount);
        if (n !== null && n > 0) total += n;
      });
      return total;
    });
  }

  function renderBag(amount) {
    setField('bagAmount', fmtInt(amount));
    setField('bagUsd', isNum(state.price) ? fmtUsd(amount * state.price) : '—');

    var share = isNum(state.supply) && state.supply > 0
      ? (amount / state.supply) * 100
      : null;
    setField('bagShare', isNum(share)
      ? (share >= 0.01 ? share.toFixed(3) + '%' : '<0.01%')
      : '—');
    setField('bagRank', rankFor(amount, share));
  }

  function refreshBag() {
    if (!wallet.address) return Promise.resolve();
    return fetchBag(wallet.address).then(renderBag).catch(function (err) {
      bagMsg('Could not read your balance from the chain right now. Try again in a moment.', true);
      if (window.console && console.warn) console.warn('[CUNA]', err);
    });
  }

  function showConnected() {
    setField('walletAddr', shortAddress(wallet.address));
    if (els.connectWrap) els.connectWrap.hidden = true;
    if (els.result) els.result.hidden = false;
    if (els.picker) els.picker.hidden = true;
    bagMsg('Connected to ' + wallet.name + '. Read-only — nothing was signed.');
    refreshBag();
  }

  function resetWallet(message) {
    wallet = { provider: null, name: '', address: '' };
    if (els.connectWrap) els.connectWrap.hidden = false;
    if (els.result) els.result.hidden = true;
    if (els.picker) els.picker.hidden = true;
    ['bagAmount', 'bagUsd', 'bagShare', 'bagRank', 'walletAddr'].forEach(function (f) {
      setField(f, '—');
    });
    bagMsg(message || '');
  }

  function attachProviderEvents(provider) {
    if (!provider || typeof provider.on !== 'function') return;
    provider.on('disconnect', function () {
      resetWallet('Wallet disconnected.');
    });
    provider.on('accountChanged', function (publicKey) {
      if (!publicKey) { resetWallet('Wallet disconnected.'); return; }
      var addr = readAddress(provider, { publicKey: publicKey });
      if (!addr) { resetWallet('Wallet switched to an account this page could not read.'); return; }
      wallet.address = addr;
      showConnected();
    });
  }

  function connectTo(entry, silent) {
    var provider = entry.provider;
    // connect() is the whole surface. Nothing else is ever called.
    var attempt = silent
      ? provider.connect({ onlyIfTrusted: true })
      : provider.connect();

    return Promise.resolve(attempt).then(function (res) {
      var addr = readAddress(provider, res);
      if (!addr) throw new Error('Wallet returned an unreadable address');
      wallet = { provider: provider, name: entry.name, address: addr };
      attachProviderEvents(provider);
      showConnected();
    });
  }

  function buildPicker(wallets) {
    if (!els.picker) return;
    els.picker.textContent = '';
    wallets.forEach(function (entry) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost';
      btn.textContent = entry.name;
      btn.addEventListener('click', function () {
        bagMsg('Waiting for ' + entry.name + '…');
        connectTo(entry, false).catch(function (err) {
          bagMsg(describeConnectError(err), true);
        });
      });
      els.picker.appendChild(btn);
    });
    els.picker.hidden = false;
  }

  function describeConnectError(err) {
    var code = err && err.code;
    var text = (err && err.message) || '';
    if (code === 4001 || /reject|denied|cancel/i.test(text)) {
      return 'Connection cancelled. No hard feelings.';
    }
    return 'Could not connect to that wallet. Nothing was signed — try again.';
  }

  function wireWallet() {
    if (!els.connectBtn) return;

    els.connectBtn.addEventListener('click', function () {
      var wallets = detectWallets();

      if (!wallets.length) {
        bagMsg('No Solana wallet found in this browser. Install one (Phantom, Solflare and Backpack all work), then reload this page.', true);
        return;
      }
      if (wallets.length === 1) {
        bagMsg('Waiting for ' + wallets[0].name + '…');
        connectTo(wallets[0], false).catch(function (err) {
          bagMsg(describeConnectError(err), true);
        });
        return;
      }
      bagMsg('Pick a wallet:');
      buildPicker(wallets);
    });

    if (els.disconnectBtn) {
      els.disconnectBtn.addEventListener('click', function () {
        var provider = wallet.provider;
        if (provider && typeof provider.disconnect === 'function') {
          try { provider.disconnect(); } catch (e) { /* wallet already gone */ }
        }
        resetWallet('Disconnected.');
      });
    }

    // If this browser already trusts the site, reconnect without a popup.
    // Wallets that don't support onlyIfTrusted just reject; we stay quiet.
    var known = detectWallets();
    if (known.length) {
      connectTo(known[0], true).catch(function () { /* not trusted yet */ });
    }
  }

  // ──────────────────────────────────────────────────────────
  // Go
  // ──────────────────────────────────────────────────────────
  wireLinks();
  buildLinks();
  wireCopy();
  buildMemes();
  wireWallet();
  refresh();

  setInterval(function () {
    if (!document.hidden) refresh();
  }, CONFIG.refreshMs);

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refresh();
  });
})();
