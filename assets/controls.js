/* CUNA shared touch/keyboard controls.
 *
 * One implementation of the input layer for every game on the site. It was
 * extracted rather than copied on purpose: the awkward parts here — same-axis
 * reversal, re-anchoring a gesture at each committed turn, a resting hand not
 * being allowed to steal the stick — all took real debugging to get right, and
 * three private copies would have drifted apart the first time one of them was
 * fixed.
 *
 * Everything is four-way and discrete. There is no such thing as a diagonal
 * in any of these games, so the dominant axis always wins outright.
 *
 * Usage:
 *   const C = CunaControls.create({
 *     shell, gutL, gutR, field, probe,
 *     onDir:    function (d) {},   // a direction was committed
 *     onEngage: function () {},    // a press that should start/resume
 *     onKey:    function (k, e) {} // return true if the key was consumed
 *   });
 *   C.layout();                    // call on resize/orientation change
 */
window.CunaControls = (function () {
  'use strict';

  var UP = 0, LEFT = 1, DOWN = 2, RIGHT = 3;
  var DX = [0, -1, 0, 1];
  var DY = [-1, 0, 1, 0];
  var CHEV = ['cg-u', 'cg-l', 'cg-d', 'cg-r'];

  var CTL_KEY = 'cuna_ctl_side';
  var FLOAT_KEY = 'cuna_stick_float';

  /* Stickiness to the direction already held, so a hold near 45 degrees does
     not machine-gun between two directions. */
  var TURN_MARGIN = 1.35;
  /* The ratio alone is not enough: near the origin both axes are a handful of
     pixels and 1-2px of jitter flips which one dominates. A turn has to win by
     an absolute margin too. */
  var TURN_MIN_PX = 10;

  function clamp(a, v, b) { return v < a ? a : v > b ? b : v; }

  function create(o) {
    var shell = o.shell, field = o.field, probe = o.probe;
    var onDir = o.onDir || function () { };
    var onEngage = o.onEngage || function () { };
    var onKey = o.onKey || function () { return false; };

    var mqTouch = window.matchMedia('(hover:none) and (pointer:coarse)');
    var mqPortrait = window.matchMedia('(orientation: portrait)');

    var sticks = {};
    var ctlSide = 'r';
    var stickFloats = false;
    var curDir = -1;

    /* ── preferences ───────────────────────────────────────────────── */

    function setCtlSide(side) {
      if (side !== 'l' && side !== 'r') return;
      ctlSide = side;
      ['l', 'r'].forEach(function (k) {
        var S = sticks[k];
        if (!S) return;
        S.mode = (k === ctlSide) ? 'stick' : 'pad';
        S.gut.setAttribute('data-ctl', S.mode);
      });
      try { localStorage.setItem(CTL_KEY, side); } catch (e) { }
    }

    function setStickFloats(v) {
      stickFloats = !!v;
      try { localStorage.setItem(FLOAT_KEY, stickFloats ? '1' : '0'); } catch (e) { }
    }

    function readPrefs() {
      var side = 'r', fl = false;
      try {
        var s = localStorage.getItem(CTL_KEY);
        if (s === 'l' || s === 'r') side = s;
        fl = localStorage.getItem(FLOAT_KEY) === '1';
      } catch (e) { }
      stickFloats = fl;
      setCtlSide(side);
    }

    /* ── readouts ──────────────────────────────────────────────────── */

    function setChev(d) {
      var all = shell.querySelectorAll('.cg-chev');
      for (var i = 0; i < all.length; i++) {
        all[i].classList.toggle('is-on', all[i].classList.contains(CHEV[d]));
      }
    }

    /* Both crosses show the committed direction, not just the one you
       touched. On a tablet your hands are far apart and you will be looking
       at whichever is nearer. */
    function lightArm(d) {
      for (var side in sticks) {
        var S = sticks[side];
        if (!S || !S.arms) continue;
        for (var k = 0; k < 4; k++) {
          if (S.arms[k]) S.arms[k].classList.toggle('is-on', k === d);
        }
      }
    }

    function setDir(d) {
      if (d < 0) return;
      curDir = d;
      setChev(d);
      lightArm(d);
      onDir(d);
    }

    /* ── direction from a vector ───────────────────────────────────── */

    /* Returns true when the committed direction actually changed, which is
       the signal for the caller to re-anchor the gesture. */
    function commitVec(S, dx, dy) {
      var ax = Math.abs(dx), ay = Math.abs(dy);
      var d = ax > ay ? (dx > 0 ? RIGHT : LEFT) : (dy > 0 ? DOWN : UP);
      if (S.lastDir >= 0 && d !== S.lastDir) {
        var horizOld = S.lastDir === LEFT || S.lastDir === RIGHT;
        var horizNew = d === LEFT || d === RIGHT;
        /* Stickiness only means something between two axes competing to
           dominate. A reversal along the SAME axis is not a competition — the
           sign flipped, that is the whole of it — and weighing it against the
           axis it is already on makes `held` and `rival` the same number, so
           the test can never pass and the direction can never reverse. */
        if (horizOld !== horizNew) {
          var held = horizOld ? ax : ay;
          var rival = horizOld ? ay : ax;
          if (rival < held * TURN_MARGIN || rival - held < TURN_MIN_PX) d = S.lastDir;
        }
      }
      var changed = d !== S.lastDir;
      S.lastDir = d;
      setDir(d);
      return changed;
    }

    /* ── the gutter pads ───────────────────────────────────────────── */

    function armAt(S, px, py) {
      if (S.mode !== 'pad') return -1;
      var half = S.padR;
      var x = px - S.padX, y = py - S.padY;
      if (Math.abs(x) > half || Math.abs(y) > half) return -1;
      /* The hub in the middle is deliberately inert, so a thumb landing dead
         centre does not pick a direction at random. */
      var t = half * 0.33;
      if (Math.abs(x) <= t && y < -t) return UP;
      if (Math.abs(x) <= t && y > t) return DOWN;
      if (Math.abs(y) <= t && x < -t) return LEFT;
      if (Math.abs(y) <= t && x > t) return RIGHT;
      return -1;
    }

    function deadZone(S) { return Math.max(12, S.r * 0.20); }

    function localPt(S, e) {
      var r = S.gut.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    /* There is no "active" gutter and nothing moves between them: both are
       always live and independent. That is what makes the hand holding a
       tablet harmless — a stationary touch never exceeds the dead zone, so it
       commits nothing, and it has nothing to take over. */
    function padDown(S, e) {
      if (S.id !== null) return;
      S.id = e.pointerId;
      try { S.gut.setPointerCapture(e.pointerId); } catch (err) { }
      if (e.cancelable) e.preventDefault();

      var pt = localPt(S, e);
      S.dragging = false;
      if (S.pad) S.pad.classList.add('is-hot');

      var arm = armAt(S, pt.x, pt.y);
      S.lastDir = arm;
      if (arm >= 0) setDir(arm);

      /* A fixed stick holds its printed spot and is driven from its own
         centre, the way a physical one is. The grab radius is generous so
         "near enough" counts, and pressing the rest of that gutter is not
         dead: it falls through to a plain swipe from wherever the thumb
         landed, so a miss still steers. */
      var grabbed = Math.hypot(pt.x - S.homeX, pt.y - S.homeY) <= S.r * 1.35;
      var anchored = S.mode === 'stick' && !stickFloats && grabbed;
      S.ringDriven = S.mode !== 'stick' || stickFloats || grabbed;

      if (anchored) {
        S.ox = S.homeX; S.oy = S.homeY;
        S.stick.style.transform = 'translate3d(0,0,0)';
      } else {
        S.ox = pt.x; S.oy = pt.y;
        if (S.ringDriven) {
          S.stick.classList.add('is-drag');
          S.stick.style.transform =
            'translate3d(' + (pt.x - S.homeX) + 'px,' + (pt.y - S.homeY) + 'px,0)';
        }
      }
      S.nub.style.transform = 'translate3d(0,0,0)';
      onEngage();
    }

    function padMove(S, e) {
      if (S.id !== e.pointerId) return;
      if (e.cancelable) e.preventDefault();
      var pt = localPt(S, e);
      var dx = pt.x - S.ox, dy = pt.y - S.oy;
      if (Math.hypot(dx, dy) < deadZone(S)) return;

      if (!S.dragging) {
        S.dragging = true;
        if (S.ringDriven) S.stick.classList.add('is-live');
        /* A drag that began on an arm should be free to turn away from it. */
        S.lastDir = -1;
      }
      /* Re-anchor only when the direction actually changed. Re-anchoring every
         move resets the evidence each frame so no vector can grow enough to
         win a turn; never re-anchoring leaves the first leg's displacement
         standing forever so no second turn can beat it. Anchoring at each turn
         is what lets you chain turns without lifting. */
      if (commitVec(S, dx, dy)) { S.ox = pt.x; S.oy = pt.y; }

      if (S.ringDriven) {
        var throwR = S.r * 0.62;
        S.nub.style.transform = 'translate3d(' +
          (DX[S.lastDir] * throwR) + 'px,' + (DY[S.lastDir] * throwR) + 'px,0)';
      }
    }

    function padUp(S, e) {
      if (S.id !== e.pointerId) return;
      releasePad(S);
    }

    function releasePad(S) {
      var pid = S.id;
      S.id = null;
      if (pid !== null) { try { S.gut.releasePointerCapture(pid); } catch (err) { } }
      S.dragging = false;
      S.lastDir = -1;
      if (S.pad) S.pad.classList.remove('is-hot', 'is-dragging');
      S.stick.classList.remove('is-live', 'is-drag');
      S.stick.style.transform = 'translate3d(0,0,0)';
      S.nub.style.transform = 'translate3d(0,0,0)';
      /* direction stays latched — releasing does not stop the player */
    }

    function mkStick(side, gut) {
      if (!gut) return;
      var stick = gut.querySelector('.cg-stick');
      var pad = gut.querySelector('.cg-pad');
      if (!stick) return;
      var arms = [];
      if (pad) {
        arms[UP] = pad.querySelector('.cg-pu');
        arms[LEFT] = pad.querySelector('.cg-pl');
        arms[DOWN] = pad.querySelector('.cg-pd');
        arms[RIGHT] = pad.querySelector('.cg-pr');
      }
      var S = {
        side: side, gut: gut, stick: stick, pad: pad, arms: arms,
        nub: stick.querySelector('.cg-nub'),
        id: null, ox: 0, oy: 0, r: 60, lastDir: -1, dragging: false,
        ringDriven: true, homeX: 0, homeY: 0, padX: 0, padY: 0, padR: 74,
        mode: 'pad'
      };
      sticks[side] = S;
      gut.addEventListener('pointerdown', function (e) { padDown(S, e); });
      gut.addEventListener('pointermove', function (e) { padMove(S, e); });
      gut.addEventListener('pointerup', function (e) { padUp(S, e); });
      gut.addEventListener('pointercancel', function (e) { padUp(S, e); });
    }

    function readSafe(which) {
      if (!probe) return 24;
      try {
        var cs = getComputedStyle(probe);
        var v = parseFloat(which === 'l' ? cs.paddingLeft : cs.paddingRight) || 0;
        return Math.max(v, 24);
      } catch (e) { return 24; }
    }

    function layout() {
      var portrait = mqPortrait.matches;
      var d = portrait
        ? clamp(104, 0.30 * (window.innerWidth || 360), 148)
        : clamp(104, 0.26 * (window.innerHeight || 360), 148);
      var r = d / 2;
      ['l', 'r'].forEach(function (side) {
        var S = sticks[side];
        if (!S) return;
        var w = S.gut.clientWidth, h = S.gut.clientHeight;
        S.r = r;
        S.stick.style.setProperty('--ring', d + 'px');
        if (w < 20 || h < 20) return;
        var safe = readSafe(side);
        var off = Math.max(safe + r + 6, w * (portrait ? 0.42 : 0.45));
        var cx = side === 'l' ? off : w - off;
        cx = clamp(r + 8, cx, Math.max(r + 8, w - r - 8));
        var cy = h * (portrait ? 0.50 : 0.62);
        cy = clamp(r + 8, cy, Math.max(r + 8, h - r - 8));

        S.padR = d * 0.5;
        S.padX = cx; S.padY = cy;
        if (S.pad) {
          S.pad.style.setProperty('--pad', d + 'px');
          S.pad.style.left = (cx - S.padR) + 'px';
          S.pad.style.top = (cy - S.padR) + 'px';
        }
        S.homeX = cx; S.homeY = cy;
        S.stick.style.left = (cx - r) + 'px';
        S.stick.style.top = (cy - r) + 'px';
        if (S.id === null) {
          S.ox = cx; S.oy = cy;
          S.stick.style.transform = 'translate3d(0,0,0)';
        }
      });
    }

    /* ── swipe on the playfield ────────────────────────────────────── */

    var swipe = null;

    function fieldDown(e) {
      /* The overlay sits inside the field, so a press on one of its buttons
         reaches this handler too. Without the guard, tapping a control on the
         start card would also start the run on the same touch. */
      if (e.target && e.target.closest && e.target.closest('[data-act]')) return;
      swipe = { id: e.pointerId, ax: e.clientX, ay: e.clientY, lastDir: -1 };
      if (e.cancelable && mqTouch.matches) e.preventDefault();
      onEngage();
    }

    /* No dead wedge. Requiring one axis to beat the other by 1.5x discarded
       22.6 degrees on each diagonal — 90 degrees of the circle, a quarter of
       every possible swipe, silently. A four-way game has no diagonals to
       disambiguate. */
    function fieldMove(e) {
      if (!swipe || swipe.id !== e.pointerId) return;
      var dx = e.clientX - swipe.ax, dy = e.clientY - swipe.ay;
      if (Math.hypot(dx, dy) < 24) return;
      if (commitVec(swipe, dx, dy)) { swipe.ax = e.clientX; swipe.ay = e.clientY; }
    }

    function fieldUp(e) { if (swipe && swipe.id === e.pointerId) swipe = null; }

    /* ── keyboard ──────────────────────────────────────────────────── */

    /* The game claims a key only when it is actually on screen, so a visitor
       reading the footer does not find space and the arrows hijacked. */
    function engaged() {
      if (shell.contains(document.activeElement)) return true;
      if (document.body.classList.contains('cuna-playing')) return true;
      var r = shell.getBoundingClientRect();
      return r.bottom > 0 && r.top < (window.innerHeight || document.documentElement.clientHeight);
    }

    function keyHandler(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!engaged()) return;
      var k = e.key;
      var d = -1;
      if (k === 'ArrowUp' || k === 'w' || k === 'W') d = UP;
      else if (k === 'ArrowLeft' || k === 'a' || k === 'A') d = LEFT;
      else if (k === 'ArrowDown' || k === 's' || k === 'S') d = DOWN;
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') d = RIGHT;
      if (d >= 0) {
        setDir(d);
        if (e.cancelable) e.preventDefault();
        onEngage();
        return;
      }
      if (onKey(k, e) && e.cancelable) e.preventDefault();
    }

    /* ── the chooser chips ─────────────────────────────────────────── */

    function optsHtml() {
      if (!mqTouch.matches) return '';
      return '<div class="cg-opts">' +
        '<button class="cg-swap" type="button" data-act="swapctl">' +
        '<span>' + (ctlSide === 'l' ? 'STICK LEFT' : 'D-PAD LEFT') + '</span>' +
        '<i>&#8644;</i>' +
        '<span>' + (ctlSide === 'l' ? 'D-PAD RIGHT' : 'STICK RIGHT') + '</span>' +
        '</button>' +
        '<button class="cg-swap" type="button" data-act="stickmode">' +
        '<span>STICK: ' + (stickFloats ? 'FOLLOWS' : 'FIXED') + '</span>' +
        '</button>' +
        '</div>';
    }

    /* Returns a toast string when it handled the action, else null. */
    function handleAct(a) {
      if (a === 'swapctl') {
        setCtlSide(ctlSide === 'l' ? 'r' : 'l');
        return ctlSide === 'l' ? 'STICK ON THE LEFT' : 'STICK ON THE RIGHT';
      }
      if (a === 'stickmode') {
        setStickFloats(!stickFloats);
        return stickFloats ? 'STICK FOLLOWS YOUR THUMB' : 'STICK STAYS PUT';
      }
      return null;
    }

    /* ── wire up ───────────────────────────────────────────────────── */

    mkStick('l', o.gutL);
    mkStick('r', o.gutR);
    readPrefs();

    if (field) {
      field.addEventListener('pointerdown', fieldDown);
      field.addEventListener('pointermove', fieldMove);
      field.addEventListener('pointerup', fieldUp);
      field.addEventListener('pointercancel', fieldUp);
    }
    document.addEventListener('keydown', keyHandler);

    return {
      UP: UP, LEFT: LEFT, DOWN: DOWN, RIGHT: RIGHT, DX: DX, DY: DY,
      layout: layout,
      setDir: setDir,
      setChev: setChev,
      lightArm: lightArm,
      optsHtml: optsHtml,
      handleAct: handleAct,
      engaged: engaged,
      isTouch: function () { return mqTouch.matches; },
      dir: function () { return curDir; }
    };
  }

  return { create: create, UP: UP, LEFT: LEFT, DOWN: DOWN, RIGHT: RIGHT, DX: DX, DY: DY };
})();
