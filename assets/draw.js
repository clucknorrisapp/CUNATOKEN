/* CUNA DRAWING — paste a Solana address, get entered.
 *
 * Two things have to happen for an entry to count, and the page says so at
 * every step:
 *
 *   1. The address is entered HERE. The website list is the official one —
 *      the drawing is run from it.
 *   2. The same address is replied under the pinned post on X. That is how
 *      each entry on the list is verified. One without the other is not an
 *      entry.
 *
 * The website list needs somewhere to live, and a static site has nowhere:
 * REGISTRY.endpoint is that somewhere. While it is empty this page CANNOT
 * record anything, and it says so rather than showing a green tick over a
 * write that never happened — someone's prize depends on it.
 *
 * Nothing here asks for, accepts, or transmits anything but a public address.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* ── the drawing ── */

  /* Central time, September, is UTC-5 (CDT). Stored as explicit UTC instants
     so the window means the same thing in every timezone a holder is in. */
  var DRAW = {
    opensAt: Date.parse('2026-09-11T15:30:00Z'),   /* Fri 11 Sep, 10:30 AM CT */
    closesAt: Date.parse('2026-09-13T18:00:00Z'),  /* Sun 13 Sep,  1:00 PM CT */
    opensLabel: 'Friday 11 September, 10:30 AM Central',
    closesLabel: 'Sunday 13 September, 1:00 PM Central'
  };

  /* Where the entry is recorded.

     xPost: the pinned post on @cunatoken. Fill this in with its URL and the
            button becomes a REPLY to that exact post, which is what the rules
            ask for. Left empty, it falls back to a plain post the user has to
            put under the pinned one themselves.

     endpoint: a URL that accepts POST {address} and records it — the official
            list the drawing is run from. There is no such endpoint on this
            static site; it would live on the same app that serves
            lock.cunatoken.com, or any form service that takes a POST. While
            this is empty NOTHING IS RECORDED and the page says so out loud. */
  var REGISTRY = {
    xPost: '',
    endpoint: '',
    /* GET check?address=<addr>, answering {ok:true, found:true|false}. Same
       story as endpoint: without it the page can confirm the holder half of
       the answer from the chain but not the list half, and says which is
       which rather than guessing. */
    check: ''
  };

  var HANDLE = 'cunatoken';

  /* Holding more than a dollar of CUNA is worth a second entry, so the page
     reads the balance of the address you pasted and says whether it counts.
     Same mint, same endpoints and same account-summing as "Check your bag" —
     one read of the chain, so the two pages can never disagree. */
  var MINT = '4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc';
  var RPCS = ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];
  var BONUS_USD = 1;

  /* ── address checking ── */

  var B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  /* A regex on the alphabet catches a wrong character but not a wrong length
     once it is decoded, and a dropped character is the typo people actually
     make. Decode it properly: a Solana address is 32 bytes, no more, no less.
     Getting this wrong sends someone's entry nowhere. */
  function decodeBase58(str) {
    var bytes = [0];
    for (var i = 0; i < str.length; i++) {
      var v = B58.indexOf(str.charAt(i));
      if (v < 0) return null;
      for (var j = 0; j < bytes.length; j++) bytes[j] *= 58;
      bytes[0] += v;
      var carry = 0;
      for (var k = 0; k < bytes.length; k++) {
        bytes[k] += carry;
        carry = bytes[k] >> 8;
        bytes[k] &= 0xff;
      }
      while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
    }
    /* leading '1's are leading zero bytes */
    for (var z = 0; z < str.length && str.charAt(z) === '1'; z++) bytes.push(0);
    return bytes.reverse();
  }

  function checkAddress(raw) {
    var a = (raw || '').trim();
    if (!a) return { ok: false, why: '' };
    if (/\s/.test(a)) return { ok: false, why: 'That has a space in it — paste just the address.' };
    /* The one input on this site that could ruin someone's day. */
    if (a.split(/\s+/).length > 5 || /\b(seed|phrase|mnemonic)\b/i.test(a)) {
      return { ok: false, why: 'That is not an address. Never paste a seed phrase anywhere.' };
    }
    if (a.length < 32 || a.length > 44) {
      return { ok: false, why: 'A Solana address is 32–44 characters. That one is ' + a.length + '.' };
    }
    var bad = a.split('').filter(function (c) { return B58.indexOf(c) < 0; });
    if (bad.length) {
      return { ok: false, why: 'That contains ' + bad[0] + ', which is not in a Solana address.' };
    }
    var bytes = decodeBase58(a);
    if (!bytes || bytes.length !== 32) {
      return { ok: false, why: 'That is not a valid Solana address — check for a missing character.' };
    }
    return { ok: true, address: a };
  }

  /* ── what the address holds ── */

  function rpc(method, params) {
    var left = RPCS.slice();
    function attempt() {
      if (!left.length) return Promise.reject(new Error('all RPCs failed'));
      var url = left.shift();
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params })
      }).then(function (r) {
        if (!r.ok) throw new Error('RPC responded ' + r.status);
        return r.json();
      }).then(function (d) {
        if (!d || d.error || d.result === undefined || d.result === null) {
          throw new Error('RPC returned nothing useful');
        }
        return d.result;
      }).catch(attempt);
    }
    return attempt();
  }

  /* An owner can hold the same mint across several token accounts, so the
     balance is the sum of all of them — not the first one found. */
  function balanceOf(address) {
    return rpc('getTokenAccountsByOwner', [address, { mint: MINT }, { encoding: 'jsonParsed' }])
      .then(function (result) {
        var accounts = (result && result.value) || [];
        var total = 0;
        for (var i = 0; i < accounts.length; i++) {
          var a = accounts[i];
          var info = a && a.account && a.account.data && a.account.data.parsed && a.account.data.parsed.info;
          var amt = info && info.tokenAmount && (info.tokenAmount.uiAmountString || info.tokenAmount.uiAmount);
          var n = Number(amt);
          if (isFinite(n) && n > 0) total += n;
        }
        return total;
      });
  }

  function priceUsd() {
    return fetch('https://lite-api.jup.ag/tokens/v2/search?query=' + encodeURIComponent(MINT),
                 { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('price ' + r.status); return r.json(); })
      .then(function (data) {
        var list = Array.isArray(data) ? data : (data && data.data) || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i] && list[i].id === MINT) {
            var p = Number(list[i].usdPrice);
            if (isFinite(p) && p > 0) return p;
          }
        }
        throw new Error('no price');
      });
  }

  function fmtInt(n) {
    try { return Math.round(n).toLocaleString('en-US'); } catch (e) { return String(Math.round(n)); }
  }
  function fmtUsd(n) {
    if (!isFinite(n)) return '—';
    if (n >= 1) return '$' + n.toFixed(2);
    return '$' + n.toFixed(4);
  }

  /* Resolves to what the page should say about the second entry. A failed
     read is reported as unknown rather than as "you do not qualify" — the
     chain being unreachable is not the holder's fault. */
  function checkBonus(address) {
    return Promise.all([balanceOf(address), priceUsd()]).then(function (r) {
      var amount = r[0], price = r[1], usd = amount * price;
      return { ok: true, amount: amount, usd: usd, qualifies: usd > BONUS_USD };
    }).catch(function () {
      return { ok: false };
    });
  }

  /* ── the window ── */

  function phase(now) {
    if (now < DRAW.opensAt) return 'before';
    if (now >= DRAW.closesAt) return 'after';
    return 'open';
  }

  function countdown(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var d = Math.floor(s / 86400); s -= d * 86400;
    var h = Math.floor(s / 3600); s -= h * 3600;
    var m = Math.floor(s / 60); s -= m * 60;
    var out = [];
    if (d) out.push(d + (d === 1 ? ' day' : ' days'));
    if (d || h) out.push(h + 'h');
    out.push(m + 'm');
    if (!d) out.push(s + 's');
    return out.join(' ');
  }

  /* The window in the reader's own timezone, because "1 PM Central" is a
     small maths problem for most of the people reading it. */
  function localLabel(ms) {
    try {
      return new Date(ms).toLocaleString(undefined, {
        weekday: 'short', day: 'numeric', month: 'short',
        hour: 'numeric', minute: '2-digit'
      });
    } catch (e) { return ''; }
  }

  var el = {};
  var timer = 0;

  function tick() {
    var now = Date.now();
    var p = phase(now);
    if (el.state) el.state.setAttribute('data-phase', p);

    if (p === 'before') {
      setText(el.status, 'Opens in ' + countdown(DRAW.opensAt - now));
      setText(el.sub, 'Entries open ' + DRAW.opensLabel + '.');
    } else if (p === 'open') {
      setText(el.status, 'Closes in ' + countdown(DRAW.closesAt - now));
      setText(el.sub, 'Entries close ' + DRAW.closesLabel + '.');
    } else {
      setText(el.status, 'Entries are closed');
      setText(el.sub, 'This drawing closed ' + DRAW.closesLabel + '.');
    }

    var shut = (p !== 'open');
    if (el.input) el.input.disabled = shut;
    if (el.go) el.go.disabled = shut;
  }

  function setText(node, t) { if (node) node.textContent = t; }

  /* ── entering ── */

  function entryText(address) {
    return 'Entering the $CUNA drawing 👅\n\n' + address;
  }

  function entryUrl(address) {
    var u = 'https://x.com/intent/post?text=' + encodeURIComponent(entryText(address));
    var id = REGISTRY.xPost && REGISTRY.xPost.match(/status\/(\d+)/);
    if (id) u += '&in_reply_to=' + id[1];
    return u;
  }

  /* Best effort, and never the thing standing between a holder and their
     entry: if the registry is unreachable the X reply still counts. */
  function register(address) {
    if (!REGISTRY.endpoint) return Promise.resolve('none');
    return fetch(REGISTRY.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: address })
    }).then(function (r) {
      if (!r.ok) throw new Error('registry responded ' + r.status);
      return 'saved';
    }).catch(function () { return 'failed'; });
  }

  /* "Am I entered?" — two independent questions, answered separately so a
     half-answer is never dressed up as a whole one:
       on the list?  only the registry knows.
       one entry or two?  the chain knows, right now. */
  function lookup() {
    var res = checkAddress(el.check.value);
    if (!res.ok) { sayCheck('bad', res.why || 'Paste the address you entered with.'); return; }

    sayCheck('wait', 'Looking…');
    var onList = REGISTRY.check
      ? fetch(REGISTRY.check + (REGISTRY.check.indexOf('?') < 0 ? '?' : '&') +
              'address=' + encodeURIComponent(res.address), { cache: 'no-store' })
          .then(function (r) { if (!r.ok) throw new Error('check ' + r.status); return r.json(); })
          .then(function (d) { return d && d.ok ? !!d.found : null; })
          .catch(function () { return null; })
      : Promise.resolve(undefined);

    Promise.all([onList, checkBonus(res.address)]).then(function (r) {
      var listed = r[0], bonus = r[1];
      var entries = bonus.ok ? (bonus.qualifies ? 2 : 1) : null;

      var head;
      if (listed === true) head = 'You are on the website list.';
      else if (listed === false) head = 'This address is NOT on the website list — enter it above.';
      else if (listed === null) head = 'Could not reach the website list just now.';
      else head = 'The website list is not switched on yet, so it cannot be checked here.';

      var tail;
      if (entries === 2) {
        tail = ' Holding ' + fmtInt(bonus.amount) + ' $CUNA (about ' + fmtUsd(bonus.usd) +
               '), so this address counts as 2 entries.';
      } else if (entries === 1) {
        tail = bonus.amount > 0
          ? ' Holding ' + fmtInt(bonus.amount) + ' $CUNA (about ' + fmtUsd(bonus.usd) +
            ') — under $1, so 1 entry. Over $1 at draw time makes it 2.'
          : ' No $CUNA at this address, so 1 entry. Over $1 at draw time makes it 2.';
      } else {
        tail = ' Could not read the chain, so the second entry could not be checked here.';
      }

      var reply = listed === true
        ? ' Your reply has to be on the X thread too, or it does not count.'
        : '';
      sayCheck(listed === false ? 'bad' : 'good', head + tail + reply);
    });
  }

  function sayCheck(kind, text) {
    if (!el.checkMsg) return;
    el.checkMsg.className = 'dr-msg is-' + kind;
    el.checkMsg.textContent = text;
  }

  function say(kind, text) {
    if (!el.msg) return;
    el.msg.className = 'dr-msg is-' + kind;
    el.msg.textContent = text;
  }

  function submit() {
    var res = checkAddress(el.input.value);
    if (!res.ok) { say('bad', res.why || 'Paste your Solana address first.'); el.input.focus(); return; }
    if (phase(Date.now()) !== 'open') { say('bad', 'Entries are not open right now.'); return; }

    /* Open the tab inside the click: the popup blocker eats one opened later,
       and the whole point of the button is landing in the composer. */
    var win = null;
    try { win = window.open(entryUrl(res.address), '_blank', 'noopener'); } catch (e) { }

    el.out.hidden = false;
    setText(el.outAddr, res.address);
    if (el.outLink) el.outLink.href = entryUrl(res.address);
    if (el.pinned) el.pinned.href = REGISTRY.xPost || ('https://x.com/' + HANDLE);

    register(res.address).then(function (how) {
      if (how === 'saved') {
        say('good', 'You are on the website list. Now reply with the same address on the X thread — ' +
                    'without that reply the entry does not count.');
      } else if (how === 'none') {
        /* No endpoint configured: claiming an entry here would be a lie. */
        say('bad', 'The website list is not switched on yet, so this could not be recorded. ' +
                   'Reply on the X thread now and come back to enter here once it is live.');
      } else {
        say('bad', 'Could not reach the website list. Reply on the X thread, then try entering ' +
                   'here again — both are needed.');
      }
    });

    showBonus(res.address);

    try { localStorage.setItem('cuna_draw_addr', res.address); } catch (e) { }
    if (!win && el.outLink) el.outLink.focus();
  }

  /* The second entry, read live off the chain. Holdings are checked again
     when the drawing is actually run, so this says what the address holds
     now rather than promising what it will hold on Sunday. */
  function showBonus(address) {
    if (!el.bonus) return;
    el.bonus.hidden = false;
    el.bonus.className = 'dr-bonus is-checking';
    setText(el.bonusText, 'Checking what this address holds…');

    checkBonus(address).then(function (b) {
      if (!b.ok) {
        el.bonus.className = 'dr-bonus is-unknown';
        setText(el.bonusText,
          'Could not read the chain just now, so the second entry could not be checked here. ' +
          'It is checked again when the drawing is run, so holding still counts.');
        return;
      }
      if (b.qualifies) {
        el.bonus.className = 'dr-bonus is-yes';
        setText(el.bonusText,
          'Holding ' + fmtInt(b.amount) + ' $CUNA — about ' + fmtUsd(b.usd) + '. ' +
          'That is over $1, so this address gets a second entry.');
      } else if (b.amount > 0) {
        el.bonus.className = 'dr-bonus is-no';
        setText(el.bonusText,
          'Holding ' + fmtInt(b.amount) + ' $CUNA — about ' + fmtUsd(b.usd) + '. ' +
          'Over $1 gets a second entry; this one is still in with one.');
      } else {
        el.bonus.className = 'dr-bonus is-no';
        setText(el.bonusText,
          'No $CUNA at this address. You are in with one entry — holding over $1 makes it two.');
      }
    });
  }

  /* ── boot ── */

  function init() {
    el.state = $('dr-state');
    if (!el.state) return;
    el.status = $('dr-status');
    el.sub = $('dr-sub');
    el.input = $('dr-address');
    el.go = $('dr-go');
    el.msg = $('dr-msg');
    el.out = $('dr-out');
    el.outAddr = $('dr-out-addr');
    el.outLink = $('dr-out-link');
    el.pinned = $('dr-pinned');
    el.check = $('dr-check-addr');
    el.checkGo = $('dr-check-go');
    el.checkMsg = $('dr-check-msg');
    el.bonus = $('dr-bonus');
    el.bonusText = $('dr-bonus-text');

    setText($('dr-opens'), DRAW.opensLabel);
    setText($('dr-closes'), DRAW.closesLabel);
    var lo = localLabel(DRAW.opensAt), lc = localLabel(DRAW.closesAt);
    if (lo && lc) setText($('dr-local'), 'Your time: ' + lo + ' → ' + lc);

    if (el.pinned) el.pinned.href = REGISTRY.xPost || ('https://x.com/' + HANDLE);
    if (!REGISTRY.endpoint) {
      var n = $('dr-registry-note');
      if (n) n.hidden = false;
    }

    el.go.addEventListener('click', submit);
    if (el.checkGo) {
      el.checkGo.addEventListener('click', lookup);
      el.check.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); lookup(); }
      });
      el.check.addEventListener('paste', function () {
        setTimeout(function () { el.check.value = el.check.value.trim(); }, 0);
      });
    }
    el.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
    el.input.addEventListener('input', function () {
      if (el.msg) { el.msg.textContent = ''; el.msg.className = 'dr-msg'; }
    });

    /* Paste is how every one of these is filled in — tidy it up rather than
       rejecting a stray space someone did not put there. */
    el.input.addEventListener('paste', function () {
      setTimeout(function () { el.input.value = el.input.value.trim(); }, 0);
    });

    var last = '';
    try { last = localStorage.getItem('cuna_draw_addr') || ''; } catch (e) { }
    if (last && !el.input.value) el.input.placeholder = last;

    tick();
    timer = setInterval(tick, 1000);

    /* Test hook: non-visual, enters nothing. */
    el.state.__cuna = {
      check: function (a) { return checkAddress(a); },
      phase: function (t) { return phase(t === undefined ? Date.now() : t); },
      url: function (a) { return entryUrl(a); },
      window: function () { return { opensAt: DRAW.opensAt, closesAt: DRAW.closesAt }; },
      bonus: function (a) { return checkBonus(a); },
      /* Lets the test drive the recorded-entry path, which is the one every
         real entry takes once the list is switched on. */
      setEndpoint: function (u) { REGISTRY.endpoint = u; },
      setPost: function (u) { REGISTRY.xPost = u; },
      setCheck: function (u) { REGISTRY.check = u; },
      lookup: function () { lookup(); },
      bonusUsd: BONUS_USD
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
