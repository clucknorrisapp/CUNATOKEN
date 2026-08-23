/* TONGUE TWISTER — snake, with a tongue that has an obvious reason to grow.
 *
 * Shares the sprite atlas, shell CSS and input layer with TONGUE RUSH. The
 * only thing this file owns is the rules.
 */
(function () {
  'use strict';

  /* 15 squares, not 17. On a phone the board is width-bound at roughly 300px,
     so 17 columns put the tongue at 11px wide — thin enough that the art stops
     reading as anything. */
  var COLS = 15, ROWS = 15;
  var BEST_KEY = 'cuna_twister_best';

  /* Step interval in ms. Snake speed is the whole difficulty curve, so it
     ramps with length rather than with a level counter. */
  var STEP_START = 165, STEP_MIN = 68;
  var JEET_AT = 8;        /* length at which a chaser shows up */
  var POWER_EVERY = 6;    /* every Nth taco is a power taco */
  var FRIGHT_MS = 6000;

  var $ = function (id) { return document.getElementById(id); };

  var el = {};
  var C = null;
  var TILE = 16, DPR = 1;
  var snake = [], dir = 3, queued = [], grow = 0;
  var food = null, power = false, eaten = 0;
  var jeet = null, frightUntil = 0;
  var score = 0, best = 0, bestAtStart = 0;
  var state = 'attract', paused = false;
  var acc = 0, last = 0, raf = 0;
  var soundOn = false, actx = null;

  /* ── sprites ─────────────────────────────────────────────────────── */

  var SPR = {
    img: null, ready: false, cell: 144,
    map: {
      open: [0, 0], closed: [1, 0], power: [2, 0], pellet: [3, 0],
      jeet: [4, 0], fright: [3, 1]
    }
  };

  function loadSprites() {
    var im = new Image();
    im.decoding = 'async';
    im.onload = function () { SPR.img = im; SPR.ready = true; };
    im.onerror = function () { SPR.ready = false; };
    im.src = 'assets/sprites.webp';
  }

  function drawSpr(name, cx, cy, size) {
    if (!SPR.ready) return false;
    var m = SPR.map[name];
    if (!m) return false;
    var c = SPR.cell;
    el.ctx.drawImage(SPR.img, m[0] * c, m[1] * c, c, c,
      cx - size / 2, cy - size / 2, size, size);
    return true;
  }

  /* ── layout ──────────────────────────────────────────────────────── */

  /* Board size comes from the VIEWPORT, never from the field.
     The field is a grid track whose size follows its content, so measuring it
     and then setting the canvas it contains is a feedback loop: every layout
     pass read a slightly smaller box and wrote a slightly smaller board, and
     it converged on the minimum tile size. Both boards were 120px squares on
     half the devices tested before this was caught. */
  function boardSide() {
    var vw = window.innerWidth || 360, vh = window.innerHeight || 640;
    var portrait = vh >= vw;
    /* Width is bounded by the SHELL, not the field. The shell is the grid
       container — its width comes from the page and never from the canvas — so
       it is safe to measure, where the field track sizes to its own content
       and feeds back. Without this the board was 34px wider than the box that
       clips it and the outer holes were sliced off on a phone. */
    var shellW = (el.shell && el.shell.clientWidth) || vw;
    var maxW = portrait ? shellW - 22 : shellW * 0.46;
    var maxH = portrait ? vh * 0.52 : vh * 0.74;
    return Math.max(160, Math.min(maxW, maxH, 620));
  }

  function layout() {
    TILE = Math.max(12, Math.floor(boardSide() / COLS));
    var w = TILE * COLS, h = TILE * ROWS;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    el.canvas.width = Math.round(w * DPR);
    el.canvas.height = Math.round(h * DPR);
    el.canvas.style.width = w + 'px';
    el.canvas.style.height = h + 'px';
    el.ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (C) C.layout();
    draw();
  }

  var layoutT = 0;
  function scheduleLayout(ms) {
    clearTimeout(layoutT);
    layoutT = setTimeout(layout, ms || 60);
  }

  /* ── sound ───────────────────────────────────────────────────────── */

  function beep(freq, ms, type) {
    if (!soundOn) return;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'square';
      o.frequency.value = freq;
      g.gain.value = 0.04;
      o.connect(g); g.connect(actx.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + ms / 1000);
      o.stop(actx.currentTime + ms / 1000);
    } catch (e) { }
  }

  function setSound(v) {
    soundOn = v;
    el.sound.classList.toggle('is-muted', !v);
    el.sound.setAttribute('aria-pressed', v ? 'true' : 'false');
    el.sound.setAttribute('aria-label', v ? 'Sound on' : 'Sound off');
  }

  /* ── state ───────────────────────────────────────────────────────── */

  function readBest() {
    try { best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { best = 0; }
  }
  function writeBest() {
    if (score <= best) return;
    best = score;
    try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { }
  }

  function freeCell() {
    /* Rejection sampling is fine here: the board only gets crowded at lengths
       no one reaches, and the alternative (building the free list every time)
       costs more on every single taco. */
    for (var i = 0; i < 400; i++) {
      var x = (Math.random() * COLS) | 0, y = (Math.random() * ROWS) | 0;
      if (!occupied(x, y)) return { x: x, y: y };
    }
    /* Board genuinely full — scan for the first gap so we never return null. */
    for (var yy = 0; yy < ROWS; yy++) {
      for (var xx = 0; xx < COLS; xx++) if (!occupied(xx, yy)) return { x: xx, y: yy };
    }
    return null;
  }

  function occupied(x, y) {
    for (var i = 0; i < snake.length; i++) {
      if (snake[i].x === x && snake[i].y === y) return true;
    }
    if (jeet && jeet.x === x && jeet.y === y) return true;
    return false;
  }

  function placeFood() {
    var c = freeCell();
    if (!c) return;
    eaten++;
    power = (eaten % POWER_EVERY) === 0;
    food = c;
  }

  function reset() {
    snake = [];
    var cy = ROWS >> 1;
    /* Start near the left wall heading right, not in the middle. From the
       middle a beginner gets eight tiles — about a second and a third — before
       the far wall, which reads as the game killing you before you have
       touched anything. */
    for (var i = 0; i < 4; i++) snake.push({ x: 3 - i, y: cy });
    dir = 3; queued = []; grow = 0;
    score = 0; eaten = 0; power = false;
    jeet = null; frightUntil = 0;
    acc = 0;
    /* Put the first one straight ahead so the very first thing that happens is
       a taco rather than a wall. */
    food = { x: Math.min(COLS - 2, 9), y: cy };
    paintHud();
  }

  function startRun() {
    reset();
    bestAtStart = best;
    state = 'play';
    paused = false;
    hideOverlay();
    document.body.classList.add('cuna-playing');
    last = performance.now();
    tickLoop(last);
  }

  function gameOver() {
    state = 'over';
    document.body.classList.remove('cuna-playing');
    var isBest = score > bestAtStart;
    writeBest();
    paintHud();
    beep(140, 260, 'sawtooth');
    showOverlay(
      '<div class="cg-card">' +
      '<p class="cg-big">' + (isBest ? 'NEW PERSONAL BEST' : 'TIED IN A KNOT') + '</p>' +
      '<p class="cg-sub">' + score.toLocaleString('en-US') + ' calories · length ' + snake.length + '</p>' +
      '<div class="cg-btns">' +
      '<button class="btn btn-buy btn-sm" type="button" data-act="again">GO AGAIN</button>' +
      '<button class="btn btn-ghost btn-sm" type="button" data-act="exit">BACK TO THE SITE</button>' +
      '</div></div>', false);
  }

  function setPaused(v) {
    if (state !== 'play') return;
    paused = v;
    if (v) {
      showOverlay(
        '<div class="cg-card">' +
        '<p class="cg-big">PAUSED</p>' +
        '<p class="cg-sub">The tongue is catching its breath.</p>' +
        '<div class="cg-btns">' +
        '<button class="btn btn-buy btn-sm" type="button" data-act="resume">RESUME</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-act="sound">' +
        (soundOn ? 'SOUND OFF' : 'SOUND ON') + '</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-act="exit">BACK TO THE SITE</button>' +
        '</div></div>', false);
    } else {
      hideOverlay();
      last = performance.now();
      tickLoop(last);
    }
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
    showOverlay(
      '<div class="cg-card cg-attract">' +
      '<p class="cg-big">TONGUE TWISTER</p>' +
      '<p class="cg-pill">' + (C && C.isTouch() ? 'TAP TO EAT' : 'PRESS ANY KEY') + '</p>' +
      '<p class="cg-sub">it only gets longer</p></div>' +
      (C ? C.optsHtml() : ''));
  }

  var toastT = 0;
  function toast(txt) {
    el.toast.textContent = txt;
    el.toast.classList.add('is-on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.toast.classList.remove('is-on'); }, 1400);
  }

  /* ── input ───────────────────────────────────────────────────────── */

  /* Queue rather than assign. Two turns inside one step used to be swallowed
     — you would press up-then-left before the snake had moved and only the
     left survived, which reads as a dropped input at exactly the moment it
     matters most. */
  function onDir(d) {
    if (queued.length < 2) queued.push(d);
  }

  function nextDir() {
    while (queued.length) {
      var d = queued.shift();
      /* A reversal into your own neck is not a turn, it is instant death by
         typo. Classic snake refuses it; the input layer allows same-axis
         reversal because every other game needs it. */
      if (snake.length > 1 && d === ((dir + 2) % 4)) continue;
      return d;
    }
    return dir;
  }

  function onEngage() {
    try { el.shell.focus({ preventScroll: true }); } catch (e) { try { el.shell.focus(); } catch (e2) { } }
    if (state === 'attract') startRun();
    else if (state === 'over') startRun();
    else if (paused) setPaused(false);
  }

  function onKey(k) {
    if (k === ' ' || k === 'Spacebar' || k === 'Enter') {
      if (state === 'attract' || state === 'over') startRun();
      else if (paused) setPaused(false);
      return true;
    }
    if (k === 'p' || k === 'P') { setPaused(!paused); return true; }
    if (k === 'm' || k === 'M') { setSound(!soundOn); return true; }
    if (k === 'Escape') {
      if (paused || state === 'over') location.href = 'index.html';
      else setPaused(true);
      return true;
    }
    return false;
  }

  /* ── the step ────────────────────────────────────────────────────── */

  function stepMs() {
    var t = Math.min(1, (snake.length - 4) / 40);
    return STEP_START + (STEP_MIN - STEP_START) * t;
  }

  function moveJeet() {
    if (!jeet) return;
    /* Deliberately dim: it walks toward you one axis at a time and never
       pathfinds. The body you are dragging around is the real hazard, and a
       clever chaser on top of that is just unfair. */
    var hx = snake[0].x, hy = snake[0].y;
    var dx = hx - jeet.x, dy = hy - jeet.y;
    var frightened = performance.now() < frightUntil;
    if (frightened) { dx = -dx; dy = -dy; }
    var nx = jeet.x, ny = jeet.y;
    if (Math.abs(dx) > Math.abs(dy)) nx += dx > 0 ? 1 : -1;
    else if (dy !== 0) ny += dy > 0 ? 1 : -1;
    else if (dx !== 0) nx += dx > 0 ? 1 : -1;
    jeet.x = Math.max(0, Math.min(COLS - 1, nx));
    jeet.y = Math.max(0, Math.min(ROWS - 1, ny));
  }

  var jeetPhase = 0;
  function step() {
    dir = nextDir();
    var h = snake[0];
    var nx = h.x + C.DX[dir], ny = h.y + C.DY[dir];

    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) { gameOver(); return; }

    /* The tail cell frees up on this same step unless we are growing, so
       chasing your own tail is legal — as it should be. */
    var ignoreTail = grow === 0;
    for (var i = 0; i < snake.length; i++) {
      if (ignoreTail && i === snake.length - 1) continue;
      if (snake[i].x === nx && snake[i].y === ny) { gameOver(); return; }
    }

    snake.unshift({ x: nx, y: ny });
    if (grow > 0) grow--; else snake.pop();

    if (food && nx === food.x && ny === food.y) {
      var wasPower = power;
      grow += wasPower ? 3 : 1;
      score += wasPower ? 120 : 25;
      if (wasPower) { frightUntil = performance.now() + FRIGHT_MS; toast('JEET IS SCARED'); }
      beep(wasPower ? 660 : 440, wasPower ? 130 : 60);
      placeFood();
      if (!jeet && snake.length >= JEET_AT) {
        var c = freeCell();
        if (c) { jeet = c; toast('JEET INCOMING'); }
      }
      paintHud();
    }

    /* Checked on both sides of the chaser's move. Only checking afterwards
       let the two swap cells — you step into his square while he steps into
       yours — and pass straight through each other without ever being in the
       same place at the same time. */
    if (touchedJeet()) return;

    /* The chaser moves at half the snake's rate, so speeding up does not also
       make it twice as deadly. */
    jeetPhase ^= 1;
    if (jeetPhase === 0) moveJeet();

    touchedJeet();
  }

  /* Returns true when the run ended. */
  function touchedJeet() {
    if (!jeet) return false;
    if (jeet.x !== snake[0].x || jeet.y !== snake[0].y) return false;
    if (performance.now() < frightUntil) {
      score += 200;
      beep(880, 120);
      toast('ATE HIM');
      jeet = freeCell();
      paintHud();
      return false;
    }
    gameOver();
    return true;
  }

  function tickLoop(now) {
    if (state !== 'play' || paused) return;
    raf = requestAnimationFrame(tickLoop);
    var dt = Math.min(now - last, 120);
    last = now;
    acc += dt;
    var ms = stepMs();
    while (acc >= ms) { acc -= ms; if (state !== 'play') break; step(); }
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
    COL.pink2 = cssVar('--pink-2', '#ff6fb0');
    COL.pink3 = cssVar('--pink-3', '#ffa8cf');
    COL.plum2 = cssVar('--plum-2', '#520f33');
    COL.plum3 = cssVar('--plum-3', '#7a1a4d');
    COL.cream = cssVar('--cream', '#fff3d6');
  }

  function draw() {
    if (!el.ctx) return;
    var w = COLS * TILE, h = ROWS * TILE;
    var g = el.ctx;
    g.clearRect(0, 0, w, h);

    /* board */
    g.fillStyle = COL.plum2;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.045)';
    g.lineWidth = 1;
    for (var i = 1; i < COLS; i++) {
      g.beginPath(); g.moveTo(i * TILE + .5, 0); g.lineTo(i * TILE + .5, h); g.stroke();
    }
    for (var j = 1; j < ROWS; j++) {
      g.beginPath(); g.moveTo(0, j * TILE + .5); g.lineTo(w, j * TILE + .5); g.stroke();
    }

    /* food */
    if (food) {
      var fx = food.x * TILE + TILE / 2, fy = food.y * TILE + TILE / 2;
      var fs = TILE * (power ? 1.15 : 0.92);
      if (!drawSpr(power ? 'power' : 'pellet', fx, fy, fs)) {
        g.fillStyle = power ? COL.cream : COL.pink3;
        g.beginPath(); g.arc(fx, fy, fs * 0.32, 0, 6.283); g.fill();
      }
    }

    /* the tongue: one rounded stroke through every segment, so it reads as a
       single continuous thing rather than a row of boxes */
    if (snake.length) {
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = COL.ink;
      g.lineWidth = TILE * 0.82;
      strokeBody(g);
      g.strokeStyle = COL.pink;
      g.lineWidth = TILE * 0.62;
      strokeBody(g);
      /* a lighter centre line reads as the wet middle of a tongue */
      g.strokeStyle = COL.pink3;
      g.lineWidth = TILE * 0.16;
      g.globalAlpha = .55;
      strokeBody(g);
      g.globalAlpha = 1;

      var hx = snake[0].x * TILE + TILE / 2, hy = snake[0].y * TILE + TILE / 2;
      var mouth = (performance.now() / 130 | 0) % 2 === 0 ? 'open' : 'closed';
      if (!drawSpr(mouth, hx, hy, TILE * 1.5)) {
        g.fillStyle = COL.pink2;
        g.beginPath(); g.arc(hx, hy, TILE * 0.46, 0, 6.283); g.fill();
      }
    }

    /* chaser */
    if (jeet) {
      var jx = jeet.x * TILE + TILE / 2, jy = jeet.y * TILE + TILE / 2;
      var scared = performance.now() < frightUntil;
      if (!drawSpr(scared ? 'fright' : 'jeet', jx, jy, TILE * 1.25)) {
        g.fillStyle = scared ? COL.cream : COL.pink;
        g.beginPath(); g.arc(jx, jy, TILE * 0.42, 0, 6.283); g.fill();
      }
    }
  }

  function strokeBody(g) {
    g.beginPath();
    for (var i = 0; i < snake.length; i++) {
      var x = snake[i].x * TILE + TILE / 2, y = snake[i].y * TILE + TILE / 2;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    if (snake.length === 1) {
      g.lineTo(snake[0].x * TILE + TILE / 2 + .01, snake[0].y * TILE + TILE / 2);
    }
    g.stroke();
  }

  /* ── hud ─────────────────────────────────────────────────────────── */

  function paintHud() {
    el.score.textContent = score.toLocaleString('en-US');
    el.best.textContent = best.toLocaleString('en-US');
    el.len.textContent = String(snake.length);
    if (el.pScore) el.pScore.textContent = score.toLocaleString('en-US');
    if (el.pBest) el.pBest.textContent = best.toLocaleString('en-US');
    if (el.pLen) el.pLen.textContent = String(snake.length);
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
    el.score = $('cg-score');
    el.best = $('cg-best');
    el.len = $('cg-len');
    el.pScore = $('cg-p-score');
    el.pBest = $('cg-p-best');
    el.pLen = $('cg-p-len');
    el.sound = $('cg-sound');
    el.pause = $('cg-pause');
    el.probe = $('cg-probe');
    el.gutL = $('cg-gutL');
    el.gutR = $('cg-gutR');

    var touch = window.matchMedia('(hover:none) and (pointer:coarse)').matches;
    el.shell.classList.add(touch ? 'cg-touch' : 'cg-desktop');

    readColours();
    readBest();
    loadSprites();

    C = CunaControls.create({
      shell: el.shell, gutL: el.gutL, gutR: el.gutR,
      field: el.field, probe: el.probe,
      onDir: onDir, onEngage: onEngage, onKey: onKey
    });

    reset();
    layout();
    attractCard();
    paintHud();
    setSound(false);

    el.sound.addEventListener('click', function (e) { e.stopPropagation(); setSound(!soundOn); });
    el.pause.addEventListener('click', function (e) { e.stopPropagation(); setPaused(!paused); });

    el.overlay.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!b) return;
      var a = b.getAttribute('data-act');
      var msg = C.handleAct(a);
      if (msg !== null) { attractCard(); toast(msg); return; }
      if (a === 'resume') setPaused(false);
      else if (a === 'sound') { setSound(!soundOn); setPaused(true); }
      else if (a === 'again') startRun();
      else if (a === 'exit') location.href = 'index.html';
    });

    /* The first layout runs before webfonts land and before the grid has
       settled, so it measured a field far smaller than the one you end up
       looking at and the board came out a third of the size it should be.
       Observing the field catches every later settle, not just resizes. */
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
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && state === 'play' && !paused) setPaused(true);
    });

    /* A small non-visual hook so the page can be driven by an automated
       smoke test. It draws nothing and awards nothing. */
    el.shell.__cuna = {
      s: function () {
        return {
          state: state, paused: paused, score: score, len: snake.length,
          head: { x: snake[0].x, y: snake[0].y }, dir: dir,
          body: snake.map(function (c) { return c.x + ',' + c.y; }),
          cols: COLS, rows: ROWS,
          food: food ? { x: food.x, y: food.y, power: power } : null,
          jeet: jeet ? { x: jeet.x, y: jeet.y } : null,
          fright: performance.now() < frightUntil
        };
      },
      put: function (x, y, isPower) { food = { x: x, y: y }; power = !!isPower; },
      spawnJeet: function (x, y) { jeet = { x: x, y: y }; }
    };

    /* Sprites arrive after first paint; repaint when they land. */
    var t = setInterval(function () {
      if (SPR.ready) { clearInterval(t); draw(); }
    }, 120);
    setTimeout(function () { clearInterval(t); }, 6000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
