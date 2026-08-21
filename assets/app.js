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
    // launchSupply is the actual supply at launch, confirmed by the team. It
    // is a fixed historical constant used ONLY to size the progress bar (how
    // far along the road we are) — it is not live data, and the supply it is
    // measured against always is.
    burnGoal: 6900000000,
    launchSupply: 13659767778.871345,

    // Jupiter Lock. The locks vest on a schedule and the released tokens are
    // what gets burned, so the locked total falls over time — which is why it
    // is read live rather than pinned to a constant. This program id owns the
    // vesting escrows; the mint sits at byte 40 of the escrow account, so one
    // getProgramAccounts call with a memcmp filter returns exactly this
    // token's locks and nothing else.
    lockProgram: 'LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn',
    lockMintOffset: 40,
    // Only used if that call fails (some RPCs refuse getProgramAccounts).
    // Measured 2026-08-21; it will drift as locks vest, hence the fallback
    // label saying so.
    lockedApprox: 7004310000,
    // Locks change slowly, so this doesn't need the 30s cadence.
    lockRefreshMs: 300000,

    // Public RPCs, tried in order. Both are CORS-open and keyless.
    rpcEndpoints: [
      'https://solana-rpc.publicnode.com',
      'https://api.mainnet-beta.solana.com'
    ],

    refreshMs: 30000,

    // Jupiter Plugin — the swap widget. Notes for whoever touches this next:
    //  * "Jupiter Terminal" (terminal.jup.ag/main-v2.js, main-v4.js) is the
    //    retired predecessor. Its docs 301 to the Plugin page now. main-v2 in
    //    particular has no Shadow DOM and leaks its Tailwind reset into the
    //    host page, which would wreck this stylesheet.
    //  * The option is fixedMint, SINGULAR. fixedOutputMint existed in the old
    //    Terminal and is silently ignored here — copy an old snippet and users
    //    get a wide-open token picker instead of a locked one.
    //  * No RPC is passed or accepted; the plugin runs on Jupiter's own Ultra
    //    API. Nothing here to rate-limit.
    jupiter: {
      script: 'https://plugin.jup.ag/plugin-v1.js',
      targetId: 'jupiter-plugin',
      quoteApi: 'https://lite-api.jup.ag/swap/v1/quote',
      solMint: 'So11111111111111111111111111111111111111112',
      logoUri: 'https://arweave.net/pFKl2kLMwya7ULAUtgBTYExz-3yHM4c3gc5eGmvWkVY',
      // Opens at a size that fills close to the quoted price in this pool.
      defaultLamports: '50000000', // 0.05 SOL
        warnPct: 3,
      badPct: 10,
      loadTimeoutMs: 12000,
      // The second-stage bundle is ~800KB, so allow for a slow connection
      // before calling the widget dead.
      readyTimeoutMs: 20000
    },

    // Public burn wallet. People can send $CUNA here to take it out of supply
    // without connecting anything. Leave it '' and the whole "send to the burn
    // wallet" block stays hidden — better an absent feature than a wrong
    // address on a page telling people to send tokens to it.
    burnWallet: '',

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

  // Solana addresses are base58 (no 0, O, I or l) and 32-44 characters.
  // Nothing that fails this goes into an RPC call or onto the page.
  var BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

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

  // toFixed always leaves a decimal point, so trailing zeros can be trimmed
  // wholesale: 6.90 -> 6.9, 7.00 -> 7, while 10 stays 10.
  function trimZeros(fixed) {
    return fixed.indexOf('.') === -1 ? fixed : fixed.replace(/\.?0+$/, '');
  }

  function fmtCompact(n) {
    if (!isNum(n)) return '—';
    // Thresholds sit at each tier's rounding boundary, so a value that would
    // round up (999,999,999 -> "1000M") is promoted instead.
    if (n >= 999.995e6) return trimZeros((n / 1e9).toFixed(2)) + 'B';
    if (n >= 999.95e3) return trimZeros((n / 1e6).toFixed(2)) + 'M';
    if (n >= 1e3) return trimZeros((n / 1e3).toFixed(1)) + 'K';
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
  var state = { price: null, supply: null, solUsd: null, locked: null };

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
    // priceUsd / priceNative is the SOL price, so the impact table can show
    // dollars without a second API call.
    var native = toNum(pair.priceNative);
    state.solUsd = (isNum(price) && isNum(native) && native > 0) ? price / native : null;
    setField('price', fmtUsd(price));
    // DexScreener values this token against its ORIGINAL supply — it has not
    // picked up the ~4B burned — so its market cap runs ~41% high and
    // contradicts the live supply this same page shows in the burn tracker.
    // Live supply x live price is the honest figure; DexScreener's is only a
    // fallback for first paint, before the RPC has answered.
    setField('fdv', fmtUsd(isNum(price) && isNum(state.supply) ? price * state.supply : mcap));
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
  // Jupiter Lock escrows
  //
  // Field offsets into the vesting escrow account, confirmed against the
  // chain: the decoded totals sum to exactly the balance held by the lock
  // token accounts, so the layout below is right rather than merely plausible.
  //   144 cliff_time        152 frequency (seconds)
  //   160 cliff_unlock_amount
  //   168 amount_per_period 176 number_of_period
  //   184 total_claimed_amount
  //   192 vesting_start_time
  // ──────────────────────────────────────────────────────────

  var LOCK = {
    cliffTime: 144, frequency: 152, cliffAmount: 160,
    perPeriod: 168, periods: 176, claimed: 184
  };

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var out = [];
    for (var i = 0; i < bin.length; i++) out.push(bin.charCodeAt(i));
    return out;
  }

  // Reads a little-endian u64 as a double. Amounts here run to ~7e17 raw,
  // past the exact-integer range, but the value is divided by 1e9 for display
  // and the residual error is far below a whole token.
  function u64(bytes, off) {
    var lo = 0, hi = 0, i;
    for (i = 3; i >= 0; i--) lo = lo * 256 + bytes[off + i];
    for (i = 7; i >= 4; i--) hi = hi * 256 + bytes[off + i];
    return hi * 4294967296 + lo;
  }

  function fetchLocks() {
    return rpc('getProgramAccounts', [
      CONFIG.lockProgram,
      {
        encoding: 'base64',
        filters: [{ memcmp: { offset: CONFIG.lockMintOffset, bytes: CONFIG.mint } }]
      }
    ]).then(function (accounts) {
      if (!Array.isArray(accounts) || !accounts.length) throw new Error('No locks returned');

      var nowSec = Math.floor(new Date().getTime() / 1000);
      var locked = 0, perDay = 0, count = 0;

      accounts.forEach(function (entry) {
        var data = entry && entry.account && entry.account.data;
        var b64 = Array.isArray(data) ? data[0] : null;
        if (!b64) return;

        var b = b64ToBytes(b64);
        if (b.length < 200) return;

        var cliffAmount = u64(b, LOCK.cliffAmount);
        var perPeriod = u64(b, LOCK.perPeriod);
        var periods = u64(b, LOCK.periods);
        var claimed = u64(b, LOCK.claimed);
        var frequency = u64(b, LOCK.frequency);
        var cliffTime = u64(b, LOCK.cliffTime);

        var total = cliffAmount + perPeriod * periods;
        locked += Math.max(total - claimed, 0);
        count += 1;

        // Only escrows past their cliff are releasing anything yet.
        if (frequency > 0 && nowSec >= cliffTime) {
          perDay += perPeriod * 86400 / frequency;
        }
      });

      return { locked: locked / 1e9, perDay: perDay / 1e9, count: count };
    });
  }

  function renderLocks(info) {
    state.locked = info.locked;
    var supply = state.supply;
    var pct = (isNum(supply) && supply > 0 && info.locked <= supply)
      ? (info.locked / supply) * 100 : null;

    setField('locked', fmtCompact(info.locked) +
      (isNum(pct) ? ' · ' + pct.toFixed(1) + '%' : ''));

    setField('unlockRate', info.perDay > 0
      ? fmtCompact(info.perDay) + ' / day'
      : 'not started');
  }

  // Falls back to the pinned figure so the panel still says something true-ish
  // if an RPC refuses getProgramAccounts.
  function renderLocksFallback() {
    if (isNum(state.locked)) return;
    var supply = state.supply;
    var pct = (isNum(supply) && supply > 0 && CONFIG.lockedApprox <= supply)
      ? (CONFIG.lockedApprox / supply) * 100 : null;
    setField('locked', '~' + fmtCompact(CONFIG.lockedApprox) +
      (isNum(pct) ? ' · ' + pct.toFixed(1) + '%' : ''));
    setField('unlockRate', '—');
  }

  var lastLockFetch = 0;

  function refreshLocks(force) {
    var now = new Date().getTime();
    if (!force && now - lastLockFetch < CONFIG.lockRefreshMs) return Promise.resolve();
    lastLockFetch = now;
    return fetchLocks().then(renderLocks).catch(function (err) {
      renderLocksFallback();
      if (window.console && console.warn) console.warn('[CUNA] locks:', err);
    });
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
        // Throw inside the per-endpoint promise so a 200 with a junk body
        // fails over to the next endpoint instead of resolving undefined.
        if (!data || data.result === undefined || data.result === null) {
          throw new Error('RPC returned no result for ' + method);
        }
        return data.result;
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
    // Promise.all does not order renderMarket against renderSupply, so the
    // cap is recomputed here too — otherwise it shows DexScreener's stale
    // number for up to a full refresh interval.
    if (isNum(state.price)) setField('fdv', fmtUsd(state.price * supply));
    animateField('supply', supply, fmtInt);

    var burned = Math.max(CONFIG.launchSupply - supply, 0);
    var remaining = Math.max(supply - CONFIG.burnGoal, 0);
    var span = CONFIG.launchSupply - CONFIG.burnGoal;
    var pct = span > 0 ? Math.min(Math.max((burned / span) * 100, 0), 100) : 0;

    animateField('burned', burned, fmtInt);
    animateField('remaining', remaining, fmtInt);
    setField('goal', fmtInt(CONFIG.burnGoal));

    setField('burnPct', pct.toFixed(2) + '% there');
    setField('launchLabel', 'Launch · ' + fmtCompact(CONFIG.launchSupply));
    setField('goalLabel', 'Goal · ' + fmtCompact(CONFIG.burnGoal));

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

  var refreshSeq = 0;
  var lastRefreshStart = 0;

  function refresh() {
    // Tab focus can fire visibilitychange in bursts; without this each one
    // starts its own pair of requests.
    var now = new Date().getTime();
    if (now - lastRefreshStart < 2000) return Promise.resolve();
    lastRefreshStart = now;

    // An older response landing last would otherwise repaint stale numbers.
    var seq = ++refreshSeq;

    return Promise.all([
      fetchMarket().then(function (pair) { if (seq === refreshSeq) renderMarket(pair); }),
      fetchSupply().then(function (supply) { if (seq === refreshSeq) renderSupply(supply); })
    ]).then(function () {
      if (seq !== refreshSeq) return;
      failures = 0;
      timeNote();
      // Price and supply just moved, so a connected bag is now worth
      // something slightly different.
      refreshBag();
      refreshBurnWallet();
      refreshLocks();
    }).catch(function (err) {
      if (seq !== refreshSeq) return;
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

    // The header icons carry real hrefs in the markup so they work without
    // JS. This keeps CONFIG authoritative anyway, and drops any icon whose
    // URL has been cleared rather than leaving a link to nowhere.
    $$('[data-social]').forEach(function (a) {
      var url = CONFIG.socials[a.getAttribute('data-social')];
      if (url) { a.href = url; a.hidden = false; }
      else { a.hidden = true; }
    });
  }

  // Reuses the header's inline SVGs so the icon artwork lives in exactly one
  // place, and the community row can't drift from the header.
  function socialIcon(name) {
    var source = $('[data-social="' + name + '"] svg');
    return source ? source.cloneNode(true) : null;
  }

  function makeLink(href, icon, label, cls) {
    var a = document.createElement('a');
    a.className = 'btn ' + cls;
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';

    // icon is either a cloned SVG node or an emoji string.
    if (icon && icon.nodeType === 1) {
      icon.setAttribute('class', 'btn-icon');
      a.appendChild(icon);
    } else if (icon) {
      var e = document.createElement('span');
      e.className = 'btn-emoji';
      e.setAttribute('aria-hidden', 'true');
      e.textContent = icon;
      a.appendChild(e);
    }
    a.appendChild(document.createTextNode(label));
    return a;
  }

  function buildLinks() {
    var row = $('[data-links-row]');
    if (!row) return;

    var items = [];
    if (CONFIG.socials.telegram) items.push([CONFIG.socials.telegram, socialIcon('telegram'), 'Telegram', 'btn-buy']);
    if (CONFIG.socials.x) items.push([CONFIG.socials.x, socialIcon('x'), 'X', 'btn-buy']);
    items.push([CONFIG.buyUrl, '👅', 'Buy on Jupiter', 'btn-ghost']);
    items.push([CONFIG.chartUrl, '📈', 'DexScreener', 'btn-ghost']);
    items.push([CONFIG.explorerUrl, '🔎', 'Solscan', 'btn-ghost']);

    items.forEach(function (it) {
      row.appendChild(makeLink(it[0], it[1], it[2], it[3]));
    });
  }

  function wireCopyButton(btnSel, labelSel, getValue) {
    var btn = $(btnSel);
    if (!btn) return;
    var label = $(labelSel, btn);
    var timer = null;

    btn.addEventListener('click', function () {
      var value = getValue();
      if (!value) return;

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
        navigator.clipboard.writeText(value).then(function () { done(true); },
          function () { done(false); });
      } else {
        done(false);
      }
    });
  }

  function wireCopy() {
    wireCopyButton('[data-copy-mint]', '[data-copy-text]', function () { return CONFIG.mint; });
    wireCopyButton('[data-copy-burn]', '[data-copy-burn-text]', function () { return CONFIG.burnWallet; });
  }

  // The burn wallet block only exists once there is a real address to show.
  function buildBurnWallet() {
    var block = $('[data-burn-send]');
    if (!block) return;
    if (!CONFIG.burnWallet || !BASE58_ADDRESS.test(CONFIG.burnWallet)) {
      if (CONFIG.burnWallet && window.console && console.warn) {
        console.warn('[CUNA] burnWallet is set but is not a valid Solana address — block hidden.');
      }
      return;
    }
    setField('burnWallet', CONFIG.burnWallet);
    block.hidden = false;
  }

  function refreshBurnWallet() {
    if (!CONFIG.burnWallet || !BASE58_ADDRESS.test(CONFIG.burnWallet)) return Promise.resolve();
    return fetchBag(CONFIG.burnWallet).then(function (amount) {
      setField('burnWalletBalance', fmtInt(amount) + ' $CUNA');
    }).catch(function () {
      setField('burnWalletBalance', '—');
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
  // "Check your bag" — two routes to the same read-only answer.
  //
  //   1. Connect a wallet. The ONLY wallet methods this file ever calls are
  //      connect() and disconnect(). It never calls signTransaction,
  //      signAllTransactions, signMessage or signAndSendTransaction, and it
  //      never builds a transaction — so connecting cannot move a visitor's
  //      funds.
  //   2. Paste an address. This touches no wallet at all: it is a public
  //      address going into a public RPC read. Strictly safer than route 1,
  //      and offered first-class for people who would rather not connect.
  //
  // Keep it that way. This file never asks for a signature. The swap widget
  // is a separate feature, with its own wallet connection, its own threat
  // model and its own safety copy — it must not be wired into this one.
  // ──────────────────────────────────────────────────────────

  // source is 'wallet' or 'address' — it decides the panel's wording.
  var view = { source: '', provider: null, name: '', address: '' };

  // Guards against a slow in-flight balance response painting into a panel
  // that has since been cleared or pointed at a different address.
  var bagSeq = 0;

  var els = {
    connectWrap: $('[data-bag-connect]'),
    connectBtn: $('[data-connect]'),
    picker: $('[data-wallet-picker]'),
    lookupForm: $('[data-bag-lookup]'),
    lookupInput: $('[data-bag-input]'),
    result: $('[data-bag-result]'),
    disconnectBtn: $('[data-disconnect]'),
    disconnectText: $('[data-disconnect-text]'),
    sourceLabel: $('[data-bag-source-label]'),
    msg: $('[data-bag-msg]')
  };

  function bagMsg(text, isError) {
    if (!els.msg) return;
    els.msg.textContent = text || '';
    els.msg.classList.toggle('is-error', !!isError);
  }

  // Injected providers, in the order we'd rather find them. Detection is
  // read-only: we look at window, we never call anything here.
  function detectWallets() {
    var w = window;
    var found = [];
    var seen = [];

    // eager === false marks a provider that must never get the silent
    // load-time connect: an unknown wallet may ignore onlyIfTrusted and pop
    // its approval sheet with no user gesture behind it.
    function add(name, provider, eager) {
      if (!provider || typeof provider.connect !== 'function') return;
      if (seen.indexOf(provider) !== -1) return;
      seen.push(provider);
      found.push({ name: name, provider: provider, eager: eager !== false });
    }

    add('Phantom', w.phantom && w.phantom.solana);
    add('Solflare', w.solflare && w.solflare.isSolflare ? w.solflare : null);
    add('Backpack', w.backpack && w.backpack.isBackpack ? w.backpack : null);
    add('Glow', w.glow && w.glow.solana);

    if (w.solana) {
      if (w.solana.isPhantom) add('Phantom', w.solana);
      else if (w.solana.isSolflare) add('Solflare', w.solana);
      else add('Solana wallet', w.solana, false);
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

  // Sums every $CUNA token account an address owns.
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
      ? (share <= 0 ? '0%' : share >= 0.01 ? share.toFixed(3) + '%' : '<0.01%')
      : '—');
    setField('bagRank', rankFor(amount, share));
  }

  function refreshBag() {
    if (!view.address) return Promise.resolve();

    var seq = ++bagSeq;
    var addr = view.address;

    return fetchBag(addr).then(function (amount) {
      // A newer lookup started, or the panel was cleared, while this was in
      // flight — drop the result rather than paint a stale balance.
      if (seq !== bagSeq || view.address !== addr) return;
      renderBag(amount);
    }).catch(function (err) {
      if (seq !== bagSeq || view.address !== addr) return;
      bagMsg('Could not read that balance from the chain right now. Try again in a moment.', true);
      if (window.console && console.warn) console.warn('[CUNA]', err);
    });
  }

  function showBag(message) {
    var byWallet = view.source === 'wallet';
    // Clear the previous address's figures before the new read lands, so a
    // slow or failing lookup can never leave one wallet's balance sitting
    // under another wallet's address.
    ['bagAmount', 'bagUsd', 'bagShare', 'bagRank'].forEach(function (f) {
      setField(f, '—');
    });
    setField('walletAddr', shortAddress(view.address));
    if (els.sourceLabel) els.sourceLabel.textContent = byWallet ? 'Connected' : 'Looking at';
    if (els.disconnectText) els.disconnectText.textContent = byWallet ? 'Disconnect' : 'Clear';
    if (els.connectWrap) els.connectWrap.hidden = true;
    if (els.result) els.result.hidden = false;
    if (els.picker) els.picker.hidden = true;
    bagMsg(message);
    refreshBag();
  }

  function clearBag(message) {
    view = { source: '', provider: null, name: '', address: '' };
    bagSeq += 1; // orphan anything still in flight
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
      if (view.source === 'wallet') clearBag('Wallet disconnected.');
    });

    provider.on('accountChanged', function (publicKey) {
      if (view.source !== 'wallet') return;
      if (!publicKey) { clearBag('Wallet disconnected.'); return; }
      var addr = readAddress(provider, { publicKey: publicKey });
      if (!addr) { clearBag('Wallet switched to an account this page could not read.'); return; }
      view.address = addr;
      showBag('Switched to ' + shortAddress(addr) + '.');
    });
  }

  function connectTo(entry, silent) {
    var provider = entry.provider;
    // connect() is the whole surface. Nothing else is ever called.
    var attempt;
    try {
      attempt = silent
        ? provider.connect({ onlyIfTrusted: true })
        : provider.connect();
    } catch (err) {
      // Some injected providers throw synchronously rather than rejecting.
      // Same failure, so put it on the same path instead of letting it
      // escape the .catch and strand the UI on "Waiting for…".
      return Promise.reject(err);
    }

    return Promise.resolve(attempt).then(function (res) {
      var addr = readAddress(provider, res);
      if (!addr) throw new Error('Wallet returned an unreadable address');
      view = { source: 'wallet', provider: provider, name: entry.name, address: addr };
      attachProviderEvents(provider);
      showBag('Connected to ' + entry.name + '. Read-only — nothing was signed.');
    });
  }

  function describeConnectError(err) {
    var code = err && err.code;
    var text = (err && err.message) || '';
    if (code === 4001 || /reject|denied|cancel/i.test(text)) {
      return 'Connection cancelled. No hard feelings.';
    }
    return 'Could not connect to that wallet. Nothing was signed — try again.';
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

  function lookupByAddress(raw) {
    var addr = String(raw || '').trim();

    if (!addr) {
      bagMsg('Paste a Solana wallet address first.', true);
      return;
    }
    if (!BASE58_ADDRESS.test(addr)) {
      bagMsg("That doesn't look like a Solana address. They're 32–44 characters, no 0, O, I or l.", true);
      return;
    }

    view = { source: 'address', provider: null, name: '', address: addr };
    showBag('Reading the chain for ' + shortAddress(addr) + '. No wallet involved.');
  }

  function wireBag() {
    if (els.connectBtn) {
      els.connectBtn.addEventListener('click', function () {
        var wallets = detectWallets();

        if (!wallets.length) {
          bagMsg('No Solana wallet found in this browser. Install one (Phantom, Solflare and Backpack all work) and reload — or just paste your address below instead.', true);
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
    }

    if (els.lookupForm) {
      els.lookupForm.addEventListener('submit', function (event) {
        event.preventDefault();
        lookupByAddress(els.lookupInput && els.lookupInput.value);
      });
    }

    if (els.disconnectBtn) {
      els.disconnectBtn.addEventListener('click', function () {
        var provider = view.source === 'wallet' ? view.provider : null;
        if (provider && typeof provider.disconnect === 'function') {
          // May throw synchronously OR return a rejecting promise.
          try {
            Promise.resolve(provider.disconnect()).catch(function () {});
          } catch (e) { /* wallet already gone */ }
        }
        clearBag(provider ? 'Disconnected.' : '');
        if (els.lookupInput) els.lookupInput.value = '';
      });
    }

    // Pages without the bag panel (buy, safety) have nothing to reconnect to.
    if (!els.result) return;

    // If this browser already trusts the site, reconnect without a popup.
    // Wallets that don't support onlyIfTrusted just reject; we stay quiet.
    var eager = detectWallets().filter(function (w) { return w.eager; });
    if (eager.length) {
      connectTo(eager[0], true).catch(function () { /* not trusted yet */ });
    }
  }

  // ──────────────────────────────────────────────────────────
  // Buy: Jupiter Plugin, loaded only when someone asks for it.
  //
  // This is the one feature on the page that leads to a signature, and the
  // one place third-party code runs on this origin. Both facts are stated
  // next to the button rather than buried, which is only honest if the
  // script really is absent until the click — so the <script> tag is
  // injected here, not written into index.html.
  //
  // Jupiter's widget shows dollar amounts but never a price-impact figure,
  // and this pool is thin enough that the difference is the whole story. So
  // the impact number is computed here from Jupiter's quote API and shown
  // both up front and live as the amount changes.
  // ──────────────────────────────────────────────────────────

  var JUP = CONFIG.jupiter;
  var jupState = { loading: false, loaded: false, failed: false };

  function lamports(sol) {
    return String(Math.round(sol * 1e9));
  }

  function quoteImpact(amountLamports) {
    var url = JUP.quoteApi +
      '?inputMint=' + encodeURIComponent(JUP.solMint) +
      '&outputMint=' + encodeURIComponent(CONFIG.mint) +
      '&amount=' + encodeURIComponent(amountLamports) +
      '&slippageBps=150';

    return fetch(url, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('Quote responded ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var pct = toNum(data && data.priceImpactPct);
        if (pct === null) throw new Error('No priceImpactPct in quote');
        return pct * 100;
      });
  }

  function impactClass(pct) {
    if (pct >= JUP.badPct) return 'impact-bad';
    if (pct >= JUP.warnPct) return 'impact-warn';
    return 'impact-ok';
  }

  // Live readout for whatever the user types into the widget.
  var liveTimer = null;
  var liveSeq = 0;

  function showLiveImpact(fromValue) {
    var out = $('[data-jup-impact]');
    if (!out) return;

    var sol = toNum(fromValue);
    if (sol === null || sol <= 0) { out.textContent = ''; return; }

    clearTimeout(liveTimer);
    var seq = ++liveSeq;
    liveTimer = setTimeout(function () {
      quoteImpact(lamports(sol)).then(function (pct) {
        if (seq !== liveSeq) return;
        out.textContent = 'Price impact on ' + sol + ' SOL: −' + pct.toFixed(2) + '%' +
          (pct >= JUP.badPct ? ' — that is a lot for this pool.'
            : pct >= JUP.warnPct ? ' — worth knowing before you press Swap.'
            : '');
        out.className = 'jup-impact ' + impactClass(pct);
      }).catch(function () {
        if (seq !== liveSeq) return;
        out.textContent = '';
      });
    }, 400);
  }

  // The plugin has two independent ways to die silently, and init() resolves
  // in both. Checking only one of them still ships an empty box.
  //
  //   1. It fetches its stylesheets with Promise.all, and one of them is from
  //      Google Fonts. Any single rejection discards all of them and the
  //      shadow root is left essentially empty.
  //   2. Its stub injects a second ~800KB script and neither awaits nor
  //      catches it. If that is blocked — plausible for a large script on a
  //      crypto domain — the shadow root fills in and looks healthy, the box
  //      is a full 560px tall, and the portal inside it stays empty forever
  //      while the stub polls for a global that never arrives.
  //
  // Requiring shadow content AND that global is correct in both cases.
  function widgetLooksEmpty() {
    var target = document.getElementById(JUP.targetId);
    if (!target || !target.children.length) return true;

    var hasShadowContent = false;
    var stack = [target];
    while (stack.length) {
      var el = stack.pop();
      if (el.shadowRoot && el.shadowRoot.childElementCount > 0) hasShadowContent = true;
      for (var i = 0; i < el.children.length; i++) stack.push(el.children[i]);
    }
    if (!hasShadowContent) return true;

    return !(window.JupiterRenderer && window.JupiterRenderer.RenderJupiter);
  }

  // Polls rather than checking once, so a slow connection fetching that second
  // script isn't mistaken for a dead widget.
  function watchWidget() {
    var deadline = new Date().getTime() + JUP.readyTimeoutMs;
    var timer = setInterval(function () {
      if (!widgetLooksEmpty()) {
        clearInterval(timer);
        var loading = $('[data-jup-loading]');
        if (loading) loading.hidden = true;
        return;
      }
      if (new Date().getTime() > deadline) {
        clearInterval(timer);
        jupFailed('widget never finished rendering');
      }
    }, 500);
  }

  function jupFailed(reason) {
    if (jupState.failed) return;
    jupState.failed = true;
    jupState.loading = false;

    var wrap = $('[data-jup-wrap]');
    var load = $('[data-buy-load]');
    if (wrap) wrap.hidden = true;
    if (load) {
      load.hidden = false;
      var note = $('.buy-load-note', load);
      if (note) {
        note.textContent = "Jupiter's swap box didn't load — some browser extensions and networks block it. " +
          'The jup.ag link below does the same trade.';
        note.classList.add('is-error');
      }
      var btn = $('[data-load-widget]', load);
      if (btn) btn.hidden = true;
    }
    if (window.console && console.warn) console.warn('[CUNA] Jupiter widget:', reason);
  }

  function initJupiter() {
    if (!window.Jupiter || typeof window.Jupiter.init !== 'function') {
      jupFailed('window.Jupiter missing after script load');
      return;
    }

    // init() returns a promise and REJECTS on bad config — it does not throw,
    // so try/catch alone would miss it.
    Promise.resolve(window.Jupiter.init({
      displayMode: 'integrated',
      integratedTargetId: JUP.targetId,
      containerStyles: { height: '560px', borderRadius: '18px' },
      // Defaults to TRUE, which would silently reconnect a wallet on every
      // later visit — the opposite of what this page offers people.
      autoConnect: false,
      defaultExplorer: 'Solscan',
      branding: { name: 'CUNALINGUS', logoUri: JUP.logoUri },
      formProps: {
        swapMode: 'ExactIn',
        initialInputMint: JUP.solMint,
        initialOutputMint: CONFIG.mint,
        fixedMint: CONFIG.mint,
        initialAmount: JUP.defaultLamports
      },
      onFormUpdate: function (form) {
        showLiveImpact(form && form.fromValue);
      },
      onSwapError: function (e) {
        if (window.console && console.warn) console.warn('[CUNA] swap error', e && e.error);
      }
    })).then(function () {
      jupState.loaded = true;
      jupState.loading = false;
      var load = $('[data-buy-load]');
      if (load) load.hidden = true;
      showLiveImpact(0.05);
      watchWidget();
    }).catch(function (err) {
      jupFailed(err && err.message ? err.message : err);
    });
  }

  function loadJupiter() {
    if (jupState.loading || jupState.loaded) return;
    jupState.loading = true;

    var btn = $('[data-load-widget]');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading Jupiter…'; }

    var wrap = $('[data-jup-wrap]');
    if (wrap) wrap.hidden = false;

    var timeout = setTimeout(function () {
      if (!jupState.loaded) jupFailed('timed out after ' + JUP.loadTimeoutMs + 'ms');
    }, JUP.loadTimeoutMs);

    var script = document.createElement('script');
    script.src = JUP.script;
    script.async = true;
    script.onload = function () { clearTimeout(timeout); initJupiter(); };
    script.onerror = function () { clearTimeout(timeout); jupFailed('script failed to load'); };
    document.head.appendChild(script);
  }

  function wireBuy() {
    var btn = $('[data-load-widget]');
    if (btn) btn.addEventListener('click', loadJupiter);
  }

  // ──────────────────────────────────────────────────────────
  // Go
  // ──────────────────────────────────────────────────────────
  wireLinks();
  buildLinks();
  wireCopy();
  buildMemes();
  buildBurnWallet();
  wireBag();
  wireBuy();
  refresh();

  setInterval(function () {
    if (!document.hidden) refresh();
  }, CONFIG.refreshMs);

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refresh();
  });
})();
