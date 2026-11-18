/* COBRAS on a toy 2-sphere.
 *
 * A small, faithful implementation of the method in the paper, used by the interactive figures:
 *   Eq. (1)        exp / log maps on the unit sphere
 *   Eqs. (7)–(9)   geodesic reference coupling and the discrete Schrödinger Bridge
 *   Eq. (20)       log-domain Sinkhorn sweeps for the endpoint potentials φ̂, ψ̂
 *   Eqs. (22)–(24) the steering field: weighted attraction minus weighted repulsion
 *   Sec. 4.3       alignment coefficient s, support score u, reference percentile r, gate g
 *   Eq. (17)       K geodesic Euler steps of length Δ = (T/K) s(x0) g θ0
 * Everything is plain arrays of 3-vectors; no DOM access.
 */
(function (root) {
  'use strict';
  const PI = Math.PI, DEG = PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ── 3-vectors ──────────────────────────────────────────────────────────────────────────────
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const unit = a => { const n = len(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const mean = P => { const m = [0, 0, 0]; P.forEach(p => { m[0] += p[0]; m[1] += p[1]; m[2] += p[2]; }); return mul(m, 1 / P.length); };

  // ── sphere geometry, Eq. (1) ───────────────────────────────────────────────────────────────
  const geo = (a, b) => Math.acos(clamp(dot(a, b), -1, 1));
  function logmap(x, y) {                       // (θ / sin θ) Π_x y
    const c = clamp(dot(x, y), -1, 1), th = Math.acos(c);
    if (th < 1e-9) return [0, 0, 0];
    const k = th / Math.sin(Math.max(th, 1e-9));
    return [k * (y[0] - c * x[0]), k * (y[1] - c * x[1]), k * (y[2] - c * x[2])];
  }
  function expmap(x, v) {                       // cos‖v‖ x + sin‖v‖ v/‖v‖
    const n = len(v);
    if (n < 1e-12) return x.slice();
    const c = Math.cos(n), s = Math.sin(n) / n;
    return unit([c * x[0] + s * v[0], c * x[1] + s * v[1], c * x[2] + s * v[2]]);
  }
  const slerp = (a, b, t) => expmap(a, mul(logmap(a, b), t));
  const tangent = (x, v) => sub(v, mul(x, dot(x, v)));          // Π_x v
  function fromLL(lat, lon) { lat *= DEG; lon *= DEG; return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)]; }
  function toLL(p) { return [Math.asin(clamp(p[1], -1, 1)) / DEG, Math.atan2(p[0], p[2]) / DEG]; }
  function frame(p) {                            // (east, north) tangent basis at p
    let e = cross([0, 1, 0], p);
    if (len(e) < 1e-6) e = [1, 0, 0];
    e = unit(e);
    return [e, unit(cross(p, e))];
  }
  function lse(a, n) {                           // log Σ exp, stable
    let m = -Infinity;
    for (let k = 0; k < n; k++) if (a[k] > m) m = a[k];
    if (m === -Infinity) return m;
    let s = 0;
    for (let k = 0; k < n; k++) s += Math.exp(a[k] - m);
    return m + Math.log(s);
  }

  // ── deterministic randomness ───────────────────────────────────────────────────────────────
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * PI * r()); }

  // an anisotropic cloud around (lat, lon): Gaussian in the tangent plane, mapped with exp
  function blob(r, lat, lon, n, sNorth, sEast, rot = 0) {
    const c = fromLL(lat, lon), [e, nn] = frame(c), cr = Math.cos(rot * DEG), sr = Math.sin(rot * DEG), out = [];
    for (let k = 0; k < n; k++) {
      const a = gauss(r) * sEast * DEG, b = gauss(r) * sNorth * DEG;
      out.push(expmap(c, add(mul(e, cr * a - sr * b), mul(nn, sr * a + cr * b))));
    }
    return out;
  }

  // ── the toy activation sphere shared by every figure ───────────────────────────────────────
  // undesired activations p₋: one elongated cloud; desired activations p₊: two modes.
  // reference prompts D_ref: in-distribution prompts used only to calibrate the support gate.
  const SCENE = {
    seed: 5,
    minus: [-2, -36, 46, 13, 7, 0],                       // [lat, lon, n, σ_north°, σ_east°, rotation°]
    plus: [[24, 26, 23, 7, 8, -10], [-22, 29, 23, 7, 8, 10]],
    ref: [[-2, -42, 90, 15, 10, 0], [24, 24, 20, 9, 10, 0], [-22, 27, 20, 9, 10, 0], [0, -8, 25, 12, 12, 0]],
  };
  function scene(cfg = SCENE) {
    const r = rng(cfg.seed);
    const Dm = blob(r, ...cfg.minus);
    const Dp = [].concat(...cfg.plus.map(b => blob(r, ...b)));
    const Dref = [].concat(...cfg.ref.map(b => blob(r, ...b)));
    return { Dm, Dp, Dref, cfg };
  }

  function knnMedian(P, k) {
    const ds = P.map((p, a) => {
      const d = P.map((q, b) => (a === b ? Infinity : geo(p, q))).sort((x, y) => x - y);
      return d[k - 1];
    }).sort((x, y) => x - y);
    return ds[Math.floor(ds.length / 2)];
  }

  // ── the fitted bridge ──────────────────────────────────────────────────────────────────────
  class Bridge {
    constructor(Dm, Dp, opt = {}) {
      this.Dm = Dm; this.Dp = Dp; this.Nm = Dm.length; this.Np = Dp.length;
      // eps: entropic regularization ε (null → the paper's rule, squared median 5-NN distance)
      // bw:  field bandwidth b (null → per-population max distance, Eq. 32); bg: support bandwidth b_g
      // (null → ε/256 as in App. E.4). The toy figures pass values suited to a 2-sphere with ~50 points.
      this.o = Object.assign({ sweeps: 50, kappa: 3, eps: null, bw: null, bg: null, T: 0.55, K: 10, p: 0.7 }, opt);
      const { Nm, Np } = this;
      this.D2 = new Float64Array(Nm * Np);               // squared geodesic distances d(h⁻_j, h⁺_i)²
      for (let j = 0; j < Nm; j++) for (let i = 0; i < Np; i++) this.D2[j * Np + i] = geo(Dm[j], Dp[i]) ** 2;
      this.eps0 = knnMedian(Dm.concat(Dp), 5) ** 2;      // App. E.4: squared median 5-NN geodesic distance
      this.dEuc = sub(mean(Dp), mean(Dm));               // difference of means (the fixed direction)
      this.mu = unit(this.dEuc);                         // unit contrastive axis μ (Sec. 4.3)
      this.buf = new Float64Array(Math.max(Nm, Np));
      this.setEps(this.o.eps || this.eps0);
    }

    // Eq. (7) reference weights and Eq. (20) Sinkhorn; unnormalized e^{-c} as in App. E.4
    setEps(eps) {
      const { Nm, Np, D2, buf } = this;
      this.eps = eps;
      const C = this.C = new Float64Array(Nm * Np);
      for (let k = 0; k < Nm * Np; k++) C[k] = D2[k] / (2 * eps);
      const lphi = this.lphi = new Float64Array(Nm), lpsi = this.lpsi = new Float64Array(Np);
      const lNm = Math.log(Nm), lNp = Math.log(Np);
      for (let s = 0; s < this.o.sweeps; s++) {
        for (let j = 0; j < Nm; j++) { for (let i = 0; i < Np; i++) buf[i] = lpsi[i] - C[j * Np + i]; lphi[j] = -lNm - lse(buf, Np); }
        for (let i = 0; i < Np; i++) { for (let j = 0; j < Nm; j++) buf[j] = lphi[j] - C[j * Np + i]; lpsi[i] = -lNp - lse(buf, Nm); }
      }
      const P = this.P = new Float64Array(Nm * Np);     // P̂*_{01,ji} = φ̂_j ψ̂_i Q̂_ji
      for (let j = 0; j < Nm; j++) for (let i = 0; i < Np; i++) P[j * Np + i] = Math.exp(lphi[j] + lpsi[i] - C[j * Np + i]);
      this.ref = null;
      return this;
    }

    // effective number of desired partners per undesired sample (row perplexity of the plan)
    partners() {
      const { Nm, Np, P } = this;
      let acc = 0;
      for (let j = 0; j < Nm; j++) {
        let z = 0, h = 0;
        for (let i = 0; i < Np; i++) z += P[j * Np + i];
        for (let i = 0; i < Np; i++) { const q = P[j * Np + i] / z; if (q > 0) h -= q * Math.log(q); }
        acc += Math.exp(h);
      }
      return acc / Nm;
    }

    // Eqs. (22)–(24). mode 'cobras' uses the fitted bridge; 'kde' is the ε → ∞ limit (Prop. 1).
    // bw: fixed bandwidth b, or null for the per-population choice b±(x) = max_h d(x,h)² of Eq. (32).
    field(x, mode = 'cobras') {
      const { Nm, Np, Dm, Dp, C, lphi, lpsi, buf } = this;
      const lkm = new Float64Array(Nm), lkp = new Float64Array(Np);
      let mm = 0, mp = 0;
      for (let j = 0; j < Nm; j++) { lkm[j] = geo(x, Dm[j]) ** 2; if (lkm[j] > mm) mm = lkm[j]; }
      for (let i = 0; i < Np; i++) { lkp[i] = geo(x, Dp[i]) ** 2; if (lkp[i] > mp) mp = lkp[i]; }
      const bm = this.o.bw || Math.max(mm, 1e-6), bp = this.o.bw || Math.max(mp, 1e-6);
      for (let j = 0; j < Nm; j++) lkm[j] = -lkm[j] / (2 * bm);
      for (let i = 0; i < Np; i++) lkp[i] = -lkp[i] / (2 * bp);
      const wp = new Float64Array(Np), wm = new Float64Array(Nm);
      if (mode === 'kde') { wp.set(lkp); wm.set(lkm); } else {
        for (let i = 0; i < Np; i++) { for (let j = 0; j < Nm; j++) buf[j] = lphi[j] - C[j * Np + i] + lkm[j]; wp[i] = lse(buf, Nm) + lkp[i]; }
        for (let j = 0; j < Nm; j++) { for (let i = 0; i < Np; i++) buf[i] = lpsi[i] - C[j * Np + i] + lkp[i]; wm[j] = lse(buf, Np) + lkm[j]; }
      }
      const zp = lse(wp, Np), zm = lse(wm, Nm);
      let a = [0, 0, 0], r = [0, 0, 0];
      for (let i = 0; i < Np; i++) { wp[i] = Math.exp(wp[i] - zp); a = add(a, mul(logmap(x, Dp[i]), wp[i])); }
      for (let j = 0; j < Nm; j++) { wm[j] = Math.exp(wm[j] - zm); r = add(r, mul(logmap(x, Dm[j]), wm[j])); }
      return { v: sub(a, r), a, r, wp, wm };
    }

    // alignment coefficient s(x) = 1 / (1 + e^{2κ cos(x, μ)})
    s(x) { return 1 / (1 + Math.exp(2 * this.o.kappa * dot(x, this.mu))); }

    // Eqs. (14)–(15): u(x) = −log( φ̂_{b_g}(x) ψ̂_{b_g}(x) ), b_g a fixed multiple of ε
    u(x) {
      const { Nm, Np, Dm, Dp, lphi, lpsi, buf } = this, bg = this.o.bg || this.eps / 256;
      for (let j = 0; j < Nm; j++) buf[j] = lphi[j] - geo(x, Dm[j]) ** 2 / (2 * bg);
      const a = lse(buf, Nm);
      for (let i = 0; i < Np; i++) buf[i] = lpsi[i] - geo(x, Dp[i]) ** 2 / (2 * bg);
      return -(a + lse(buf, Np));
    }
    calibrate(Dref) { this.Dref = Dref; this.ref = Float64Array.from(Dref.map(z => this.u(z))).sort(); return this; }
    rankOf(u) {                                   // r = |{z ∈ D_ref : u(z) < u}| / n
      const ref = this.ref; let lo = 0, hi = ref.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (ref[m] < u) lo = m + 1; else hi = m; }
      return lo / ref.length;
    }
    gateOf(r, p = this.o.p) { return Math.min(1, (1 - r) / (1 - p)); }   // Eq. (16)
    g(x) { if (!this.ref) this.calibrate(this.Dref || []); return this.gateOf(this.rankOf(this.u(x))); }
    theta0(x) { return Math.acos(clamp(dot(x, this.mu), -1, 1)); }

    // Algorithm 1 / Eq. (17)
    steer(x0, { T = this.o.T, K = this.o.K, gate = true, mode = 'cobras' } = {}) {
      const s = this.s(x0), g = gate ? this.g(x0) : 1, th0 = this.theta0(x0);
      const delta = (T / K) * s * g * th0, path = [x0], fields = [];
      let x = x0;
      for (let k = 0; k < K; k++) {
        const f = this.field(x, mode); fields.push(f);
        const n = len(f.v);
        if (delta > 0 && n > 0) x = expmap(x, mul(f.v, delta / n));
        path.push(x);
      }
      return { path, fields, s, g, th0, delta };
    }

    // the comparison in Fig. 2(c): the same Euclidean vector added to every activation, norm restored
    fixed(x0, alpha, n = 24) {
      const path = [];
      for (let k = 0; k <= n; k++) path.push(unit(add(x0, mul(this.dEuc, alpha * k / n))));
      return { path };
    }
  }

  root.CobrasToy = { PI, DEG, clamp, dot, add, sub, mul, len, unit, cross, mean, geo, logmap, expmap, slerp, tangent, fromLL, toLL, frame, lse, rng, gauss, blob, scene, Bridge };
})(window);
