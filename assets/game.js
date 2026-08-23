/* TONGUE RUSH — the $CUNA chart-eating game.
   One file, no deps, no build step. Canvas 2D, everything drawn in code.
   It is a toy. It awards nothing. */
(function () {
  'use strict';

  /* ───────────────────────── CONST ───────────────────────── */

  var C = {
    ink: '#24040f', plum: '#3d0a26', plum2: '#520f33', plum3: '#6b1444',
    mouthDark: '#2b0512',
    pink: '#ff2e88', pink2: '#ff5fa2', pink3: '#ff8fc0', pinkDeep: '#c2185b',
    floor: '#320820',
    cream: '#ffeccb', cream2: '#fff7e6', mint: '#14f195', red: '#ff5c5c'
  };

  const COLS = 21, ROWS = 23;
  const STEP = 1 / 60;
  const TURN_WINDOW = 0.45;
  /* The shell halves hinge at the back tip, so a given angle splays the mouth
     much wider than a centre pivot would. 0.38 rad reads as the same chomp. */
  const MAX_OPEN = 0.38;
  const UP = 0, LEFT = 1, DOWN = 2, RIGHT = 3;
  const DX = [0, -1, 0, 1];
  const DY = [-1, 0, 1, 0];
  const OPP = [2, 3, 0, 1];
  const TOTAL_EDIBLES = 212;
  /* The storage key keeps its original name on purpose. Renaming it to match
     the game's new title would silently reset every player's personal best,
     which is a real cost for no benefit — nobody sees this. */
  const BEST_KEY = 'cuna_munch_best';

  /* speed table: [player, playerEating, chaser, frightened, tunnel] tiles/sec */
  function speeds(course) {
    if (course <= 1) return [6.80, 6.05, 6.40, 3.40, 2.70];
    if (course <= 4) return [7.40, 6.55, 7.00, 3.70, 3.00];
    if (course <= 8) return [8.00, 7.10, 7.60, 4.00, 3.40];
    return [8.00, 7.10, 7.70, 4.20, 3.60];
  }
  const EYE_SPEED = 14.0;

  function frightDur(course) {
    const t = [7, 7, 6, 5, 4, 3, 2.5, 2, 2];
    return t[Math.min(course, 8)];
  }

  function phaseTable(course) {
    if (course <= 1) return [7, 20, 7, 20, 5, 20, 5];
    if (course <= 4) return [7, 20, 7, 20, 5, 25, 5];
    return [5, 20, 5, 20, 5, 25, 5];
  }

  function bonusValue(course) {
    if (course <= 2) return 100;
    if (course <= 4) return 300;
    if (course <= 6) return 500;
    return 1000;
  }

  /* ───────────────────────── MAZE ───────────────────────── */

  const MAZE = [
    '#####################',
    '#.........#.........#',
    '#o##.####.#.####.##o#',
    '#.##.####.#.####.##.#',
    '#...................#',
    '#.###.#.#####.#.###.#',
    '#.###.#.#####.#.###.#',
    '#.....#..:::..#.....#',
    '#.###.#.##-##.#.###.#',
    '#.###.#.#GGG#.#.###.#',
    ' .......#GGG#....... ',
    '#.###.#.#####.#.###.#',
    '#.###.#.......#.###.#',
    '#.###.##.#.#.##.###.#',
    '#.###.##.#.#.##.###.#',
    '#.........:.........#',
    '#.####.##.#.##.####.#',
    '#.####.##.#.##.####.#',
    '#o.................o#',
    '#.##.####.#.####.##.#',
    '#.##.####.#.####.##.#',
    '#...................#',
    '#####################'
  ];

  const SPAWN = { x: 10, y: 15 };
  const DOOR = { x: 10, y: 8 };
  const HOUSE_EXIT = { x: 10, y: 7 };
  const HOUSE_MID = { x: 10, y: 9.5 };
  const BONUS_TILE = { x: 10, y: 12 };
  const SCATTER = [{ x: 18, y: -3 }, { x: 2, y: -3 }, { x: 18, y: 25 }, { x: 2, y: 25 }];
  /* index order matches CH order below: JEET, RUGGY, FUDD, PAPER */

  /* ─────────────────── tile helpers ─────────────────── */

  function tileAt(tx, ty) {
    if (ty === 10) { tx = ((tx % COLS) + COLS) % COLS; }
    if (tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS) return '#';
    return MAZE[ty][tx];
  }
  function playerWalk(tx, ty) {
    const c = tileAt(tx, ty);
    return c === '.' || c === 'o' || c === ':' || c === ' ';
  }
  /* normal chasers may not enter the house or the door */
  function chaserWalk(tx, ty) { return playerWalk(tx, ty); }
  /* eyes / house traffic may */
  function ghostWalk(tx, ty) {
    const c = tileAt(tx, ty);
    return c === '.' || c === 'o' || c === ':' || c === ' ' || c === 'G' || c === '-';
  }
  function wrapX(e) {
    if (Math.round(e.y) !== 10) return;
    if (e.x < -0.5) e.x += COLS;
    else if (e.x > COLS - 0.5) e.x -= COLS;
  }
  function inTunnelSlow(x, y) {
    if (Math.round(y) !== 10) return false;
    const tx = Math.round(x);
    return tx <= 2 || tx >= 18;
  }

  /* ─────────────────── BFS eye field ─────────────────── */

  const EYEF = new Int16Array(COLS * ROWS).fill(9999);
  (function buildEyeField() {
    const q = [DOOR.x + DOOR.y * COLS];
    EYEF[q[0]] = 0;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % COLS, y = (i / COLS) | 0, d = EYEF[i];
      for (let k = 0; k < 4; k++) {
        let nx = x + DX[k], ny = y + DY[k];
        if (y === 10) { if (nx < 0) nx += COLS; else if (nx >= COLS) nx -= COLS; }
        if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
        const j = nx + ny * COLS;
        if (EYEF[j] <= d + 1) continue;
        if (!ghostWalk(nx, ny)) continue;
        EYEF[j] = d + 1; q.push(j);
      }
    }
  })();

  /* ─────────────────── run / course state ─────────────────── */

  const pellets = new Uint8Array(COLS * ROWS); /* 1 = taco, 2 = loaded taco */
  let pelletsLeft = 0;
  let pelletPath = null, fillingPath = null, garnishPath = null, pelletDirty = true;

  function resetPellets() {
    pelletsLeft = 0;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const c = MAZE[y][x], i = x + y * COLS;
      pellets[i] = c === '.' ? 1 : c === 'o' ? 2 : 0;
      if (pellets[i]) pelletsLeft++;
    }
    pelletDirty = true;
  }

  /* ─────────────────── DOM ─────────────────── */

  const $ = function (id) { return document.getElementById(id); };
  const el = {};

  /* ─────────────────── layout / canvas ─────────────────── */

  let TILE = 16, DPR = 1, dprCap = 2;
  let layoutMode = 'desktop';
  let inputMode = 'desktop';
  let RM = false;

  const mqTouch = window.matchMedia('(hover:none) and (pointer:coarse)');
  const mqPortrait = window.matchMedia('(orientation: portrait)');
  const mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function clamp(a, v, b) { return v < a ? a : v > b ? b : v; }

  let mazeCan = null, mazeCtx = null, pulseCan = null, pulseCtx = null;
  let pelletCan = null, pelletCtx = null;

  /* ───────────────────── sprite atlas ─────────────────────
     One WebP, nine 256px cells, drawn art rather than canvas paths. Every
     draw falls back to the path version if the atlas has not arrived — an
     older browser without WebP, a blocked request, anything. The game is
     fully playable either way; it just looks hand-drawn instead of rendered. */
  const SPR = {
    img: null, ready: false, cell: 256,
    map: { open: [0,0], closed: [1,0], power: [2,0], pellet: [3,0], jeet: [4,0],
           ruggy: [0,1], fudd: [1,1], paper: [2,1], fright: [3,1] }
  };

  function loadSprites() {
    try {
      const img = new Image();
      img.decoding = 'async';
      img.onload = function () {
        SPR.img = img; SPR.ready = true;
        pelletDirty = true;
        /* the HUD icons were painted before this arrived */
        try { paintLives(); buildLegend(); } catch (e) { }
      };
      img.onerror = function () { SPR.ready = false; };
      img.src = 'assets/sprites.webp';
    } catch (e) { SPR.ready = false; }
  }

  /* size is the sprite's box in css px. flip mirrors horizontally, which is
     how the player faces left without being drawn upside down. */
  function drawSprite(g, name, cx, cy, size, rot, flip, alpha) {
    if (!SPR.ready) return false;
    const c = SPR.map[name]; if (!c) return false;
    const N = SPR.cell;
    g.save();
    g.translate(cx, cy);
    if (rot) g.rotate(rot);
    if (flip) g.scale(-1, 1);
    if (alpha != null) g.globalAlpha = alpha;
    g.drawImage(SPR.img, c[0] * N, c[1] * N, N, N, -size / 2, -size / 2, size, size);
    g.restore();
    return true;
  }

  function layout() {
    const shell = el.shell;
    const isTouch = mqTouch.matches && inputMode === 'touch';
    const portrait = mqPortrait.matches;
    layoutMode = !isTouch ? 'desktop' : (portrait ? 'portrait-touch' : 'landscape-touch');

    const shellW = shell.clientWidth || 320;
    const shellH = shell.clientHeight || 480;
    let availW, availH, tmin, tmax;

    if (layoutMode === 'portrait-touch') {
      /* Must match the deck row in the portrait grid rule, or the canvas can
         be sized taller than the space the grid actually leaves it. */
      const deck = clamp(240, 0.34 * shellH, 330);
      availW = shellW - 10;
      availH = shellH - 46 - deck - 12;
      tmin = 10; tmax = 28;
    } else if (layoutMode === 'landscape-touch') {
      const gut = clamp(132, 0.17 * shellW, 210);
      availW = shellW - 2 * gut - 16;
      availH = shellH - 40 - 12;
      tmin = 10; tmax = 28;
    } else {
      const pageW = document.documentElement.clientWidth || 1024;
      availW = Math.min(pageW - 32, 1120) - 480 - 32;
      availH = clamp(400, 0.66 * (window.innerHeight || 800), 624);
      tmin = 14; tmax = 30;
    }

    const t = clamp(tmin, Math.floor(Math.min(availW / COLS, availH / ROWS)), tmax);
    const changed = t !== TILE;
    TILE = t;

    DPR = Math.min(window.devicePixelRatio || 1, dprCap);
    const cw = COLS * TILE, ch = ROWS * TILE;
    const cv = el.canvas;
    cv.width = Math.round(cw * DPR); cv.height = Math.round(ch * DPR);
    cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
    el.ctx = cv.getContext('2d');
    el.ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    el.field.style.setProperty('--cg-w', cw + 'px');

    prerenderMaze();
    placeSticks();
    if (changed) { pelletDirty = true; shellGrad = null; bigShellGrad = null; }
  }

  function prerenderMaze() {
    const w = Math.round(COLS * TILE * DPR), h = Math.round(ROWS * TILE * DPR);
    if (!mazeCan) { mazeCan = document.createElement('canvas'); pulseCan = document.createElement('canvas'); }
    mazeCan.width = w; mazeCan.height = h;
    pulseCan.width = w; pulseCan.height = h;
    mazeCtx = mazeCan.getContext('2d');
    pulseCtx = pulseCan.getContext('2d');
    const g = mazeCtx;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    pulseCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const T = TILE;

    /* 1. chart gridlines, well behind everything edible */
    g.save();
    g.globalAlpha = 0.4; g.strokeStyle = C.plum3; g.lineWidth = 2;
    [4.5, 10.5, 18.5].forEach(function (ry) {
      g.beginPath(); g.moveTo(0, ry * T); g.lineTo(COLS * T, ry * T); g.stroke();
    });
    g.restore();

    /* 2. wall ink shadow */
    g.fillStyle = C.ink;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++)
      if (MAZE[y][x] === '#') g.fillRect(x * T, y * T + 3, T, T);

    /* 3. wall fill */
    g.fillStyle = C.plum2;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++)
      if (MAZE[y][x] === '#') g.fillRect(x * T, y * T, T, T);

    /* 4. top bevel */
    g.fillStyle = C.pinkDeep;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++)
      if (MAZE[y][x] === '#' && (y === 0 || MAZE[y - 1][x] !== '#')) g.fillRect(x * T, y * T, T, 3);

    /* 5. outline only the edges that touch open floor.
       The path is built once and stroked three times: a wide soft neon bloom,
       a tighter hot core, then the ink line on top. shadowBlur is normally
       banned here — the site's identity is a hard unblurred drop shadow — but
       this is baked into the prerendered maze once per layout, not per frame,
       and the flat walls were the one thing still looking painted next to the
       glossy sprites. */
    const edge = new Path2D();
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (MAZE[y][x] !== '#') continue;
      const X = x * T, Y = y * T;
      if (y === 0 || MAZE[y - 1][x] !== '#') { edge.moveTo(X, Y); edge.lineTo(X + T, Y); }
      if (y === ROWS - 1 || MAZE[y + 1][x] !== '#') { edge.moveTo(X, Y + T); edge.lineTo(X + T, Y + T); }
      if (x === 0 || MAZE[y][x - 1] !== '#') { edge.moveTo(X, Y); edge.lineTo(X, Y + T); }
      if (x === COLS - 1 || MAZE[y][x + 1] !== '#') { edge.moveTo(X + T, Y); edge.lineTo(X + T, Y + T); }
    }
    g.save();
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.shadowColor = C.pink;
    g.shadowBlur = Math.max(6, T * 0.55);
    g.strokeStyle = 'rgba(255,46,136,.55)';
    g.lineWidth = Math.max(2, T * 0.10);
    g.stroke(edge);
    g.stroke(edge);
    g.shadowBlur = Math.max(3, T * 0.22);
    g.strokeStyle = 'rgba(255,143,192,.9)';
    g.lineWidth = Math.max(1.5, T * 0.055);
    g.stroke(edge);
    g.restore();

    g.strokeStyle = C.ink; g.lineWidth = 3; g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath();
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (MAZE[y][x] !== '#') continue;
      const X = x * T, Y = y * T;
      if (y === 0 || MAZE[y - 1][x] !== '#') { g.moveTo(X, Y); g.lineTo(X + T, Y); }
      if (y === ROWS - 1 || MAZE[y + 1][x] !== '#') { g.moveTo(X, Y + T); g.lineTo(X + T, Y + T); }
      if (x === 0 || MAZE[y][x - 1] !== '#') { g.moveTo(X, Y); g.lineTo(X, Y + T); }
      if (x === COLS - 1 || MAZE[y][x + 1] !== '#') { g.moveTo(X + T, Y); g.lineTo(X + T, Y + T); }
    }
    g.stroke();

    /* 6. candle wicks on tall single-width vertical wall runs */
    g.strokeStyle = C.plum3; g.lineWidth = 2;
    g.beginPath();
    for (let x = 1; x < COLS - 1; x++) {
      let y = 0;
      while (y < ROWS) {
        if (MAZE[y][x] !== '#' || MAZE[y][x - 1] === '#' || MAZE[y][x + 1] === '#') { y++; continue; }
        let y2 = y;
        while (y2 < ROWS && MAZE[y2][x] === '#' && MAZE[y2][x - 1] !== '#' && MAZE[y2][x + 1] !== '#') y2++;
        if (y2 - y >= 3) {
          const cx = (x + 0.5) * T;
          g.moveTo(cx, (y - 0.35) * T); g.lineTo(cx, y * T);
          g.moveTo(cx, y2 * T); g.lineTo(cx, (y2 + 0.35) * T);
        }
        y = y2 + 1;
      }
    }
    g.stroke();

    /* 7. tunnel mouths fade out */
    const gl = g.createLinearGradient(0, 0, T, 0);
    gl.addColorStop(0, C.floor); gl.addColorStop(1, 'rgba(50,8,32,0)');
    g.fillStyle = gl; g.fillRect(0, 10 * T, T, T);
    const gr = g.createLinearGradient(COLS * T, 0, (COLS - 1) * T, 0);
    gr.addColorStop(0, C.floor); gr.addColorStop(1, 'rgba(50,8,32,0)');
    g.fillStyle = gr; g.fillRect((COLS - 1) * T, 10 * T, T, T);

    /* ghost-house door */
    g.fillStyle = C.pink3;
    g.fillRect(9.6 * T, (8 + 0.42) * T, 1.8 * T, Math.max(3, 0.16 * T));
    g.strokeStyle = C.ink; g.lineWidth = 2;
    g.strokeRect(9.6 * T, (8 + 0.42) * T, 1.8 * T, Math.max(3, 0.16 * T));

    /* pulse layer for PLATE CLEAN */
    const p = pulseCtx;
    p.fillStyle = C.pinkDeep;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++)
      if (MAZE[y][x] === '#') p.fillRect(x * T, y * T, T, T);
  }

  /* ───────────────────────── ART ─────────────────────────
     No images, no shadowBlur, no filters. The site's identity is a hard
     unblurred drop shadow straight down, so every sprite is drawn twice:
     once as an ink silhouette 3px lower, once for real. Shadows for a whole
     layer go down first so they never stack on each other. */

  let lipGrad = null, tongueGrad = null, shellGrad = null, bigShellGrad = null;

  /* Two shell halves hinged at the BACK TIP, not the centre. A centre pivot
     leaves a notch behind the hinge and strokes both fold edges into an X
     across the face; hinging at the tip makes the fold edges meet in a single
  /* ── the player: lips and tongue ──────────────────────────────────────
     Serves the player, the life icons and the title card.

     The chomp is two lip halves hinged at the back corner of the mouth,
     rotating apart by `open` — the same trick the taco shell used, which is
     what makes a Pac-Man read as a Pac-Man. The tongue rides underneath and
     lolls further out in TONGUE OUT mode.                                  */

  function lipHalf(g, s) {
    /* One lip, drawn corner-to-corner. s = +1 lower, -1 upper. The cupid's-bow
       dip on the upper lip is what stops it reading as a plain crescent.
       Deliberately FAT: thin lens shapes left the character mostly dark mouth
       cavity at maze scale, where the reference art is mostly lip. */
    g.moveTo(-1.0, 0);
    g.quadraticCurveTo(-0.70, s * 0.46, -0.20, s * 0.64);
    g.quadraticCurveTo(0.10, s * 0.76, 0.46, s * 0.60);
    g.quadraticCurveTo(0.88, s * 0.40, 1.02, s * 0.06);
    g.quadraticCurveTo(1.07, s * 0.01, 1.0, 0);
    g.closePath();
  }

  function buildMouth(g, open) {
    g.beginPath();
    for (let k = 0; k < 2; k++) {
      const s = k ? -1 : 1;
      g.save();
      g.translate(-1.0, 0); g.rotate(s * open); g.translate(1.0, 0);
      lipHalf(g, s);
      g.restore();
    }
  }

  function drawMouth(g, px, py, dir, open, opt) {
    opt = opt || {};
    const T = opt.tile || TILE;
    const r = T * 0.52;
    const LW = Math.max(2, Math.min(3.4, T * 0.14));
    const closed = 1 - Math.min(1, open / MAX_OPEN);
    const shadow = !!opt.shadow;
    const spin = opt.spin || 0, shrink = opt.shrink == null ? 1 : opt.shrink;
    const detail = T >= 17;

    g.save();
    g.translate(px, py + (shadow ? 3 : 0));
    if (spin) g.rotate(spin);
    if (shrink !== 1) g.scale(shrink, shrink);
    g.save();
    if (dir === LEFT) g.scale(-1, 1);
    else if (dir === UP) g.rotate(-Math.PI / 2);
    else if (dir === DOWN) g.rotate(Math.PI / 2);
    g.scale(r, r);
    g.lineWidth = LW / r;
    if (!shadow && !RM) g.scale(1 + 0.09 * closed, 1 - 0.09 * closed);

    if (shadow) {
      buildMouth(g, open);
      g.fillStyle = C.ink; g.fill();
      g.restore(); g.restore();
      return;
    }

    /* 1. Mouth cavity. A dark wedge behind the lips, so an open mouth reads as
          a mouth rather than as a gap with the maze showing through. */
    if (open > 0.02) {
      g.save();
      g.beginPath();
      g.moveTo(-0.55, 0);
      g.arc(-0.55, 0, 1.62, -open * 1.02, open * 1.02);
      g.closePath();
      g.fillStyle = C.mouthDark; g.fill();
      g.restore();
    }

    /* 2. Tongue, sitting in the cavity and lolling out of the lower lip. */
    const reach = opt.tongue ? 1.62 : 1.02;
    const tw = 0.66;
    g.save();
    g.translate(0, 0.13);
    if (!tongueGrad) {
      tongueGrad = g.createLinearGradient(0, -tw / 2, 0, tw / 2);
      tongueGrad.addColorStop(0, C.pink2);
      tongueGrad.addColorStop(0.55, C.pink3);
      tongueGrad.addColorStop(1, C.pinkDeep);
    }
    g.beginPath();
    if (g.roundRect) g.roundRect(-0.44, -tw / 2, reach + 0.44, tw, tw / 2);
    else g.rect(-0.44, -tw / 2, reach + 0.44, tw);
    g.fillStyle = tongueGrad; g.fill();
    g.strokeStyle = C.ink; g.lineWidth = LW / r; g.stroke();
    if (detail) {
      /* centre crease + two gloss blobs — the thing that says "wet" */
      g.strokeStyle = 'rgba(120,10,60,.55)'; g.lineWidth = Math.max(1.3, LW * 0.5) / r; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-0.12, 0); g.lineTo(reach - 0.30, 0); g.stroke();
      g.fillStyle = 'rgba(255,255,255,.40)';
      g.beginPath(); g.ellipse(reach * 0.55, -0.15, reach * 0.17, 0.06, -0.10, 0, 6.2832); g.fill();
    }
    g.restore();

    /* 3. Lips, one half at a time: gradient body, teeth clipped inside the
          upper, then a specular streak along the outer curve. */
    if (!lipGrad) {
      lipGrad = g.createLinearGradient(0, -1.1, 0, 1.1);
      lipGrad.addColorStop(0, '#ff4f97');
      lipGrad.addColorStop(0.45, C.pink);
      lipGrad.addColorStop(1, '#a01050');
    }
    for (let k = 0; k < 2; k++) {
      const sd = k ? -1 : 1;
      g.save();
      g.translate(-1.0, 0); g.rotate(sd * open); g.translate(1.0, 0);

      g.beginPath(); lipHalf(g, sd);
      g.fillStyle = lipGrad; g.fill();

      g.save();
      g.beginPath(); lipHalf(g, sd); g.clip();

      /* teeth ride the upper lip only, as in the art */
      if (detail && sd < 0) {
        g.fillStyle = C.cream2;
        g.beginPath();
        g.moveTo(-0.52, 0.02);
        g.quadraticCurveTo(0.12, -0.26, 0.84, 0.02);
        g.lineTo(0.84, -0.17);
        g.quadraticCurveTo(0.12, -0.46, -0.52, -0.15);
        g.closePath(); g.fill();
        if (T >= 24) {
          g.strokeStyle = 'rgba(120,10,60,.35)'; g.lineWidth = 1.1 / r;
          for (let i = -1; i <= 1; i++) {
            const tx = 0.14 + i * 0.30;
            g.beginPath(); g.moveTo(tx, -0.05); g.lineTo(tx + 0.03, -0.24); g.stroke();
          }
        }
      }

      /* specular streak — the single thing that reads as "glossy" */
      if (detail) {
        g.fillStyle = 'rgba(255,255,255,.34)';
        g.beginPath();
        g.ellipse(-0.16, sd * 0.44, 0.34, sd > 0 ? 0.070 : 0.080, sd > 0 ? 0.18 : -0.18, 0, 6.2832);
        g.fill();
      }
      g.restore();

      g.beginPath(); lipHalf(g, sd);
      g.strokeStyle = C.ink; g.lineWidth = LW / r; g.lineJoin = 'round'; g.stroke();
      g.restore();
    }
    g.restore();

    /* Wink sits in screen space so the face never reads upside-down. */
    if (T >= 15) {
      g.save();
      g.scale(r, r);
      g.strokeStyle = C.ink; g.lineWidth = Math.max(1.7, LW * 0.8) / r; g.lineCap = 'round';
      g.beginPath();
      if (opt.wink) { g.moveTo(-0.36, -0.92); g.quadraticCurveTo(-0.17, -0.74, 0.02, -0.92); }
      else { g.moveTo(-0.17, -1.00); g.lineTo(-0.17, -0.76); }
      g.stroke();
      g.restore();
    }
    g.restore();
  }
  /* ── chasers ── */

  function bodyPath(g, kind, cx, cy, T, hemPh) {
    const bob = RM ? 0 : Math.sin(hemPh) * 0.055 * T;
    g.beginPath();
    if (kind === 0) {                                  /* JEET — candle */
      const hw = 0.33 * T, top = cy - 0.55 * T, hemY = cy + 0.30 * T, bot = cy + 0.50 * T, r = 0.10 * T;
      g.moveTo(cx - hw, hemY);
      g.lineTo(cx - hw, top + r);
      g.quadraticCurveTo(cx - hw, top, cx - hw + r, top);
      g.lineTo(cx + hw - r, top);
      g.quadraticCurveTo(cx + hw, top, cx + hw, top + r);
      g.lineTo(cx + hw, hemY);
      const tw = (2 * hw) / 3;
      for (let i = 0; i < 3; i++) {
        const xR = cx + hw - i * tw, xM = xR - tw / 2, xL = xR - tw;
        const d = bot + (i % 2 ? -bob : bob);
        g.lineTo(xR, d); g.lineTo(xM, d); g.lineTo(xM, hemY); g.lineTo(xL, hemY);
      }
      g.closePath();
    } else if (kind === 1) {                           /* RUGGY — rug */
      const tw = 0.34 * T, bw = 0.52 * T, top = cy - 0.44 * T, hemY = cy + 0.34 * T, bot = cy + 0.50 * T, r = 0.08 * T;
      g.moveTo(cx - tw + r, top);
      g.lineTo(cx + tw - r, top);
      g.quadraticCurveTo(cx + tw, top, cx + tw + (bw - tw) * 0.15, top + r);
      g.lineTo(cx + bw, hemY);
      const n = 7, sp = (2 * bw) / (n - 1);
      for (let i = 0; i < n; i++) {
        const x = cx + bw - i * sp;
        const d = bot + (i % 2 ? -bob * 0.6 : bob * 0.6);
        g.lineTo(x + 1.2, hemY); g.lineTo(x, d); g.lineTo(x - 1.2, hemY);
      }
      g.lineTo(cx - bw, hemY);
      g.lineTo(cx - tw - (bw - tw) * 0.15, top + r);
      g.quadraticCurveTo(cx - tw, top, cx - tw + r, top);
      g.closePath();
    } else if (kind === 2) {                           /* FUDD — tongue */
      const hw = 0.33 * T, cyTop = cy - 0.22 * T, bot = cy + 0.36 * T;
      g.moveTo(cx - hw, cyTop);
      g.arc(cx, cyTop, hw, Math.PI, 0);
      g.lineTo(cx + hw, bot);
      g.quadraticCurveTo(cx + hw * 0.5, bot + 0.16 * T + bob, cx, bot + 0.02 * T);
      g.quadraticCurveTo(cx - hw * 0.5, bot + 0.14 * T - bob, cx - hw, bot);
      g.closePath();
    } else {                                           /* PAPER — crumpled sheet */
      const r = 0.44 * T, cyc = cy - 0.11 * T, hemY = cy + 0.30 * T, bot = cy + 0.50 * T;
      g.moveTo(cx - r, cyc);
      g.lineTo(cx - 0.38 * T, cy - 0.60 * T);
      g.lineTo(cx - 0.16 * T, cy - 0.46 * T);
      g.quadraticCurveTo(cx, cy - 0.66 * T, cx + 0.16 * T, cy - 0.46 * T);
      g.lineTo(cx + 0.38 * T, cy - 0.60 * T);
      g.lineTo(cx + r, cyc);
      g.lineTo(cx + r, hemY);
      const n = 6, sp = (2 * r) / n;
      for (let i = 0; i < n; i++) {
        const x1 = cx + r - i * sp - sp / 2, x2 = cx + r - (i + 1) * sp;
        g.lineTo(x1, bot + (i % 2 ? -bob : bob)); g.lineTo(x2, hemY);
      }
      g.closePath();
    }
  }

  /* sep, rx, ry, y — tuned per silhouette so no head is all eyes */
  const EYE = [
    { s: 0.155, rx: 0.112, ry: 0.142, y: -0.13 },
    { s: 0.180, rx: 0.118, ry: 0.130, y: -0.11 },
    { s: 0.150, rx: 0.106, ry: 0.140, y: -0.16 },
    { s: 0.180, rx: 0.126, ry: 0.146, y: -0.10 }
  ];
  function drawEyes(g, cx, cy, T, tdx, tdy, p) {
    p = p || EYE[0];
    const m = Math.hypot(tdx, tdy) || 1;
    const ox = (tdx / m) * 0.055 * T, oy = (tdy / m) * 0.055 * T;
    const lw = Math.max(1.6, 0.075 * T);
    for (let s = -1; s <= 1; s += 2) {
      const x = cx + s * p.s * T, y = cy + p.y * T;
      g.fillStyle = C.cream2; g.strokeStyle = C.ink; g.lineWidth = lw;
      g.beginPath(); g.ellipse(x, y, p.rx * T, p.ry * T, 0, 0, 6.2832); g.fill(); g.stroke();
      g.fillStyle = C.ink;
      g.beginPath(); g.arc(x + ox, y + oy, 0.062 * T, 0, 6.2832); g.fill();
    }
  }

  const CH_FILL = [C.red, C.pinkDeep, C.mint, C.cream2];
  /* chaser index -> atlas cell; kind is an index, not a name */
  const CH_SPRITE = ['jeet', 'ruggy', 'fudd', 'paper'];
  const CH_LW = [3, 3, 3, 3.5];

  function drawChaser(g, kind, cx, cy, T, o) {
    o = o || {};
    if (o.shadow) {
      if (o.mode === 'eyes') return;
      g.save(); g.translate(0, 3);
      bodyPath(g, kind, cx, cy, T, o.hemPh || 0);
      g.fillStyle = C.ink; g.fill();
      g.restore();
      return;
    }
    if (o.mode === 'eyes') {
      drawEyes(g, cx, cy, T, o.tdx || 0, o.tdy || 0, EYE[kind]);
      g.fillStyle = C.cream2;
      g.beginPath(); g.ellipse(cx, cy + 0.22 * T, 0.05 * T, 0.08 * T, 0, 0, 6.2832); g.fill();
      return;
    }
    const fright = o.fright;
    bodyPath(g, kind, cx, cy, T, o.hemPh || 0);
    g.fillStyle = fright ? (o.flash ? C.cream2 : C.plum3) : CH_FILL[kind];
    g.fill();
    g.strokeStyle = C.ink; g.lineWidth = CH_LW[kind]; g.lineJoin = 'round'; g.lineCap = 'round';
    g.stroke();

    if (!fright) {
      /* the one detail each silhouette gets */
      g.save();
      g.lineCap = 'round'; g.lineJoin = 'round';
      if (kind === 0) {
        g.strokeStyle = C.ink; g.lineWidth = Math.max(1.6, 0.07 * T);
        g.beginPath();
        g.moveTo(cx, cy - 0.56 * T); g.lineTo(cx, cy - 0.76 * T);
        g.moveTo(cx, cy + 0.51 * T); g.lineTo(cx, cy + 0.61 * T);
        g.stroke();
      } else if (kind === 1) {
        g.strokeStyle = C.plum3; g.lineWidth = Math.max(1.4, 0.055 * T);
        const d = 0.11 * T, my = cy + 0.19 * T;
        g.beginPath();
        g.moveTo(cx, my - d); g.lineTo(cx + d * 1.5, my); g.lineTo(cx, my + d); g.lineTo(cx - d * 1.5, my);
        g.closePath(); g.stroke();
      } else if (kind === 2) {
        g.strokeStyle = C.plum3; g.lineWidth = Math.max(1.4, 0.055 * T);
        g.beginPath(); g.moveTo(cx, cy + 0.08 * T); g.lineTo(cx, cy + 0.34 * T); g.stroke();
      } else {
        g.strokeStyle = C.pink3; g.lineWidth = Math.max(1.4, 0.06 * T);
        g.beginPath();
        g.moveTo(cx - 0.30 * T, cy - 0.30 * T); g.lineTo(cx + 0.26 * T, cy - 0.36 * T);
        g.moveTo(cx - 0.26 * T, cy + 0.16 * T); g.lineTo(cx + 0.32 * T, cy + 0.08 * T);
        g.stroke();
      }
      g.restore();
      drawEyes(g, cx, cy, T, o.tdx || 0, o.tdy || 0, EYE[kind]);
    } else {
      const ec = o.flash ? C.plum3 : C.cream;
      const ep = EYE[kind];
      g.strokeStyle = ec; g.lineWidth = Math.max(2, 0.1 * T); g.lineCap = 'round';
      for (let s = -1; s <= 1; s += 2) {
        const x = cx + s * ep.s * T, y = cy + ep.y * T, k = 0.085 * T;
        g.beginPath();
        g.moveTo(x - k, y - k); g.lineTo(x + k, y + k);
        g.moveTo(x + k, y - k); g.lineTo(x - k, y + k);
        g.stroke();
      }
      g.beginPath();
      const my = cy + 0.22 * T, mw = 0.26 * T;
      g.moveTo(cx - mw, my);
      g.lineTo(cx - mw / 2, my - 0.07 * T);
      g.lineTo(cx, my);
      g.lineTo(cx + mw / 2, my - 0.07 * T);
      g.lineTo(cx + mw, my);
      g.stroke();
    }
  }

  /* ── edibles ── */

  function drawLips(g, cx, cy, T, s) {
    const r = 0.30 * T * s;
    g.save(); g.translate(cx, cy); g.scale(r, r);
    g.lineWidth = 2 / r; g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(-1, -0.05);
    g.quadraticCurveTo(-0.55, -0.72, -0.16, -0.16);
    g.quadraticCurveTo(0, -0.34, 0.16, -0.16);
    g.quadraticCurveTo(0.55, -0.72, 1, -0.05);
    g.quadraticCurveTo(0.45, 0.86, 0, 0.86);
    g.quadraticCurveTo(-0.45, 0.86, -1, -0.05);
    g.closePath();
    g.fillStyle = C.pink; g.fill();
    g.strokeStyle = C.ink; g.stroke();
    g.fillStyle = C.pink3;
    g.beginPath(); g.arc(0, 0.28, 0.3, 0, Math.PI); g.fill();
    g.strokeStyle = C.ink; g.lineWidth = 1.6 / r; g.stroke();
    g.fillStyle = C.cream2;
    g.beginPath(); g.arc(-0.45, -0.12, 0.2, 0, 6.2832); g.fill();
    g.restore();
  }

  /* The energizer: the same taco as the pellets, scaled up and garnished, so
     it plainly reads as "the big one" rather than as a second character. The
     pink mascot taco was tried here first and looked too much like the
     player's lips at maze scale. */
  /* The energizer: the winking taco from the brand art, in full. Shell with a
     speckled gradient, a loaded filling edge, and a face. Only four on the
     board and they are the biggest edible on it, so it can afford the detail
     the pellets cannot. */
  function drawLoadedTaco(g, cx, cy, T, s) {
    const R = 0.46 * T * s;
    const LW = Math.max(2, Math.min(3, T * 0.11));
    const detail = T >= 16;
    g.save();
    g.translate(cx, cy + R * 0.16);
    g.lineJoin = 'round'; g.lineCap = 'round';

    /* shell */
    if (!bigShellGrad) {
      bigShellGrad = g.createLinearGradient(0, -R, 0, R);
      bigShellGrad.addColorStop(0, C.pink2);
      bigShellGrad.addColorStop(0.55, C.pink);
      bigShellGrad.addColorStop(1, C.pinkDeep);
    }
    g.beginPath();
    g.moveTo(-R, 0); g.arc(0, 0, R, Math.PI, 0, true); g.closePath();
    g.fillStyle = bigShellGrad; g.fill();

    /* filling along the top edge — the cubes and bits, abstracted to dots */
    g.save();
    g.beginPath(); g.moveTo(-R, 0); g.arc(0, 0, R, Math.PI, 0, true); g.closePath(); g.clip();
    g.fillStyle = C.cream;
    g.beginPath(); g.rect(-R, -R * 0.20, R * 2, R * 0.22); g.fill();
    if (detail) {
      const bits = [[-0.62, -0.30, C.mint], [-0.30, -0.42, C.cream2], [0.02, -0.34, '#ff8a3d'],
                    [0.34, -0.44, C.mint], [0.64, -0.30, '#ff8a3d']];
      for (let i = 0; i < bits.length; i++) {
        g.fillStyle = bits[i][2];
        g.beginPath(); g.arc(bits[i][0] * R, bits[i][1] * R, R * 0.15, 0, 6.2832); g.fill();
      }
    }
    /* shell speckles */
    if (T >= 20) {
      g.fillStyle = 'rgba(120,10,60,.35)';
      const sp = [[-0.45, 0.34], [-0.10, 0.52], [0.26, 0.30], [0.52, 0.52], [0.06, 0.16]];
      for (let i = 0; i < sp.length; i++) {
        g.beginPath(); g.arc(sp[i][0] * R, sp[i][1] * R, R * 0.055, 0, 6.2832); g.fill();
      }
    }
    g.restore();

    g.beginPath();
    g.moveTo(-R, 0); g.arc(0, 0, R, Math.PI, 0, true); g.closePath();
    g.strokeStyle = C.ink; g.lineWidth = LW; g.stroke();

    /* face: open eye, wink, grin with a tongue tip */
    if (detail) {
      g.fillStyle = C.cream2;
      g.beginPath(); g.arc(-R * 0.20, R * 0.34, R * 0.13, 0, 6.2832); g.fill();
      g.fillStyle = C.ink;
      g.beginPath(); g.arc(-R * 0.20, R * 0.34, R * 0.07, 0, 6.2832); g.fill();
      g.strokeStyle = C.ink; g.lineWidth = Math.max(1.4, LW * 0.6); g.lineCap = 'round';
      g.beginPath();
      g.moveTo(R * 0.24, R * 0.30); g.quadraticCurveTo(R * 0.38, R * 0.42, R * 0.52, R * 0.30);
      g.stroke();
      g.beginPath();
      g.moveTo(-R * 0.02, R * 0.60); g.quadraticCurveTo(R * 0.18, R * 0.74, R * 0.36, R * 0.58);
      g.stroke();
    }
    g.restore();
  }
  function drawSideOrder(g, cx, cy, T, course) {
    const k = course <= 2 ? 0 : course <= 4 ? 1 : course <= 6 ? 2 : 3;
    g.save();
    g.lineWidth = 3; g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = C.ink;
    if (k === 0) {
      g.fillStyle = C.mint;
      g.beginPath(); g.arc(cx, cy, 0.36 * T, 0, 6.2832); g.fill(); g.stroke();
      g.strokeStyle = C.cream; g.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        const a = -Math.PI / 2 + (i - 1.5) * 0.42;
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * 0.34 * T, cy + Math.sin(a) * 0.34 * T); g.stroke();
      }
    } else if (k === 1) {
      g.fillStyle = C.red;
      g.beginPath();
      g.moveTo(cx - 0.3 * T, cy - 0.1 * T);
      g.quadraticCurveTo(cx + 0.1 * T, cy - 0.42 * T, cx + 0.3 * T, cy + 0.1 * T);
      g.quadraticCurveTo(cx + 0.05 * T, cy + 0.42 * T, cx - 0.3 * T, cy - 0.1 * T);
      g.closePath(); g.fill(); g.stroke();
      g.strokeStyle = C.mint; g.lineWidth = 3;
      g.beginPath(); g.moveTo(cx - 0.3 * T, cy - 0.1 * T); g.lineTo(cx - 0.42 * T, cy - 0.34 * T); g.stroke();
    } else if (k === 2) {
      g.fillStyle = C.red;
      g.beginPath();
      if (g.roundRect) g.roundRect(cx - 0.2 * T, cy - 0.3 * T, 0.4 * T, 0.66 * T, 0.1 * T);
      else g.rect(cx - 0.2 * T, cy - 0.3 * T, 0.4 * T, 0.66 * T);
      g.fill(); g.stroke();
      g.fillStyle = C.cream; g.fillRect(cx - 0.2 * T, cy - 0.02 * T, 0.4 * T, 0.16 * T);
      g.fillStyle = C.ink; g.fillRect(cx - 0.09 * T, cy - 0.44 * T, 0.18 * T, 0.16 * T);
    } else {
      g.fillStyle = C.cream;
      g.beginPath(); g.arc(cx, cy, 0.38 * T, 0, 6.2832); g.fill(); g.stroke();
      drawLips(g, cx, cy + 0.02 * T, T * 0.72, 1);
    }
    g.restore();
  }

  /* ───────────────────── entities ───────────────────── */

  const P = { x: SPAWN.x, y: SPAWN.y, dir: LEFT, want: LEFT, dist: 0 };
  const CH_NAMES = ['JEET', 'RUGGY', 'FUDD', 'PAPER'];
  const chasers = [0, 1, 2, 3].map(function (k) {
    return {
      kind: k, x: 10, y: 9.5, dir: LEFT, mode: 'house', fright: false,
      houseT: 0, houseBob: 0, phase: k * 1.3, relP: 0, relT: 0
    };
  });

  /* ───────────────────── run state ───────────────────── */

  let state = 'attract', paused = false, over = false;
  let score = 0, best = 0, lives = 3, course = 1;
  let stateT = 0, readyQ = [], readyTxt = '';
  let courseT = 0, phaseIdx = 0, phaseT = 0, frightT = 0, frightDurCur = 0, frightMult = 0;
  let pelletsThisCourse = 0, pelletsThisLife = 0, graceT = 0;
  let bonusOn = false, bonusT = 0, bonusPops = 0;
  let freezeT = 0, playerFreeze = 0, lastEatT = -99;
  let shakeT = 0, shakeMag = 0, killer = -1;
  let extraGiven = false;
  let floats = [], clock = 0;
  let stats = { tacos: 0, chasers: 0, deaths: 0 };
  let hintDone = false;

  let bestAtStart = 0;

  function readBest() {
    try { const v = parseInt(localStorage.getItem(BEST_KEY), 10); if (isFinite(v) && v > 0) best = v; } catch (e) { }
  }
  function writeBest() {
    try { if (score > best) best = score; localStorage.setItem(BEST_KEY, String(best)); } catch (e) { }
  }

  /* ───────────────────── movement ───────────────────── */

  function movePlayer(adv) {
    /* 1 & 2 — turn buffer. `want` never expires and is never cleared. */
    let carry = 0;
    if (P.want !== P.dir) {
      if (P.want === OPP[P.dir]) {
        P.dir = P.want;
      } else {
        const tx = Math.round(P.x), ty = Math.round(P.y);
        let nx = tx + DX[P.want], ny = ty + DY[P.want];
        if (ty === 10) { if (nx < 0) nx += COLS; else if (nx >= COLS) nx -= COLS; }
        if (playerWalk(nx, ny)) {
          const horiz = DX[P.dir] !== 0;
          const off = horiz ? Math.abs(P.x - tx) : Math.abs(P.y - ty);
          if (off <= TURN_WINDOW) {
            if (horiz) P.x = tx; else P.y = ty;
            carry = Math.min(off, TURN_WINDOW);
            P.dir = P.want;
            if (!hintDone) { hintDone = true; if (el.hint) el.hint.classList.add('is-gone'); }
          }
        }
      }
    }
    /* 3 — advance, clamping at the tile centre when the way ahead is wall */
    adv += carry;
    const dx = DX[P.dir], dy = DY[P.dir];
    const tx = Math.round(P.x), ty = Math.round(P.y);
    let ax = tx + dx, ay = ty + dy;
    if (ty === 10) { if (ax < 0) ax += COLS; else if (ax >= COLS) ax -= COLS; }
    const before = { x: P.x, y: P.y };
    if (!playerWalk(ax, ay)) {
      if (dx > 0) P.x = Math.min(P.x + adv, tx);
      else if (dx < 0) P.x = Math.max(P.x - adv, tx);
      else if (dy > 0) P.y = Math.min(P.y + adv, ty);
      else P.y = Math.max(P.y - adv, ty);
    } else { P.x += dx * adv; P.y += dy * adv; }
    P.dist += Math.abs(P.x - before.x) + Math.abs(P.y - before.y);
    wrapX(P);
  }

  function ahead(px, py, d, n) {
    let x = px + DX[d] * n, y = py + DY[d] * n;
    if (d === UP) x -= n;   /* the original overflow bug, deliberately kept */
    return { x: x, y: y };
  }

  function isScatter() {
    const tbl = phaseTable(course);
    return phaseIdx < tbl.length && (phaseIdx % 2) === 0;
  }

  function target(c) {
    if (isScatter()) return SCATTER[c.kind];
    const px = Math.round(P.x), py = Math.round(P.y);
    if (c.kind === 0) return { x: px, y: py };
    if (c.kind === 1) return ahead(px, py, P.dir, 4);
    if (c.kind === 2) {
      const o = ahead(px, py, P.dir, 2);
      const j = chasers[0], jx = Math.round(j.x), jy = Math.round(j.y);
      return { x: jx + 2 * (o.x - jx), y: jy + 2 * (o.y - jy) };
    }
    const dd = (c.x - P.x) * (c.x - P.x) + (c.y - P.y) * (c.y - P.y);
    return dd >= 36 ? { x: px, y: py } : SCATTER[3];
  }

  function chooseDir(c) {
    const tx = Math.round(c.x), ty = Math.round(c.y);
    const back = OPP[c.dir];
    let bestK = -1, bestV = Infinity;
    if (c.mode === 'eyes') {
      for (let k = 0; k < 4; k++) {
        let nx = tx + DX[k], ny = ty + DY[k];
        if (ty === 10) { if (nx < 0) nx += COLS; else if (nx >= COLS) nx -= COLS; }
        if (!ghostWalk(nx, ny)) continue;
        const v = EYEF[nx + ny * COLS];
        if (v < bestV) { bestV = v; bestK = k; }
      }
    } else if (c.fright) {
      const opts = [];
      for (let k = 0; k < 4; k++) {
        if (k === back) continue;
        let nx = tx + DX[k], ny = ty + DY[k];
        if (ty === 10) { if (nx < 0) nx += COLS; else if (nx >= COLS) nx -= COLS; }
        if (chaserWalk(nx, ny)) opts.push(k);
      }
      bestK = opts.length ? opts[(Math.random() * opts.length) | 0] : back;
    } else {
      const t = target(c);
      for (let k = 0; k < 4; k++) {
        if (k === back) continue;
        let nx = tx + DX[k], ny = ty + DY[k];
        if (ty === 10) { if (nx < 0) nx += COLS; else if (nx >= COLS) nx -= COLS; }
        if (!chaserWalk(nx, ny)) continue;
        const ddx = nx - t.x, ddy = ny - t.y, v = ddx * ddx + ddy * ddy;
        if (v < bestV) { bestV = v; bestK = k; }
      }
      if (bestK < 0) bestK = back;
    }
    c.dir = bestK < 0 ? back : bestK;
  }

  function chaserSpeed(c) {
    const sp = speeds(course);
    if (c.mode === 'eyes') return EYE_SPEED;
    let v;
    if (c.fright) v = sp[3];
    else {
      v = sp[2];
      if (c.kind === 0) {
        const rem = pelletsLeft / TOTAL_EDIBLES;
        v += rem <= 0.10 ? 0.25 : rem <= 0.20 ? 0.15 : 0;
      }
    }
    if (inTunnelSlow(c.x, c.y)) v = Math.min(v, sp[4]);
    return Math.min(v, sp[0] - 0.15);
  }

  function moveChaser(c, dt) {
    if (c.mode === 'house') {
      c.houseBob += dt;
      c.y = HOUSE_MID.y + (RM ? 0 : 0.35 * Math.sin(c.houseBob * Math.PI * 2 * 1.2 + c.phase));
      return;
    }
    if (c.mode === 'exiting') {
      const s = 4.6 * dt;
      if (Math.abs(c.x - 10) > 1e-4) c.x += Math.sign(10 - c.x) * Math.min(s, Math.abs(10 - c.x));
      else if (c.y > HOUSE_EXIT.y + 1e-4) c.y = Math.max(HOUSE_EXIT.y, c.y - s);
      else { c.x = 10; c.y = HOUSE_EXIT.y; c.mode = 'normal'; c.dir = LEFT; c.fright = frightT > 0; }
      return;
    }
    if (c.mode === 'entering') {
      const s = 7 * dt;
      c.x = 10;
      if (c.y < HOUSE_MID.y) c.y = Math.min(HOUSE_MID.y, c.y + s);
      else { c.y = HOUSE_MID.y; c.mode = 'house'; c.houseT = 0; c.houseBob = 0; c.relP = -1; c.relT = 0.6; c.fright = false; }
      return;
    }
    let adv = chaserSpeed(c) * dt, guard = 0;
    while (adv > 1e-9 && guard++ < 10) {
      const dx = DX[c.dir], dy = DY[c.dir];
      const cur = dx ? c.x : c.y;
      const fwd = dx > 0 || dy > 0;
      const next = fwd ? Math.floor(cur + 1e-6) + 1 : Math.ceil(cur - 1e-6) - 1;
      const d2n = Math.abs(next - cur);
      if (adv < d2n - 1e-9) {
        c.x += dx * adv; c.y += dy * adv; adv = 0; wrapX(c);
      } else {
        if (dx) { c.x = next; c.y = Math.round(c.y); } else { c.y = next; c.x = Math.round(c.x); }
        adv -= d2n; wrapX(c);
        if (c.mode === 'eyes' && Math.round(c.x) === DOOR.x && Math.round(c.y) === DOOR.y) { c.mode = 'entering'; return; }
        chooseDir(c);
      }
    }
  }

  function reverseAll() {
    for (let i = 0; i < 4; i++) {
      const c = chasers[i];
      if (c.mode !== 'normal' || c.fright) continue;
      c.dir = OPP[c.dir];
    }
  }

  /* ───────────────────── scoring ───────────────────── */

  function addScore(n) {
    score += n;
    if (!extraGiven && score >= 10000) {
      extraGiven = true; lives++;
      toast('EXTRA TACO'); blip('extra'); paintLives();
    }
    paintHud();
  }
  function addFloat(x, y, txt) { floats.push({ x: x, y: y, txt: txt, t: 0 }); }

  function startFright() {
    frightDurCur = frightDur(course);
    frightT = frightDurCur;
    frightMult = 0;
    for (let i = 0; i < 4; i++) {
      const c = chasers[i];
      if (c.mode === 'normal') { c.dir = OPP[c.dir]; c.fright = true; }
    }
    toast('TONGUE OUT'); blip('lips'); say('Tongue out.');
  }

  function eatChaser(c) {
    const val = 200 * Math.pow(2, Math.min(frightMult, 3));
    frightMult++;
    addScore(val);
    stats.chasers++;
    c.fright = false; c.mode = 'eyes';
    freezeT = 0.5;
    shakeT = RM ? 0 : 0.12; shakeMag = 2;
    addFloat(c.x, c.y, String(val));
    blip('eat');
  }

  function eatCheck() {
    const tx = Math.round(P.x), ty = Math.round(P.y);
    if (tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS) return;
    const i = tx + ty * COLS, v = pellets[i];
    if (v) {
      pellets[i] = 0; pelletsLeft--; pelletDirty = true;
      pelletsThisCourse++; pelletsThisLife++; stats.tacos++;
      lastEatT = courseT;
      if (v === 1) { addScore(10); blip('chomp'); }
      else { addScore(50); playerFreeze = 0.06; startFright(); }
      /* threshold, not equality — a missed frame must never skip the pop */
      if ((bonusPops === 0 && pelletsThisCourse >= 60) || (bonusPops === 1 && pelletsThisCourse >= 150)) {
        bonusOn = true; bonusT = 9; bonusPops++;
      }
      paintHud();
      if (pelletsLeft === 0) { courseClear(); return; }
    }
    if (bonusOn && Math.hypot(P.x - BONUS_TILE.x, P.y - BONUS_TILE.y) < 0.7) {
      bonusOn = false;
      const val = bonusValue(course);
      addScore(val); addFloat(BONUS_TILE.x, BONUS_TILE.y, String(val));
      toast('SIDE ORDER'); blip('side');
    }
  }

  /* ───────────────────── state machine ───────────────────── */

  function placeActors(firstOfCourse) {
    P.x = SPAWN.x; P.y = SPAWN.y; P.dir = LEFT; P.want = LEFT; P.dist = 0;
    playerFreeze = 0; lastEatT = -99; freezeT = 0;
    pelletsThisLife = 0;
    frightT = 0; frightMult = 0;
    const hx = [10, 10, 9, 11];
    for (let k = 0; k < 4; k++) {
      const c = chasers[k];
      c.fright = false; c.houseT = 0; c.houseBob = 0; c.phase = k * 1.3;
      if (k === 0) { c.x = HOUSE_EXIT.x; c.y = HOUSE_EXIT.y; c.dir = LEFT; c.mode = 'normal'; }
      else {
        c.x = hx[k]; c.y = HOUSE_MID.y; c.dir = UP; c.mode = 'house';
        if (k === 1) { c.relP = 0; c.relT = 0; }
        else if (k === 2) { c.relP = firstOfCourse ? 20 : 12; c.relT = 4; }
        else { c.relP = firstOfCourse ? 55 : 32; c.relT = 8; }
      }
    }
    if (firstOfCourse) { phaseIdx = 0; phaseT = 0; courseT = 0; }
    setChev(P.dir); lightArm(P.dir);
  }

  function resetCourse(showCourseCard) {
    resetPellets();
    pelletsThisCourse = 0; bonusOn = false; bonusPops = 0;
    placeActors(true);
    readyQ = [];
    if (showCourseCard) readyQ.push({ t: 0.9, txt: 'COURSE ' + course });
    readyQ.push({ t: 0.9, txt: 'GET CHOMPING' });
    state = 'ready'; nextReady();
    say('Course ' + course + '. Go.');
  }

  function nextReady() {
    const n = readyQ.shift();
    if (!n) { state = 'play'; showOverlay(null); return; }
    readyTxt = n.txt; stateT = n.t;
    showOverlay('<div class="cg-card"><p class="cg-big">' + n.txt + '</p></div>');
  }

  function startRun() {
    if (state !== 'attract' && state !== 'over') return;
    over = false;
    /* Snapshot the best to beat. writeBest() also runs on death, on pause and
       on tab-away, so by game over `best` has usually already caught up to
       `score` — comparing against it there meant the banner could never fire. */
    bestAtStart = best;
    score = 0; lives = 3; course = 1; extraGiven = false;
    stats = { tacos: 0, chasers: 0, deaths: 0 };
    graceT = 10; floats = [];
    hintDone = false; if (el.hint) el.hint.classList.remove('is-gone');
    enterImmersive();
    resetCourse(false);
    paintHud(); paintLives();
  }

  function die() {
    state = 'dying'; stateT = 0;
    shakeT = RM ? 0 : 0.18; shakeMag = 4;
    blip('death');
    writeBest();
  }

  function afterDeath() {
    lives--; stats.deaths++;
    paintLives();
    if (lives <= 0) { gameOver(); return; }
    placeActors(false);
    say('Eaten. ' + lives + ' taco' + (lives === 1 ? '' : 's') + ' left.');
    readyQ = [{ t: 0.7, txt: 'SPAT OUT' }, { t: 0.9, txt: 'GET CHOMPING' }];
    state = 'ready'; nextReady();
  }

  function courseClear() {
    state = 'clear'; stateT = 0;
    say('Course clear.');
    showOverlay('<div class="cg-card"><p class="cg-big">PLATE CLEAN</p></div>');
  }

  function nextCourse() {
    course++;
    paintHud();
    resetCourse(true);
  }

  function gameOver() {
    state = 'over'; over = true;
    const isBest = score > bestAtStart;
    writeBest();
    say('Game over. ' + score.toLocaleString('en-US') + ' calories, course ' + course + '.');
    showLabel(isBest);
    if (el.hint) el.hint.classList.remove('is-gone');
    paintHud();
  }

  /* ───────────────────── attract ───────────────────── */

  const ATTRACT = [[10, 15], [1, 15], [1, 10], [1, 4], [5, 4], [5, 10], [7, 10], [7, 12], [13, 12], [13, 10], [19, 10], [19, 15]];
  let aIdx = 0, aProg = 0;

  function attractStep(dt) {
    if (RM) { P.x = SPAWN.x; P.y = SPAWN.y; P.dir = LEFT; P.dist += dt * 1.6; return; }
    const a = ATTRACT[aIdx], b = ATTRACT[(aIdx + 1) % ATTRACT.length];
    const len = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
    aProg += 7.75 * dt;
    if (aProg >= len) { aProg -= len; aIdx = (aIdx + 1) % ATTRACT.length; return; }
    const f = len ? aProg / len : 0;
    const nx = a[0] + (b[0] - a[0]) * f, ny = a[1] + (b[1] - a[1]) * f;
    P.dist += Math.abs(nx - P.x) + Math.abs(ny - P.y);
    P.x = nx; P.y = ny;
    P.dir = b[0] > a[0] ? RIGHT : b[0] < a[0] ? LEFT : b[1] > a[1] ? DOWN : UP;
  }

  /* ───────────────────── sim step ───────────────────── */

  function simStep(dt) {
    clock += dt;
    for (let i = floats.length - 1; i >= 0; i--) {
      floats[i].t += dt; if (floats[i].t > 0.9) floats.splice(i, 1);
    }
    if (shakeT > 0) shakeT -= dt;

    if (state === 'attract') { attractStep(dt); return; }
    if (paused || state === 'over') return;

    if (state === 'ready') { stateT -= dt; if (stateT <= 0) nextReady(); return; }
    if (state === 'dying') { stateT += dt; if (stateT >= 0.9) afterDeath(); return; }
    if (state === 'clear') { stateT += dt; if (stateT >= 1.6) nextCourse(); return; }
    if (state !== 'play') return;

    if (freezeT > 0) { freezeT -= dt; return; }

    courseT += dt;
    if (graceT > 0) graceT -= dt;
    if (bonusOn) { bonusT -= dt; if (bonusT <= 0) bonusOn = false; }

    if (frightT > 0) {
      frightT -= dt;
      if (frightT <= 0) { frightT = 0; for (let i = 0; i < 4; i++) chasers[i].fright = false; }
    } else {
      const tbl = phaseTable(course);
      if (phaseIdx < tbl.length) {
        phaseT += dt;
        if (phaseT >= tbl[phaseIdx]) { phaseT -= tbl[phaseIdx]; phaseIdx++; reverseAll(); }
      }
    }

    for (let k = 0; k < 4; k++) {
      const c = chasers[k];
      if (c.mode !== 'house') continue;
      c.houseT += dt;
      const held = course === 1 && graceT > 0 && c.kind !== 0;
      if (held) continue;
      if ((c.relP >= 0 && pelletsThisLife >= c.relP) || c.houseT >= c.relT) c.mode = 'exiting';
    }

    const sp = speeds(course);
    let pv = (courseT - lastEatT) < 0.12 ? sp[1] : sp[0];
    if (playerFreeze > 0) { playerFreeze -= dt; pv = 0; }
    if (pv > 0) movePlayer(pv * dt);
    eatCheck();
    if (state !== 'play') return;

    for (let k = 0; k < 4; k++) moveChaser(chasers[k], dt);

    for (let k = 0; k < 4; k++) {
      const c = chasers[k];
      if (c.mode === 'eyes' || c.mode === 'entering' || c.mode === 'house') continue;
      if (Math.hypot(P.x - c.x, P.y - c.y) < 0.65) {
        if (c.fright) { eatChaser(c); }
        else { killer = k; die(); return; }
      }
    }
  }

  /* ───────────────────── render ───────────────────── */

  /* Pellets are tiny tacos: a half-disc shell with the flat edge up, and a
     filling strip along that edge. Still two batched Path2Ds and two fills a
     frame — the shape changed, the cost did not. Below ~14px the filling is
     dropped and it reads as a warm dot, which is the right call at that size. */
  /* Pellet tacos. Three batched Path2Ds — shell, filling, garnish — so the
     whole board is still three fills a frame however many are left. Detail
     drops out by size: under 14px it is a warm dot, over 18px it gets specks. */
  /* Where the sparkle layer is allowed to twinkle. Gathered here rather than
     scanned per frame: this runs on the same dirty flag the pellet layer
     already uses, so a frame costs a few array lookups instead of 483 cell
     tests. */
  let sparkSites = [];

  function pelletBuild() {
    pelletPath = new Path2D();
    fillingPath = new Path2D();
    garnishPath = new Path2D();
    sparkSites = [];
    const r = Math.max(2, 0.19 * TILE);
    const showFilling = TILE >= 13;
    const showGarnish = TILE >= 18;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (pellets[x + y * COLS] !== 1) continue;
      const cx = (x + 0.5) * TILE, cy = (y + 0.5) * TILE + r * 0.28;
      sparkSites.push(cx, cy);
      pelletPath.moveTo(cx - r, cy);
      pelletPath.arc(cx, cy, r, Math.PI, 0, true);
      pelletPath.closePath();
      if (showFilling) {
        const fr = r * 0.78, fy = cy - r * 0.14;
        fillingPath.moveTo(cx - fr, fy);
        fillingPath.arc(cx, fy, fr, Math.PI, 0, true);
        fillingPath.closePath();
      }
      if (showGarnish) {
        /* Kept inside the filling band and offset, never a symmetrical pair
           above the shell — two dots over a stripe read as a face. */
        const gr = Math.max(0.8, r * 0.15);
        garnishPath.moveTo(cx - r * 0.22 + gr, cy - r * 0.22);
        garnishPath.arc(cx - r * 0.22, cy - r * 0.22, gr, 0, 6.2832);
      }
    }

    /* and the sprite version of the same board */
    if (SPR.ready) {
      const W = COLS * TILE, H = ROWS * TILE;
      if (!pelletCan) { pelletCan = document.createElement('canvas'); }
      if (pelletCan.width !== Math.round(W * DPR) || pelletCan.height !== Math.round(H * DPR)) {
        pelletCan.width = Math.round(W * DPR); pelletCan.height = Math.round(H * DPR);
      }
      pelletCtx = pelletCan.getContext('2d');
      pelletCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
      pelletCtx.clearRect(0, 0, W, H);
      /* The replacement art is cropped tighter to its cell than the sprite it
         replaced, so at 0.92 the tacos in adjacent tiles nearly touched and
         the corridors stopped reading as corridors. */
      const sz = TILE * 0.78;
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
        if (pellets[x + y * COLS] !== 1) continue;
        drawSprite(pelletCtx, 'pellet', (x + 0.5) * TILE, (y + 0.5) * TILE, sz, 0, false);
      }
    }

    pelletDirty = false;
  }

  /* A four-point star with a pinched waist. Two round-capped strokes were the
     obvious way to draw this and they read as a fat plus sign, not a glint —
     the taper is the whole difference. Additive, so on a dark board it reads
     as light rather than as white paint. */
  function drawSpark(g, x, y, r, a) {
    const w = r * 0.16;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = a;
    g.fillStyle = C.cream2;
    g.beginPath();
    g.moveTo(x, y - r);
    g.quadraticCurveTo(x + w, y - w, x + r, y);
    g.quadraticCurveTo(x + w, y + w, x, y + r);
    g.quadraticCurveTo(x - w, y + w, x - r, y);
    g.quadraticCurveTo(x - w, y - w, x, y - r);
    g.fill();
    g.globalAlpha = a * 0.85;
    g.beginPath(); g.arc(x, y, Math.max(0.8, r * 0.16), 0, 6.283); g.fill();
    g.restore();
  }

  /* Twinkle a handful of tacos at a time. Each spark owns a slot; the slot
     picks a new taco every cycle and fades in and out across it, so the board
     glitters without anything strobing. */
  const SPARKS = 7, SPARK_CYCLE = 1.15;
  function drawSparkle(g) {
    const n = sparkSites.length >> 1;
    if (!n || RM) return;
    for (let i = 0; i < SPARKS; i++) {
      const phase = clock / SPARK_CYCLE + i * 0.618;
      const cycle = Math.floor(phase);
      const t = phase - cycle;
      /* one smooth hump per cycle, so it fades up and back down */
      const a = Math.sin(t * Math.PI);
      if (a < 0.04) continue;
      /* cheap deterministic shuffle: a large odd stride walks the whole list
         without repeating a site until it has visited them all */
      const idx = ((cycle * 7919 + i * 104729) % n + n) % n;
      drawSpark(g, sparkSites[idx * 2], sparkSites[idx * 2 + 1],
        Math.max(2.5, TILE * 0.30), a * 0.85);
    }
  }

  function render() {
    const g = el.ctx; if (!g || !mazeCan) return;
    const T = TILE, W = COLS * T, H = ROWS * T;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = C.floor; g.fillRect(0, 0, W, H);

    let ox = 0, oy = 0;
    if (shakeT > 0 && !RM) { ox = (Math.random() * 2 - 1) * shakeMag; oy = (Math.random() * 2 - 1) * shakeMag; }
    g.save(); g.translate(ox, oy);

    g.drawImage(mazeCan, 0, 0, W, H);
    if (state === 'clear' && !RM) {
      const a = Math.max(0, Math.sin(stateT / 1.6 * Math.PI * 2 * 2)) * 0.55;
      if (a > 0.01) { g.globalAlpha = a; g.drawImage(pulseCan, 0, 0, W, H); g.globalAlpha = 1; }
    }

    /* pellets — one batched path, one fill */
    if (pelletDirty) pelletBuild();

    /* Sprite pellets are baked into a layer on the same dirty flag that the
       batched paths use, so 200-odd tacos still cost one drawImage a frame
       rather than 200. */
    if (SPR.ready && pelletCan) {
      g.drawImage(pelletCan, 0, 0, W, H);
      drawSparkle(g);
    } else {
      if (!shellGrad) {
        shellGrad = g.createLinearGradient(0, 0, 0, T * 1.2);
        shellGrad.addColorStop(0, C.cream2);
        shellGrad.addColorStop(1, '#e8b877');
      }
      g.fillStyle = shellGrad;
      g.fill(pelletPath);
      if (T >= 13) { g.fillStyle = C.pink; g.fill(fillingPath); }
      if (T >= 18) { g.fillStyle = C.mint; g.fill(garnishPath); }
      if (T >= 19) { g.strokeStyle = C.ink; g.lineWidth = 1.2; g.stroke(pelletPath); }
    }

    /* Energizers: a full loaded taco, pulsing. The lips used to play this
       part, but the lips are the player now — so the big one on the board is
       simply the biggest taco on the board. */
    const puls = RM ? 1.05 : 1.0 + 0.12 * (0.5 + 0.5 * Math.sin(clock * Math.PI * 2 * 1.4));
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (pellets[x + y * COLS] !== 2) continue;
      const ex = (x + 0.5) * T, ey = (y + 0.5) * T;
      if (!drawSprite(g, 'power', ex, ey, T * 1.20 * puls, 0, false)) {
        drawLoadedTaco(g, ex, ey, T, puls);
      }
    }

    if (bonusOn && state === 'play') drawSideOrder(g, (BONUS_TILE.x + 0.5) * T, (BONUS_TILE.y + 0.5) * T, T, course);

    const showChasers = state === 'play' || state === 'ready' || state === 'clear' ||
      (state === 'dying' && stateT < 0.15);
    const flash = frightT > 0 && frightT <= Math.min(1.5, frightDurCur * 0.35) && (Math.floor(clock * 4) % 2 === 0);

    /* one shadow pass for the whole sprite layer, then one art pass */
    if (showChasers) {
      for (let k = 0; k < 4; k++) {
        const c = chasers[k];
        if (c.mode === 'eyes') continue;
        if (!SPR.ready) drawChaser(g, c.kind, (c.x + 0.5) * T, (c.y + 0.5) * T, T, { shadow: true, hemPh: clock * 6 + c.phase });
      }
    }

    /* taco */
    const dying = state === 'dying';
    let open = MAX_OPEN * Math.abs(Math.cos((P.dist / 0.8) * Math.PI));
    if (RM) open = MAX_OPEN * Math.abs(Math.cos((P.dist / 1.6) * Math.PI));
    let spin = 0, shrink = 1, drop = 0, showTaco = true;
    if (dying) {
      const t = stateT;
      if (t < 0.15) { open = MAX_OPEN * Math.abs(Math.cos((P.dist / 0.8) * Math.PI)); }
      else if (t < 0.75) {
        const f = (t - 0.15) / 0.6;
        open = MAX_OPEN + (1.9 - MAX_OPEN) * f;
        if (!RM) { spin = f * Math.PI * 6; shrink = 1 - f; }
      } else { showTaco = false; }
      if (!RM && killer === 1 && t < 0.2) drop = 0.15 * (t / 0.2);
    }
    const px = (P.x + 0.5) * T, py = (P.y + 0.5) * T + drop * T;

    /* The atlas art carries its own outline and shading, so it needs no
       separate silhouette pass; the path version still does. */
    if (showTaco && !SPR.ready) {
      drawMouth(g, px, py, P.dir, open, { shadow: true, spin: spin, shrink: shrink });
    }

    /* art pass */
    if (showChasers) {
      for (let k = 0; k < 4; k++) {
        const c = chasers[k];
        const ccx = (c.x + 0.5) * T, ccy = (c.y + 0.5) * T;
        /* Eyes-only (eaten, heading home) stays path-drawn — a cutout of just
           the eyes is not worth a tenth atlas cell. */
        let done = false;
        if (c.mode !== 'eyes') {
          const name = c.fright ? 'fright' : CH_SPRITE[c.kind];
          done = drawSprite(g, name, ccx, ccy, T * 1.26, 0, false,
            c.fright && flash ? 0.55 : 1);
        }
        if (!done) {
          drawChaser(g, c.kind, ccx, ccy, T, {
            mode: c.mode, fright: c.fright, flash: flash,
            hemPh: clock * 6 + c.phase,
            tdx: P.x - c.x, tdy: P.y - c.y
          });
        }
      }
    }
    if (dying && !RM && killer === 1 && stateT < 0.2) {
      const f = stateT / 0.2, rc = chasers[1];
      g.save(); g.fillStyle = C.plum3; g.globalAlpha = 0.75 * (1 - f);
      g.fillRect(px - 0.5 * T + DX[rc.dir] * f * 0.6 * T, py - 0.2 * T + DY[rc.dir] * f * 0.6 * T, T, 0.5 * T);
      g.restore();
    }
    if (showTaco) {
      const wink = state === 'play' && !dying && (clock % 3.4) < 0.24;
      const chomp = open > MAX_OPEN * 0.45 ? 'open' : 'closed';
      const rot = (P.dir === UP ? -Math.PI / 2 : P.dir === DOWN ? Math.PI / 2 : 0) + spin;
      if (!drawSprite(g, chomp, px, py, T * 1.30 * shrink, rot, P.dir === LEFT)) {
        drawMouth(g, px, py, P.dir, open, { spin: spin, shrink: shrink, tongue: frightT > 0, fright: frightT > 0, wink: wink });
      }
    }

    /* floating score numbers — the only text the canvas draws */
    if (floats.length) {
      g.save();
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '700 ' + Math.max(11, Math.round(T * 0.62)) + 'px "Luckiest Guy", system-ui, sans-serif';
      g.lineWidth = 4; g.lineJoin = 'round'; g.strokeStyle = C.ink;
      for (let i = 0; i < floats.length; i++) {
        const f = floats[i], a = 1 - f.t / 0.9;
        g.globalAlpha = a < 0 ? 0 : a;
        const fx = (f.x + 0.5) * T, fy = (f.y + 0.5) * T - f.t * T * 1.1;
        g.strokeText(f.txt, fx, fy); g.fillStyle = C.cream2; g.fillText(f.txt, fx, fy);
      }
      g.restore();
    }
    g.restore();
  }

  /* ───────────────────── HUD / overlays ───────────────────── */

  let lastHud = '';
  function paintHud() {
    const s = score + '|' + best + '|' + course + '|' + pelletsLeft;
    if (s === lastHud) return;
    lastHud = s;
    el.score.textContent = score.toLocaleString('en-US');
    el.best.textContent = Math.max(best, score).toLocaleString('en-US');
    el.course.textContent = String(course);
    if (el.pScore) el.pScore.textContent = score.toLocaleString('en-US');
    if (el.pBest) el.pBest.textContent = Math.max(best, score).toLocaleString('en-US');
    if (el.pCourse) el.pCourse.textContent = String(course);
    if (el.pBids) el.pBids.textContent = String(pelletsLeft);
  }

  function paintLives() {
    const holders = [el.lives, el.pLives];
    for (let h = 0; h < holders.length; h++) {
      const box = holders[h]; if (!box) continue;
      box.textContent = '';
      const n = Math.max(0, Math.min(lives, 8));
      for (let i = 0; i < n; i++) {
        const cv = document.createElement('canvas');
        const s = (window.innerWidth || 400) < 430 ? 19 : 24;
        cv.width = s * 2; cv.height = s * 2; cv.style.width = s + 'px'; cv.style.height = s + 'px';
        const g = cv.getContext('2d');
        g.setTransform(2, 0, 0, 2, 0, 0);
        if (!drawSprite(g, 'open', s / 2, s / 2, s * 0.98, 0, false)) {
          drawMouth(g, s / 2, s / 2 - 1, RIGHT, 0.3, { tile: s * 0.92, shadow: true });
          drawMouth(g, s / 2, s / 2 - 1, RIGHT, 0.3, { tile: s * 0.92 });
        }
        box.appendChild(cv);
      }
      box.setAttribute('aria-label', lives + ' tacos left');
    }
  }

  function showOverlay(html, pass) {
    const o = el.overlay;
    if (!html) { o.hidden = true; o.innerHTML = ''; o.classList.remove('cg-pass'); return; }
    o.innerHTML = html;
    o.classList.toggle('cg-pass', pass !== false);
    o.hidden = false;
  }

  let toastT = null;
  function toast(txt) {
    if (!el.toast) return;
    el.toast.textContent = txt;
    el.toast.classList.add('is-on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.toast.classList.remove('is-on'); }, 900);
  }

  let lastSay = 0;
  function say(msg) {
    const t = Date.now();
    if (t - lastSay < 1500) return;
    lastSay = t;
    if (el.live) el.live.textContent = msg;
  }

  function attractCard() {
    const touch = inputMode === 'touch';
    /* The swap is offered, not imposed. Both controls work whichever way it
       is set, so this is a handedness preference rather than a mode you have
       to get right before you are allowed to play. */
    const swap = touch && CTL ? CTL.optsHtml() : '';
    showOverlay(
      '<div class="cg-card cg-attract">' +
      '<p class="cg-big">TONGUE RUSH</p>' +
      '<p class="cg-pill">' + (touch ? 'TAP TO EAT' : 'PRESS ANY KEY') + '</p>' +
      '<p class="cg-sub">gonna eat that chart</p></div>' + swap);
  }

  function pauseCard() {
    showOverlay(
      '<div class="cg-card">' +
      '<p class="cg-big">PAUSED</p>' +
      '<p class="cg-sub">The taco is resting its jaw.</p>' +
      '<div class="cg-btns">' +
      '<button class="btn btn-buy btn-sm" type="button" data-act="resume">RESUME</button>' +
      '<button class="btn btn-ghost btn-sm" type="button" data-act="sound">' + (soundOn ? 'SOUND OFF' : 'SOUND ON') + '</button>' +
      '<button class="btn btn-ghost btn-sm" type="button" data-act="exit">BACK TO THE SITE</button>' +
      '</div></div>', false);
  }

  function dots(label, value, width) {
    const v = String(value);
    const n = Math.max(2, width - label.length - v.length);
    return label + ' ' + new Array(n).join('.') + ' ' + v;
  }

  function showLabel(isBest) {
    const degen = Math.min(9999, Math.round(score / 20));
    const rows = [
      ['Calories', score.toLocaleString('en-US')],
      ['Course reached', String(course)],
      ['Tacos eaten', String(stats.tacos)],
      ['Chasers swallowed', String(stats.chasers)],
      ['Times spat out', String(stats.deaths)],
      ['% Daily Degen', degen + '%']
    ];
    let body = '';
    for (let i = 0; i < rows.length; i++) {
      body += '<span class="cg-lrow"><span>' + rows[i][0] + '</span><i></i><b>' + rows[i][1] + '</b></span>';
    }
    showOverlay(
      '<div class="cg-card cg-label-wrap"><div class="cg-label">' +
      (isBest ? '<p class="cg-newbest">NEW PERSONAL BEST</p>' : '') +
      '<h3>NUTRITION FACTS</h3>' +
      '<span class="cg-lrow cg-lrow-top"><span>Serving size</span><i></i><b>1 taco</b></span>' +
      '<span class="cg-lrow cg-lrow-top"><span>Servings per run</span><i></i><b>3</b></span>' +
      '<div class="cg-lrule"></div>' + body +
      '<p class="cg-lfoot">* Percent Daily Degen is made up. So is everything else on this label. Contains no financial advice, no nutrition, and no promises. Not a food. Not an investment. Just a taco.</p>' +
      '</div><div class="cg-btns">' +
      '<button class="btn btn-buy btn-sm" type="button" data-act="again">AGAIN</button>' +
      /* Short enough to stay on one line in a half-width grid cell — the long
         versions wrapped and left the two buttons two lines tall. */
      '<button class="btn btn-ghost btn-sm" type="button" data-act="share">SHARE LABEL</button>' +
      '<button class="btn btn-ghost btn-sm" type="button" data-act="exit">BACK TO SITE</button>' +
      '</div></div>', false);
  }

  function napCard() {
    try {
      el.shell.innerHTML =
        '<div class="cg-nap"><p class="cg-big">The taco’s having a nap.</p>' +
        '<p class="cg-sub">This little game didn’t load. The rest of the site is fine — go poke the chart instead.</p>' +
        '<p><a class="btn btn-buy btn-sm" href="index.html">BACK TO THE SITE</a></p></div>';
      el.shell.classList.add('is-nap');
      document.body.classList.remove('cuna-playing');
    } catch (e) { }
  }

  function shareLabel(btn) {
    const txt = 'Ate ' + score.toLocaleString('en-US') + ' calories off the chart in TONGUE RUSH. Course ' +
      course + '. gonna eat that chart. ' + location.origin + location.pathname;
    const done = function () {
      const old = btn.textContent; btn.textContent = 'COPIED';
      setTimeout(function () { btn.textContent = old; }, 1600);
    };
    try {
      if (navigator.share) { navigator.share({ text: txt }).then(function () { }, function () { }); return; }
    } catch (e) { }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done, function () { selectFallback(txt, done); });
        return;
      }
    } catch (e) { }
    selectFallback(txt, done);
  }
  function selectFallback(txt, done) {
    try {
      const ta = document.createElement('textarea');
      ta.value = txt; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta); done();
    } catch (e) { }
  }

  /* ───────────────────── audio (never autoplays) ───────────────────── */

  let actx = null, soundOn = false;
  function initAudio() {
    if (actx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      actx = new AC();
      const b = actx.createBuffer(1, 1, 22050);
      const s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);
      if (actx.resume) actx.resume();
      return true;
    } catch (e) { actx = null; return false; }
  }
  let chompAlt = 0;
  function blip(kind) {
    if (!soundOn || !actx || actx.state !== 'running') return;
    try {
      const t = actx.currentTime;
      const mk = function (type, f0, f1, dur, gain) {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = type; o.frequency.setValueAtTime(f0, t);
        if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
      };
      if (kind === 'chomp') { chompAlt ^= 1; mk('square', chompAlt ? 220 : 196, chompAlt ? 220 : 196, 0.04, 0.06); }
      else if (kind === 'lips') mk('sawtooth', 300, 800, 0.18, 0.09);
      else if (kind === 'eat') mk('square', 400, 1200, 0.24, 0.09);
      else if (kind === 'side') { mk('triangle', 660, 660, 0.12, 0.08); setTimeout(function () { blip('side2'); }, 150); }
      else if (kind === 'side2') mk('triangle', 660, 660, 0.12, 0.08);
      else if (kind === 'extra') { mk('triangle', 880, 880, 0.12, 0.09); setTimeout(function () { blip('extra2'); }, 140); }
      else if (kind === 'extra2') mk('triangle', 1320, 1320, 0.12, 0.09);
      else if (kind === 'death') mk('sawtooth', 500, 80, 0.9, 0.11);
    } catch (e) { }
  }
  function setSound(on) {
    if (on && !initAudio()) { el.sound.hidden = true; return; }
    if (on && actx && actx.resume) { try { actx.resume(); } catch (e) { } }
    soundOn = on;
    if (on && actx && actx.state !== 'running') { el.sound.hidden = true; soundOn = false; return; }
    el.sound.setAttribute('aria-pressed', on ? 'true' : 'false');
    el.sound.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
    /* Always a note; muted draws a slash across it. A bare cross here read as
       "close the game", which is the most prominent control on the screen. */
    el.sound.textContent = '♪';
    el.sound.classList.toggle('is-on', on);
    el.sound.classList.toggle('is-muted', !on);
    if (state === 'play' && paused) pauseCard();
  }

  /* ───────────────────── input ───────────────────── */

  /* Input lives in assets/controls.js, shared with TONGUE TWISTER. It was
     extracted rather than copied: same-axis reversal, re-anchoring a gesture
     at each committed turn and a resting hand not stealing the stick all took
     real debugging, and private copies would drift the first time one of them
     was fixed. */
  let CTL = null;

  function setChev(d) { if (CTL) CTL.setChev(d); }
  function lightArm(d) { if (CTL) CTL.lightArm(d); }
  function setDir(d) { if (d >= 0) { P.want = d; setChev(d); lightArm(d); } }
  function placeSticks() { if (CTL) CTL.layout(); }

  function tapStart() {
    try { el.shell.focus({ preventScroll: true }); } catch (e) { try { el.shell.focus(); } catch (e2) { } }
    if (state === 'attract') startRun();
    else if (paused) setPaused(false);
  }

  /* Direction keys and the shell-engaged gate live in controls.js; this only
     handles the keys that are specific to this game. */
  function gameKey(k) {
    if (k === ' ' || k === 'Spacebar' || k === 'Enter') {
      if (state === 'attract' || state === 'over') startRun();
      else if (paused) setPaused(false);
      return true;
    }
    if (k === 'p' || k === 'P') { setPaused(!paused); return true; }
    if (k === 'm' || k === 'M') { setSound(!soundOn); return true; }
    if (k === 'Escape') {
      if (paused || state === 'over') { exitImmersive(); backToSite(); }
      else setPaused(true);
      return true;
    }
    return false;
  }

  function setPaused(v) {
    if (state === 'attract' || state === 'over') return;
    paused = v;
    el.pause.setAttribute('aria-label', v ? 'Resume' : 'Pause');
    el.pause.textContent = v ? '▶' : '❚❚';
    if (v) { writeBest(); pauseCard(); if (actx && actx.suspend) { try { actx.suspend(); } catch (e) { } } }
    else {
      if (actx && soundOn && actx.resume) { try { actx.resume(); } catch (e) { } }
      if (state === 'ready') showOverlay('<div class="cg-card"><p class="cg-big">' + readyTxt + '</p></div>');
      else showOverlay(null);
    }
  }

  function backToSite() {
    writeBest();
    state = 'attract'; paused = false; over = false;
    aIdx = 0; aProg = 0;
    resetPellets(); placeActors(true);
    score = 0; lives = 3; course = 1; paintHud(); paintLives();
    attractCard();
  }

  /* immersive mode — touch only */
  let savedY = 0, immersive = false;
  function enterImmersive() {
    if (!mqTouch.matches || inputMode !== 'touch' || immersive) return;
    savedY = window.scrollY || window.pageYOffset || 0;
    immersive = true;
    document.body.classList.add('cuna-playing');
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    scheduleLayout(0);
  }
  function exitImmersive() {
    if (!immersive) return;
    immersive = false;
    document.body.classList.remove('cuna-playing');
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    try { window.scrollTo(0, savedY); } catch (e) { }
    scheduleLayout(0);
  }

  function setInputMode(m) {
    /* A phone with a Bluetooth keyboard, or a stray keypress after a tap,
       used to flip the shell into the desktop three-column grid on a 390px
       screen and shove the maze off the side. Keyboard input still works in
       touch layout — onKey does not consult inputMode — so a coarse-pointer
       device simply keeps its touch layout. */
    if (m === 'desktop' && mqTouch.matches) return;
    if (inputMode === m) return;
    inputMode = m;
    el.shell.classList.toggle('cg-desktop', m === 'desktop');
    el.shell.classList.toggle('cg-touch', m === 'touch');
    updateHint();
    if (state === 'attract') attractCard();
    scheduleLayout(0);
  }

  function updateHint() {
    if (!el.hint) return;
    el.hint.textContent = inputMode === 'touch'
      ? 'Drag to steer. The stick follows your thumb — press the other side and it moves over there.'
      : 'Arrows or WASD. P pauses. M is the sound. Space starts.';
  }

  /* ───────────────────── loop ───────────────────── */

  let raf = 0, acc = 0, last = 0;
  const ft = []; let ftSum = 0;

  function perfWatch(dt) {
    ft.push(dt); ftSum += dt;
    if (ft.length < 60) return;
    const mean = ftSum / ft.length;
    ft.length = 0; ftSum = 0;
    if (mean > 0.020 && dprCap > 1) {
      dprCap = dprCap === 2 ? 1.5 : 1;
      layout();
    }
  }

  function frame(now) {
    try {
      let dt = (now - last) / 1000; last = now;
      if (dt > 0.1) dt = 0.1; if (!(dt > 0)) dt = 0;
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < 5) { simStep(STEP); acc -= STEP; steps++; }
      if (steps === 5) acc = 0;
      render();
      perfWatch(dt);
      raf = requestAnimationFrame(frame);
    } catch (e) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      napCard();
    }
  }

  let layoutT = null;
  function scheduleLayout(ms) {
    clearTimeout(layoutT);
    layoutT = setTimeout(function () { try { layout(); } catch (e) { } }, ms == null ? 100 : ms);
  }

  /* ───────────────────── legend sprites ───────────────────── */

  function buildLegend() {
    const cvs = el.shell.querySelectorAll('canvas[data-ch]');
    for (let i = 0; i < cvs.length; i++) {
      const cv = cvs[i], k = parseInt(cv.getAttribute('data-ch'), 10);
      const s = 26;
      cv.width = s * 2; cv.height = s * 2; cv.style.width = s + 'px'; cv.style.height = s + 'px';
      const g = cv.getContext('2d');
      g.setTransform(2, 0, 0, 2, 0, 0);
      if (!drawSprite(g, CH_SPRITE[k], s / 2, s / 2, s * 0.98, 0, false)) {
        drawChaser(g, k, s / 2, s / 2, s * 0.92, { shadow: true });
        drawChaser(g, k, s / 2, s / 2, s * 0.92, { mode: 'normal', tdx: -1, tdy: 0 });
      }
    }
  }

  /* ───────────────────── boot ───────────────────── */

  function boot() {
    el.shell = $('cuna-game');
    if (!el.shell) return;
    el.canvas = $('cg-canvas');
    el.field = $('cg-field');
    el.overlay = $('cg-overlay');
    el.toast = $('cg-toast');
    el.hud = $('cg-hud');
    el.score = $('cg-score'); el.best = $('cg-best'); el.course = $('cg-course');
    el.lives = $('cg-lives'); el.sound = $('cg-sound'); el.pause = $('cg-pause');
    el.gutL = $('cg-gutL'); el.gutR = $('cg-gutR');
    el.live = $('cg-live'); el.probe = $('cg-probe'); el.hint = $('cg-hint');
    el.pScore = $('cg-p-score'); el.pBest = $('cg-p-best'); el.pCourse = $('cg-p-course');
    el.pLives = $('cg-p-lives'); el.pBids = $('cg-p-bids');
    if (!el.canvas || !el.canvas.getContext) throw new Error('no canvas');
    el.ctx = el.canvas.getContext('2d');
    if (!el.ctx) throw new Error('no 2d');

    RM = mqMotion.matches;
    inputMode = mqTouch.matches ? 'touch' : 'desktop';
    el.shell.classList.add(inputMode === 'touch' ? 'cg-touch' : 'cg-desktop');

    readBest();
    loadSprites();
    resetPellets();
    placeActors(true);
    CTL = CunaControls.create({
      shell: el.shell, gutL: el.gutL, gutR: el.gutR,
      field: el.field, probe: el.probe,
      onDir: function (d) { P.want = d; },
      onEngage: tapStart,
      onKey: gameKey
    });
    buildLegend();
    layout();
    paintHud(); paintLives(); updateHint(); attractCard(); setChev(LEFT); lightArm(LEFT);
    el.sound.textContent = '✕';
    el.pause.textContent = '❚❚';

    /* events */
    el.overlay.addEventListener('click', function (e) {
      const b = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!b) return;
      const a = b.getAttribute('data-act');
      const msg = CTL ? CTL.handleAct(a) : null;
      if (msg !== null) { attractCard(); toast(msg); return; }
      if (a === 'resume') setPaused(false);
      else if (a === 'sound') setSound(!soundOn);
      else if (a === 'exit') { exitImmersive(); backToSite(); }
      else if (a === 'again') startRun();
      else if (a === 'share') shareLabel(b);
    });
    el.sound.addEventListener('click', function () { setSound(!soundOn); });
    el.pause.addEventListener('click', function () { setPaused(!paused); });
    el.shell.addEventListener('pointerdown', function () {
      try { el.shell.focus({ preventScroll: true }); } catch (e) { }
    });
    document.addEventListener('gesturestart', function (e) {
      if (document.body.classList.contains('cuna-playing') && e.cancelable) e.preventDefault();
    });

    if (window.ResizeObserver) {
      const ro = new ResizeObserver(function () { scheduleLayout(100); });
      ro.observe(el.shell);
    }
    window.addEventListener('resize', function () { scheduleLayout(100); });
    window.addEventListener('orientationchange', function () { scheduleLayout(160); });

    const onMotion = function () { RM = mqMotion.matches; };
    if (mqMotion.addEventListener) mqMotion.addEventListener('change', onMotion);
    else if (mqMotion.addListener) mqMotion.addListener(onMotion);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        acc = 0; writeBest();
        if (state === 'play' || state === 'ready') setPaused(true);
        if (actx && actx.suspend) { try { actx.suspend(); } catch (e) { } }
      } else { last = performance.now(); }
    });
    window.addEventListener('pagehide', function () { writeBest(); });

    last = performance.now();
    raf = requestAnimationFrame(frame);

    /* A small non-visual hook so the page can be driven by an automated
       smoke test. It draws nothing and awards nothing; strip it if you'd
       rather nobody could poke the sim from a console. */
    el.shell.__cuna = {
      s: function () {
        return {
          state: state, paused: paused, score: score, lives: lives, course: course,
          left: pelletsLeft, x: P.x, y: P.y, dir: P.dir, want: P.want, tile: TILE,
          mode: layoutMode, ch: chasers.map(function (c) { return { m: c.mode, f: c.fright, x: c.x, y: c.y }; })
        };
      },
      clearAll: function () {
        for (let i = 0; i < pellets.length; i++) if (pellets[i] === 1) { pellets[i] = 0; pelletsLeft--; pelletsThisCourse++; }
        pelletDirty = true;
      },
      warp: function (x, y) { P.x = x; P.y = y; },
      warpCh: function (i, x, y) { const c = chasers[i]; c.x = x; c.y = y; if (c.mode === 'house') c.mode = 'normal'; }
    };
  }

  try { boot(); } catch (e) { napCard(); }
})();
