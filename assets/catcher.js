/* CUNA CUMMIN' FOR YA — a catcher. Tacos fall, you are the lips.
 *
 * Shares the sprite atlas, the shell CSS and the input layer with the other
 * three games; the only thing this file owns is the rules and the board.
 *
 * The one genuinely new thing here is that the lips are HELD rather than
 * latched. Every other game on the site is a grid game where a committed
 * direction should stand until you commit another one, so controls.js keeps
 * the last direction latched after you let go. A catcher wants the opposite:
 * you slide while you hold and stop when you release, on a thumb and on a
 * keyboard alike. So this file layers a release signal over the shared layer
 * — a keyup listener, and a count of live pointers inside the shell — and
 * zeroes the steer when the last one lifts. onDir stays the only thing that
 * ever sets a direction, so the chevrons and the d-pad arms keep lighting up
 * exactly as they do everywhere else.
 */
(function () {
  'use strict';

  var BEST_KEY = 'cuna_catcher_best';
  var LIVES = 3;

  /* Everything below is in fractions of the board, so the difficulty is the
     same on a 262px phone board and a 460px desktop one. */
  var FALL_START = 0.34, FALL_MAX = 0.95;   /* board heights per second */
  var GAP_START = 780, GAP_MIN = 300;        /* ms between drops */
  var BAD_START = 0.20, BAD_MAX = 0.46;      /* share of drops that bite */
  var BIG_CHANCE = 0.08;
  var RAMP_MS = 100000;                      /* time to reach full difficulty */
  var PLAYER_SPEED = 1.25;                   /* board widths per second */
  var GRACE_MS = 1100;                       /* mercy after a life is lost */

  /* Board proportions. Taller than wide — a catcher needs fall time — but
     never taller than the room the grid actually has. */
  var ASPECT = 1.34, W_MAX = 460, W_MIN = 180, H_MIN = 200;

  /* Mirrors game.css. The three-column grids give the gutters a hard minimum
     and the field whatever is left, so the board's width budget is arithmetic
     rather than a measurement — see boardBox(). Keep these in step with the
     `minmax()` mins in game.css or the canvas can be sized wider than the
     track that holds it, and the shell clips instead of scrolling. */
  var GUT_MIN_DESKTOP = 240, GUT_MIN_TOUCH = 132;
  /* Mirrors the portrait deck row: clamp(240px, 34svh, 330px). */
  var DECK_MIN = 240, DECK_MAX = 330, DECK_VH = 0.34;

  var $ = function (id) { return document.getElementById(id); };

  var el = {};
  var C = null;
  var mqPortrait = window.matchMedia('(orientation: portrait)');

  var W = 0, H = 0, DPR = 1;
  var state = 'attract', paused = false;
  var score = 0, best = 0, bestAtStart = 0, streak = 0, bestStreak = 0;
  var lives = LIVES, caught = 0, dropped = 0, bitten = 0;
  var runStart = 0, nextDrop = 0, graceUntil = 0, lastFrame = 0, raf = 0;
  var autospawn = true;
  var steer = 0;
  var items = [];
  var player = { x: 0, w: 0 };
  var soundOn = false, actx = null;

  /* ── sprites ─────────────────────────────────────────────────────── */

  /* The lips and the four chasers come straight off the atlas. Both taco
     kinds use `power`, the detailed one, and are told apart by size and a
     glow: `pellet` is drawn for ~16px in the maze and has no face, so at the
     70-odd pixels a falling taco gets here it is a featureless cream dome. */
  var SPR = {
    img: null, ready: false, cell: 256,
    map: {
      open: [0, 0], closed: [1, 0], taco: [2, 0], big: [2, 0],
      jeet: [4, 0], ruggy: [0, 1], fudd: [1, 1], paper: [2, 1]
    }
  };
  var CHASERS = ['jeet', 'ruggy', 'fudd', 'paper'];
  var GOOD = { taco: 1, big: 1 };

  function loadSprites() {
    var im = new Image();
    im.decoding = 'async';
    im.onload = function () { SPR.img = im; SPR.ready = true; draw(); };
    im.onerror = function () { SPR.ready = false; };
    im.src = 'assets/sprites-neo.webp';
  }

  /* Returns false when the atlas has not loaded, so every call site can draw
     the path version instead. A blocked request or no WebP still plays. */
  function drawSpr(g, name, cx, cy, size, alpha) {
    if (!SPR.ready) return false;
    var m = SPR.map[name];
    if (!m) return false;
    var c = SPR.cell;
    g.save();
    if (alpha !== undefined) g.globalAlpha = alpha;
    g.drawImage(SPR.img, m[0] * c, m[1] * c, c, c, cx - size / 2, cy - size / 2, size, size);
    g.restore();
    return true;
  }

  /* ── layout ──────────────────────────────────────────────────────── */

  /* Which grid game.css has actually given us. Read from the same media
     queries the stylesheet uses rather than from the DOM, because every box
     in that grid except the shell sizes to its content — including the field
     — and measuring one of those to size the canvas inside it is the feedback
     loop that shrank both of the older boards to their minimum tile. */
  function flanked() {
    if (el.shell.classList.contains('cg-touch')) return !mqPortrait.matches;
    return (window.innerWidth || 0) > 560;
  }

  function boardBox() {
    var cs = getComputedStyle(el.shell);
    var padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    var padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    /* The SHELL is the one safe thing to measure: it is the grid container,
       its width comes from the page, and it never comes back from the
       canvas. */
    var content = Math.max(120, (el.shell.clientWidth || 320) - padX);

    var wBudget = content;
    if (flanked()) {
      var gut = el.shell.classList.contains('cg-touch') ? GUT_MIN_TOUCH : GUT_MIN_DESKTOP;
      wBudget = Math.max(140, content - 2 * gut);
    }

    var vh = window.innerHeight || 640;
    /* The HUD's height is set by its text, not by the board, so it is safe. */
    var hud = (el.hud && el.hud.offsetHeight) || 40;
    var deck = 0;
    if (el.shell.classList.contains('cg-touch') && mqPortrait.matches) {
      deck = Math.min(DECK_MAX, Math.max(DECK_MIN, vh * DECK_VH));
    }
    var hBudget = vh - padY - hud - deck - 16;
    /* While playing the shell is fixed to the viewport and clips, so the
       budget above is the real ceiling. Sitting on the page it can grow
       instead — but a board tall enough to push the fine print off a laptop
       is worse than a slightly smaller one, so cap it. */
    if (cs.position !== 'fixed') hBudget = Math.min(hBudget, vh * 0.62);

    var w = Math.max(W_MIN, Math.min(wBudget, W_MAX));
    var h = Math.max(H_MIN, Math.min(hBudget, w * ASPECT));
    /* Wider than it is tall stops reading as rain and starts reading as a
       pinball table, and the lips end up with nothing to react to. */
    if (h < w) w = Math.max(W_MIN, h);
    return { w: Math.round(w), h: Math.round(h) };
  }

  function layout() {
    var box = boardBox();
    var ow = W, oh = H;
    W = box.w; H = box.h;

    DPR = Math.min(window.devicePixelRatio || 1, 2);
    el.canvas.width = Math.round(W * DPR);
    el.canvas.height = Math.round(H * DPR);
    el.canvas.style.width = W + 'px';
    el.canvas.style.height = H + 'px';
    el.ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    buildGlow();

    player.w = W * 0.20;
    /* Everything in play is stored in board pixels, so a re-layout has to
       carry it across rather than teleport it. Entering immersive mode
       resizes the board mid-run, and without this the lips jumped to the
       left wall and every taco jumped with them. */
    if (ow && oh) {
      var sx = W / ow, sy = H / oh;
      player.x *= sx;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        it.x *= sx; it.y *= sy; it.r *= sx; it.v *= sy; it.ax *= sx;
      }
    } else {
      player.x = W / 2;
    }
    clampPlayer();
    if (C) C.layout();
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

  /* ── best score ──────────────────────────────────────────────────── */

  function readBest() {
    try { best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { best = 0; }
  }
  function writeBest() {
    if (score <= best) return;
    best = score;
    try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { }
  }

  /* ── the ramp ────────────────────────────────────────────────────── */

  function lerp(a, b, t) { return a + (b - a) * t; }
  function progress() {
    if (state !== 'play') return 0;
    return Math.min(1, (performance.now() - runStart) / RAMP_MS);
  }

  /* ── drops ───────────────────────────────────────────────────────── */

  function spawn(kind, fx) {
    var t = progress();
    var big = kind === 'big';
    var r = W * (big ? 0.105 : GOOD[kind] ? 0.070 : 0.075);
    var pad = r + W * 0.03;
    var x = fx === undefined ? pad + Math.random() * Math.max(1, W - pad * 2) : fx * W;
    var v = H * lerp(FALL_START, FALL_MAX, t) * (0.88 + Math.random() * 0.28);
    if (kind === 'fudd') v *= 1.22;       /* FUDD only knows one thing: down, fast */
    if (big) v *= 0.82;                    /* the big one is worth waiting for */
    var it = {
      kind: kind, x: x, y: -r, r: r, v: v,
      ax: 0, seed: Math.random() * 6.283, born: performance.now()
    };
    items.push(it);
    return it;
  }

  function rollDrop() {
    var t = progress();
    var r = Math.random();
    if (r < lerp(BAD_START, BAD_MAX, t)) spawn(CHASERS[(Math.random() * CHASERS.length) | 0]);
    else if (r > 1 - BIG_CHANCE) spawn('big');
    else spawn('taco');
  }

  /* ── the player ──────────────────────────────────────────────────── */

  function clampPlayer() {
    var half = player.w / 2;
    if (player.x < half) player.x = half;
    if (player.x > W - half) player.x = W - half;
  }

  /* ── state ───────────────────────────────────────────────────────── */

  function reset() {
    score = 0; streak = 0; bestStreak = 0;
    lives = LIVES; caught = 0; dropped = 0; bitten = 0;
    items = [];
    steer = 0;
    player.x = W / 2;
    graceUntil = 0;
    clampPlayer();
    paintHud();
    paintLives();
  }

  function startRun() {
    reset();
    /* Snapshot the best BEFORE the run can write to it. Comparing the final
       score against a `best` that writeBest() has already raised makes every
       new record report itself as an ordinary game over. */
    bestAtStart = best;
    state = 'play';
    paused = false;
    runStart = performance.now();
    nextDrop = runStart + 500;
    hideOverlay();
    document.body.classList.add('cuna-playing');
    lastFrame = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }

  function gameOver() {
    state = 'over';
    cancelAnimationFrame(raf);
    document.body.classList.remove('cuna-playing');
    steer = 0;
    var isBest = score > bestAtStart;
    writeBest();
    paintHud();
    beep(140, 300, 'sawtooth');
    say('Run over. ' + score + ' calories.');
    showOverlay(
      '<div class="cg-card">' +
      '<p class="cg-big">' + (isBest ? 'NEW PERSONAL BEST' : 'DROPPED IT') + '</p>' +
      '<p class="cg-sub">' + score.toLocaleString('en-US') + ' calories · ' +
      caught + ' caught · best streak ' + bestStreak + '</p>' +
      '<div class="cg-btns">' +
      '<button class="btn btn-buy btn-sm" type="button" data-act="again">GO AGAIN</button>' +
      '<button class="btn btn-ghost btn-sm" type="button" data-act="exit">BACK TO THE SITE</button>' +
      '</div></div>', false);
  }

  /* When the game stops, the clock stops with it. Without this the drop timer
     and the difficulty ramp both keep counting the time spent staring at the
     pause card, and you come back to a wall of chasers. */
  var pausedAt = 0;

  function setPaused(v) {
    if (state !== 'play') return;
    paused = v;
    if (v) {
      steer = 0;
      pausedAt = performance.now();
      cancelAnimationFrame(raf);
      showOverlay(
        '<div class="cg-card">' +
        '<p class="cg-big">PAUSED</p>' +
        '<p class="cg-sub">Nothing is falling. Enjoy it.</p>' +
        '<div class="cg-btns">' +
        '<button class="btn btn-buy btn-sm" type="button" data-act="resume">RESUME</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-act="sound">' +
        (soundOn ? 'SOUND OFF' : 'SOUND ON') + '</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-act="exit">BACK TO THE SITE</button>' +
        '</div></div>', false);
    } else {
      hideOverlay();
      lastFrame = performance.now();
      if (pausedAt) {
        var slept = lastFrame - pausedAt;
        runStart += slept; nextDrop += slept;
        if (graceUntil) graceUntil += slept;
      }
      pausedAt = 0;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
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
      '<p class="cg-big">CUNA CUMMIN’ FOR YA</p>' +
      '<p class="cg-pill">' + (C && C.isTouch() ? 'TAP TO START' : 'PRESS ANY KEY') + '</p>' +
      '<p class="cg-sub">CUNA cummin’ for ya 💦</p></div>' +
      (C ? C.optsHtml() : ''));
  }

  var toastT = 0;
  function toast(txt) {
    el.toast.textContent = txt;
    el.toast.classList.add('is-on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.toast.classList.remove('is-on'); }, 1000);
  }

  var sayT = 0;
  function say(txt) {
    if (!el.live) return;
    clearTimeout(sayT);
    sayT = setTimeout(function () { el.live.textContent = txt; }, 120);
  }

  var hurtT = 0;
  function flinch() {
    el.shell.classList.remove('is-hurt');
    /* Reading offsetWidth restarts the animation; without it a second hit
       inside the first flash does nothing at all. */
    void el.shell.offsetWidth;
    el.shell.classList.add('is-hurt');
    clearTimeout(hurtT);
    hurtT = setTimeout(function () { el.shell.classList.remove('is-hurt'); }, 700);
  }

  /* ── input ───────────────────────────────────────────────────────── */

  function onDir(d) {
    if (d === C.LEFT) steer = -1;
    else if (d === C.RIGHT) steer = 1;
    /* Up and down are not nothing: they plant the lips. A four-way control
       whose two vertical arms are inert reads as broken, and a hard stop is
       genuinely useful when a chaser is coming down on your head. */
    else steer = 0;
  }

  function onEngage() {
    try { el.shell.focus({ preventScroll: true }); }
    catch (e) { try { el.shell.focus(); } catch (e2) { } }
    if (state === 'attract' || state === 'over') startRun();
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

  /* Release tracking — the half of the control scheme controls.js cannot
     provide, because for a grid game a released direction should stay
     latched. Keys are counted by name and touches by pointer id; when the
     last one lifts, the lips stop. */
  var heldKeys = {}, livePointers = {};

  function isSteerKey(k) {
    return k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown' ||
      k === 'a' || k === 'A' || k === 'd' || k === 'D' ||
      k === 'w' || k === 'W' || k === 's' || k === 'S';
  }
  function anyHeld(bag) { for (var k in bag) if (bag[k]) return true; return false; }

  function wireRelease() {
    document.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isSteerKey(e.key)) heldKeys[e.key] = 1;
    });
    document.addEventListener('keyup', function (e) {
      if (!isSteerKey(e.key)) return;
      delete heldKeys[e.key];
      if (!anyHeld(heldKeys) && !anyHeld(livePointers)) steer = 0;
    });
    /* A key held while the tab loses focus never sends its keyup. */
    window.addEventListener('blur', function () { heldKeys = {}; steer = 0; });

    el.shell.addEventListener('pointerdown', function (e) { livePointers[e.pointerId] = 1; });
    var up = function (e) {
      if (!livePointers[e.pointerId]) return;
      delete livePointers[e.pointerId];
      if (!anyHeld(livePointers) && !anyHeld(heldKeys)) steer = 0;
    };
    /* On document, not the shell: a gutter captures the pointer, so the up
       is retargeted there and only reaches the shell by bubbling — but a
       pointercancel during a scroll gesture may not reach it at all. */
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  }

  /* ── the frame ───────────────────────────────────────────────────── */

  function frame(now) {
    if (state !== 'play' || paused) return;
    raf = requestAnimationFrame(frame);
    /* Capped so a backgrounded tab or a slow paint cannot let a taco skip
       clean through the catch band on the frame it comes back. */
    var dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    update(dt, now);
    draw();
  }

  function update(dt, now) {
    var t = progress();

    player.x += steer * PLAYER_SPEED * W * dt;
    clampPlayer();

    if (autospawn && now >= nextDrop) {
      rollDrop();
      nextDrop = now + lerp(GAP_START, GAP_MIN, t) * (0.72 + Math.random() * 0.56);
    }

    var half = player.w / 2;
    var mouthY = H - player.w * 0.62;
    var grace = now < graceUntil;

    for (var i = items.length - 1; i >= 0; i--) {
      var it = items[i];
      it.y += it.v * dt;
      /* Each chaser falls the way it chases in the maze game. None of it is
         clever — the point is that four identical falling sprites would be
         four identical falling sprites. */
      if (it.kind === 'jeet') it.ax = (player.x - it.x) * 1.5;
      else if (it.kind === 'ruggy') it.ax = Math.sin(now / 260 + it.seed) * W * 0.5;
      else if (it.kind === 'paper') {
        var d = player.x - it.x;
        it.ax = Math.abs(d) < W * 0.20 ? -d * 2.2 : d * 1.1;   /* bottles it up close */
      } else it.ax = 0;
      /* Capped well under the lips' own speed. An uncapped homing chaser is
         not a hazard, it is a guarantee: it simply lands on you. */
      var cap = W * (it.kind === 'paper' ? 0.40 : 0.48);
      if (it.ax > cap) it.ax = cap; else if (it.ax < -cap) it.ax = -cap;
      if (it.ax) {
        it.x += it.ax * dt;
        if (it.x < it.r) it.x = it.r;
        if (it.x > W - it.r) it.x = W - it.r;
      }

      /* Caught: the item's middle has reached the mouth band and it is over
         the lips. The band is deep enough that nothing tunnels through it at
         the capped frame time. */
      if (it.y >= mouthY - it.r * 0.45 && it.y <= H - player.w * 0.10 &&
        Math.abs(it.x - player.x) <= half + it.r * 0.40) {
        if (GOOD[it.kind]) {
          items.splice(i, 1);
          streak++;
          if (streak > bestStreak) bestStreak = streak;
          caught++;
          /* A streak bonus rather than a multiplier, so a clean run pays
             without making the last thirty seconds worth more than the
             first two minutes. */
          var bonus = Math.min(100, (streak - 1) * 10);
          score += (it.kind === 'big' ? 150 : 50) + bonus;
          beep(it.kind === 'big' ? 720 : 520, it.kind === 'big' ? 110 : 60);
          if (it.kind === 'big') toast('BIG ONE');
          else if (streak % 10 === 0) toast(streak + ' IN A ROW');
          paintHud();
          continue;
        }
        if (!grace) {
          items.splice(i, 1);
          bitten++;
          streak = 0;
          lives--;
          graceUntil = now + GRACE_MS;
          grace = true;
          flinch();
          beep(150, 220, 'sawtooth');
          toast('CAUGHT A ' + it.kind.toUpperCase());
          say(it.kind + ' caught. ' + lives + ' ' + (lives === 1 ? 'life' : 'lives') + ' left.');
          paintHud();
          paintLives();
          if (lives <= 0) { gameOver(); return; }
          continue;
        }
      }

      if (it.y - it.r > H) {
        items.splice(i, 1);
        /* A taco that got past you costs the streak and nothing else.
           Punishing a miss twice makes a long run feel arbitrary. */
        if (GOOD[it.kind]) {
          dropped++;
          if (streak >= 10) toast('STREAK GONE');
          streak = 0;
          paintHud();
        }
      }
    }
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

  /* The floor glow, baked to a bitmap once per layout.
     Caching the gradient object was not enough: filling the whole board with a
     radial gradient every frame was the entire cost of this game — an empty
     board still measured 33ms at 4x CPU throttle with nothing falling. A
     blit of a pre-rendered disc is a fraction of that. Only the top half of
     the disc is kept, since the rest is below the floor. */
  var glowCan = null, glowR = 0;
  function buildGlow() {
    glowCan = null;
    if (!H) return;
    try {
      var R = Math.round(H * 0.55);
      if (R < 4) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var c = document.createElement('canvas');
      c.width = Math.round(R * 2 * dpr); c.height = Math.round(R * dpr);
      var g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      var gr = g.createRadialGradient(R, R, 0, R, R, R);
      gr.addColorStop(0, 'rgba(255,111,176,.20)');
      gr.addColorStop(1, 'rgba(255,111,176,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, R * 2, R);
      glowCan = c; glowR = R;
    } catch (e) { glowCan = null; }
  }

  function draw() {
    if (!el.ctx || !W || !H) return;
    var g = el.ctx, now = performance.now();

    g.clearRect(0, 0, W, H);
    g.fillStyle = COL.plum2;
    g.fillRect(0, 0, W, H);

    /* A glow under the lips so the bottom of the board reads as the place
       things are meant to end up. */
    /* Built once and translated, not rebuilt every frame. createRadialGradient
       per frame was costing more than everything else in this function put
       together; the gradient lives in user space, so sliding the canvas under
       it follows the lips for free. */
    if (glowCan) {
      g.drawImage(glowCan, player.x - glowR, H - glowR, glowR * 2, glowR);
    }

    /* Guide rails, so a falling thing has something to be measured against and
       sideways drift is visible before it matters. Neon rather than grey, and
       batched into one path instead of four strokes. */
    var rails = new Path2D();
    for (var c = 1; c < 5; c++) {
      var gx = Math.round(W * c / 5) + 0.5;
      rails.moveTo(gx, 0); rails.lineTo(gx, H);
    }
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = 'rgba(255,46,136,.10)';
    g.lineWidth = 3; g.stroke(rails);
    g.strokeStyle = 'rgba(255,143,192,.14)';
    g.lineWidth = 1; g.stroke(rails);
    g.restore();

    /* A hot line along the floor: this is the level the lips defend, and it
       was previously implied by nothing at all. */
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = 'rgba(255,46,136,.30)';
    g.lineWidth = 10;
    g.beginPath(); g.moveTo(0, H - 1); g.lineTo(W, H - 1); g.stroke();
    g.strokeStyle = 'rgba(255,143,192,.75)';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, H - 1.5); g.lineTo(W, H - 1.5); g.stroke();
    g.restore();

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var size = it.r * 2;
      if (it.kind === 'big') {
        g.save();
        g.globalAlpha = 0.32 + Math.sin(now / 170 + it.seed) * 0.12;
        g.fillStyle = COL.cream;
        g.beginPath(); g.arc(it.x, it.y, it.r * 1.15, 0, 6.283); g.fill();
        g.restore();
      }
      /* A gentle tumble: falling sprites that never rotate look pasted on. */
      g.save();
      g.translate(it.x, it.y);
      g.rotate(Math.sin(now / 520 + it.seed) * (GOOD[it.kind] ? 0.22 : 0.12));
      if (!drawSpr(g, it.kind, 0, 0, size)) {
        g.fillStyle = GOOD[it.kind] ? COL.cream : COL.pink;
        g.beginPath(); g.arc(0, 0, it.r * 0.8, 0, 6.283); g.fill();
        g.strokeStyle = COL.ink;
        g.lineWidth = Math.max(2, it.r * 0.16);
        g.stroke();
      }
      g.restore();
    }

    drawPlayer(g, now);
  }

  function drawPlayer(g, now) {
    var size = player.w;
    var cy = H - size * 0.52;
    var blink = now < graceUntil && (((now / 110) | 0) % 2 === 0);

    /* The mouth opens for whatever is about to land in it. */
    var open = false;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.y > H * 0.55 && Math.abs(it.x - player.x) < size * 0.9) { open = true; break; }
    }
    if (!open && state === 'play') open = ((now / 480) | 0) % 2 === 0;

    g.save();
    if (blink) g.globalAlpha = 0.35;
    /* A shadow on the floor pins the lips to the bottom of the board rather
       than leaving them floating in front of it. */
    g.fillStyle = 'rgba(36,4,15,.45)';
    g.beginPath();
    g.ellipse(player.x, H - size * 0.08, size * 0.46, size * 0.10, 0, 0, 6.283);
    g.fill();
    if (!drawSpr(g, open ? 'open' : 'closed', player.x, cy, size)) {
      g.fillStyle = COL.pink2;
      g.beginPath();
      g.ellipse(player.x, cy, size * 0.46, size * 0.30, 0, 0, 6.283);
      g.fill();
      g.strokeStyle = COL.ink;
      g.lineWidth = Math.max(2, size * 0.07);
      g.stroke();
      if (open) {
        g.fillStyle = COL.ink;
        g.beginPath();
        g.ellipse(player.x, cy, size * 0.30, size * 0.16, 0, 0, 6.283);
        g.fill();
      }
    }
    g.restore();
  }

  /* ── hud ─────────────────────────────────────────────────────────── */

  function paintHud() {
    el.score.textContent = score.toLocaleString('en-US');
    el.best.textContent = Math.max(best, score).toLocaleString('en-US');
    if (el.streak) el.streak.textContent = String(streak);
    if (el.pScore) el.pScore.textContent = score.toLocaleString('en-US');
    if (el.pBest) el.pBest.textContent = Math.max(best, score).toLocaleString('en-US');
    if (el.pStreak) el.pStreak.textContent = String(streak);
  }

  function paintLives() {
    var holders = [el.lives, el.pLives];
    for (var h = 0; h < holders.length; h++) {
      var box = holders[h];
      if (!box) continue;
      box.textContent = '';
      var n = Math.max(0, Math.min(lives, 8));
      for (var i = 0; i < n; i++) {
        var cv = document.createElement('canvas');
        var s = (window.innerWidth || 400) < 430 ? 19 : 24;
        cv.width = s * 2; cv.height = s * 2;
        cv.style.width = s + 'px'; cv.style.height = s + 'px';
        var g = cv.getContext('2d');
        g.setTransform(2, 0, 0, 2, 0, 0);
        if (!drawSpr(g, 'open', s / 2, s / 2, s * 0.98)) {
          g.fillStyle = COL.pink2 || '#ff6fb0';
          g.beginPath();
          g.ellipse(s / 2, s / 2, s * 0.42, s * 0.28, 0, 0, 6.283);
          g.fill();
        }
        box.appendChild(cv);
      }
      box.setAttribute('aria-label', lives + (lives === 1 ? ' life left' : ' lives left'));
    }
  }

  /* ── boot ────────────────────────────────────────────────────────── */

  function init() {
    el.shell = $('cuna-game');
    if (!el.shell) return;
    el.canvas = $('cg-canvas');
    el.ctx = el.canvas.getContext('2d');
    el.field = $('cg-field');
    el.hud = $('cg-hud');
    el.overlay = $('cg-overlay');
    el.toast = $('cg-toast');
    el.live = $('cg-live');
    el.score = $('cg-score');
    el.best = $('cg-best');
    el.streak = $('cg-streak');
    el.lives = $('cg-lives');
    el.pScore = $('cg-p-score');
    el.pBest = $('cg-p-best');
    el.pStreak = $('cg-p-streak');
    el.pLives = $('cg-p-lives');
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
    wireRelease();

    layout();
    reset();
    attractCard();
    setSound(false);

    el.sound.addEventListener('click', function (e) { e.stopPropagation(); setSound(!soundOn); });
    el.pause.addEventListener('click', function (e) { e.stopPropagation(); setPaused(!paused); });

    /* The attract overlay is cg-pass so a tap anywhere on it starts the run;
       controls.js already refuses to start on a [data-act] target, and this
       is the other half of that — the click that presses a button must not
       also be read as a tap on the card. */
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

    /* The first measurement happens before the webfonts land and before the
       grid has settled, so it reads a HUD and a shell that are not the ones
       you end up looking at. Observing catches every later settle, including
       the shell going fixed when a run starts. */
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () { scheduleLayout(0); });
      ro.observe(el.field);
      ro.observe(el.hud);
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
          state: state, paused: paused, score: score, best: best, lives: lives,
          streak: streak, bestStreak: bestStreak, caught: caught, dropped: dropped,
          bitten: bitten, steer: steer, w: W, h: H,
          playerX: player.x, playerFx: W ? player.x / W : 0, playerW: player.w,
          grace: performance.now() < graceUntil,
          items: items.map(function (it) {
            return {
              kind: it.kind, x: it.x, y: it.y, r: it.r, v: it.v,
              fx: W ? it.x / W : 0, fy: H ? it.y / H : 0
            };
          })
        };
      },
      /* fx and fy are fractions of the board so a test does not have to know
         how big the board came out on the device it is running on. */
      spawn: function (kind, fx, fy) {
        var it = spawn(kind, fx === undefined ? 0.5 : fx);
        if (fy !== undefined) it.y = fy * H;
        return { kind: it.kind, x: it.x, y: it.y, r: it.r };
      },
      clear: function () { items.length = 0; },
      autospawn: function (v) { autospawn = !!v; },
      setLives: function (n) { lives = n; paintLives(); paintHud(); },
      setSteer: function (v) { steer = v; },
      movePlayer: function (fx) { player.x = fx * W; clampPlayer(); }
    };

    /* Sprites arrive after the first paint; repaint when they land, and give
       the lives pips a second go now that they have art. */
    var t = setInterval(function () {
      if (SPR.ready) { clearInterval(t); paintLives(); draw(); }
    }, 120);
    setTimeout(function () { clearInterval(t); }, 6000);

    paintHud();
    paintLives();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
