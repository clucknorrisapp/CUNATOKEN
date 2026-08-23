/* JEET WHACK — tap the tacos, leave the jeets alone.
 *
 * The whole game is one gesture, which is the point: it is the thing you can
 * play one-handed on a phone while waiting for a coffee, where TONGUE RUSH
 * wants both thumbs and your attention.
 */
(function () {
  'use strict';

  var BEST_KEY = 'cuna_whack_best';
  var ROUND_MS = 45000;
  var COLS = 3, ROWS = 3;

  /* How long a thing stays up, and how often something pops. Both tighten as
     the round runs down, so the last ten seconds are the interesting ones. */
  var UP_START = 1150, UP_MIN = 520;
  var GAP_START = 720, GAP_MIN = 260;

  var $ = function (id) { return document.getElementById(id); };

  var el = {};
  var holes = [];
  var score = 0, best = 0, bestAtStart = 0, streak = 0, misses = 0;
  var state = 'attract';
  var endAt = 0, nextPop = 0, raf = 0, lastFrame = 0;
  var soundOn = false, actx = null;

  /* Targets here are ~190px, ten times the size the maze pellet was drawn for,
     and at that scale it is a featureless cream dome. Both taco kinds use the
     detailed sprite; the big one is distinguished by size and a glow, not by
     different art. */
  var SPR = {
    img: null, ready: false, cell: 256,
    map: {
      taco: [2, 0], bigtaco: [2, 0], jeet: [4, 0],
      ruggy: [0, 1], fudd: [1, 1], paper: [2, 1]
    }
  };
  var GOOD = { taco: 1, bigtaco: 1 };
  var BADDIES = ['jeet', 'ruggy', 'fudd', 'paper'];

  function loadSprites() {
    var im = new Image();
    im.decoding = 'async';
    im.onload = function () { SPR.ready = true; SPR.img = im; draw(); };
    im.onerror = function () { SPR.ready = false; };
    im.src = 'assets/sprites-neo.webp';
  }

  function drawSpr(name, cx, cy, size, alpha) {
    if (!SPR.ready) return false;
    var m = SPR.map[name];
    if (!m) return false;
    var g = el.ctx, c = SPR.cell;
    g.save();
    g.globalAlpha = alpha === undefined ? 1 : alpha;
    g.drawImage(SPR.img, m[0] * c, m[1] * c, c, c, cx - size / 2, cy - size / 2, size, size);
    g.restore();
    return true;
  }

  /* ── board ───────────────────────────────────────────────────────── */

  function makeHoles() {
    holes = [];
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        holes.push({ gx: x, gy: y, kind: null, upAt: 0, downAt: 0, hit: 0, x: 0, y: 0, r: 0 });
      }
    }
  }

  var W = 0, H = 0, DPR = 1;
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
    var cell = Math.max(60, Math.floor(boardSide() / Math.max(COLS, ROWS)));
    W = cell * COLS; H = cell * ROWS;

    DPR = Math.min(window.devicePixelRatio || 1, 2);
    el.canvas.width = Math.round(W * DPR);
    el.canvas.height = Math.round(H * DPR);
    el.canvas.style.width = W + 'px';
    el.canvas.style.height = H + 'px';
    el.ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    for (var i = 0; i < holes.length; i++) {
      var h = holes[i];
      h.x = (h.gx + 0.5) * cell;
      h.y = (h.gy + 0.5) * cell;
      h.r = cell * 0.36;
    }
    draw();
  }

  var layoutT = 0;
  function scheduleLayout(ms) { clearTimeout(layoutT); layoutT = setTimeout(layout, ms || 60); }

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

  function progress() {
    var left = Math.max(0, endAt - performance.now());
    return 1 - (left / ROUND_MS);
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function popOne() {
    var down = [];
    for (var i = 0; i < holes.length; i++) if (!holes[i].kind) down.push(holes[i]);
    if (!down.length) return;
    var h = down[(Math.random() * down.length) | 0];
    var t = progress();
    /* Baddies get commoner as the round runs down: early on it is a taco
       gallery, by the end you actually have to look. */
    var badChance = lerp(0.28, 0.52, t);
    var r = Math.random();
    if (r < badChance) h.kind = BADDIES[(Math.random() * BADDIES.length) | 0];
    else if (r > 0.94) h.kind = 'bigtaco';
    else h.kind = 'taco';
    h.upAt = performance.now();
    h.downAt = h.upAt + lerp(UP_START, UP_MIN, t);
    h.hit = 0;
  }

  function startRun() {
    score = 0; streak = 0; misses = 0;
    bestAtStart = best;
    for (var i = 0; i < holes.length; i++) { holes[i].kind = null; holes[i].hit = 0; }
    state = 'play';
    endAt = performance.now() + ROUND_MS;
    nextPop = performance.now() + 300;
    hideOverlay();
    document.body.classList.add('cuna-playing');
    paintHud();
    lastFrame = performance.now();
    loop(lastFrame);
  }

  function endRun() {
    state = 'over';
    cancelAnimationFrame(raf);
    document.body.classList.remove('cuna-playing');
    var isBest = score > bestAtStart;
    writeBest();
    paintHud();
    beep(160, 300, 'sawtooth');
    showOverlay(
      '<div class="cg-card">' +
      '<p class="cg-big">' + (isBest ? 'NEW PERSONAL BEST' : 'TIME') + '</p>' +
      '<p class="cg-sub">' + score.toLocaleString('en-US') + ' calories · ' +
      misses + ' wrong ' + (misses === 1 ? 'tap' : 'taps') + '</p>' +
      '<div class="cg-btns">' +
      '<button class="btn btn-buy btn-sm" type="button" data-act="again">GO AGAIN</button>' +
      '<button class="btn btn-ghost btn-sm" type="button" data-act="exit">BACK TO THE SITE</button>' +
      '</div></div>', false);
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
      '<p class="cg-big">JEET WHACK</p>' +
      '<p class="cg-pill">' + (touch ? 'TAP TO START' : 'CLICK TO START') + '</p>' +
      '<p class="cg-sub">tacos yes, jeets no</p></div>');
  }

  var toastT = 0;
  function toast(txt) {
    el.toast.textContent = txt;
    el.toast.classList.add('is-on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.toast.classList.remove('is-on'); }, 900);
  }

  /* ── input ───────────────────────────────────────────────────────── */

  function hitAt(cx, cy) {
    for (var i = 0; i < holes.length; i++) {
      var h = holes[i];
      if (!h.kind || h.hit) continue;
      /* A forgiving radius. The sprite is the target, not the hole, and a
         thumb is wider than a fingertip cursor. */
      if (Math.hypot(cx - h.x, cy - h.y) <= h.r * 1.45) return h;
    }
    return null;
  }

  function onTap(e) {
    if (e.target && e.target.closest && e.target.closest('[data-act]')) return;
    if (state !== 'play') {
      try { el.shell.focus({ preventScroll: true }); } catch (err) { }
      startRun();
      return;
    }
    var r = el.canvas.getBoundingClientRect();
    var cx = e.clientX - r.left, cy = e.clientY - r.top;
    if (cx < 0 || cy < 0 || cx > W || cy > H) return;
    var h = hitAt(cx, cy);
    if (!h) return;
    if (e.cancelable) e.preventDefault();

    if (GOOD[h.kind]) {
      streak++;
      var base = h.kind === 'bigtaco' ? 150 : 50;
      /* A streak bonus rather than a multiplier: it rewards a clean run
         without making the last few seconds worth more than the first thirty. */
      var bonus = Math.min(100, (streak - 1) * 10);
      score += base + bonus;
      h.hit = 1;
      beep(h.kind === 'bigtaco' ? 720 : 520, 70);
      if (streak > 0 && streak % 10 === 0) toast(streak + ' IN A ROW');
    } else {
      streak = 0;
      misses++;
      score = Math.max(0, score - 75);
      h.hit = 2;
      beep(150, 180, 'sawtooth');
      toast('THAT WAS A JEET');
    }
    paintHud();
  }

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var r = el.shell.getBoundingClientRect();
    var onScreen = el.shell.contains(document.activeElement) ||
      document.body.classList.contains('cuna-playing') ||
      (r.bottom > 0 && r.top < (window.innerHeight || 0));
    if (!onScreen) return;
    var k = e.key;
    if (k === ' ' || k === 'Spacebar' || k === 'Enter') {
      if (e.cancelable) e.preventDefault();
      if (state !== 'play') startRun();
      return;
    }
    if (k === 'm' || k === 'M') { setSound(!soundOn); return; }
    if (k === 'Escape') { location.href = 'index.html'; }
  }

  /* ── loop ────────────────────────────────────────────────────────── */

  function loop(now) {
    if (state !== 'play') return;
    raf = requestAnimationFrame(loop);
    lastFrame = now;

    if (now >= endAt) { endRun(); return; }
    if (now >= nextPop) {
      popOne();
      nextPop = now + lerp(GAP_START, GAP_MIN, progress()) * (0.7 + Math.random() * 0.6);
    }
    for (var i = 0; i < holes.length; i++) {
      var h = holes[i];
      if (!h.kind) continue;
      if (h.hit && now - h.upAt > 160 + 120) { h.kind = null; continue; }
      if (!h.hit && now >= h.downAt) {
        /* A taco that got away costs nothing but the streak — punishing a
           miss twice makes the endgame feel arbitrary. */
        if (GOOD[h.kind]) streak = 0;
        h.kind = null;
      }
    }
    draw();
    paintClock();
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
    COL.plum3 = cssVar('--plum-3', '#7a1a4d');
    COL.cream = cssVar('--cream', '#fff3d6');
  }

  function draw() {
    if (!el.ctx) return;
    var g = el.ctx;
    g.clearRect(0, 0, W, H);
    var now = performance.now();

    for (var i = 0; i < holes.length; i++) {
      var h = holes[i];

      /* the hole, with a neon rim: a wide faint ring then a hot thin one, so
         the port reads as lit rather than as a flat grey ellipse */
      g.fillStyle = COL.plum2;
      g.beginPath();
      g.ellipse(h.x, h.y + h.r * 0.55, h.r * 1.05, h.r * 0.42, 0, 0, 6.283);
      g.fill();
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = 'rgba(255,46,136,.16)';
      g.lineWidth = Math.max(4, h.r * 0.30);
      g.stroke();
      g.strokeStyle = 'rgba(255,143,192,.55)';
      g.lineWidth = Math.max(1.5, h.r * 0.07);
      g.stroke();
      g.restore();
      g.strokeStyle = COL.ink;
      g.lineWidth = Math.max(2, h.r * 0.09);
      g.stroke();

      if (!h.kind) continue;

      /* Rise out of the hole and drop back, clipped so it reads as emerging
         rather than floating above the board. */
      var life = now - h.upAt;
      var rise = Math.min(1, life / 130);
      var fall = h.hit ? Math.min(1, Math.max(0, (life - 160) / 120)) : 0;
      var up = Math.max(0, rise - fall);
      var size = h.r * (h.kind === 'bigtaco' ? 2.5 : 2.05);
      var cy = h.y + h.r * 0.55 - up * h.r * 1.15;

      g.save();
      g.beginPath();
      g.rect(h.x - h.r * 1.6, h.y - h.r * 2.2, h.r * 3.2, h.r * 2.75);
      g.clip();
      if (h.hit === 2) {
        g.save();
        g.translate(h.x, cy);
        g.rotate(Math.sin(life / 22) * 0.22);
        g.translate(-h.x, -cy);
      }
      if (h.kind === 'bigtaco') {
        g.save();
        g.globalAlpha = .35 + Math.sin(life / 160) * .12;
        g.fillStyle = COL.cream;
        g.beginPath(); g.arc(h.x, cy, size * 0.56, 0, 6.283); g.fill();
        g.restore();
      }
      if (!drawSpr(h.kind, h.x, cy, size)) {
        g.fillStyle = GOOD[h.kind] ? COL.cream : COL.pink;
        g.beginPath(); g.arc(h.x, cy, h.r * 0.7, 0, 6.283); g.fill();
      }
      if (h.hit === 2) g.restore();
      g.restore();
    }
  }

  /* ── hud ─────────────────────────────────────────────────────────── */

  function paintHud() {
    el.score.textContent = score.toLocaleString('en-US');
    el.best.textContent = best.toLocaleString('en-US');
    if (el.streak) el.streak.textContent = String(streak);
    if (el.pScore) el.pScore.textContent = score.toLocaleString('en-US');
    if (el.pBest) el.pBest.textContent = best.toLocaleString('en-US');
    if (el.pStreak) el.pStreak.textContent = String(streak);
  }

  function paintClock() {
    var left = Math.max(0, endAt - performance.now());
    var s = Math.ceil(left / 1000);
    if (el.clock.textContent !== String(s)) el.clock.textContent = String(s);
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
    el.clock = $('cg-clock');
    el.streak = $('cg-streak');
    el.pScore = $('cg-p-score');
    el.pBest = $('cg-p-best');
    el.pStreak = $('cg-p-streak');
    el.sound = $('cg-sound');

    var touch = window.matchMedia('(hover:none) and (pointer:coarse)').matches;
    el.shell.classList.add(touch ? 'cg-touch' : 'cg-desktop');

    readColours();
    readBest();
    makeHoles();
    loadSprites();
    layout();
    attractCard();
    paintHud();
    el.clock.textContent = String(ROUND_MS / 1000);
    setSound(false);

    el.field.addEventListener('pointerdown', onTap);
    document.addEventListener('keydown', onKey);
    el.sound.addEventListener('click', function (e) { e.stopPropagation(); setSound(!soundOn); });

    el.overlay.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!b) return;
      var a = b.getAttribute('data-act');
      if (a === 'again') startRun();
      else if (a === 'exit') location.href = 'index.html';
    });

    /* Same reason as TONGUE TWISTER: the first measurement happens before the
       grid and the webfonts have settled. */
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
      /* No pause button on a timed round: leaving the tab ends it rather than
         handing out free thinking time. */
      if (document.hidden && state === 'play') endRun();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
