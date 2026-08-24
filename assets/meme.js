/* CUNA MEME LAB — sticker your own picture, or make a PFP.
 *
 * Everything happens in the page. The photo is read with FileReader, drawn to
 * a canvas, and exported with toBlob; it is never uploaded anywhere, because
 * there is nowhere to upload it to — this site has no backend and no keys.
 * That is worth saying out loud on the page, because "drop your photo here"
 * on a memecoin site is otherwise a reasonable thing to be suspicious of.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* Export sizes. Square is the one people post; PFP is what X and Telegram
     crop to a circle, so it is generated already square and centred. */
  var MODES = {
    square: { w: 1080, h: 1080, label: 'SQUARE' },
    pfp: { w: 512, h: 512, label: 'PFP' },
    wide: { w: 1200, h: 675, label: 'WIDE' }
  };

  var STICKERS = [
    { k: 'open', n: 'Tongue out' },
    { k: 'closed', n: 'Lips' },
    { k: 'power', n: 'Taco' },
    { k: 'pellet', n: 'Lil taco' },
    { k: 'jeet', n: 'Jeet' },
    { k: 'ruggy', n: 'Ruggy' },
    { k: 'fudd', n: 'Fudd' },
    { k: 'paper', n: 'Paper' },
    { k: 'fright', n: 'Spooked' },
    { k: 'badge', n: 'Badge' }
  ];

  /* Caption bank for SURPRISE ME. Nothing here promises anything, predicts
     anything, or gets more explicit than a raised eyebrow. */
  var LINES = [
    'when the chart licks back',
    'tongue out, hands diamond',
    'i came for the taco',
    'she said what coin',
    'certified licker',
    'no notes, just tongue',
    'my portfolio said aaah',
    'pov: you found cuna',
    'jeets hate this one trick',
    'built different, tastes similar',
    'sir this is a taco stand',
    'it me. the tongue guy.'
  ];

  var SPR = {
    img: null, ready: false, cell: 256,
    map: {
      open: [0, 0], closed: [1, 0], power: [2, 0], pellet: [3, 0], jeet: [4, 0],
      ruggy: [0, 1], fudd: [1, 1], paper: [2, 1], fright: [3, 1]
    }
  };
  var LOGO = { img: null, ready: false };

  var el = {};
  var mode = 'square';
  var photo = null;            /* HTMLImageElement or null */
  var photoFit = 'cover';
  var items = [];              /* placed stickers, painter order */
  var sel = -1;
  var W = 1080, H = 1080;      /* export pixels */
  var view = 1;                /* css px per export px */
  var ph = { z: 1, ox: 0, oy: 0 };   /* zoom and pan of the photo itself */
  var ring = true;             /* the automatic PFP ring */
  var autoCap = false;         /* captions we wrote, and may overwrite */

  /* ── assets ── */

  function loadAssets() {
    var a = new Image();
    a.onload = function () { SPR.img = a; SPR.ready = true; paintPalette(); draw(); };
    a.onerror = function () { SPR.ready = false; paintPalette(); };
    a.src = 'assets/sprites-neo.webp';

    var b = new Image();
    b.onload = function () { LOGO.img = b; LOGO.ready = true; paintPalette(); draw(); };
    b.onerror = function () { LOGO.ready = false; };
    b.src = 'assets/logo.jpg';
  }

  function drawSticker(g, kind, cx, cy, size, rot, flip) {
    g.save();
    g.translate(cx, cy);
    if (rot) g.rotate(rot);
    /* the badge carries readable text, so it never mirrors */
    if (flip && kind !== 'badge') g.scale(-1, 1);
    if (kind === 'badge') {
      if (!LOGO.ready) { g.restore(); return false; }
      /* the badge is a square jpg; clip it round so it drops in as a coin */
      g.save();
      g.beginPath(); g.arc(0, 0, size / 2, 0, 6.283); g.closePath(); g.clip();
      g.drawImage(LOGO.img, -size / 2, -size / 2, size, size);
      g.restore();
      g.lineWidth = Math.max(2, size * 0.045);
      g.strokeStyle = '#24040f';
      g.beginPath(); g.arc(0, 0, size / 2, 0, 6.283); g.stroke();
      g.restore();
      return true;
    }
    if (!SPR.ready) { g.restore(); return false; }
    var m = SPR.map[kind];
    if (!m) { g.restore(); return false; }
    var c = SPR.cell;
    g.drawImage(SPR.img, m[0] * c, m[1] * c, c, c, -size / 2, -size / 2, size, size);
    g.restore();
    return true;
  }

  /* ── layout ── */

  function layout() {
    var M = MODES[mode];
    W = M.w; H = M.h;
    var box = el.stage.getBoundingClientRect();
    /* Width comes from the stage, height from the viewport, and never the
       other way round — measuring the element the canvas lives in and then
       sizing the canvas from it is a feedback loop. */
    var maxW = Math.max(160, box.width - 4);
    var maxH = Math.max(160, (window.innerHeight || 640) * 0.52);
    view = Math.min(maxW / W, maxH / H);
    var cw = Math.round(W * view), ch = Math.round(H * view);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.canvas.width = Math.round(cw * dpr);
    el.canvas.height = Math.round(ch * dpr);
    el.canvas.style.width = cw + 'px';
    el.canvas.style.height = ch + 'px';
    el.ctx.setTransform(dpr * view, 0, 0, dpr * view, 0, 0);
    draw();
  }

  var layoutT = 0;
  function scheduleLayout(ms) { clearTimeout(layoutT); layoutT = setTimeout(layout, ms || 60); }

  /* ── drawing ── */

  /* The photo is a picture you place, not a fixed background: cover/contain
     gives the starting scale, then zoom and pan move it under the frame. For
     a PFP that is the whole game — the face is never in the middle of the
     original shot. */
  function fitPhoto() {
    if (!photo) return null;
    var iw = photo.naturalWidth || photo.width, ih = photo.naturalHeight || photo.height;
    if (!iw || !ih) return null;
    var base = (photoFit === 'cover') ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih);
    var s = base * ph.z;
    var w = iw * s, h = ih * s;
    return { x: (W - w) / 2 + ph.ox, y: (H - h) / 2 + ph.oy, w: w, h: h };
  }

  /* Stop short of dragging the picture off the frame entirely. When it is
     smaller than the frame it may still drift a little, so a shrunken photo
     can be nudged off-centre on purpose. */
  function clampPan() {
    var f = fitPhoto();
    if (!f) return;
    var mx = (f.w - W) / 2, my = (f.h - H) / 2;
    if (mx < 0) mx = W * 0.28;
    if (my < 0) my = H * 0.28;
    ph.ox = clamp(-mx, ph.ox, mx);
    ph.oy = clamp(-my, ph.oy, my);
  }

  function resetPhoto() { ph.z = 1; ph.ox = 0; ph.oy = 0; }

  /* Keep whatever is under (px, py) under (px, py).
     The fit is centre-anchored — x = (W - w) / 2 + ox — so the frame centre
     already holds still when w grows; solving screen(u) for a fixed point
     gives ox' = k·ox + (1 - k)·(px - W/2). Treating ox as a plain top-left
     offset instead slides the picture every time you touch the zoom. */
  function zoomAt(factor, px, py) {
    var z0 = ph.z;
    ph.z = clamp(0.35, ph.z * factor, 6);
    var k = ph.z / z0;
    ph.ox = k * ph.ox + (1 - k) * (px - W / 2);
    ph.oy = k * ph.oy + (1 - k) * (py - H / 2);
    clampPan();
    syncZoom();
  }

  function draw() {
    var g = el.ctx;
    if (!g) return;
    g.clearRect(0, 0, W, H);

    /* Backdrop first, always — once the photo can be zoomed out or panned it
       no longer covers the frame, and a round PFP export would otherwise come
       back with transparent corners. */
    var grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#6b1444');
    grad.addColorStop(1, '#24040f');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    if (photo) {
      var f = fitPhoto();
      if (f) g.drawImage(photo, f.x, f.y, f.w, f.h);
    } else {
      g.fillStyle = 'rgba(255,143,192,.75)';
      g.font = '600 ' + Math.round(W * 0.032) + 'px "Baloo 2", system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('drop a picture in, or just sticker this', W / 2, H * 0.52);
    }

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      drawSticker(g, it.k, it.x, it.y, it.s, it.r, it.f);
    }

    drawCaption(g, el.top.value, 'top');
    drawCaption(g, el.bottom.value, 'bottom');

    /* The ring goes over the lot, because its whole job is to survive whatever
       is underneath it once a client crops the avatar round. */
    if (mode === 'pfp' && ring) drawRing(g);
    if (mode === 'pfp') drawPfpGuide(g);
    if (sel >= 0 && sel < items.length) drawHandles(g, items[sel]);

    /* render() draws too; scheduling from inside it would just chase its own
       tail until the key matched. */
    if (!rendering) schedulePrerender();
  }

  /* Captions are drawn with a heavy ink outline rather than a shadow, because
     a meme gets reposted at whatever size and a soft shadow disappears. */
  function drawCaption(g, txt, where) {
    txt = (txt || '').trim();
    if (!txt) return;
    var size = Math.round(W * (mode === 'pfp' ? 0.11 : 0.085));
    var pad = W * 0.045;
    g.save();
    g.textAlign = 'center';
    g.textBaseline = where === 'top' ? 'top' : 'bottom';
    g.lineJoin = 'round';
    g.miterLimit = 2;

    var lines = wrap(g, txt.toUpperCase(), size, W - pad * 2);
    /* shrink until it fits rather than clipping words off the edge */
    var guard = 0;
    while (lines.length > 3 && size > W * 0.03 && guard++ < 20) {
      size = Math.round(size * 0.88);
      lines = wrap(g, txt.toUpperCase(), size, W - pad * 2);
    }
    var lh = size * 1.06;

    /* Cream text on someone's holiday photo is a coin flip. A soft band that
       fades out costs nothing and makes every caption legible. */
    if (photo) {
      var band = lines.length * lh + pad * 1.5;
      var gy0 = where === 'top' ? 0 : H, gy1 = where === 'top' ? band : H - band;
      var sc = g.createLinearGradient(0, gy0, 0, gy1);
      sc.addColorStop(0, 'rgba(36,4,15,.55)');
      sc.addColorStop(1, 'rgba(36,4,15,0)');
      g.fillStyle = sc;
      g.fillRect(0, where === 'top' ? 0 : H - band, W, band);
    }

    for (var i = 0; i < lines.length; i++) {
      var y = where === 'top' ? pad + i * lh : H - pad - (lines.length - 1 - i) * lh;
      g.font = '400 ' + size + 'px "Luckiest Guy", system-ui, sans-serif';
      g.lineWidth = Math.max(4, size * 0.20);
      g.strokeStyle = '#24040f';
      g.strokeText(lines[i], W / 2, y);
      g.fillStyle = '#ffeccb';
      g.fillText(lines[i], W / 2, y);
    }
    g.restore();
  }

  function wrap(g, txt, size, maxw) {
    g.font = '400 ' + size + 'px "Luckiest Guy", system-ui, sans-serif';
    var words = txt.split(/\s+/), lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var t = cur ? cur + ' ' + words[i] : words[i];
      if (g.measureText(t).width > maxw && cur) { lines.push(cur); cur = words[i]; }
      else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  /* What the circular crop will throw away, shown while you are framing.
     Preview only — render() stubs this out, so none of it reaches the file.
     Without it, "make the picture fit the ring" is guesswork. */
  function drawPfpGuide(g) {
    var R = Math.min(W, H) / 2;
    g.save();
    g.beginPath();
    g.rect(0, 0, W, H);
    g.arc(W / 2, H / 2, R, 0, 6.283);
    g.fillStyle = 'rgba(20,2,9,.62)';
    g.fill('evenodd');
    if (!ring) {
      g.strokeStyle = 'rgba(255,236,203,.55)';
      g.setLineDash([W * 0.02, W * 0.02]);
      g.lineWidth = Math.max(2, W * 0.006);
      g.beginPath(); g.arc(W / 2, H / 2, R - g.lineWidth, 0, 6.283); g.stroke();
    }
    g.restore();
  }

  /* The PFP ring. Nobody should have to place this by hand: switch to PFP and
     it is already there, sized to the circular crop and baked into the export.
     Ink hairlines on both edges so it still reads against a bright photo. */
  function drawRing(g) {
    var R = Math.min(W, H) / 2;
    var w = R * 0.095;
    var cx = W / 2, cy = H / 2;
    g.save();

    var grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#ff2e88');
    grad.addColorStop(0.5, '#ffb0d2');
    grad.addColorStop(1, '#ff2e88');
    g.lineWidth = w;
    g.strokeStyle = grad;
    g.beginPath(); g.arc(cx, cy, R - w / 2, 0, 6.283); g.stroke();

    var hair = Math.max(2, R * 0.013);
    g.lineWidth = hair;
    g.strokeStyle = '#24040f';
    g.beginPath(); g.arc(cx, cy, R - w + hair / 2, 0, 6.283); g.stroke();
    g.beginPath(); g.arc(cx, cy, R - hair / 2, 0, 6.283); g.stroke();

    /* a cream glint on the upper-left, so the ring looks like an object and
       not like a border someone forgot to remove */
    g.lineWidth = w * 0.30;
    g.strokeStyle = 'rgba(255,236,203,.55)';
    g.beginPath(); g.arc(cx, cy, R - w * 0.34, 3.6, 4.9); g.stroke();

    g.restore();
  }

  function drawHandles(g, it) {
    var r = it.s / 2;
    g.save();
    g.translate(it.x, it.y);
    g.rotate(it.r || 0);
    g.strokeStyle = '#ff2e88';
    g.lineWidth = Math.max(2, W * 0.005);
    g.setLineDash([W * 0.012, W * 0.012]);
    g.strokeRect(-r, -r, it.s, it.s);
    g.setLineDash([]);
    /* scale/rotate grip, bottom-right */
    g.fillStyle = '#ff2e88';
    g.beginPath(); g.arc(r, r, W * 0.022, 0, 6.283); g.fill();
    g.strokeStyle = '#24040f'; g.lineWidth = Math.max(2, W * 0.004); g.stroke();
    /* delete, top-left */
    g.fillStyle = '#ffeccb';
    g.beginPath(); g.arc(-r, -r, W * 0.022, 0, 6.283); g.fill();
    g.stroke();
    g.strokeStyle = '#24040f'; g.lineWidth = Math.max(2, W * 0.006);
    var k = W * 0.010;
    g.beginPath();
    g.moveTo(-r - k, -r - k); g.lineTo(-r + k, -r + k);
    g.moveTo(-r + k, -r - k); g.lineTo(-r - k, -r + k);
    g.stroke();
    /* flip, top-right — a keyboard shortcut is no use on a phone */
    g.fillStyle = '#ffeccb';
    g.beginPath(); g.arc(r, -r, W * 0.022, 0, 6.283); g.fill();
    g.strokeStyle = '#24040f'; g.lineWidth = Math.max(2, W * 0.004); g.stroke();
    g.lineWidth = Math.max(2, W * 0.005);
    g.beginPath();
    g.moveTo(r, -r - k); g.lineTo(r, -r + k);
    g.moveTo(r - k * 1.5, -r - k * 0.45); g.lineTo(r - k * 0.55, -r); g.lineTo(r - k * 1.5, -r + k * 0.45);
    g.moveTo(r + k * 1.5, -r - k * 0.45); g.lineTo(r + k * 0.55, -r); g.lineTo(r + k * 1.5, -r + k * 0.45);
    g.stroke();
    g.restore();
  }

  /* ── hit testing ── */

  function toCanvas(e) {
    var b = el.canvas.getBoundingClientRect();
    return { x: (e.clientX - b.left) / view, y: (e.clientY - b.top) / view };
  }

  function local(it, p) {
    var dx = p.x - it.x, dy = p.y - it.y;
    var a = -(it.r || 0), c = Math.cos(a), s = Math.sin(a);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  }

  function pick(p) {
    for (var i = items.length - 1; i >= 0; i--) {
      var q = local(items[i], p), r = items[i].s / 2;
      if (Math.abs(q.x) <= r && Math.abs(q.y) <= r) return i;
    }
    return -1;
  }

  function grip(it, p) {
    if (!it) return null;
    var q = local(it, p), r = it.s / 2, t = W * 0.04;
    if (Math.hypot(q.x - r, q.y - r) <= t) return 'size';
    if (Math.hypot(q.x + r, q.y + r) <= t) return 'del';
    if (Math.hypot(q.x - r, q.y + r) <= t) return 'flip';
    return null;
  }

  /* ── undo ── */

  /* Every destructive or fiddly action pushes one snapshot first. It is a
     toy, so a shallow stack of plain JSON is enough — the photo is not in it,
     only where the photo is sitting. */
  var past = [];
  function snap() {
    past.push(JSON.stringify({ i: items, t: el.top.value, b: el.bottom.value, p: ph, c: autoCap }));
    if (past.length > 30) past.shift();
    syncUndo();
  }
  function undoOnce() {
    var raw = past.pop();
    if (!raw) return;
    var o = JSON.parse(raw);
    items = o.i; el.top.value = o.t; el.bottom.value = o.b;
    ph = o.p; autoCap = !!o.c; sel = -1;
    clampPan(); syncZoom(); draw(); syncUndo();
    setHint('');
  }
  function syncUndo() { if (el.undo) el.undo.disabled = !past.length; }

  /* ── interaction ── */

  var drag = null;
  var pointers = {};

  function onDown(e) {
    el.canvas.setPointerCapture && el.canvas.setPointerCapture(e.pointerId);
    pointers[e.pointerId] = toCanvas(e);
    if (Object.keys(pointers).length === 2) { startPinch(); return; }

    var p = pointers[e.pointerId];
    var g = grip(items[sel], p);
    if (g === 'del') { snap(); items.splice(sel, 1); sel = -1; draw(); return; }
    if (g === 'flip') { snap(); items[sel].f = !items[sel].f; draw(); return; }
    if (g === 'size') {
      var it = items[sel];
      snap();
      drag = { mode: 'size', id: e.pointerId, s0: it.s, r0: it.r || 0,
               d0: Math.hypot(p.x - it.x, p.y - it.y),
               a0: Math.atan2(p.y - it.y, p.x - it.x) };
      return;
    }
    var i = pick(p);
    sel = i;
    if (i >= 0) {
      /* bring to front so the thing you just grabbed is the thing you see */
      var picked = items.splice(i, 1)[0];
      items.push(picked);
      sel = items.length - 1;
      snap();
      drag = { mode: 'move', id: e.pointerId, dx: p.x - picked.x, dy: p.y - picked.y };
    } else if (photo) {
      /* Nothing under the finger and there is a picture: you are moving the
         picture. This is the part nobody guesses, hence the line of help
         under the stage. */
      snap();
      drag = { mode: 'pan', id: e.pointerId, dx: p.x - ph.ox, dy: p.y - ph.oy };
    }
    draw();
  }

  var pinch = null;
  function startPinch() {
    drag = null;
    var ids = Object.keys(pointers);
    var a = pointers[ids[0]], b = pointers[ids[1]];
    var base = { d0: Math.hypot(b.x - a.x, b.y - a.y) || 1,
                 a0: Math.atan2(b.y - a.y, b.x - a.x) };
    if (sel >= 0) {
      var it = items[sel];
      base.what = 'item'; base.s0 = it.s; base.r0 = it.r || 0;
    } else if (photo) {
      snap();
      base.what = 'photo'; base.z0 = ph.z; base.ox = ph.ox; base.oy = ph.oy;
      base.cx = (a.x + b.x) / 2; base.cy = (a.y + b.y) / 2;
    } else return;
    pinch = base;
  }

  function onMove(e) {
    if (!(e.pointerId in pointers)) return;
    pointers[e.pointerId] = toCanvas(e);
    if (e.cancelable) e.preventDefault();

    var ids = Object.keys(pointers);
    if (pinch && ids.length === 2) {
      var a = pointers[ids[0]], b = pointers[ids[1]];
      var d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      var ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (pinch.what === 'item' && sel >= 0) {
        var it = items[sel];
        it.s = clamp(W * 0.06, pinch.s0 * (d / pinch.d0), W * 1.6);
        it.r = pinch.r0 + (ang - pinch.a0);
      } else if (pinch.what === 'photo') {
        var k = clamp(0.35, pinch.z0 * (d / pinch.d0), 6) / pinch.z0;
        ph.z = pinch.z0 * k;
        ph.ox = k * pinch.ox + (1 - k) * (pinch.cx - W / 2);
        ph.oy = k * pinch.oy + (1 - k) * (pinch.cy - H / 2);
        clampPan(); syncZoom();
      }
      draw();
      return;
    }
    if (!drag || drag.id !== e.pointerId) return;
    var p = pointers[e.pointerId];
    var t = items[sel];
    if (drag.mode === 'pan') {
      ph.ox = p.x - drag.dx; ph.oy = p.y - drag.dy;
      clampPan(); draw();
      return;
    }
    if (!t) return;
    if (drag.mode === 'move') {
      t.x = p.x - drag.dx; t.y = p.y - drag.dy;
    } else if (drag.mode === 'size') {
      var d2 = Math.hypot(p.x - t.x, p.y - t.y);
      t.s = clamp(W * 0.06, drag.s0 * (d2 / (drag.d0 || 1)), W * 1.6);
      t.r = drag.r0 + (Math.atan2(p.y - t.y, p.x - t.x) - drag.a0);
    }
    draw();
  }

  function onUp(e) {
    delete pointers[e.pointerId];
    if (Object.keys(pointers).length < 2) pinch = null;
    if (drag && drag.id === e.pointerId) drag = null;
  }

  function clamp(a, v, b) { return v < a ? a : v > b ? b : v; }

  /* ── palette ── */

  function paintPalette() {
    el.palette.innerHTML = '';
    STICKERS.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ml-chip';
      b.title = s.n;
      b.setAttribute('aria-label', 'Add ' + s.n);
      var c = document.createElement('canvas');
      c.width = 128; c.height = 128;
      var g = c.getContext('2d');
      g.clearRect(0, 0, 128, 128);
      if (!drawSticker(g, s.k, 64, 64, 118, 0)) {
        g.fillStyle = '#6b1444';
        g.beginPath(); g.arc(64, 64, 46, 0, 6.283); g.fill();
      }
      b.appendChild(c);
      b.addEventListener('click', function () { addSticker(s.k); });
      el.palette.appendChild(b);
    });
  }

  function addSticker(k) {
    /* Dropped slightly off-centre and rotated a touch each time, so stacking
       three does not look like one. */
    snap();
    var n = items.length;
    items.push({
      k: k,
      x: W * (0.5 + (n % 3 - 1) * 0.07),
      y: H * (0.5 + ((n / 3 | 0) % 3 - 1) * 0.07),
      s: W * 0.34,
      r: ((n * 37) % 21 - 10) * Math.PI / 180
    });
    sel = items.length - 1;
    draw();
    setHint('');
  }

  /* ── one tap ── */

  function pickOne(arr) { return arr[Math.random() * arr.length | 0]; }

  /* SURPRISE ME. One press has to produce something postable, so: keep the
     middle clear (that is where a face is), ring the edges with a handful of
     stickers at mixed sizes and angles, never let two overlap, and stay inside
     the circle when we are making a PFP. */
  function autoCompose() {
    snap();
    var minDim = Math.min(W, H);
    var pfp = (mode === 'pfp');
    var cx = W / 2, cy = H / 2;

    /* lead with a mouth, fill from the rest — a meme with no lips in it is
       not a CUNA meme */
    var picks = [pickOne(['open', 'closed'])];
    var bag = ['open', 'closed', 'power', 'pellet', 'badge', 'jeet', 'ruggy', 'fudd', 'paper', 'fright']
      .filter(function (k) { return k !== picks[0]; });
    var wanted = 3 + (Math.random() * 2 | 0);
    while (picks.length < wanted && bag.length) {
      picks.push(bag.splice(Math.random() * bag.length | 0, 1)[0]);
    }

    var placed = [];
    var rad = minDim * (pfp ? 0.29 : 0.34);
    var inner = pfp ? minDim * 0.40 : 0;     /* the ring eats the outer edge */
    var a0 = Math.random() * 6.283;

    for (var i = 0; i < picks.length; i++) {
      var size = minDim * (pfp ? 0.17 + Math.random() * 0.10 : 0.20 + Math.random() * 0.14);
      var spot = null;
      for (var t = 0; t < 60 && !spot; t++) {
        var ang = a0 + (i / picks.length) * 6.283 + (Math.random() - 0.5) * 0.85;
        var d = rad * (0.80 + Math.random() * 0.40);
        var x = cx + Math.cos(ang) * d;
        var y = cy + Math.sin(ang) * d;
        var half = size / 2;
        if (pfp) {
          if (Math.hypot(x - cx, y - cy) + half * 0.86 > inner) continue;
        } else {
          x = clamp(half * 0.72, x, W - half * 0.72);
          y = clamp(half * 0.72, y, H - half * 0.72);
        }
        var clear = true;
        for (var j = 0; j < placed.length; j++) {
          if (Math.hypot(x - placed[j].x, y - placed[j].y) < (size + placed[j].s) * 0.42) { clear = false; break; }
        }
        if (clear) spot = { x: x, y: y };
      }
      if (!spot) continue;
      placed.push({ k: picks[i], x: spot.x, y: spot.y, s: size,
                    r: (Math.random() * 44 - 22) * Math.PI / 180,
                    f: Math.random() < 0.5 });
    }

    items = placed;
    sel = -1;

    /* Captions: fill them in too, but never clobber something the user typed
       themselves — only lines we put there. */
    if (pfp) {
      if (autoCap) { el.top.value = ''; el.bottom.value = ''; autoCap = false; }
    } else if (autoCap || (!el.top.value && !el.bottom.value)) {
      var line = pickOne(LINES), guard = 0;
      while (line === el.top.value.toLowerCase() && guard++ < 8) line = pickOne(LINES);
      el.top.value = line;
      el.bottom.value = '$CUNA';
      autoCap = true;
    }

    if (pfp && !ring) { ring = true; syncRing(); }
    draw();
    setHint(pfp ? 'Ring is on and it is already framed. Tap again for another.'
                : 'Tap again for a different one, or drag anything to move it.');
  }

  /* ── photo in ── */

  /* A 12-megapixel phone photo drags like treacle and buys nothing at 1080px
     across. Downscale once on the way in and everything after is smooth. */
  function shrink(im) {
    var iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
    var max = Math.max(iw, ih), cap = 2400;
    if (max <= cap) return im;
    var k = cap / max;
    var c = document.createElement('canvas');
    c.width = Math.round(iw * k); c.height = Math.round(ih * k);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return c;
  }

  function readFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { setHint('That is not an image.'); return; }
    if (file.size > 20 * 1024 * 1024) { setHint('That picture is over 20MB — try a smaller one.'); return; }
    var fr = new FileReader();
    fr.onload = function () {
      var im = new Image();
      im.onload = function () {
        snap();
        photo = shrink(im);
        photo.__cunaId = ++photoSeq;
        resetPhoto();
        syncPhotoUI();
        /* "use your pic to make something cool" — so the first picture in
           lays itself out. Anything already placed by hand is left alone. */
        if (!items.length) autoCompose();
        else draw();
        setHint('Drag the picture to move it, or use the zoom slider.');
      };
      im.onerror = function () { setHint('Could not read that picture.'); };
      im.src = fr.result;
    };
    fr.onerror = function () { setHint('Could not read that file.'); };
    fr.readAsDataURL(file);
  }

  function setHint(t) { if (el.hint) el.hint.textContent = t || ''; }

  /* One way in and out of a mode, so the click handler and the test hook can
     never drift apart. Captions we wrote ourselves come off in PFP — they land
     on the ring and nobody wants a round avatar with a slogan across it. */
  function applyMode(m) {
    mode = m;
    if (m === 'pfp' && autoCap) { el.top.value = ''; el.bottom.value = ''; autoCap = false; }
    document.querySelectorAll('[data-ml="mode"]').forEach(function (x) {
      x.setAttribute('aria-pressed', x.getAttribute('data-mode') === m ? 'true' : 'false');
    });
    syncRing();
    clampPan();
    layout();
  }

  function syncZoom() {
    if (el.zoom && document.activeElement !== el.zoom) el.zoom.value = Math.round(ph.z * 100);
  }

  /* The photo controls are noise until there is a photo. */
  function syncPhotoUI() {
    if (el.photoRow) el.photoRow.hidden = !photo;
    syncZoom();
  }

  /* The ring only means anything on a round crop, so its control only exists
     in PFP mode. */
  function syncRing() {
    if (!el.ring) return;
    el.ring.hidden = (mode !== 'pfp');
    el.ring.setAttribute('aria-pressed', ring ? 'true' : 'false');
    el.ring.textContent = ring ? 'RING ON' : 'RING OFF';
  }

  /* ── export ── */

  var rendering = false;

  /* The export, drawn but not yet encoded. */
  function buildExport() {
    rendering = true;
    var out = document.createElement('canvas');
    out.width = W; out.height = H;
    var g = out.getContext('2d');
    var keepSel = sel, keepCtx = el.ctx;
    sel = -1;                       /* handles and the crop ring are UI, not art */
    var pfp = (mode === 'pfp');
    el.ctx = g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    var realDraw = drawPfpGuide;
    drawPfpGuide = function () { };
    try { draw(); } finally {
      drawPfpGuide = realDraw;
      el.ctx = keepCtx; sel = keepSel;
    }
    if (pfp) {
      /* Round it here rather than trusting every client to crop the same way. */
      var round = document.createElement('canvas');
      round.width = W; round.height = H;
      var rg = round.getContext('2d');
      rg.save();
      rg.beginPath(); rg.arc(W / 2, H / 2, Math.min(W, H) / 2, 0, 6.283); rg.closePath(); rg.clip();
      rg.drawImage(out, 0, 0);
      rg.restore();
      out = round;
    }
    draw();
    rendering = false;
    return out;
  }

  function render(cb) {
    var out = buildExport();
    out.toBlob(function (blob) { cb(blob, out); }, 'image/png');
  }

  /* A finished PNG with no await anywhere: toDataURL encodes synchronously,
     and base64 unpacks synchronously, so this can run inside a click and the
     share sheet still counts the gesture as live. Costs a short freeze, which
     is a fair trade against sharing yesterday's picture. */
  function renderFileSync() {
    try {
      var url = buildExport().toDataURL('image/png');
      var bin = atob(url.slice(url.indexOf(',') + 1));
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new File([new Blob([arr], { type: 'image/png' })], 'cuna.png', { type: 'image/png' });
    } catch (e) { return null; }
  }

  function saveBlob(blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'cuna-' + mode + '-' + Date.now() + '.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /* Safari — which is every iPhone — only lets you call navigator.share or
     clipboard.write while the user gesture is still alive, and toBlob is
     async, so by the time the PNG exists the gesture is gone and the share
     dies silently. Keep a finished PNG on hand instead: the click then hands
     the file straight over with nothing to wait for. */
  var cache = { blob: null, key: '', busy: false };
  var photoSeq = 0;

  function stateKey() {
    return [mode, ring, photoFit, el.top.value, el.bottom.value,
            ph.z.toFixed(3), Math.round(ph.ox), Math.round(ph.oy),
            photo ? photo.__cunaId : 0,
            items.map(function (i) {
              return i.k + Math.round(i.x) + ',' + Math.round(i.y) + ',' +
                     Math.round(i.s) + ',' + (i.r || 0).toFixed(2) + (i.f ? 'f' : '');
            }).join(';')].join('|');
  }

  var preT = 0;
  function schedulePrerender() {
    clearTimeout(preT);
    preT = setTimeout(function () {
      var key = stateKey();
      if (cache.busy || cache.key === key) return;
      cache.busy = true;
      render(function (blob) {
        cache.busy = false;
        if (blob) { cache.blob = blob; cache.key = key; }
      });
    }, 700);
  }

  /* The ready-made file, or null when the picture has moved on since. */
  function freshFile() {
    if (!cache.blob || cache.key !== stateKey()) return null;
    try { return new File([cache.blob], 'cuna.png', { type: 'image/png' }); } catch (e) { return null; }
  }

  function renderBlob() {
    return new Promise(function (res, rej) {
      render(function (blob) { blob ? res(blob) : rej(new Error('no blob')); });
    });
  }

  /* A share sheet is the right answer on a phone — it hands X the actual file
     — and the wrong one on a desktop, where it opens an OS dialog that
     usually cannot post to X at all. */
  function handheld() {
    return (navigator.maxTouchPoints || 0) > 0 &&
           !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  }

  function canShareFile(f) {
    return !!(f && navigator.share && navigator.canShare && navigator.canShare({ files: [f] }));
  }

  function download() {
    render(function (blob) {
      if (!blob) { setHint('Could not build the image.'); return; }
      saveBlob(blob);
      setHint('Saved. Go and post it.');
    });
  }

  /* The post X gets, written for you. No numbers, no claims — the picture is
     the point. Whatever is on the top line leads, if there is one. */
  function xText() {
    var top = (el.top.value || '').trim();
    var lead = top ? '“' + top.toUpperCase() + '”' : 'made this in the $CUNA meme lab';
    return lead + '\n\n$CUNA 👅 @cunatoken\nhttps://cunatoken.com/meme.html';
  }

  function xUrl() {
    return 'https://x.com/intent/post?text=' + encodeURIComponent(xText());
  }

  /* Two ways the picture can travel, and the device decides which. */
  function postToX() {
    /* Phone: the share sheet carries the PNG itself into the X app, so the
       picture never has to touch the camera roll. Use the export kept warm in
       the background, or build one on the spot if it has gone stale — either
       way it is the picture on screen right now. */
    var f = freshFile() || (handheld() ? renderFileSync() : null);
    if (handheld() && canShareFile(f)) {
      setHint('Pick X — the picture goes with it.');
      navigator.share({ files: [f], text: xText() }).then(function () { }, function (err) {
        /* cancelled is not a failure; anything else falls back to the composer */
        if (err && err.name === 'AbortError') { setHint(''); return; }
        clipboardRoute();
      });
      return;
    }
    clipboardRoute();
  }

  /* Desktop, or a phone that will not share files. X's web intent cannot
     carry an image, so the PNG goes to the clipboard and the composer opens
     with the words already written.

     Three things this has to get right, none of which show up headless:
       - the tab opens only after the write has settled; opening it first
         moves focus, and a clipboard commit on an unfocused document is
         refused;
       - a real Blob goes in whenever one is ready, because not every browser
         accepts a Promise inside ClipboardItem;
       - the "now paste it" instruction has to survive on this page, since
         the tab that would carry it is the one taking focus away. */
  function clipboardRoute() {
    writeClipboard(function (how) { openComposer(how); });
  }

  /* Shared by POST TO X and COPY IT AGAIN. Reports 'copied', 'saved' (the
     browser refused, so it is in the downloads folder instead) or 'failed'. */
  function writeClipboard(done) {
    var fresh = (cache.blob && cache.key === stateKey()) ? cache.blob : null;
    var ready = fresh ? Promise.resolve(fresh) : renderBlob();

    var wrote = null;
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        wrote = navigator.clipboard.write([new ClipboardItem({ 'image/png': fresh || ready })]);
      }
    } catch (e) { wrote = null; }

    var saveInstead = function () {
      ready.then(function (b) { saveBlob(b); done('saved'); }, function () { done('failed'); });
    };
    if (!wrote) { saveInstead(); return; }
    wrote.then(function () { done('copied'); }, saveInstead);
  }

  function openComposer(how) {
    /* Opened with noopener, which by spec returns null — so there is no way
       to tell an opened tab from a blocked one. The link is therefore always
       offered: redundant when the tab opened, and the only way through when
       it did not. */
    try { window.open(xUrl(), '_blank', 'noopener'); } catch (e) { }
    showXPanel(how, xUrl());
  }

  var PASTE = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '') ? '⌘V' : 'Ctrl+V';

  /* What just happened and what to do about it — stated on this page, where
     it can still be read, with a way out of every failure. */
  function showXPanel(how, url) {
    var box = $('ml-xpanel');
    if (!box) return;
    while (box.firstChild) box.removeChild(box.firstChild);
    box.hidden = false;

    var msg = document.createElement('p');
    msg.className = 'ml-xmsg';
    msg.textContent =
      how === 'copied' ? 'Picture copied. Over in the X tab, press ' + PASTE + ' to drop it into the post.' :
      how === 'saved' ? 'This browser would not let us copy the picture, so it went to your downloads — drag that file into the post.' :
                        'Could not build the picture. Try SAVE PNG.';
    box.appendChild(msg);

    var row = document.createElement('div');
    row.className = 'ml-row';
    if (url) {
      var a = document.createElement('a');
      a.className = 'btn btn-buy btn-sm';
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = 'OPEN THE POST →';
      row.appendChild(a);
    }
    [['copyimg', 'COPY IT AGAIN'], ['save', 'SAVE PNG']].forEach(function (b) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost btn-sm';
      btn.setAttribute('data-ml', b[0]);
      btn.textContent = b[1];
      row.appendChild(btn);
    });
    box.appendChild(row);
  }

  /* Copying on its own, for when the X tab is already open: come back here,
     press it, switch over, paste. */
  function copyImage() {
    writeClipboard(function (how) {
      setHint(how === 'copied' ? 'Copied. Press ' + PASTE + ' in the post.'
            : how === 'saved' ? 'Copying is blocked here — saved it instead.'
                              : 'Could not build the picture.');
    });
  }

  function share() {
    var f = freshFile() || renderFileSync();
    if (canShareFile(f)) {
      navigator.share({ files: [f], text: 'CUNA cummin’ for ya 💦 cunatoken.com' })
        .then(function () { }, function () { });
      return;
    }
    /* No share sheet, or the picture changed a moment ago: clipboard, then a
       download. */
    writeClipboard(function (how) {
      setHint(how === 'copied' ? 'Copied. Paste it anywhere.'
            : how === 'saved' ? 'Saved. Go and post it.'
                              : 'Could not build the picture.');
    });
  }

  /* ── boot ── */

  function init() {
    el.stage = $('ml-stage');
    if (!el.stage) return;
    el.canvas = $('ml-canvas');
    el.ctx = el.canvas.getContext('2d');
    el.palette = $('ml-palette');
    el.top = $('ml-top');
    el.bottom = $('ml-bottom');
    el.hint = $('ml-hint');
    el.file = $('ml-file');
    el.ring = document.querySelector('[data-ml="ring"]');
    el.zoom = $('ml-zoom');
    el.photoRow = $('ml-photo');
    el.undo = document.querySelector('[data-ml="undo"]');

    /* Say what will actually happen on the device in hand, rather than making
       everyone read both halves. */
    var note = $('ml-xnote');
    if (note) {
      note.textContent = handheld()
        ? 'POST TO X sends the picture itself through the share sheet — pick X and it arrives attached, with the words already written. Nothing to save first.'
        : 'X cannot take an image through a link, so the picture lands on your clipboard and the post opens with the words already written. Paste it in and post.';
    }

    loadAssets();
    paintPalette();
    syncRing();
    syncPhotoUI();
    syncUndo();
    layout();

    el.canvas.addEventListener('pointerdown', onDown);
    el.canvas.addEventListener('pointermove', onMove);
    el.canvas.addEventListener('pointerup', onUp);
    el.canvas.addEventListener('pointercancel', onUp);

    if (el.zoom) {
      var zSnapped = false;
      el.zoom.addEventListener('pointerdown', function () { zSnapped = false; });
      el.zoom.addEventListener('input', function () {
        if (!photo) return;
        if (!zSnapped) { snap(); zSnapped = true; }
        var want = clamp(0.35, Number(el.zoom.value) / 100, 6);
        zoomAt(want / ph.z, W / 2, H / 2);
        draw();
      });
      el.zoom.addEventListener('change', function () { zSnapped = false; });
    }

    /* Wheel scales whatever you are working on: the selected sticker, or the
       picture under the pointer if nothing is selected. */
    el.canvas.addEventListener('wheel', function (e) {
      var k = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      if (sel >= 0 && items[sel]) {
        e.preventDefault();
        items[sel].s = clamp(W * 0.06, items[sel].s * k, W * 1.6);
        draw();
      } else if (photo) {
        e.preventDefault();
        var p = toCanvas(e);
        zoomAt(k, p.x, p.y);
        draw();
      }
    }, { passive: false });

    /* Once someone types their own line, SURPRISE ME stops rewriting it. */
    var typed = function () { autoCap = false; draw(); };
    el.top.addEventListener('input', typed);
    el.bottom.addEventListener('input', typed);

    el.file.addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) readFile(e.target.files[0]);
    });

    /* drag and drop onto the canvas */
    ['dragenter', 'dragover'].forEach(function (t) {
      el.stage.addEventListener(t, function (e) { e.preventDefault(); el.stage.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      el.stage.addEventListener(t, function (e) { e.preventDefault(); el.stage.classList.remove('is-over'); });
    });
    el.stage.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
    });

    /* paste a screenshot straight in */
    document.addEventListener('paste', function (e) {
      var it = e.clipboardData && e.clipboardData.items;
      if (!it) return;
      for (var i = 0; i < it.length; i++) {
        if (it[i].type && it[i].type.indexOf('image') === 0) { readFile(it[i].getAsFile()); return; }
      }
    });

    document.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-ml]') : null;
      if (!b) return;
      var a = b.getAttribute('data-ml');
      if (a === 'mode') {
        applyMode(b.getAttribute('data-mode'));
      } else if (a === 'auto') {
        autoCompose();
      } else if (a === 'ring') {
        ring = !ring;
        syncRing();
        draw();
      } else if (a === 'x') {
        postToX();
      } else if (a === 'copyimg') {
        copyImage();
      } else if (a === 'undo') {
        undoOnce();
      } else if (a === 'recenter') {
        snap(); resetPhoto(); syncZoom(); draw(); setHint('Picture back where it started.');
      } else if (a === 'fit') {
        snap();
        photoFit = photoFit === 'cover' ? 'contain' : 'cover';
        b.textContent = photoFit === 'cover' ? 'FILL' : 'FIT';
        clampPan(); draw();
      } else if (a === 'clear') {
        snap();
        items = []; sel = -1; el.top.value = ''; el.bottom.value = ''; autoCap = false; draw();
      } else if (a === 'drop') {
        snap();
        photo = null; resetPhoto(); syncPhotoUI(); draw(); setHint('');
      } else if (a === 'save') download();
      else if (a === 'share') share();
    });

    document.addEventListener('keydown', function (e) {
      if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      var k = e.key;
      if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'Z')) { e.preventDefault(); undoOnce(); return; }
      if ((k === 'Delete' || k === 'Backspace') && sel >= 0) {
        e.preventDefault(); snap(); items.splice(sel, 1); sel = -1; draw(); return;
      }
      if ((k === 'f' || k === 'F') && sel >= 0) {
        e.preventDefault(); snap(); items[sel].f = !items[sel].f; draw(); return;
      }
      /* Arrows nudge whatever is selected, or the picture when nothing is. */
      var dx = (k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0);
      var dy = (k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0);
      if (dx || dy) {
        var step = W * (e.shiftKey ? 0.04 : 0.01);
        if (sel >= 0 && items[sel]) {
          e.preventDefault(); items[sel].x += dx * step; items[sel].y += dy * step; draw();
        } else if (photo) {
          e.preventDefault(); ph.ox += dx * step; ph.oy += dy * step; clampPan(); draw();
        }
      }
    });

    if (window.ResizeObserver) {
      new ResizeObserver(function () { scheduleLayout(0); }).observe(el.stage);
    }
    window.addEventListener('resize', function () { scheduleLayout(80); });
    window.addEventListener('load', function () { scheduleLayout(0); });

    /* Webfonts land after first paint and canvas text does not reflow, so the
       caption has to be redrawn once they are actually available. */
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { draw(); });
    }

    /* Test hook: non-visual, awards nothing. */
    el.stage.__cuna = {
      s: function () {
        return { mode: mode, W: W, H: H, items: items.length, sel: sel,
                 photo: !!photo, top: el.top.value, bottom: el.bottom.value,
                 ring: ring, autoCap: autoCap, z: ph.z, flips: items.filter(function (i) { return i.f; }).length };
      },
      add: function (k) { addSticker(k); return items.length; },
      setMode: function (m) { applyMode(m); },
      auto: function () { autoCompose(); return items.map(function (i) { return { k: i.k, x: i.x, y: i.y, s: i.s }; }); },
      photo: function () { return { z: ph.z, ox: ph.ox, oy: ph.oy, fit: photoFit, box: fitPhoto() }; },
      zoom: function (z) { if (z !== undefined) { zoomAt(z / ph.z, W / 2, H / 2); draw(); } return ph.z; },
      pan: function (x, y) { ph.ox += x; ph.oy += y; clampPan(); draw(); return { ox: ph.ox, oy: ph.oy }; },
      undo: function () { undoOnce(); return past.length; },
      undoDepth: function () { return past.length; },
      cached: function () { return { has: !!cache.blob, fresh: !!cache.blob && cache.key === stateKey(), bytes: cache.blob ? cache.blob.size : 0 }; },
      postToX: function () { postToX(); },
      handheld: handheld,
      syncFile: function () { var f = renderFileSync(); return f ? f.size : 0; },
      ring: function (v) { if (v !== undefined) { ring = !!v; syncRing(); draw(); } return ring; },
      xUrl: xUrl,
      render: function () { return new Promise(function (res) { render(function (b, c) { res({ w: c.width, h: c.height, bytes: b ? b.size : 0 }); }); }); }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
