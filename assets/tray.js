/* TACO TRAY — swap two neighbours, line up three, watch the tray collapse.
 *
 * A match-three next to a maze, a snake and a whack game: the one you can
 * play badly and slowly. That is why it is a MOVE budget and not a clock.
 * A clock rewards flailing at the first three you spot; the whole pleasure of
 * this genre is the twenty seconds you spend finding the swap that sets off
 * four cascades, and a timer taxes exactly that. Twenty moves, no ticking,
 * and a mis-swap that lines nothing up costs nothing but the animation.
 *
 * Conventions follow assets/whack.js — ES5, one IIFE, board sized from the
 * shell and the viewport, never from the field.
 */
(function () {
  'use strict';

  var BEST_KEY = 'cuna_tray_best';
  var COLS = 7, ROWS = 7, N = COLS * ROWS;
  var MOVES = 20;

  /* Seven columns, not eight. On the narrowest phone the site still supports
     (320px) the shell gives the tray about 278px, which is a 39px tile at 7
     across and a 34px tile at 8 — under the ~44px a thumb wants, and this is
     a game where you aim at one specific tile. Seven also keeps a five-line
     rare enough to feel like something. */

  /* Five tile kinds, not six. The brief offered six and asked whether that is
     too many: it is, but not for the usual difficulty reason — it is a
     legibility one. `jeet` (red ghost) and `ruggy` (magenta ghost) are the
     same silhouette in two neighbouring hues, and at a 39px tile on a phone
     they are one tile type with a colour wobble. Dropping `ruggy` leaves five
     that differ in shape as well as colour: a taco, a lips, and three ghosts
     that are red, mint and cream. Five also makes matches commoner, which a
     twenty-move round wants. */
  var TYPES = ['power', 'jeet', 'fudd', 'paper', 'open'];
  var NT = TYPES.length;

  /* Each kind gets a plate as well as a sprite. Sprite alone was not enough:
     three of the five are ghosts, so the silhouette carries very little at
     tile size and the whole board read as confetti. A flat mid-dark plate per
     kind gives every tile a second, larger, blockier cue, which is what lets
     you scan a column without looking at any single tile. */
  var PLATE = ['#7c4a10', '#701624', '#10474b', '#3e3e60', '#6b1444'];
  var PLATE_LIT = ['#a4661c', '#95202f', '#186a70', '#575784', '#932061'];

  var $ = function (id) { return document.getElementById(id); };

  var el = {};
  var g = new Int8Array(N);          /* type index per cell, -1 = empty */
  var vx = new Float32Array(N);      /* visual offset, in CELLS not pixels, so */
  var vy = new Float32Array(N);      /* a resize mid-animation cannot skew it  */
  var vs = new Float32Array(N);      /* scale */
  var va = new Float32Array(N);      /* alpha */

  var state = 'attract';             /* attract | play | over */
  var ph = 'idle';                   /* idle | swap | back | clear | fall | shrink | grow */
  var phT0 = 0, phDur = 0, phData = null;

  var score = 0, best = 0, bestAtStart = 0;
  var moves = MOVES, chain = 0, bestChain = 0, lines = 0;
  var raf = 0;
  var soundOn = false, actx = null;
  var queue = null;                  /* test hook: forced refill order */

  var SPR = {
    img: null, ready: false, cell: 144,
    map: { power: [2, 0], jeet: [4, 0], fudd: [1, 1], paper: [2, 1], open: [0, 0] }
  };

  var MOTION = 1;
  var DUR = { swap: 150, back: 150, clear: 190, fall: 240, shrink: 150, grow: 190 };

  function dur(k) { return DUR[k] * MOTION; }

  function loadSprites() {
    var im = new Image();
    im.decoding = 'async';
    im.onload = function () { SPR.ready = true; SPR.img = im; draw(); };
    im.onerror = function () { SPR.ready = false; };
    im.src = 'assets/sprites.webp';
  }

  /* ── grid maths ───────────────────────────────────────────────────── */

  function rnd(n) { return (Math.random() * n) | 0; }

  function randType() {
    if (queue && queue.length) {
      var i = TYPES.indexOf(String(queue.shift()));
      if (i >= 0) return i;
    }
    return rnd(NT);
  }

  /* Does the tile at i sit in a run of three or more? Cheap enough to call
     inside the legal-move scan, which runs it ~200 times a board. */
  function matchAt(gr, i) {
    var t = gr[i];
    if (t < 0) return false;
    var x = i % COLS, y = (i / COLS) | 0, n = 1, k;
    for (k = x - 1; k >= 0 && gr[y * COLS + k] === t; k--) n++;
    for (k = x + 1; k < COLS && gr[y * COLS + k] === t; k++) n++;
    if (n >= 3) return true;
    n = 1;
    for (k = y - 1; k >= 0 && gr[k * COLS + x] === t; k--) n++;
    for (k = y + 1; k < ROWS && gr[k * COLS + x] === t; k++) n++;
    return n >= 3;
  }

  /* Every run of three or more, horizontal and vertical, as separate groups.
     An L or a T is two overlapping groups: both score, the union clears. */
  function findGroups(gr) {
    var out = [], x, y, run, k, c;
    for (y = 0; y < ROWS; y++) {
      run = 1;
      for (x = 1; x <= COLS; x++) {
        var same = x < COLS && gr[y * COLS + x] >= 0 && gr[y * COLS + x] === gr[y * COLS + x - 1];
        if (same) { run++; continue; }
        if (run >= 3) { c = []; for (k = x - run; k < x; k++) c.push(y * COLS + k); out.push(c); }
        run = 1;
      }
    }
    for (x = 0; x < COLS; x++) {
      run = 1;
      for (y = 1; y <= ROWS; y++) {
        var s2 = y < ROWS && gr[y * COLS + x] >= 0 && gr[y * COLS + x] === gr[(y - 1) * COLS + x];
        if (s2) { run++; continue; }
        if (run >= 3) { c = []; for (k = y - run; k < y; k++) c.push(k * COLS + x); out.push(c); }
        run = 1;
      }
    }
    return out;
  }

  function swapCells(gr, i, j) { var t = gr[i]; gr[i] = gr[j]; gr[j] = t; }

  /* The first swap that would line something up, or null. Doubles as the
     deadlock test and as a hint for the test hook. */
  function findMove(gr) {
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        var i = y * COLS + x, j;
        if (x + 1 < COLS) {
          j = i + 1;
          swapCells(gr, i, j);
          var ok = matchAt(gr, i) || matchAt(gr, j);
          swapCells(gr, i, j);
          if (ok) return [i, j];
        }
        if (y + 1 < ROWS) {
          j = i + COLS;
          swapCells(gr, i, j);
          var ok2 = matchAt(gr, i) || matchAt(gr, j);
          swapCells(gr, i, j);
          if (ok2) return [i, j];
        }
      }
    }
    return null;
  }

  /* Fill left-to-right, top-to-bottom, refusing any colour that would
     complete a run behind or above. With five kinds at most two are excluded,
     so the pool is never empty and this cannot loop. The result is a board
     with no pre-existing match BY CONSTRUCTION — it is not generated and then
     checked, which is the version that occasionally ships a board that opens
     mid-cascade. */
  function fillFresh() {
    var pool = [];
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        var i = y * COLS + x, a = -1, b = -1;
        if (x >= 2 && g[i - 1] === g[i - 2]) a = g[i - 1];
        if (y >= 2 && g[i - COLS] === g[i - 2 * COLS]) b = g[i - COLS];
        pool.length = 0;
        for (var t = 0; t < NT; t++) if (t !== a && t !== b) pool.push(t);
        g[i] = pool[rnd(pool.length)];
      }
    }
  }

  /* No match is guaranteed above; a legal move is not, so re-roll until there
     is one. On a 7x7 with five kinds a dead fresh board is rare, but "rare"
     over thousands of page loads is "someone will see it". */
  function newBoard() {
    for (var tries = 0; tries < 400; tries++) {
      fillFresh();
      if (findMove(g)) return;
    }
  }

  /* Re-deal the tiles already on the tray rather than inventing new ones, so
     a reshuffle cannot quietly change how many of each colour you have. */
  function reshuffled() {
    var bag = [], i;
    for (i = 0; i < N; i++) bag.push(g[i]);
    for (var tries = 0; tries < 200; tries++) {
      for (i = bag.length - 1; i > 0; i--) {
        var j = rnd(i + 1), t = bag[i]; bag[i] = bag[j]; bag[j] = t;
      }
      var cand = new Int8Array(N);
      for (i = 0; i < N; i++) cand[i] = bag[i];
      if (!findGroups(cand).length && findMove(cand)) return cand;
    }
    /* Same bag, no arrangement found: fall back to a fresh deal. */
    var save = new Int8Array(g);
    newBoard();
    var out = new Int8Array(g);
    g.set(save);
    return out;
  }

  function resetVis() {
    for (var i = 0; i < N; i++) { vx[i] = 0; vy[i] = 0; vs[i] = 1; va[i] = 1; }
  }

  /* ── layout ──────────────────────────────────────────────────────── */

  var W = 0, H = 0, cell = 40, DPR = 1;

  /* Board size comes from the SHELL and the VIEWPORT, never from the field.
     The field is a grid track that sizes to its content, so measuring it and
     then setting the canvas it contains is a feedback loop that converges on
     the minimum tile size — the bug that shipped two 120px boards on this
     site. The shell is the grid container: its width comes from the page and
     can never come back from the canvas, so it is safe to read. */
  function boardSide() {
    var vw = window.innerWidth || 360, vh = window.innerHeight || 640;
    var shellW = (el.shell && el.shell.clientWidth) || vw;

    /* Is the shell laid out with the two side panels? Asked of matchMedia
       with the exact breakpoint tray.css uses, NOT by measuring a gutter: a
       gutter is a `1fr` track, so its width depends on the field, and reading
       it here would put the board's size back on a loop through its own
       container. A media query only knows about the viewport.

       This is the bug the first version of this file shipped: the portrait
       branch handed the board the whole shell width, which is right on a
       phone and wrong on a 768px-wide desktop window, where the grid still
       reserves 2x240px of gutter. The board was 175px wider than the track
       and the right-hand columns were sliced off by the shell's
       `overflow: hidden` — invisibly, because the page itself never
       scrolled sideways. */
    var threeCol = el.shell && el.shell.classList.contains('cg-desktop') &&
      window.matchMedia('(min-width: 1001px)').matches;

    /* 480 is the two gutters at their minmax() floor; the extra 22 leaves
       room for the canvas's own 3px ink border and the field padding. */
    var maxW = threeCol ? shellW - 502 : shellW - 22;
    var maxH = vh * (vh >= vw ? 0.62 : 0.78);
    return Math.max(200, Math.min(maxW, maxH, 620));
  }

  function layout() {
    var side = boardSide();
    cell = Math.max(28, Math.floor(side / COLS));
    W = cell * COLS; H = cell * ROWS;

    /* Assert the result actually fits, rather than trusting the arithmetic.
       If the shell is narrower than the sum says it should be, shrink the
       tile until it is not — a clipped tray is unplayable, a small one is
       merely disappointing. */
    var shellW = (el.shell && el.shell.clientWidth) || W;
    while (W + 8 > shellW && cell > 28) { cell--; W = cell * COLS; H = cell * ROWS; }

    DPR = Math.min(window.devicePixelRatio || 1, 2);
    el.canvas.width = Math.round(W * DPR);
    el.canvas.height = Math.round(H * DPR);
    el.canvas.style.width = W + 'px';
    el.canvas.style.height = H + 'px';
    el.ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    /* game.css pins the toast 8% down the FIELD, which is the same thing as
       8% down the board in the other games because their field track hugs the
       canvas. Here the field is a flexible track that fills the immersive
       shell, so 8% of it left the toast floating in dead space a long way
       above the tray. Re-anchor it off the board's own height — the one
       number that is already known here. */
    if (el.toast) el.toast.style.top = 'calc(50% - ' + Math.round(H * 0.44) + 'px)';

    draw();
  }

  var layoutT = 0;
  function scheduleLayout(ms) { clearTimeout(layoutT); layoutT = setTimeout(layout, ms || 60); }

  /* ── sound ───────────────────────────────────────────────────────── */

  function beep(freq, ms, type) {
    if (!soundOn) return;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator(), gn = actx.createGain();
      o.type = type || 'square';
      o.frequency.value = freq;
      gn.gain.value = 0.04;
      o.connect(gn); gn.connect(actx.destination);
      o.start();
      gn.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + ms / 1000);
      o.stop(actx.currentTime + ms / 1000);
    } catch (e) { }
  }

  function setSound(v) {
    soundOn = v;
    el.sound.classList.toggle('is-muted', !v);
    el.sound.setAttribute('aria-pressed', v ? 'true' : 'false');
    el.sound.setAttribute('aria-label', v ? 'Sound on' : 'Sound off');
  }

  /* ── best score ──────────────────────────────────────────────────── */

  function readBest() {
    try { best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { best = 0; }
  }
  function writeBest() {
    if (score <= best) return;
    best = score;
    try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { }
  }

  /* ── phases ──────────────────────────────────────────────────────── */

  function setPhase(name, ms, data) {
    ph = name; phDur = ms; phData = data || null; phT0 = performance.now();
    if (ms <= 0) { applyPhase(1); advance(); }
  }

  function ease(t) { return 1 - Math.pow(1 - t, 3); }

  function applyPhase(t) {
    var d = phData, i, k;
    if (ph === 'swap' || ph === 'back') {
      var e = ease(t);
      vx[d.a] = d.ax * (1 - e); vy[d.a] = d.ay * (1 - e);
      vx[d.b] = d.bx * (1 - e); vy[d.b] = d.by * (1 - e);
    } else if (ph === 'clear') {
      for (k = 0; k < d.cells.length; k++) { i = d.cells[k]; vs[i] = 1 - t; va[i] = 1 - t; }
    } else if (ph === 'fall') {
      var e2 = ease(t);
      for (k = 0; k < d.from.length; k++) {
        i = d.from[k][0];
        vy[i] = d.from[k][1] * (1 - e2);
      }
    } else if (ph === 'shrink') {
      for (i = 0; i < N; i++) { vs[i] = 1 - t * 0.9; va[i] = 1 - t * 0.8; }
    } else if (ph === 'grow') {
      for (i = 0; i < N; i++) { vs[i] = 0.1 + t * 0.9; va[i] = 0.2 + t * 0.8; }
    }
  }

  function advance() {
    var was = ph;
    ph = 'idle';
    if (was === 'swap') {
      var groups = findGroups(g);
      if (!groups.length) {
        /* Nothing lined up. Slide it back and charge nothing: a match-three
           that spends a move on a guess is a match-three nobody experiments
           with. */
        var d = phData;
        swapCells(g, d.a, d.b);
        beep(150, 130, 'sawtooth');
        say('Nothing lined up.');
        startSwapAnim('back', d.a, d.b);
        return;
      }
      moves--;
      chain = 0;
      paintHud();
      beginClear(groups);
      return;
    }
    if (was === 'back') { resetVis(); return; }
    if (was === 'clear') {
      var cl = phData.cells;
      for (var k = 0; k < cl.length; k++) { g[cl[k]] = -1; vs[cl[k]] = 1; va[cl[k]] = 1; }
      beginFall();
      return;
    }
    if (was === 'fall') {
      resetVis();
      var next = findGroups(g);
      if (next.length) { beginClear(next); return; }
      settle();
      return;
    }
    if (was === 'shrink') {
      g.set(phData.next);
      setPhase('grow', dur('grow'), null);
      return;
    }
    if (was === 'grow') { resetVis(); settle(); return; }
  }

  function startSwapAnim(name, a, b) {
    var ax = a % COLS, ay = (a / COLS) | 0, bx = b % COLS, by = (b / COLS) | 0;
    resetVis();
    setPhase(name, dur(name === 'swap' ? 'swap' : 'back'), {
      a: a, b: b,
      ax: bx - ax, ay: by - ay,   /* the tile now at a came from b */
      bx: ax - bx, by: ay - by
    });
  }

  function beginClear(groups) {
    chain++;
    if (chain > bestChain) bestChain = chain;

    var seen = {}, cells = [], gained = 0, k, m, freed = 0;
    for (k = 0; k < groups.length; k++) {
      var len = groups[k].length;
      /* 30 a tile, and 45 more for every tile past the third, so a four is
         worth more than 4/3 of a three and a five is worth chasing. */
      gained += len * 30 + Math.max(0, len - 3) * 45;
      if (len >= 5) freed++;
      for (m = 0; m < len; m++) {
        var i = groups[k][m];
        if (!seen[i]) { seen[i] = 1; cells.push(i); }
      }
    }
    var mult = Math.min(4, 1 + 0.5 * (chain - 1));
    gained = Math.round(gained * mult);
    score += gained;
    lines += groups.length;
    moves += freed;

    if (chain >= 2) toast('CHAIN ×' + (mult % 1 ? mult.toFixed(1) : mult));
    else if (freed) toast('FIVE — MOVE BACK');
    say(gained + ' calories' + (chain >= 2 ? ', chain ' + chain : '') + '.');
    beep(420 + Math.min(6, chain) * 90, 80);
    paintHud();

    setPhase('clear', dur('clear'), { cells: cells });
  }

  function beginFall() {
    var from = [], x, y, i;
    for (x = 0; x < COLS; x++) {
      var write = ROWS - 1;
      for (y = ROWS - 1; y >= 0; y--) {
        i = y * COLS + x;
        if (g[i] < 0) continue;
        var dst = write * COLS + x;
        if (dst !== i) { g[dst] = g[i]; g[i] = -1; }
        if (write !== y) from.push([dst, y - write]);
        write--;
      }
      /* Everything from `write` up is new and falls in from above the tray. */
      for (y = write; y >= 0; y--) {
        i = y * COLS + x;
        g[i] = randType();
        from.push([i, (y - (write + 1)) - y]);
      }
    }
    resetVis();
    var drop = 1;
    for (var k = 0; k < from.length; k++) drop = Math.max(drop, Math.abs(from[k][1]));
    for (k = 0; k < from.length; k++) vy[from[k][0]] = from[k][1];
    setPhase('fall', dur('fall') * Math.min(1.6, 0.6 + drop * 0.14), { from: from });
  }

  /* Everything has stopped moving. Decide what happens next, in this order:
     the round can be over even on a dead board, and reshuffling a board
     nobody will get to play is just a confusing animation. */
  function settle() {
    resetVis();
    chain = 0;
    paintHud();
    if (state !== 'play') { draw(); return; }
    if (moves <= 0) { endRun(); return; }
    if (!findMove(g)) {
      toast('NO MOVES — RESHUFFLE');
      say('No moves left. Reshuffling the tray.');
      beep(240, 220, 'triangle');
      setPhase('shrink', dur('shrink'), { next: reshuffled() });
      return;
    }
    draw();
  }

  /* ── run ─────────────────────────────────────────────────────────── */

  function startRun() {
    score = 0; moves = MOVES; chain = 0; bestChain = 0; lines = 0;
    bestAtStart = best;             /* snapshot BEFORE the run can write it */
    sel = -1; cur = -1; keyMode = false;
    queue = null;
    ph = 'idle'; phData = null;
    newBoard();
    resetVis();
    state = 'play';
    hideOverlay();
    document.body.classList.add('cuna-playing');
    paintHud();
    scheduleLayout(0);
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function endRun() {
    state = 'over';
    ph = 'idle';
    sel = -1; cur = -1;
    document.body.classList.remove('cuna-playing');
    var isBest = score > bestAtStart;
    writeBest();
    paintHud();
    beep(180, 320, 'sawtooth');
    showOverlay(
      '<div class="cg-card">' +
      '<p class="cg-big">' + (isBest ? 'NEW PERSONAL BEST' : 'TRAY’S EMPTY') + '</p>' +
      '<p class="cg-sub">' + score.toLocaleString('en-US') + ' calories · ' +
      lines + ' ' + (lines === 1 ? 'line' : 'lines') + ' · longest chain ×' + bestChain + '</p>' +
      '<div class="cg-btns">' +
      '<button class="btn btn-buy btn-sm" type="button" data-act="again">GO AGAIN</button>' +
      '<button class="btn btn-ghost btn-sm" type="button" data-act="exit">BACK TO THE SITE</button>' +
      '</div></div>', false);
    scheduleLayout(0);
  }

  /* ── overlay ─────────────────────────────────────────────────────── */

  function showOverlay(html, pass) {
    el.overlay.innerHTML = html;
    el.overlay.classList.toggle('cg-pass', pass !== false);
    el.overlay.hidden = false;
  }
  function hideOverlay() {
    el.overlay.hidden = true;
    el.overlay.innerHTML = '';
    el.overlay.classList.remove('cg-pass');
  }
  function attractCard() {
    var touch = window.matchMedia('(hover:none) and (pointer:coarse)').matches;
    showOverlay(
      '<div class="cg-card cg-attract">' +
      '<p class="cg-big">TACO TRAY</p>' +
      '<p class="cg-pill">' + (touch ? 'TAP TO START' : 'CLICK TO START') + '</p>' +
      '<p class="cg-sub">three in a row, please</p>' +
      '<p class="cg-tray-rules">Twenty moves. Swap two neighbours. A swap that lines nothing up slides back and costs you nothing.</p>' +
      '</div>');
  }

  var toastT = 0;
  function toast(txt) {
    el.toast.textContent = txt;
    el.toast.classList.add('is-on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.toast.classList.remove('is-on'); }, 1000);
  }
  function say(txt) { if (el.live) el.live.textContent = txt; }

  /* ── input ───────────────────────────────────────────────────────── */

  var sel = -1;          /* picked-up tile, or -1 */
  var cur = -1;          /* keyboard picker */
  var keyMode = false;
  var drag = null;

  function adjacent(a, b) {
    if (a < 0 || b < 0 || a === b) return false;
    var ax = a % COLS, ay = (a / COLS) | 0, bx = b % COLS, by = (b / COLS) | 0;
    return Math.abs(ax - bx) + Math.abs(ay - by) === 1;
  }

  function cellFromPoint(clientX, clientY) {
    var r = el.canvas.getBoundingClientRect();
    var cx = clientX - r.left, cy = clientY - r.top;
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return -1;
    var x = Math.min(COLS - 1, (cx / cell) | 0);
    var y = Math.min(ROWS - 1, (cy / cell) | 0);
    return y * COLS + x;
  }

  function tryMove(a, b) {
    if (state !== 'play' || ph !== 'idle') return false;
    if (!adjacent(a, b)) return false;
    sel = -1;
    swapCells(g, a, b);
    startSwapAnim('swap', a, b);
    return true;
  }

  function pick(i) {
    if (i < 0) return;
    if (sel < 0) { sel = i; beep(560, 40); return; }
    if (sel === i) { sel = -1; return; }
    if (adjacent(sel, i)) { tryMove(sel, i); return; }
    sel = i; beep(560, 40);
  }

  function onDown(e) {
    /* The same touch that presses a button on the overlay would otherwise
       start the game underneath it. */
    if (e.target && e.target.closest && e.target.closest('[data-act]')) return;
    if (state !== 'play') {
      try { el.shell.focus({ preventScroll: true }); } catch (err) { }
      startRun();
      return;
    }
    if (drag) return;                       /* a second finger changes nothing */
    var i = cellFromPoint(e.clientX, e.clientY);
    if (i < 0) return;
    if (e.cancelable) e.preventDefault();
    keyMode = false;
    /* Selection happens on the LIFT, not here: pressing has to stay
       ambiguous between "I am picking this tile" and "I am about to drag it
       into its neighbour", and committing on press makes a drag look like two
       taps. */
    drag = { i: i, x: e.clientX, y: e.clientY, id: e.pointerId, done: false };
  }

  function onMove(e) {
    if (!drag || drag.done || drag.id !== e.pointerId || ph !== 'idle') return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    var thr = Math.max(10, cell * 0.38);
    if (Math.abs(dx) < thr && Math.abs(dy) < thr) return;
    var x = drag.i % COLS, y = (drag.i / COLS) | 0, tx = x, ty = y;
    if (Math.abs(dx) >= Math.abs(dy)) tx += dx > 0 ? 1 : -1;
    else ty += dy > 0 ? 1 : -1;
    drag.done = true;
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) { sel = -1; return; }
    tryMove(drag.i, ty * COLS + tx);
  }

  function onUp(e) {
    if (!drag || drag.id !== e.pointerId) return;
    var d = drag;
    drag = null;
    if (d.done) return;
    /* A tap, not a drag: the usual pick-then-pick-the-neighbour. */
    var i = cellFromPoint(e.clientX, e.clientY);
    if (i < 0) { sel = -1; return; }
    pick(i);
  }

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var r = el.shell.getBoundingClientRect();
    var onScreen = el.shell.contains(document.activeElement) ||
      document.body.classList.contains('cuna-playing') ||
      (r.bottom > 0 && r.top < (window.innerHeight || 0));
    if (!onScreen) return;
    var k = e.key;

    if (k === 'm' || k === 'M') { setSound(!soundOn); return; }
    if (k === 'Escape') { location.href = 'index.html'; return; }

    if (state !== 'play') {
      if (k === ' ' || k === 'Spacebar' || k === 'Enter') {
        if (e.cancelable) e.preventDefault();
        startRun();
      }
      return;
    }

    var d = null;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') d = [-1, 0];
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') d = [1, 0];
    else if (k === 'ArrowUp' || k === 'w' || k === 'W') d = [0, -1];
    else if (k === 'ArrowDown' || k === 's' || k === 'S') d = [0, 1];

    if (d) {
      if (e.cancelable) e.preventDefault();
      keyMode = true;
      if (cur < 0) { cur = ((ROWS / 2) | 0) * COLS + ((COLS / 2) | 0); return; }
      var x = cur % COLS, y = (cur / COLS) | 0;
      var nx = Math.max(0, Math.min(COLS - 1, x + d[0]));
      var ny = Math.max(0, Math.min(ROWS - 1, y + d[1]));
      var t = ny * COLS + nx;
      if (t === cur) return;
      /* Holding a tile and pushing into a neighbour IS the swap — it saves a
         keystroke and matches what the drag does with a thumb. */
      if (sel >= 0 && sel === cur) { cur = t; tryMove(sel, t); return; }
      cur = t;
      return;
    }

    if (k === ' ' || k === 'Spacebar' || k === 'Enter') {
      if (e.cancelable) e.preventDefault();
      keyMode = true;
      if (cur < 0) cur = ((ROWS / 2) | 0) * COLS + ((COLS / 2) | 0);
      pick(cur);
    }
  }

  /* ── loop ────────────────────────────────────────────────────────── */

  function loop(now) {
    raf = 0;
    if (state !== 'play') { draw(); return; }
    raf = requestAnimationFrame(loop);
    if (ph !== 'idle') {
      var t = phDur <= 0 ? 1 : Math.min(1, (now - phT0) / phDur);
      applyPhase(t);
      draw();
      if (t >= 1) advance();
      return;
    }
    draw();
  }

  /* ── drawing ─────────────────────────────────────────────────────── */

  function cssVar(n, fb) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      return v || fb;
    } catch (e) { return fb; }
  }
  var COL = {};
  function readColours() {
    COL.ink = cssVar('--ink', '#24040f');
    COL.pink = cssVar('--pink', '#ff2e88');
    COL.plum2 = cssVar('--plum-2', '#520f33');
    COL.cream = cssVar('--cream', '#ffeccb');
  }

  function rrect(gx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    gx.beginPath();
    gx.moveTo(x + r, y);
    gx.arcTo(x + w, y, x + w, y + h, r);
    gx.arcTo(x + w, y + h, x, y + h, r);
    gx.arcTo(x, y + h, x, y, r);
    gx.arcTo(x, y, x + w, y, r);
    gx.closePath();
  }

  function draw() {
    if (!el.ctx) return;
    var gx = el.ctx;
    gx.clearRect(0, 0, W, H);

    /* the tray itself */
    gx.fillStyle = COL.plum2;
    gx.fillRect(0, 0, W, H);
    gx.fillStyle = 'rgba(255,255,255,.035)';
    for (var y0 = 0; y0 < ROWS; y0++) {
      for (var x0 = 0; x0 < COLS; x0++) {
        if ((x0 + y0) % 2) gx.fillRect(x0 * cell, y0 * cell, cell, cell);
      }
    }

    /* Tiles falling in start above the top edge, so everything is clipped to
       the tray or they are drawn floating over the HUD. */
    gx.save();
    gx.beginPath();
    gx.rect(0, 0, W, H);
    gx.clip();

    var pulse = MOTION ? 1 + Math.sin(performance.now() / 190) * 0.04 : 1.03;
    var inset = Math.max(2, cell * 0.055);
    var side = cell - inset * 2;

    for (var i = 0; i < N; i++) {
      var t = g[i];
      if (t < 0 || va[i] <= 0.01) continue;
      var cx = (i % COLS) * cell + cell / 2 + vx[i] * cell;
      var cy = ((i / COLS) | 0) * cell + cell / 2 + vy[i] * cell;
      var sc = vs[i] * (i === sel ? pulse : 1);
      var s = side * sc;

      gx.save();
      gx.globalAlpha = va[i];
      rrect(gx, cx - s / 2, cy - s / 2, s, s, Math.max(3, cell * 0.18));
      gx.fillStyle = i === sel ? PLATE_LIT[t] : PLATE[t];
      gx.fill();
      gx.lineWidth = Math.max(1.5, cell * 0.05);
      gx.strokeStyle = COL.ink;
      gx.stroke();

      /* a soft top light so the plate reads as an object, not a swatch */
      gx.save();
      gx.clip();
      gx.fillStyle = 'rgba(255,255,255,.09)';
      gx.fillRect(cx - s / 2, cy - s / 2, s, s * 0.42);
      gx.restore();

      var sz = s * 0.78;
      if (SPR.ready) {
        var m = SPR.map[TYPES[t]], c = SPR.cell;
        gx.drawImage(SPR.img, m[0] * c, m[1] * c, c, c, cx - sz / 2, cy - sz / 2, sz, sz);
      } else {
        gx.fillStyle = PLATE_LIT[t];
        gx.beginPath();
        gx.arc(cx, cy, sz * 0.3, 0, 6.283);
        gx.fill();
      }
      gx.restore();
    }

    /* the picked-up tile and the keyboard picker */
    if (sel >= 0) outline(gx, sel, COL.cream, false);
    if (keyMode && cur >= 0 && cur !== sel) outline(gx, cur, COL.pink, true);

    gx.restore();
  }

  function outline(gx, i, colour, dashed) {
    var x = (i % COLS) * cell, y = ((i / COLS) | 0) * cell;
    var pad = Math.max(2, cell * 0.045);
    gx.save();
    gx.lineWidth = Math.max(2.5, cell * 0.075);
    gx.strokeStyle = colour;
    if (dashed) gx.setLineDash([Math.max(4, cell * 0.16), Math.max(3, cell * 0.11)]);
    rrect(gx, x + pad, y + pad, cell - pad * 2, cell - pad * 2, Math.max(4, cell * 0.2));
    gx.stroke();
    gx.restore();
  }

  /* ── hud ─────────────────────────────────────────────────────────── */

  function paintHud() {
    el.score.textContent = score.toLocaleString('en-US');
    el.best.textContent = best.toLocaleString('en-US');
    if (el.chain) el.chain.textContent = String(bestChain);
    if (el.moves) el.moves.textContent = String(Math.max(0, moves));
    if (el.pScore) el.pScore.textContent = score.toLocaleString('en-US');
    if (el.pBest) el.pBest.textContent = best.toLocaleString('en-US');
    if (el.pMoves) el.pMoves.textContent = String(Math.max(0, moves));
    if (el.pChain) el.pChain.textContent = String(bestChain);
  }

  /* ── test hook ───────────────────────────────────────────────────── */

  function gridNames() {
    var out = [];
    for (var y = 0; y < ROWS; y++) {
      var row = [];
      for (var x = 0; x < COLS; x++) {
        var t = g[y * COLS + x];
        row.push(t < 0 ? null : TYPES[t]);
      }
      out.push(row);
    }
    return out;
  }

  function installHook() {
    el.shell.__cuna = {
      s: function () {
        var m = findMove(g);
        return {
          state: state, phase: ph, score: score, moves: moves,
          chain: chain, bestChain: bestChain, lines: lines, best: best,
          cols: COLS, rows: ROWS, tile: cell, board: W, sel: sel, cur: cur,
          grid: gridNames(),
          matches: findGroups(g).length,
          move: m ? { ax: m[0] % COLS, ay: (m[0] / COLS) | 0, bx: m[1] % COLS, by: (m[1] / COLS) | 0 } : null
        };
      },
      /* Force a board. Purely mechanical: no matching, no scoring, no
         animation is kicked off by this, so a test can set a known grid and
         then drive one specific swap. */
      setGrid: function (rows) {
        for (var y = 0; y < ROWS; y++) {
          for (var x = 0; x < COLS; x++) {
            var n = rows[y] && rows[y][x];
            var t = TYPES.indexOf(String(n));
            if (t >= 0) g[y * COLS + x] = t;
          }
        }
        resetVis();
        draw();
        return gridNames();
      },
      /* Refills come off this queue, oldest first, until it runs dry. Lets a
         cascade test know exactly what drops in. */
      setQueue: function (names) { queue = names ? names.slice() : null; },
      setMoves: function (n) { moves = n; paintHud(); },
      /* Runs the end-of-cascade check by hand, so a test can plant a board
         with no legal move and watch it reshuffle without having to engineer
         a cascade that happens to deadlock. */
      settle: function () { settle(); },
      swap: function (ax, ay, bx, by) { return tryMove(ay * COLS + ax, by * COLS + bx); },
      hasMove: function () { return !!findMove(g); },
      newBoard: function () { newBoard(); resetVis(); draw(); return gridNames(); },
      start: function () { startRun(); },
      end: function () { endRun(); }
    };
  }

  /* ── boot ────────────────────────────────────────────────────────── */

  function init() {
    el.shell = $('cuna-game');
    if (!el.shell) return;
    el.canvas = $('cg-canvas');
    el.ctx = el.canvas.getContext('2d');
    el.field = $('cg-field');
    el.overlay = $('cg-overlay');
    el.toast = $('cg-toast');
    el.live = $('cg-live');
    el.score = $('cg-score');
    el.best = $('cg-best');
    el.chain = $('cg-chain');
    el.moves = $('cg-moves');
    el.pScore = $('cg-p-score');
    el.pBest = $('cg-p-best');
    el.pMoves = $('cg-p-moves');
    el.pChain = $('cg-p-chain');
    el.sound = $('cg-sound');

    var touch = window.matchMedia('(hover:none) and (pointer:coarse)').matches;
    el.shell.classList.add(touch ? 'cg-touch' : 'cg-desktop');

    try {
      MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1;
    } catch (e) { MOTION = 1; }

    readColours();
    readBest();
    newBoard();
    resetVis();
    loadSprites();
    layout();
    attractCard();
    paintHud();
    setSound(false);
    installHook();

    el.field.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', function () { drag = null; });
    document.addEventListener('keydown', onKey);
    el.sound.addEventListener('click', function (e) { e.stopPropagation(); setSound(!soundOn); });

    el.overlay.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!b) return;
      var a = b.getAttribute('data-act');
      if (a === 'again') startRun();
      else if (a === 'exit') location.href = 'index.html';
    });

    /* The first measurement runs before the webfonts and the grid have
       settled, so watch the field and re-lay out when it moves. Note it is
       only ever an OBSERVER here — the board's size still comes from the
       shell, never from what this reports. */
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () { scheduleLayout(0); });
      ro.observe(el.field);
    } else {
      setTimeout(layout, 250);
      setTimeout(layout, 900);
    }
    window.addEventListener('load', function () { scheduleLayout(0); });
    window.addEventListener('resize', function () { scheduleLayout(80); });
    window.addEventListener('orientationchange', function () { scheduleLayout(220); });

    /* Sprites land after the first paint. */
    var st = setInterval(function () { if (SPR.ready) { clearInterval(st); draw(); } }, 120);
    setTimeout(function () { clearInterval(st); }, 6000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
