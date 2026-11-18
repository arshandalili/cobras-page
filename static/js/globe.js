/* Sphere figures for the COBRAS page.
 * One toy activation sphere (toy.js) is shared by every figure; each figure is a small controller around
 * a Globe: an orthographic canvas projection with KaTeX labels laid over it. Drag rotates, click steers.
 */
(function () {
  'use strict';
  const T = window.CobrasToy;
  if (!T) return;
  const { DEG, clamp, dot, add, sub, mul, len, unit, geo, logmap, expmap, slerp, tangent, fromLL, toLL } = T;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // ── palette: owned by the stylesheet, read once ─────────────────────────────────────────────
  const hex = h => { h = (h || '#000').trim().replace('#', ''); if (h.length === 3) h = [...h].map(c => c + c).join(''); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  let PAL = null;
  function pal() {
    if (PAL) return PAL;
    const cs = getComputedStyle(document.documentElement), g = n => hex(cs.getPropertyValue(n));
    PAL = { bg: g('--bg'), ink: g('--ink'), muted: g('--muted'), plus: g('--plus'), minus: g('--minus'), gray: g('--field-gray'),
      globeA: g('--globe-a'), globeB: g('--globe-b'), line: g('--globe-line'), rim: g('--globe-rim'), ref: g('--ref-dot'),
      stepLo: g('--step-lo'), stepHi: g('--step-hi'), matLo: g('--mat-lo') };
    return PAL;
  }
  const tex = (el, s) => { if (window.katex) window.katex.render(s, el, { throwOnError: false }); else el.textContent = s; return el; };

  // ── the shared toy model ────────────────────────────────────────────────────────────────────
  const SC = T.scene();
  const OPTS = { eps: (20 * DEG) ** 2, bw: (12 * DEG) ** 2, bg: (8 * DEG) ** 2, T: 0.55, K: 10, kappa: 3, p: 0.7 };
  const OOD = [36, -84];                                // a prompt with no contrastive support: g = 0 here
  const LAB_MINUS = [-34, -52], LAB_PLUS = [41, 30];
  const makeModel = (o = {}) => new T.Bridge(SC.Dm, SC.Dp, Object.assign({}, OPTS, o)).calibrate(SC.Dref);
  const FIXED_ALPHA = 1.0;
  const densify = (path, n = 6) => { const out = [path[0]]; for (let k = 1; k < path.length; k++) for (let s = 1; s <= n; s++) out.push(slerp(path[k - 1], path[k], s / n)); return out; };
  const along = (path, f) => {                         // point at fraction f ∈ [0,1] of a polyline on S²
    const x = clamp(f, 0, 1) * (path.length - 1), i = Math.min(Math.floor(x), path.length - 2);
    return path.length < 2 ? path[0] : slerp(path[i], path[i + 1], x - i);
  };
  function fib(n) {
    const pts = [], ga = Math.PI * (3 - Math.sqrt(5));
    for (let k = 0; k < n; k++) { const y = 1 - 2 * (k + 0.5) / n, r = Math.sqrt(1 - y * y), th = ga * k; pts.push([r * Math.sin(th), y, r * Math.cos(th)]); }
    return pts;
  }

  // lat/lon textures: a function of the sphere point, sampled once and reused while the view rotates
  function texture(fn, w = 256, h = 128) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let r = 0; r < h; r++) {
      const lat = 90 - (r + 0.5) * 180 / h;
      for (let c = 0; c < w; c++) {
        const lon = -180 + (c + 0.5) * 360 / w, o = (r * w + c) * 4, v = fn(fromLL(lat, lon), lat, lon);
        if (v) { data[o] = v[0]; data[o + 1] = v[1]; data[o + 2] = v[2]; data[o + 3] = v[3]; }
      }
    }
    return { data, w, h };
  }
  let HALO = null;                                      // soft clouds behind p₋ and p₊ (like the shaded regions in the paper)
  function halo() {
    if (HALO) return HALO;
    const P = pal(), b = 2 * (8.5 * DEG) ** 2;
    // terms beyond ~32° are below e^-7 of the peak: skip them before paying for acos and exp
    const kde = (x, D) => { let s = 0; for (const h of D) { const c = dot(x, h); if (c > 0.85) s += Math.exp(-(Math.acos(Math.min(1, c)) ** 2) / b); } return s; };
    let mm = 0, mp = 0; SC.Dm.forEach(h => { mm = Math.max(mm, kde(h, SC.Dm)); }); SC.Dp.forEach(h => { mp = Math.max(mp, kde(h, SC.Dp)); });
    HALO = texture(x => {
      const a = smooth(0.05, 0.55, kde(x, SC.Dm) / mm), c = smooth(0.05, 0.55, kde(x, SC.Dp) / mp);
      if (a < 0.01 && c < 0.01) return null;
      const col = a >= c ? P.minus : P.plus, al = Math.max(a, c);
      return [col[0], col[1], col[2], 255 * 0.16 * al];
    }, 160, 80);                                        // a soft blur: a coarse grid is enough
    return HALO;
  }

  // ── Globe: the view center sits at lon = −yaw, lat = pitch ──────────────────────────────────
  class Globe {
    constructor(host, o = {}) {
      this.host = host;
      this.o = Object.assign({ yaw: 4, pitch: 12, fill: 0.9, cx: 0.5, cy: 0.5, drag: true }, o);
      this.canvas = document.createElement('canvas');
      this.canvas.setAttribute('aria-hidden', 'true');
      this.layer = document.createElement('div');
      this.layer.className = 'glabels';
      host.append(this.canvas, this.layer);
      this.ctx = this.canvas.getContext('2d');
      this.off = document.createElement('canvas');
      this.labels = new Map();
      this.dirty = true;
      this.setView(this.o.yaw, this.o.pitch);
      this.resize();
      new ResizeObserver(() => { this.resize(); this.dirty = true; }).observe(host);
      if (this.o.drag) this.bindPointer();
    }
    resize() {
      const w = this.host.clientWidth, h = this.host.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (!w || !h) return;
      Object.assign(this, { w, h, dpr });
      this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
      this.cx = w * this.o.cx; this.cy = h * this.o.cy;
      this.R = Math.min(w, h) / 2 * this.o.fill;
    }
    setView(yaw, pitch) {                               // view = Rx(pitch) · Ry(yaw) · world
      this.yaw = yaw; this.pitch = clamp(pitch, -75, 75);
      const a = this.yaw * DEG, b = this.pitch * DEG, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
      this.M = [ca, 0, sa, sb * sa, cb, -sb * ca, -cb * sa, sb, cb * ca];
      this.dirty = true;
    }
    proj(p) {
      const M = this.M, x = M[0] * p[0] + M[1] * p[1] + M[2] * p[2], y = M[3] * p[0] + M[4] * p[1] + M[5] * p[2], z = M[6] * p[0] + M[7] * p[1] + M[8] * p[2];
      return [this.cx + this.R * x, this.cy - this.R * y, z];
    }
    unproj(sx, sy) {
      const x = (sx - this.cx) / this.R, y = (this.cy - sy) / this.R, r2 = x * x + y * y;
      if (r2 > 1) return null;
      const z = Math.sqrt(1 - r2), M = this.M;
      return unit([M[0] * x + M[3] * y + M[6] * z, M[1] * x + M[4] * y + M[7] * z, M[2] * x + M[5] * y + M[8] * z]);
    }
    bindPointer() {
      const c = this.canvas; let st = null;
      const at = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      c.addEventListener('pointerdown', e => {
        st = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch, moved: false };
        c.setPointerCapture(e.pointerId);
      });
      c.addEventListener('pointermove', e => {
        if (st) {
          const dx = e.clientX - st.x, dy = e.clientY - st.y;
          if (!st.moved && Math.hypot(dx, dy) > 5) { st.moved = true; c.classList.add('dragging'); }
          if (st.moved) { this.setView(st.yaw + dx * 0.32, st.pitch + dy * 0.32); this.onView && this.onView(); }
        } else if (this.onHover) this.onHover(this.unproj(...at(e)));
      });
      c.addEventListener('pointerup', e => {
        if (!st) return;
        const moved = st.moved; st = null; c.classList.remove('dragging');
        if (!moved && this.onClick) { const p = this.unproj(...at(e)); if (p) this.onClick(p); }
      });
      c.addEventListener('pointercancel', () => { st = null; c.classList.remove('dragging'); });
      c.addEventListener('pointerleave', () => { if (!st && this.onHover) this.onHover(null); });
    }

    // drawing ---------------------------------------------------------------------------------
    begin() { const { ctx, dpr } = this; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, this.w, this.h); }
    body() {
      const { ctx, cx, cy, R } = this, P = pal();
      const g = ctx.createRadialGradient(cx - R * 0.38, cy - R * 0.42, R * 0.05, cx, cy, R * 1.02);
      g.addColorStop(0, rgba(P.globeA)); g.addColorStop(1, rgba(P.globeB));
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.fillStyle = g; ctx.fill();
    }
    rim() { const { ctx, cx, cy, R } = this; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.lineWidth = 1.2; ctx.strokeStyle = rgba(pal().rim); ctx.stroke(); }
    clipped(fn) { const { ctx, cx, cy, R } = this; ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.clip(); fn(); ctx.restore(); }
    graticule(step = 30) {
      const { ctx } = this, P = pal();
      ctx.lineWidth = 0.9; ctx.strokeStyle = rgba(P.line); ctx.setLineDash([2.5, 3.5]);
      ctx.beginPath();
      for (let lon = -180; lon < 180; lon += step) { const pts = []; for (let lat = -90; lat <= 90; lat += 3) pts.push(fromLL(lat, lon)); this.trace(pts); }
      for (let lat = -60; lat <= 60; lat += step) { const pts = []; for (let lon = -180; lon <= 180; lon += 3) pts.push(fromLL(lat, lon)); this.trace(pts); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    trace(pts, minZ = 0) {                              // add the front-facing parts of a polyline to the current path
      const { ctx } = this; let pen = false;
      for (const p of pts) { const [x, y, z] = this.proj(p); if (z >= minZ) { if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y); pen = true; } else pen = false; }
    }
    line(pts, color, { width = 1.6, alpha = 1, dash = null, cap = 'round' } = {}) {
      const { ctx } = this;
      ctx.beginPath(); this.trace(pts);
      ctx.lineWidth = width; ctx.lineCap = cap; ctx.lineJoin = 'round'; ctx.strokeStyle = rgba(color, alpha);
      if (dash) ctx.setLineDash(dash);
      ctx.stroke(); ctx.setLineDash([]);
    }
    arc(a, b, n = 14) { const pts = []; for (let k = 0; k <= n; k++) pts.push(slerp(a, b, k / n)); return pts; }
    dot(p, color, r = 3.2, { alpha = 1, ring = 1.6, stroke = null, sw = 1.5, sa = 1 } = {}) {
      const { ctx } = this, [x, y, z] = this.proj(p);
      if (z <= 0) return false;
      const a = alpha * smooth(0, 0.22, z);
      if (ring) { ctx.beginPath(); ctx.arc(x, y, r + ring, 0, 2 * Math.PI); ctx.fillStyle = rgba(pal().bg, a); ctx.fill(); }
      ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fillStyle = rgba(color, a); ctx.fill();
      if (stroke) { ctx.lineWidth = sw; ctx.strokeStyle = rgba(stroke, a * sa); ctx.stroke(); }
      return true;
    }
    dots(pts, color, r, o) { for (const p of pts) this.dot(p, color, r, o); }
    arrow(p, dir, ang, color, { alpha = 1, width = 1.4, head = 4.5 } = {}) {
      const d = tangent(p, dir), n = len(d);
      if (n < 1e-9) return;
      const q = expmap(p, mul(d, ang / n)), [x0, y0, z0] = this.proj(p), [x1, y1, z1] = this.proj(q);
      if (z0 <= 0.02 || z1 <= 0.02) return;
      const a = alpha * smooth(0, 0.25, Math.min(z0, z1)), { ctx } = this, th = Math.atan2(y1 - y0, x1 - x0);
      ctx.strokeStyle = ctx.fillStyle = rgba(color, a); ctx.lineWidth = width; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - Math.cos(th) * head * 0.6, y1 - Math.sin(th) * head * 0.6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - head * Math.cos(th - 0.42), y1 - head * Math.sin(th - 0.42));
      ctx.lineTo(x1 - head * Math.cos(th + 0.42), y1 - head * Math.sin(th + 0.42));
      ctx.closePath(); ctx.fill();
    }
    texture(t, scale = 0.5) {                           // paint a lat/lon texture onto the visible hemisphere
      const { R, cx, cy } = this, W = Math.max(8, Math.ceil(2 * R * scale)), off = this.off;
      if (off.width !== W) { off.width = W; off.height = W; this.img = off.getContext('2d').createImageData(W, W); }
      const img = this.img, d = img.data, s = t.data, TW = t.w, TH = t.h;
      d.fill(0);
      for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
        const p = this.unproj(cx - R + (i + 0.5) / scale, cy - R + (j + 0.5) / scale);
        if (!p) continue;
        const lat = Math.asin(clamp(p[1], -1, 1)) / DEG, lon = Math.atan2(p[0], p[2]) / DEG;
        const u = (lon + 180) / 360 * TW - 0.5, v = (90 - lat) / 180 * TH - 0.5;
        const c0 = Math.floor(u), r0 = clamp(Math.floor(v), 0, TH - 2), fu = u - c0, fv = clamp(v - r0, 0, 1);
        const ca = ((c0 % TW) + TW) % TW, cb = (ca + 1) % TW, o = (j * W + i) * 4;
        const i00 = (r0 * TW + ca) * 4, i01 = (r0 * TW + cb) * 4, i10 = ((r0 + 1) * TW + ca) * 4, i11 = ((r0 + 1) * TW + cb) * 4;
        for (let k = 0; k < 4; k++) d[o + k] = (s[i00 + k] * (1 - fu) + s[i01 + k] * fu) * (1 - fv) + (s[i10 + k] * (1 - fu) + s[i11 + k] * fu) * fv;
      }
      off.getContext('2d').putImageData(img, 0, 0);
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.drawImage(off, cx - R, cy - R, 2 * R, 2 * R);
    }
    // KaTeX labels positioned over the canvas
    label(key, content, cls = '') {
      const el = document.createElement('span');
      el.className = 'glabel ' + cls;
      if (content.startsWith('$')) tex(el, content.slice(1, -1)); else el.innerHTML = content;
      this.layer.appendChild(el); this.labels.set(key, el);
      return el;
    }
    place(key, p, dx = 0, dy = 0) {
      const el = this.labels.get(key);
      if (!el) return;
      if (!p) { el.style.opacity = 0; return; }
      const [x, y, z] = this.proj(p);
      el.style.opacity = smooth(0.08, 0.3, z);
      el.style.transform = `translate(${(x + dx).toFixed(1)}px, ${(y + dy).toFixed(1)}px) translate(-50%, -50%)`;
    }
    // a direction that may sit on or behind the limb (the contrastive axis μ): a hollow diamond when it faces
    // the viewer, otherwise a tick on the rim pointing toward it; the label sits just outside
    axisMark(key, p) {
      const { ctx, cx, cy, R } = this, [x, y, z] = this.proj(p), P = pal();
      let ang = Math.atan2(y - cy, x - cx), rx = cx + Math.cos(ang) * R, ry = cy + Math.sin(ang) * R;
      ctx.lineWidth = 1.5; ctx.strokeStyle = rgba(P.ink, 0.8);
      if (z > 0.18) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.fillStyle = rgba(P.bg); ctx.fillRect(-4, -4, 8, 8); ctx.strokeRect(-4, -4, 8, 8); ctx.restore();
        this.place(key, p, 14, -12);
      } else {
        ctx.beginPath(); ctx.moveTo(rx - Math.cos(ang) * 6, ry - Math.sin(ang) * 6); ctx.lineTo(rx + Math.cos(ang) * 7, ry + Math.sin(ang) * 7); ctx.stroke();
        const el = this.labels.get(key);
        const lx = clamp(rx + Math.cos(ang) * 22, 10, this.w - 10), ly = clamp(ry + Math.sin(ang) * 18, 10, this.h - 10);
        if (el) { el.style.opacity = 1; el.style.transform = `translate(${lx.toFixed(1)}px, ${ly.toFixed(1)}px) translate(-50%, -50%)`; }
      }
    }
    // draw the static part of a figure once into an offscreen canvas; redraw it only when the view, size or key changes
    cached(key, fn) {
      const k = `${key}|${this.yaw.toFixed(3)}|${this.pitch.toFixed(3)}|${this.w}|${this.h}|${this.dpr}`;
      if (!this.cache) this.cache = document.createElement('canvas');
      if (this.cacheKey !== k) {
        const main = this.ctx;
        this.cache.width = this.canvas.width; this.cache.height = this.canvas.height;
        this.ctx = this.cache.getContext('2d');
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); this.ctx.clearRect(0, 0, this.w, this.h);
        try { fn(); } finally { this.ctx = main; }
        this.cacheKey = k;
      }
      const c = this.ctx; c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(this.cache, 0, 0); c.restore();
    }
    scene({ halo: h = true, grid = true } = {}) {       // body, halos, graticule, rim
      this.body();
      this.clipped(() => { if (h) this.texture(halo()); if (grid) this.graticule(); });
      this.rim();
    }
    data({ r = 3, alpha = 1 } = {}) { const P = pal(); this.dots(SC.Dm, P.minus, r, { alpha }); this.dots(SC.Dp, P.plus, r, { alpha }); }
  }

  // ── figure registry + one animation clock ───────────────────────────────────────────────────
  const figs = [];
  function register(fig) {
    figs.push(fig);
    fig.visible = false;
    new IntersectionObserver(es => es.forEach(e => {
      fig.visible = e.isIntersecting;
      if (e.isIntersecting && fig.onShow) fig.onShow();
    }), { rootMargin: '80px 0px' }).observe(fig.el);
  }
  function frame(now) {
    for (const f of figs) {
      if (!f.visible) continue;
      if (f.animating(now) || f.G.dirty) { f.render(now); f.G.dirty = false; }
    }
    requestAnimationFrame(frame);
  }
  const placeAt = (lat, lon) => fromLL(lat, lon);

  // ── Figure: cover — activations streaming from p₋ to p₊ along the steering field ───────────
  function coverFig(el) {
    const B = makeModel(), P = pal(), host = $('.globe', el);
    const G = new Globe(host, { yaw: 6, pitch: 13, fill: 0.93 });
    const r = T.rng(19);
    const starts = SC.Dm.concat(T.blob(r, -2, -36, 18, 13, 7, 0)), parts = [];
    const grow = n => { while (n-- > 0 && parts.length < starts.length) parts.push({ path: densify(B.steer(starts[parts.length], { gate: true }).path, 5), off: r(), speed: 0.85 + 0.3 * r() }); };
    grow(REDUCED ? starts.length : 6);                  // the rest are traced a few per frame, so the page never stalls
    const ood = placeAt(...OOD), oodG = B.g(ood);
    G.label('pm', '$p_-$', 'lab-minus'); G.label('pp', '$p_+$', 'lab-plus');
    G.label('ood', `unsupported prompt: <span class="k"></span>`, 'lab-note');
    tex($('.k', G.labels.get('ood')), `g(\\boldsymbol{x}) = ${+oodG.toFixed(2)}`);
    const DUR = 6400, t0 = performance.now();
    const fig = {
      el, G,
      animating: () => !REDUCED,
      render(now) {
        const t = REDUCED ? 0.62 * DUR : now - t0;
        grow(4);
        G.begin(); G.cached('base', () => { G.scene(); G.data({ r: 2.6, alpha: 0.9 }); });
        const ctx = G.ctx;
        for (const pt of parts) {
          const u = (t / DUR * pt.speed + pt.off) % 1, fade = smooth(0, 0.06, u) * (1 - smooth(0.88, 1, u));
          const n = 14, tail = 0.3;
          for (let k = 0; k < n; k++) {
            const f0 = Math.max(0, u - tail * (1 - k / n)), f1 = Math.max(0, u - tail * (1 - (k + 1) / n));
            if (f1 <= 0) continue;
            const c = mix(P.minus, P.plus, smooth(0.15, 0.85, f1));
            G.line([along(pt.path, f0), along(pt.path, f1)], c, { width: 1.5, alpha: fade * 0.75 * (k + 1) / n });
          }
          G.dot(along(pt.path, u), mix(P.minus, P.plus, smooth(0.15, 0.85, u)), 2.3, { alpha: fade, ring: 1 });
        }
        // the gated prompt does not move; a slow pulse marks it
        const pulse = REDUCED ? 0.5 : (t % 2400) / 2400, [ox, oy, oz] = G.proj(ood);
        if (oz > 0) {
          ctx.beginPath(); ctx.arc(ox, oy, 5 + 13 * pulse, 0, 2 * Math.PI); ctx.lineWidth = 1.2; ctx.strokeStyle = rgba(P.ink, 0.45 * (1 - pulse)); ctx.stroke();
          ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(ox, oy, 11, 0, 2 * Math.PI); ctx.strokeStyle = rgba(P.ink, 0.5); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
        }
        G.dot(ood, P.bg, 4, { ring: 0, stroke: P.ink });
        G.place('pm', placeAt(...LAB_MINUS)); G.place('pp', placeAt(...LAB_PLUS)); G.place('ood', ood, 0, -26);
      },
    };
    register(fig);
  }

  // ── Figure: fitting the bridge — transport plan, Brownian-bridge particles, ε ───────────────
  function bridgeFig(el) {
    const B = makeModel(), P = pal(), G = new Globe($('.globe', el), { yaw: 4, pitch: 12, fill: 0.9 });
    const slider = $('input.eps', el), epsOut = $('.eps-v', el), partOut = $('.partners-v', el), sideOut = $('.side-v', el);
    const tSlider = $('input.tt', el), tOut = $('.t-v', el), play = $('button.play', el), showPlan = $('input.show-plan', el);
    const mat = $('canvas.plan-matrix', el), mctx = mat.getContext('2d');
    G.label('pm', '$p_-$', 'lab-minus'); G.label('pp', '$p_+$', 'lab-plus');
    // matrix ordering: undesired by their projection onto the axis joining the two desired modes; desired by mode then angle
    const axis = unit(sub(fromLL(...SC.cfg.plus[0].slice(0, 2)), fromLL(...SC.cfg.plus[1].slice(0, 2))));
    const rowOrd = SC.Dm.map((h, j) => [dot(h, axis), j]).sort((a, b) => b[0] - a[0]).map(a => a[1]);
    const colOrd = SC.Dp.map((h, i) => [dot(h, axis), i]).sort((a, b) => b[0] - a[0]).map(a => a[1]);
    const rnd = T.rng(7), M = 120;
    let parts = [], tt = 0.5, playing = !REDUCED, last = performance.now();
    const bridgeKL = 6;
    const nUp = SC.cfg.plus[0][2], proj = SC.Dm.map(h => dot(h, axis)), med = [...proj].sort((a, b) => a - b)[SC.Dm.length >> 1];
    function setEps(deg) {
      B.setEps((deg * DEG) ** 2);
      tex(epsOut, `\\varepsilon = (${deg.toFixed(deg < 10 ? 1 : 0)}^\\circ)^2`);
      partOut.textContent = `${Math.round(B.partners())} of ${B.Np}`;
      let same = 0;                                    // plan mass that stays on its own side (upper half of p₋ → upper mode, …)
      for (let j = 0; j < B.Nm; j++) for (let i = 0; i < B.Np; i++) if ((proj[j] >= med) === (i < nUp)) same += B.P[j * B.Np + i];
      sideOut.textContent = Math.round(100 * same) + '%';
      // particles: endpoint pairs (j, i) drawn from the plan, plus a Brownian-bridge path (Karhunen–Loève series)
      const cum = new Float64Array(B.P.length); let acc = 0;
      for (let k = 0; k < B.P.length; k++) { acc += B.P[k]; cum[k] = acc; }
      parts = [];
      for (let m = 0; m < M; m++) {
        const u = rnd() * acc; let lo = 0, hi = cum.length - 1;
        while (lo < hi) { const md = (lo + hi) >> 1; if (cum[md] < u) lo = md + 1; else hi = md; }
        const j = Math.floor(lo / B.Np), i = lo % B.Np, Z = [];
        for (let k = 1; k <= bridgeKL; k++) Z.push([T.gauss(rnd), T.gauss(rnd), T.gauss(rnd)].map(z => z * Math.SQRT2 / (k * Math.PI)));
        parts.push({ a: SC.Dm[j], b: SC.Dp[i], Z, d: rnd() });
      }
      drawMatrix(); G.dirty = true;
    }
    function particle(pt, t) {
      const base = slerp(pt.a, pt.b, t), s = Math.sqrt(B.eps);
      let nz = [0, 0, 0];
      pt.Z.forEach((z, k) => { nz = add(nz, mul(z, Math.sin((k + 1) * Math.PI * t))); });
      return expmap(base, mul(tangent(base, nz), s));
    }
    function drawMatrix() {
      const n = B.Nm, m = B.Np, W = mat.clientWidth, dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (!W) return;
      mat.width = Math.round(W * dpr); mat.height = Math.round(W * dpr);
      mctx.setTransform(dpr, 0, 0, dpr, 0, 0); mctx.clearRect(0, 0, W, W);
      const cw = W / m, ch = W / n;
      let mx = 0; for (let k = 0; k < B.P.length; k++) mx = Math.max(mx, B.P[k]);
      for (let r = 0; r < n; r++) for (let c = 0; c < m; c++) {
        const v = B.P[rowOrd[r] * m + colOrd[c]] / mx;
        mctx.fillStyle = rgba(mix(P.matLo, P.plus, Math.pow(v, 0.6)));
        mctx.fillRect(c * cw, r * ch, cw + 0.4, ch + 0.4);
      }
      mctx.strokeStyle = rgba(P.bg, 0.9); mctx.lineWidth = 1.5;   // split between the two desired modes
      const split = colOrd.findIndex(i => i >= SC.cfg.plus[0][2]);
      mctx.beginPath(); mctx.moveTo(split * cw, 0); mctx.lineTo(split * cw, W); mctx.stroke();
    }
    const fig = {
      el, G,
      animating: () => playing,
      render(now) {
        const dt = now - last; last = now;
        if (playing) { tt += dt / 3600; if (tt > 1.25) tt = -0.25; tSlider.value = Math.round(clamp(tt, 0, 1) * 1000); }
        const t = clamp(tt, 0, 1);
        tOut.textContent = t.toFixed(2);
        G.begin();
        G.cached(`plan|${B.eps}|${showPlan.checked}`, () => {
          G.scene();
          const ctx = G.ctx;
          if (showPlan.checked) {                         // plan arcs, batched by opacity
            const buckets = Array.from({ length: 7 }, () => []);
            for (let j = 0; j < B.Nm; j++) for (let i = 0; i < B.Np; i++) {
              const a = clamp(B.P[j * B.Np + i] * B.Nm * 1.1, 0, 1);
              if (a < 0.015) continue;
              buckets[Math.min(6, Math.floor(Math.sqrt(a) * 7))].push([SC.Dm[j], SC.Dp[i]]);
            }
            buckets.forEach((bk, q) => {
              if (!bk.length) return;
              ctx.beginPath(); bk.forEach(([a, b]) => G.trace(G.arc(a, b, 12)));
              ctx.lineWidth = 0.8; ctx.strokeStyle = rgba(P.ink, 0.05 + 0.32 * ((q + 1) / 7) ** 2); ctx.stroke();
            });
          }
          G.data({ r: 2.6, alpha: 0.55 });
        });
        for (const pt of parts) {
          const x = particle(pt, t);
          G.dot(x, mix(P.minus, P.plus, t), 2.2, { ring: 0, stroke: P.ink, sw: 0.9, sa: 0.45, alpha: 0.85 });
        }
        G.place('pm', placeAt(...LAB_MINUS)); G.place('pp', placeAt(...LAB_PLUS));
      },
    };
    slider.addEventListener('input', () => setEps(+slider.value));
    tSlider.addEventListener('input', () => { playing = false; play.textContent = '▶'; tt = tSlider.value / 1000; G.dirty = true; });
    play.addEventListener('click', () => { playing = !playing; play.textContent = playing ? '❚❚' : '▶'; last = performance.now(); if (playing && tt >= 1) tt = 0; G.dirty = true; });
    showPlan.addEventListener('change', () => { G.dirty = true; });
    new ResizeObserver(drawMatrix).observe(mat);
    play.textContent = playing ? '❚❚' : '▶';
    slider.value = (Math.sqrt(B.eps0) / DEG).toFixed(1);      // start at the paper's rule: squared median 5-NN distance
    setEps(+slider.value);
    register(fig);
  }

  // ── Figure: the steering field — click to steer; attraction vs repulsion ──────────────────
  function fieldFig(el) {
    const B = makeModel(), P = pal(), G = new Globe($('.globe', el), { yaw: 2, pitch: 12, fill: 0.88 });
    const out = k => $(`[data-out="${k}"]`, el);
    let method = 'cobras', gate = true, queries = [];
    G.label('pm', '$p_-$', 'lab-minus'); G.label('pp', '$p_+$', 'lab-plus');
    G.label('mu', '$\\boldsymbol{\\mu}$', 'lab-mu');
    // the field sampled on a lattice, once per method/gate setting
    const lattice = fib(620);
    const kb = 2 * (14 * DEG) ** 2;
    const lr = x => { let a = 0, b = 0; for (const h of SC.Dp) a += Math.exp(-(geo(x, h) ** 2) / kb); for (const h of SC.Dm) b += Math.exp(-(geo(x, h) ** 2) / kb); return Math.log((a + 1e-12) / (b + 1e-12)); };
    const base = lattice.map(x => ({ x, v: B.field(x).v, s: B.s(x), g: B.g(x), c: clamp(lr(x) / 7, -1, 1) }));
    function arrows() {
      for (const a of base) {
        if (method === 'fixed') { G.arrow(a.x, B.dEuc, 4.2 * DEG, P.gray, { alpha: 0.42, width: 1.1, head: 3.6 }); continue; }
        const str = a.s * (gate ? a.g : 1), col = a.c < 0 ? mix(P.gray, P.minus, -a.c) : mix(P.gray, P.plus, a.c);
        G.arrow(a.x, a.v, (2.2 + 3.6 * Math.sqrt(str)) * DEG, col, { alpha: 0.12 + 0.6 * Math.sqrt(str), width: 1.1, head: 3.6 });
      }
    }
    const STEP_MS = 240;
    function run(q) {
      if (method === 'fixed') { q.res = B.fixed(q.x0, FIXED_ALPHA, 30); q.path = q.res.path; q.dur = REDUCED ? 1 : 1500; }
      else { q.res = B.steer(q.x0, { gate }); q.path = densify(q.res.path, 6); q.dur = REDUCED ? 1 : STEP_MS * B.o.K; }
      q.t0 = performance.now();
    }
    function add(x0, label) {
      const q = { x0, label }; run(q);
      queries.push(q); if (queries.length > 4) queries.shift();
      readout(q); G.dirty = true;
    }
    const where = x => {
      const d = SC.cfg.plus.map(b => geo(x, fromLL(b[0], b[1])) / DEG);
      if (Math.min(...d) < 13) return d[0] < d[1] ? 'the upper desired mode' : 'the lower desired mode';
      return 'between or beyond the desired modes';
    };
    function readout(q) {
      const fixed = method === 'fixed', x0 = q.x0, end = q.path[q.path.length - 1], moved = geo(x0, end) / DEG;
      out('s').textContent = fixed ? '—' : q.res.s.toFixed(2);
      out('g').textContent = fixed ? '—' : (gate ? q.res.g.toFixed(2) : 'off');
      out('th').textContent = fixed ? '—' : (q.res.th0 / DEG).toFixed(0) + '°';
      out('arc').textContent = moved.toFixed(0) + '°';
      out('end').textContent = moved < 0.5 ? 'stays where it is' : 'ends in ' + where(end);
    }
    const fig = {
      el, G,
      animating: now => queries.some(q => now - q.t0 < q.dur + 60),
      render(now) {
        G.begin();
        G.cached(`field|${method}|${gate}`, () => { G.scene(); G.clipped(() => arrows()); G.data({ r: 2.9 }); });
        const act = queries[queries.length - 1];
        // weights at the active query's current step (at its start once the run is over):
        // blue lines pull toward desired samples (w⁺), brick lines push away from undesired ones (w⁻)
        let wk = null;
        if (act && method === 'cobras' && act.res.delta > 0) {
          const f = clamp((now - act.t0) / act.dur, 0, 1), k = f < 1 ? Math.min(B.o.K - 1, Math.floor(f * B.o.K)) : 0, fl = act.res.fields[k];
          const xk = act.res.path[k];
          [[fl.wp, SC.Dp, P.plus], [fl.wm, SC.Dm, P.minus]].forEach(([w, D, c]) => {
            const wmax = Math.max(...w);
            for (let i = 0; i < D.length; i++) { const a = w[i] / wmax; if (a < 0.05) continue; G.line(G.arc(xk, D[i], 10), c, { width: 0.9, alpha: 0.42 * a }); }
          });
          wk = { xk, fl };
        }
        for (const q of queries) {
          const isAct = q === act, f = isAct ? ease(clamp((now - q.t0) / q.dur, 0, 1)) : 1, alpha = isAct ? 1 : 0.45;
          const n = Math.max(1, Math.round(f * (q.path.length - 1)));
          const shown = q.path.slice(0, n + 1); shown[shown.length - 1] = along(q.path, f);
          G.line(shown, P.ink, { width: 2, alpha });
          if (method === 'cobras') {                       // white step markers like the paper's Fig. 2(b)
            const steps = q.res.path, upto = Math.floor(f * B.o.K + 1e-6);
            for (let k = 1; k <= upto && q.res.delta > 0; k++) G.dot(steps[k], P.bg, 2.6, { ring: 0, stroke: P.ink, alpha });
          }
          G.dot(q.x0, P.ink, 3.6, { alpha });
          const head = along(q.path, f);
          if (f < 1) G.dot(head, P.ink, 3, { alpha });
          else if (geo(q.x0, head) > 0.01) {
            const prev = along(q.path, 0.97);
            G.arrow(prev, logmap(prev, head), geo(prev, head), P.ink, { width: 2, head: 7, alpha });
          } else {                                         // gated: a dashed ring, as in Fig. 2(d)
            const [x, y, z] = G.proj(head);
            if (z > 0) { G.ctx.setLineDash([3, 3]); G.ctx.beginPath(); G.ctx.arc(x, y, 9, 0, 2 * Math.PI); G.ctx.strokeStyle = rgba(P.ink, 0.6 * alpha); G.ctx.lineWidth = 1.2; G.ctx.stroke(); G.ctx.setLineDash([]); }
          }
        }
        if (wk) {                                          // the two averaged tangent vectors, on top, with a halo
          const sc = 0.42, { xk, fl } = wk;
          [[fl.a, P.plus], [mul(fl.r, -1), P.minus]].forEach(([v, c]) => {
            G.arrow(xk, v, len(v) * sc, P.bg, { width: 5.5, head: 9.5 });
            G.arrow(xk, v, len(v) * sc, c, { width: 2.6, head: 7 });
          });
        }
        G.axisMark('mu', B.mu);
        G.place('pm', placeAt(...LAB_MINUS)); G.place('pp', placeAt(...LAB_PLUS));
      },
      onShow() { if (!fig.started) { fig.started = true; PRESETS.slice(0, 2).forEach((p, k) => setTimeout(() => add(fromLL(p.ll[0], p.ll[1]), p.key), 350 + 900 * k)); } },
    };
    const PRESETS = [
      { key: 'upper', ll: [12, -40] }, { key: 'lower', ll: [-16, -34] }, { key: 'between', ll: [-2, -6] },
      { key: 'near', ll: [21, 21] }, { key: 'ood', ll: OOD },
    ];
    $$('button[data-preset]', el).forEach(b => b.addEventListener('click', () => { const p = PRESETS.find(q => q.key === b.dataset.preset); add(fromLL(p.ll[0], p.ll[1]), p.key); }));
    $$('button[data-method]', el).forEach(b => b.addEventListener('click', () => {
      method = b.dataset.method;
      $$('button[data-method]', el).forEach(o => { o.classList.toggle('on', o === b); o.setAttribute('aria-selected', o === b); });
      el.classList.toggle('is-fixed', method === 'fixed');
      queries.forEach(run); if (queries.length) readout(queries[queries.length - 1]);
      G.dirty = true;
    }));
    $('input[data-gate]', el).addEventListener('change', e => { gate = e.target.checked; queries.forEach(run); if (queries.length) readout(queries[queries.length - 1]); G.dirty = true; });
    $('button.clear', el).addEventListener('click', () => { queries = []; ['s', 'g', 'th', 'arc', 'end'].forEach(k => { out(k).textContent = '—'; }); G.dirty = true; });
    G.onClick = p => add(p, 'click');
    if (REDUCED) fig.started = true, PRESETS.slice(0, 2).forEach(p => add(fromLL(p.ll[0], p.ll[1]), p.key));
    register(fig);
  }

  // ── Figure: how far COBRAS moves an activation — s, g and the step length ───────────────────
  function strengthFig(el) {
    const B = makeModel(), P = pal(), G = new Globe($('.globe', el), { yaw: 2, pitch: 12, fill: 0.88 });
    const kS = $('input.kappa', el), pS = $('input.cov', el), useS = $('input[data-use="s"]', el), useG = $('input[data-use="g"]', el);
    const out = k => $(`[data-out="${k}"]`, el);
    G.label('pm', '$p_-$', 'lab-minus'); G.label('pp', '$p_+$', 'lab-plus'); G.label('mu', '$\\boldsymbol{\\mu}$', 'lab-mu');
    // cache u(x) on the texture grid: it does not depend on κ or p
    const TW = 200, TH = 100, U = new Float64Array(TW * TH), X = [];
    for (let r = 0; r < TH; r++) for (let c = 0; c < TW; c++) { const x = fromLL(90 - (r + 0.5) * 180 / TH, -180 + (c + 0.5) * 360 / TW); X.push(x); U[r * TW + c] = B.u(x); }
    const maxStep = B.o.T * Math.PI;
    let heat = null, hover = null, version = 0;
    function step(x, u) {
      const s = useS.checked ? B.s(x) : 1, r = B.rankOf(u), g = useG.checked ? B.gateOf(r) : 1;
      return { s, r, g, th: B.theta0(x), arc: B.o.T * s * g * B.theta0(x) };
    }
    function rebuild() {
      B.o.kappa = +kS.value; B.o.p = +pS.value;
      tex($('.kappa-v', el), `\\kappa = ${(+kS.value).toFixed(1)}`); tex($('.cov-v', el), `p = ${(+pS.value).toFixed(2)}`);
      const data = new Uint8ClampedArray(TW * TH * 4);
      for (let k = 0; k < TW * TH; k++) {
        const v = step(X[k], U[k]).arc / maxStep;      // opacity grows with the step, so attenuated regions fade out
        if (v < 0.005) continue;
        const c = mix(P.stepLo, P.stepHi, Math.pow(v, 0.75));
        data[k * 4] = c[0]; data[k * 4 + 1] = c[1]; data[k * 4 + 2] = c[2]; data[k * 4 + 3] = 255 * Math.min(0.88, 1.6 * Math.pow(v, 0.8));
      }
      heat = { data, w: TW, h: TH }; version++;
      curves(); G.dirty = true;
    }
    // the two scalar functions, drawn as small plots next to the sphere
    const sPlot = $('svg.s-plot', el), gPlot = $('svg.g-plot', el);
    const W = 220, H = 110, pad = { l: 30, r: 8, t: 8, b: 22 };
    const sx = (v, a, b) => pad.l + (v - a) / (b - a) * (W - pad.l - pad.r), sy = v => H - pad.b - v * (H - pad.t - pad.b);
    function axes(svg, x0, x1, ticks) {
      let s = `<line class="ax" x1="${pad.l}" x2="${W - pad.r}" y1="${sy(0)}" y2="${sy(0)}"/><line class="ax" x1="${pad.l}" x2="${pad.l}" y1="${sy(0)}" y2="${sy(1)}"/>`;
      ticks.forEach(t => { s += `<text class="tick" x="${sx(t, x0, x1)}" y="${H - 6}" text-anchor="middle">${t}</text>`; });
      [0, 1].forEach(t => { s += `<text class="tick" x="${pad.l - 6}" y="${sy(t) + 4}" text-anchor="end">${t}</text>`; });
      s += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${sy(1)}" y2="${sy(1)}"/>`;
      return s;
    }
    function curves() {
      const k = +kS.value, p = +pS.value;
      let d = ''; for (let i = 0; i <= 80; i++) { const c = -1 + 2 * i / 80; d += (i ? 'L' : 'M') + sx(c, -1, 1).toFixed(1) + ',' + sy(1 / (1 + Math.exp(2 * k * c))).toFixed(1); }
      let e = `M${sx(0, 0, 1)},${sy(1)}L${sx(p, 0, 1)},${sy(1)}L${sx(1, 0, 1)},${sy(0)}`;
      const hv = hover && hover.info;
      sPlot.innerHTML = axes(sPlot, -1, 1, [-1, 0, 1]) + `<path class="curve" d="${d}"/>` + (hv ? `<circle class="mark" r="4.5" cx="${sx(dot(hover.x, B.mu), -1, 1)}" cy="${sy(useS.checked ? hv.s : 1)}"/>` : '');
      gPlot.innerHTML = axes(gPlot, 0, 1, [0, 0.5, 1]) + `<line class="pline" x1="${sx(p, 0, 1)}" x2="${sx(p, 0, 1)}" y1="${sy(0)}" y2="${sy(1)}"/><path class="curve" d="${e}"/>` + (hv ? `<circle class="mark" r="4.5" cx="${sx(hv.r, 0, 1)}" cy="${sy(useG.checked ? hv.g : 1)}"/>` : '');
    }
    const fig = {
      el, G,
      animating: () => false,
      render() {
        G.begin();
        G.cached(`heat|${version}`, () => {
          G.body(); G.clipped(() => { G.texture(heat); G.graticule(); }); G.rim();
          G.dots(SC.Dref, P.ref, 1.7, { ring: 0, alpha: 0.75 }); G.data({ r: 2.8 });
        });
        if (hover) G.dot(hover.x, P.ink, 4, { stroke: P.bg });
        G.axisMark('mu', B.mu);
        G.place('pm', placeAt(...LAB_MINUS)); G.place('pp', placeAt(...LAB_PLUS));
      },
    };
    G.onHover = x => {
      if (!x) { hover = null; ['cos', 's', 'r', 'g', 'arc'].forEach(k => { out(k).textContent = '—'; }); curves(); G.dirty = true; return; }
      const info = step(x, B.u(x));
      hover = { x, info };
      out('cos').textContent = dot(x, B.mu).toFixed(2).replace('-', '−');
      out('s').textContent = useS.checked ? info.s.toFixed(2) : 'off';
      out('r').textContent = info.r.toFixed(2);
      out('g').textContent = useG.checked ? info.g.toFixed(2) : 'off';
      out('arc').textContent = (info.arc / DEG).toFixed(0) + '°';
      curves(); G.dirty = true;
    };
    [kS, pS].forEach(i => i.addEventListener('input', rebuild));
    [useS, useG].forEach(i => i.addEventListener('change', rebuild));
    rebuild();
    register(fig);
  }

  const builders = { cover: coverFig, bridge: bridgeFig, field: fieldFig, strength: strengthFig };
  // the cover is built at once; the other figures when they come within reach of the viewport
  function build(el) { if (el.dataset.built) return; el.dataset.built = '1'; try { builders[el.dataset.globe](el); } catch (e) { console.error('figure', el.dataset.globe, e); } }
  function init() {
    const lazy = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { lazy.unobserve(e.target); build(e.target); } }), { rootMargin: '700px 0px' });
    $$('[data-globe]').forEach(el => (el.dataset.globe === 'cover' ? build(el) : lazy.observe(el)));
    requestAnimationFrame(frame);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.CobrasGlobe = { Globe, makeModel, SC };
})();
