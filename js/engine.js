// iPhone 5 look engine.
// Everything runs locally on <canvas>; no photo ever leaves the device.
//
// What the 2012 iPhone 5 (8 MP, 4.13 mm f/2.4, sapphire cover) did to a scene,
// and how each trait is reproduced here:
//   - small sensor, little dynamic range  -> exposure push, hard highlight clip,
//                                            regional contrast that undoes modern HDR
//   - aggressive noise reduction + sharpen -> soft detail with unsharp-mask halos
//   - warm, yellow-leaning colour science  -> warm white balance, greens toward
//                                            yellow, blues toward cyan
//   - purple flare / purple fringing       -> violet haze, beam and ghosts from the
//                                            light source, purple edges by highlights
//   - lens shading                         -> vignette and a little lateral CA
//   - sensor noise                         -> clumpy luma grain + chroma blotches
//   - JPEG of the era                      -> a real JPEG round trip

export const SENSOR = { long: 3264, short: 2448 };

const INV255 = 1 / 255;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------- looks ----------------------------------------------------------

const BASE = {
  strength: 1,
  exposure: 0.06,
  autoExposure: 1,
  contrast: 0.3,
  blackPoint: 0.015,
  blackLift: 0.02,
  saturation: 1.12,
  warmth: 0.25,
  tint: 0.05,
  greenToYellow: 0.32,
  blueToCyan: 0.16,
  shadowTint: [-0.004, 0.004, 0.004],
  highlightTint: [0.026, 0.016, -0.034],
  vignette: 0.28,
  localContrast: 0.35,
  bloom: 0.42,
  fringe: 0.3,
  aberration: 0.6,
  sharpen: 0.55,
  softness: 0.4,
  grain: 0.35,
  chroma: 0.6,
  flare: 0.4,
  flash: 0,
  compression: 0.35,
};

export const LOOKS = {
  classic: { name: 'Classic', ...BASE },
  sunny: {
    ...BASE,
    name: 'Sunny',
    exposure: 0.26,
    contrast: 0.34,
    saturation: 1.18,
    warmth: 0.4,
    greenToYellow: 0.4,
    highlightTint: [0.035, 0.022, -0.045],
    localContrast: 0.5,
    bloom: 0.6,
    flare: 0.75,
  },
  cloudy: {
    ...BASE,
    name: 'Cloudy',
    exposure: 0.34,
    contrast: 0.2,
    blackLift: 0.035,
    saturation: 0.9,
    warmth: -0.02,
    tint: 0.2,
    greenToYellow: 0.22,
    blueToCyan: 0.1,
    highlightTint: [0.01, 0.012, -0.01],
    localContrast: 0.35,
    bloom: 0.25,
    flare: 0.15,
    softness: 0.48,
    grain: 0.3,
  },
  night: {
    ...BASE,
    name: 'Night',
    exposure: 0,
    autoExposure: 0.3,
    contrast: 0.36,
    blackPoint: 0.05,
    blackLift: 0.025,
    saturation: 1.06,
    warmth: 0.12,
    tint: 0,
    blueToCyan: 0,
    shadowTint: [-0.012, -0.004, 0.03],
    highlightTint: [0.04, 0.02, -0.035],
    vignette: 0.4,
    localContrast: 0.25,
    bloom: 0.75,
    fringe: 0.3,
    sharpen: 0.55,
    softness: 0.6,
    grain: 0.85,
    chroma: 1,
    flare: 0,
    compression: 0.5,
  },
  flash: {
    ...BASE,
    name: 'Flash',
    exposure: 0.05,
    autoExposure: 0.5,
    contrast: 0.36,
    saturation: 1.04,
    warmth: -0.28,
    tint: -0.04,
    greenToYellow: 0.15,
    shadowTint: [-0.004, 0, 0.016],
    highlightTint: [0.004, 0.01, 0.03],
    vignette: 0.2,
    localContrast: 0.2,
    bloom: 0.3,
    flash: 0.75,
    grain: 0.45,
    flare: 0,
  },
};

// ---------- canvas helpers -------------------------------------------------

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Setting a canvas to 0×0 hands its memory back right away; iOS Safari caps
// total canvas memory, so every temporary canvas goes through here.
export function release(c) {
  if (c && c.width !== undefined) {
    c.width = 0;
    c.height = 0;
  }
}

function ctxOf(c, read = false) {
  const x = c.getContext('2d', read ? { willReadFrequently: true } : undefined);
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  return x;
}

const dimsOf = (s) => ({
  w: s.naturalWidth || s.videoWidth || s.width,
  h: s.naturalHeight || s.videoHeight || s.height,
});

// Resize with repeated halving so big reductions stay smooth (blurs, glow maps).
export function resample(src, w, h) {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  let cur = src;
  let { w: cw, h: ch } = dimsOf(src);
  while (cw >= w * 2 && ch >= h * 2) {
    cw = Math.max(w, Math.round(cw / 2));
    ch = Math.max(h, Math.round(ch / 2));
    const c = makeCanvas(cw, ch);
    ctxOf(c).drawImage(cur, 0, 0, cw, ch);
    if (cur !== src) release(cur);
    cur = c;
  }
  const out = makeCanvas(w, h);
  ctxOf(out).drawImage(cur, 0, 0, w, h);
  if (cur !== src) release(cur);
  return out;
}

function pixels(c) {
  return ctxOf(c, true).getImageData(0, 0, c.width, c.height);
}

// ---------- geometry -------------------------------------------------------

export function cropRect(sw, sh, aspect) {
  if (aspect === 'original') return { x: 0, y: 0, w: sw, h: sh };
  const ratio = aspect === '1:1' ? 1 : sw >= sh ? 4 / 3 : 3 / 4;
  if (sw / sh > ratio) {
    const w = sh * ratio;
    return { x: (sw - w) / 2, y: 0, w, h: sh };
  }
  const h = sw / ratio;
  return { x: 0, y: (sh - h) / 2, w: sw, h };
}

export function fitLong(crop, long) {
  const s = long / Math.max(crop.w, crop.h);
  return { w: Math.max(1, Math.round(crop.w * s)), h: Math.max(1, Math.round(crop.h * s)) };
}

// Draw the cropped source at the target size. The first draw is capped so we
// never allocate a canvas bigger than iOS allows (16.7 MP).
function drawCrop(img, crop, w, h) {
  const target = Math.max(w, h);
  const cropLong = Math.max(crop.w, crop.h);
  const firstLong = Math.min(cropLong, Math.max(target, Math.min(target * 2, 4096)));
  const s = firstLong / cropLong;
  const fw = Math.max(w, Math.round(crop.w * s));
  const fh = Math.max(h, Math.round(crop.h * s));
  const first = makeCanvas(fw, fh);
  ctxOf(first).drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, fw, fh);
  if (fw === w && fh === h) return first;
  const out = resample(first, w, h);
  release(first);
  return out;
}

// ---------- random ---------------------------------------------------------

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- per-source analysis -------------------------------------------

// Glow map at 1/8 resolution: rgb = blurred highlights (bloom), a = heavily
// blurred luminance (used to put back the regional contrast HDR removed).
function buildGlow(canvas, w, h) {
  const mw = Math.max(12, Math.round(w / 8));
  const mh = Math.max(12, Math.round(h / 8));
  const small = resample(canvas, mw, mh);
  const sd = pixels(small).data;

  const th = new ImageData(mw, mh);
  const td = th.data;
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < sd.length; i += 4) {
    const l = (0.2126 * sd[i] + 0.7152 * sd[i + 1] + 0.0722 * sd[i + 2]) * INV255;
    sum += l;
    if (l > peak) peak = l;
    let t = smoothstep(0.76, 1, l);
    t *= t;
    td[i] = sd[i] * t;
    td[i + 1] = sd[i + 1] * t;
    td[i + 2] = sd[i + 2] * t;
    td[i + 3] = 255;
  }
  const tc = makeCanvas(mw, mh);
  ctxOf(tc).putImageData(th, 0, 0);

  const blurTo = (src, div) => {
    const s = resample(src, Math.max(2, mw / div), Math.max(2, mh / div));
    const u = resample(s, mw, mh);
    release(s);
    const d = pixels(u).data;
    release(u);
    return d;
  };
  const tight = blurTo(tc, 3);
  const wide = blurTo(tc, 12);
  const local = blurTo(small, 16);
  release(tc);
  release(small);

  const data = new Float32Array(mw * mh * 4);
  let best = -1;
  let bestAt = 0;
  for (let i = 0, j = 0; i < tight.length; i += 4, j += 4) {
    const r = (0.6 * tight[i] + 0.9 * wide[i]) * INV255;
    const g = (0.6 * tight[i + 1] + 0.9 * wide[i + 1]) * INV255;
    const b = (0.6 * tight[i + 2] + 0.9 * wide[i + 2]) * INV255;
    data[j] = r;
    data[j + 1] = g;
    data[j + 2] = b;
    data[j + 3] = (0.2126 * local[i] + 0.7152 * local[i + 1] + 0.0722 * local[i + 2]) * INV255;
    const bl = r + g + b;
    if (bl > best) {
      best = bl;
      bestAt = i >> 2;
    }
  }

  // Where is the light? The brightest blob of the blurred highlights.
  let light;
  if (peak >= 0.8 && best > 0.02) {
    const x = ((bestAt % mw) + 0.5) / mw;
    const y = (Math.floor(bestAt / mw) + 0.5) / mh;
    // Purple flare comes from light at, or just past, the edge of the frame.
    // A sun in the middle of the shot mostly blooms white instead.
    const edge = Math.min(x, y, 1 - x, 1 - y);
    light = {
      x,
      y,
      factor: 0.55 + 0.45 * smoothstep(0.85, 0.99, peak),
      purple: 0.25 + 0.75 * (1 - smoothstep(0.04, 0.3, edge)),
    };
  } else {
    // No obvious light: pretend the sun sits just outside the top-right corner.
    light = { x: 0.84, y: -0.06, factor: 0.45, purple: 1 };
  }

  // The iPhone 5 metered for the middle of the scene and let highlights go.
  const meanLum = sum / (mw * mh);
  const autoEV = clamp(Math.log2(0.44 / Math.max(meanLum, 0.04)) * 0.45, -0.35, 0.5);

  return { mw, mh, data, meanLum, autoEV, peak, light };
}

// Grain is generated at a fixed ~1100 px so it looks the same in the preview
// and in the 8 MP export (where it reads as noise smeared by the camera's NR).
function buildGrain(w, h, seed) {
  const gs = Math.min(1, 1100 / Math.max(w, h));
  const gw = Math.max(1, Math.round(w * gs));
  const gh = Math.max(1, Math.round(h * gs));
  const rnd = mulberry32(seed);
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = (rnd() + rnd() + rnd() - 1.5) * 2;
  const cw = Math.max(2, Math.round(gw / 3));
  const ch = Math.max(2, Math.round(gh / 3));
  const c = new Float32Array(cw * ch * 3);
  for (let i = 0; i < c.length; i += 3) {
    const a = rnd() * 2 - 1;
    const b = rnd() * 2 - 1;
    const d = rnd() * 2 - 1;
    const m = (a + b + d) / 3; // keep it pure colour: no brightness change
    c[i] = a - m;
    c[i + 1] = b - m;
    c[i + 2] = d - m;
  }
  return { gs, gw, gh, g, cw, ch, c };
}

function axisTable(n, m) {
  const i0 = new Int32Array(n);
  const i1 = new Int32Array(n);
  const f = new Float32Array(n);
  const s = m / n;
  for (let x = 0; x < n; x++) {
    let u = (x + 0.5) * s - 0.5;
    if (u < 0) u = 0;
    if (u > m - 1) u = m - 1;
    const a = u | 0;
    i0[x] = a;
    i1[x] = a + 1 < m ? a + 1 : m - 1;
    f[x] = u - a;
  }
  return { i0, i1, f };
}

// ---------- tone curve -----------------------------------------------------

const LUT_N = 1024;
const LUT_MAX = 1.25;
const LUT_K = (LUT_N - 1) / LUT_MAX;
const PIVOT = 0.42;

const toLin = (x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
const toSrgb = (x) => (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);

function buildLUT(p, autoEV = 0) {
  const ev = Math.pow(2, p.exposure + autoEV * (p.autoExposure ?? 1));
  const w = p.warmth;
  const t = p.tint;
  const gains = [
    ev * (1 + 0.12 * w - 0.02 * t),
    ev * (1 + 0.01 * w + 0.035 * t),
    ev * (1 - 0.17 * w - 0.02 * t),
  ];
  const k = p.contrast;
  const bp = p.blackPoint;
  const lift = p.blackLift;
  return gains.map((gain) => {
    const lut = new Float32Array(LUT_N);
    for (let i = 0; i < LUT_N; i++) {
      const x = (i / (LUT_N - 1)) * LUT_MAX;
      // Clip in linear light: this is the small sensor running out of headroom.
      let y = toSrgb(Math.min(1, toLin(x) * gain));
      y = y < PIVOT ? PIVOT * Math.pow(y / PIVOT, 1 + k) : 1 - (1 - PIVOT) * Math.pow((1 - y) / (1 - PIVOT), 1 + k);
      y = (y - bp) / (1 - bp);
      if (y < 0) y = 0;
      lut[i] = lift + (1 - lift) * y;
    }
    return lut;
  });
}

// ---------- the developer --------------------------------------------------

export class Developer {
  constructor(img) {
    this.img = img;
    const d = dimsOf(img);
    this.sw = d.w;
    this.sh = d.h;
    this.seed = (Math.random() * 2 ** 31) | 0;
    this.bases = new Map();
  }

  // Source-dependent buffers for one size + crop. Cached for preview sizes.
  base(long, aspect, cache = true) {
    const key = `${long}|${aspect}`;
    if (cache && this.bases.has(key)) return this.bases.get(key);
    const crop = cropRect(this.sw, this.sh, aspect);
    const { w, h } = fitLong(crop, long);
    const canvas = drawCrop(this.img, crop, w, h);
    const A = pixels(canvas);
    const glow = buildGlow(canvas, w, h);
    const grain = buildGrain(w, h, this.seed);
    const b = { key, w, h, canvas, A, glow, grain, soft: null };
    if (cache) {
      // Keep a handful of sizes; drop the oldest.
      if (this.bases.size >= 6) {
        const [k0, old] = this.bases.entries().next().value;
        release(old.canvas);
        this.bases.delete(k0);
      }
      this.bases.set(key, b);
    }
    return b;
  }

  // Detail buffers: S = softened image (sensor + noise reduction),
  // B = a wider blur of it, used to sharpen S with visible halos.
  soft(base, softness) {
    const sk = Math.round(softness * 100);
    if (base.soft && base.soft.k === sk) return base.soft;
    const { w, h, canvas, A } = base;
    const sF = 1 - 0.6 * softness;
    let S;
    if (sF > 0.97) {
      S = A.data;
    } else {
      const s = resample(canvas, w * sF, h * sF);
      const u = resample(s, w, h);
      release(s);
      S = pixels(u).data;
      release(u);
    }
    const bs = resample(canvas, Math.max(2, (w * sF) / 2.4), Math.max(2, (h * sF) / 2.4));
    const bu = resample(bs, w, h);
    release(bs);
    const B = pixels(bu).data;
    release(bu);
    base.soft = { k: sk, S, B };
    return base.soft;
  }

  // Normalised (0..1, may sit outside the frame) light position + strength factor.
  autoLight(base) {
    return base.glow.light;
  }

  original(long, aspect) {
    return this.base(long, aspect).canvas;
  }

  // Run the look. Returns a canvas of base.w × base.h.
  develop(base, p, flarePoint, { inPlace = false } = {}) {
    const { w, h } = base;
    const soft = this.soft(base, p.softness);
    let S = soft.S;
    const B = soft.B;
    const A = base.A.data;
    if (inPlace && S === A) S = new Uint8ClampedArray(S);
    const out = inPlace ? base.A : new ImageData(w, h);
    const O = out.data;

    const [LR, LG, LB] = buildLUT(p, base.glow.autoEV);

    const glow = base.glow;
    const GD = glow.data;
    const GMW = glow.mw;
    const gxT = axisTable(w, glow.mw);
    const gyT = axisTable(h, glow.mh);

    const gr = base.grain;
    const nxT = axisTable(w, gr.gw);
    const nyT = axisTable(h, gr.gh);
    const cxT = axisTable(w, gr.cw);
    const cyT = axisTable(h, gr.ch);
    const GG = gr.g;
    const GC = gr.c;

    const cx = (w - 1) / 2;
    const cy = (h - 1) / 2;
    const invHD2 = 1 / (cx * cx + cy * cy || 1);
    const diag = Math.hypot(w, h);
    const invDiag = 1 / diag;
    const invDiag2 = invDiag * invDiag;

    const sharp = p.sharpen;
    const caK = p.aberration * 0.0016;
    const vig = p.vignette;
    const flash = p.flash;
    const local = p.localContrast;
    const sat = p.saturation;
    const g2y = p.greenToYellow;
    const b2c = p.blueToCyan;
    const [shR, shG, shB] = p.shadowTint;
    const [hiR, hiG, hiB] = p.highlightTint;
    const bloom = p.bloom;
    const fringe = p.fringe * 2.2;
    const grainAmt = p.grain * 0.06;
    const chromaAmt = p.grain * p.chroma * 0.1;
    const fineAmt = gr.gs < 0.9 ? p.grain * 0.05 * (1 - gr.gs) : 0;
    const strength = clamp(p.strength, 0, 1);

    // Flare geometry, in pixels.
    let F = null;
    if (flarePoint && flarePoint.amount > 0.001) {
      const lx = flarePoint.x * w;
      const ly = flarePoint.y * h;
      let ax = cx - lx;
      let ay = cy - ly;
      const al = Math.hypot(ax, ay);
      if (al < 1) {
        ax = 0;
        ay = 1;
      } else {
        ax /= al;
        ay /= al;
      }
      F = {
        a: flarePoint.amount,
        pa: flarePoint.amount * (flarePoint.purple ?? 1),
        lx,
        ly,
        ax,
        ay,
        g1x: cx + (cx - lx) * 0.72,
        g1y: cy + (cy - ly) * 0.72,
        g2x: cx + (cx - lx) * 0.28,
        g2y: cy + (cy - ly) * 0.28,
        r1: (0.019 * diag) ** 2,
        r2: (0.011 * diag) ** 2,
      };
    }

    let rs = this.seed ^ 0x9e3779b9;

    for (let y = 0; y < h; y++) {
      const gy0 = gyT.i0[y] * GMW;
      const gy1 = gyT.i1[y] * GMW;
      const gfy = gyT.f[y];
      const ny0 = nyT.i0[y] * gr.gw;
      const ny1 = nyT.i1[y] * gr.gw;
      const nfy = nyT.f[y];
      const cy0 = cyT.i0[y] * gr.cw;
      const cy1 = cyT.i1[y] * gr.cw;
      const cfy = cyT.f[y];
      const dy = y - cy;
      const dy2 = dy * dy;
      const rowR = Math.round(cy + dy * (1 + caK));
      const rowB = Math.round(cy + dy * (1 - caK * 0.8));
      const yR = (rowR < 0 ? 0 : rowR >= h ? h - 1 : rowR) * w;
      const yB = (rowB < 0 ? 0 : rowB >= h ? h - 1 : rowB) * w;

      for (let x = 0; x < w; x++) {
        const i = (y * w + x) << 2;
        const dx = x - cx;
        const d2 = (dx * dx + dy2) * invHD2;

        // Detail: softened + sharpened, with lateral chromatic aberration.
        let r, g, b;
        g = S[i + 1] + sharp * (S[i + 1] - B[i + 1]);
        if (caK > 0) {
          let xr = Math.round(cx + dx * (1 + caK));
          let xb = Math.round(cx + dx * (1 - caK * 0.8));
          xr = xr < 0 ? 0 : xr >= w ? w - 1 : xr;
          xb = xb < 0 ? 0 : xb >= w ? w - 1 : xb;
          const jr = (yR + xr) << 2;
          const jb = ((yB + xb) << 2) + 2;
          r = S[jr] + sharp * (S[jr] - B[jr]);
          b = S[jb] + sharp * (S[jb] - B[jb]);
        } else {
          r = S[i] + sharp * (S[i] - B[i]);
          b = S[i + 2] + sharp * (S[i + 2] - B[i + 2]);
        }
        r *= INV255;
        g *= INV255;
        b *= INV255;

        // Glow map sample (bilinear).
        const gx0 = gxT.i0[x];
        const gx1 = gxT.i1[x];
        const gfx = gxT.f[x];
        const a00 = (gy0 + gx0) << 2;
        const a01 = (gy0 + gx1) << 2;
        const a10 = (gy1 + gx0) << 2;
        const a11 = (gy1 + gx1) << 2;
        const w00 = (1 - gfx) * (1 - gfy);
        const w01 = gfx * (1 - gfy);
        const w10 = (1 - gfx) * gfy;
        const w11 = gfx * gfy;

        // Regional contrast: undo the flattening modern HDR does.
        if (local) {
          const ll = GD[a00 + 3] * w00 + GD[a01 + 3] * w01 + GD[a10 + 3] * w10 + GD[a11 + 3] * w11;
          const l0 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          let dl = (l0 - ll) * local;
          if (dl > 0) dl *= 1.15 - l0; // don't push faces and bright subjects off the top
          r += dl;
          g += dl;
          b += dl;
        }

        // Lens shading + on-camera flash falloff.
        let gain = 1 - vig * (0.55 * d2 + 0.45 * d2 * d2);
        if (flash) gain *= 1 + flash * (0.5 - 1.15 * d2);
        r *= gain;
        g *= gain;
        b *= gain;

        // Tone + white balance.
        let k = r * LUT_K;
        r = LR[k < 0 ? 0 : k > LUT_N - 1 ? LUT_N - 1 : k | 0];
        k = g * LUT_K;
        g = LG[k < 0 ? 0 : k > LUT_N - 1 ? LUT_N - 1 : k | 0];
        k = b * LUT_K;
        b = LB[k < 0 ? 0 : k > LUT_N - 1 ? LUT_N - 1 : k | 0];

        // Colour science: greens lean yellow, blues lean cyan.
        const gd = g - (r > b ? r : b);
        if (gd > 0) {
          r += gd * g2y;
          b -= gd * g2y * 0.25;
        }
        const bd = b - (r > g ? r : g);
        if (bd > 0) {
          g += bd * b2c;
          r -= bd * b2c * 0.4;
        }

        // Saturation: less in deep shadows and near clipping, like a small sensor.
        let l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        let s = sat;
        if (l < 0.35) s *= 0.72 + 0.28 * (l / 0.35);
        else if (l > 0.8) s *= 1 - 0.85 * smoothstep(0.8, 1, l);
        r = l + (r - l) * s;
        g = l + (g - l) * s;
        b = l + (b - l) * s;

        // Split tone.
        const sh = (1 - l) * (1 - l);
        const hi = l * l * (1 - smoothstep(0.86, 1, l)); // clipped white stays white
        r += sh * shR + hi * hiR;
        g += sh * shG + hi * hiG;
        b += sh * shB + hi * hiB;

        // Purple fringing: dark detail sitting against blown highlights.
        if (fringe) {
          const lb = (0.2126 * B[i] + 0.7152 * B[i + 1] + 0.0722 * B[i + 2]) * INV255;
          if (lb > 0.7) {
            const ls = (0.2126 * S[i] + 0.7152 * S[i + 1] + 0.0722 * S[i + 2]) * INV255;
            const f = (lb - ls) * smoothstep(0.7, 0.97, lb) * fringe;
            if (f > 0) {
              r += f * 0.32;
              g += f * 0.04;
              b += f * 0.58;
            }
          }
        }

        r = r < 0 ? 0 : r > 1 ? 1 : r;
        g = g < 0 ? 0 : g > 1 ? 1 : g;
        b = b < 0 ? 0 : b > 1 ? 1 : b;

        // Bloom around highlights (screen), warm.
        if (bloom) {
          const br = (GD[a00] * w00 + GD[a01] * w01 + GD[a10] * w10 + GD[a11] * w11) * bloom;
          const bg = (GD[a00 + 1] * w00 + GD[a01 + 1] * w01 + GD[a10 + 1] * w10 + GD[a11 + 1] * w11) * bloom * 0.93;
          const bb = (GD[a00 + 2] * w00 + GD[a01 + 2] * w01 + GD[a10 + 2] * w10 + GD[a11 + 2] * w11) * bloom * 0.8;
          r = 1 - (1 - r) * (1 - (br > 1 ? 1 : br));
          g = 1 - (1 - g) * (1 - (bg > 1 ? 1 : bg));
          b = 1 - (1 - b) * (1 - (bb > 1 ? 1 : bb));
        }

        // The purple flare.
        if (F) {
          const fx = x - F.lx;
          const fy = y - F.ly;
          const fd2 = (fx * fx + fy * fy) * invDiag2;
          const haze = (F.pa * 0.6) / (1 + fd2 * 26);
          const veil = (F.pa * 0.07) / (1 + fd2 * 4);
          const core = (F.a * 0.85) / (1 + fd2 * 500);
          const along = (fx * F.ax + fy * F.ay) * invDiag;
          const perp = (fy * F.ax - fx * F.ay) * invDiag;
          const at = along > 0 ? along * 2.4 : along * 10;
          const beam = (F.pa * 0.3) / ((1 + perp * perp * 520) * (1 + at * at));
          let fr = haze * 0.7 + veil * 0.55 + beam * 0.62 + core;
          let fg = haze * 0.36 + veil * 0.45 + beam * 0.28 + core * 0.94;
          let fb = haze + veil * 0.85 + beam * 0.95 + core * 0.82;
          const e1x = x - F.g1x;
          const e1y = y - F.g1y;
          const e1 = e1x * e1x + e1y * e1y;
          if (e1 < F.r1) {
            const t = F.a * 0.42 * smoothstep(F.r1, F.r1 * 0.5, e1);
            fr += t * 0.35;
            fg += t * 0.95;
            fb += t * 0.5;
          }
          const e2x = x - F.g2x;
          const e2y = y - F.g2y;
          const e2 = e2x * e2x + e2y * e2y;
          if (e2 < F.r2) {
            const t = F.a * 0.3 * smoothstep(F.r2, F.r2 * 0.35, e2);
            fr += t * 0.7;
            fg += t * 0.35;
            fb += t;
          }
          r = 1 - (1 - r) * (1 - (fr > 1 ? 1 : fr));
          g = 1 - (1 - g) * (1 - (fg > 1 ? 1 : fg));
          b = 1 - (1 - b) * (1 - (fb > 1 ? 1 : fb));
        }

        // Sensor noise: clumpy luma grain, colour blotches in the shadows.
        if (grainAmt) {
          const lg = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          const inv = 1 - lg;
          const wgt = 0.3 + 0.7 * inv * inv;
          const nx0 = nxT.i0[x];
          const nx1 = nxT.i1[x];
          const nfx = nxT.f[x];
          let n =
            (GG[ny0 + nx0] * (1 - nfx) + GG[ny0 + nx1] * nfx) * (1 - nfy) +
            (GG[ny1 + nx0] * (1 - nfx) + GG[ny1 + nx1] * nfx) * nfy;
          n *= grainAmt * wgt;
          if (fineAmt) {
            rs ^= rs << 13;
            rs ^= rs >>> 17;
            rs ^= rs << 5;
            n += ((rs & 0xffff) / 65535 - 0.5) * fineAmt * wgt;
          }
          const c0 = cxT.i0[x];
          const c1 = cxT.i1[x];
          const cf = cxT.f[x];
          const p00 = (cy0 + c0) * 3;
          const p01 = (cy0 + c1) * 3;
          const p10 = (cy1 + c0) * 3;
          const p11 = (cy1 + c1) * 3;
          const q00 = (1 - cf) * (1 - cfy);
          const q01 = cf * (1 - cfy);
          const q10 = (1 - cf) * cfy;
          const q11 = cf * cfy;
          const cw = chromaAmt * inv * inv;
          r += n + (GC[p00] * q00 + GC[p01] * q01 + GC[p10] * q10 + GC[p11] * q11) * cw;
          g += n + (GC[p00 + 1] * q00 + GC[p01 + 1] * q01 + GC[p10 + 1] * q10 + GC[p11 + 1] * q11) * cw;
          b += n + (GC[p00 + 2] * q00 + GC[p01 + 2] * q01 + GC[p10 + 2] * q10 + GC[p11 + 2] * q11) * cw;
        }

        // Mix with the original by strength.
        const oR = A[i];
        const oG = A[i + 1];
        const oB = A[i + 2];
        O[i] = oR + strength * (r * 255 - oR);
        O[i + 1] = oG + strength * (g * 255 - oG);
        O[i + 2] = oB + strength * (b * 255 - oB);
        O[i + 3] = 255;
      }
    }

    const c = inPlace ? base.canvas : makeCanvas(w, h);
    ctxOf(c).putImageData(out, 0, 0);
    return c;
  }

  dispose() {
    for (const b of this.bases.values()) release(b.canvas);
    this.bases.clear();
  }
}

// ---------- JPEG -----------------------------------------------------------

export function toBlob(canvas, type = 'image/jpeg', q = 0.92) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encoding failed'))), type, q),
  );
}

async function decode(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch (_) {
      /* fall through */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const jpegQuality = (amount) => 0.92 - 0.6 * amount;

// A real JPEG round trip. Large images get their artifacts at ~1600 px so the
// 8 MP export carries the same blockiness the preview shows.
export async function compress(canvas, amount) {
  if (amount < 0.02) return canvas;
  const q = jpegQuality(amount);
  const W = canvas.width;
  const H = canvas.height;
  const long = Math.max(W, H);
  if (long <= 1700) {
    const bmp = await decode(await toBlob(canvas, 'image/jpeg', q));
    ctxOf(canvas).drawImage(bmp, 0, 0, W, H);
    if (bmp.close) bmp.close();
    return canvas;
  }
  const s = 1600 / long;
  const sw = Math.round(W * s);
  const sh = Math.round(H * s);
  const small = resample(canvas, sw, sh);
  const before = pixels(small);
  const bmp = await decode(await toBlob(small, 'image/jpeg', q));
  const sx = ctxOf(small, true);
  sx.drawImage(bmp, 0, 0, sw, sh);
  if (bmp.close) bmp.close();
  const after = sx.getImageData(0, 0, sw, sh);
  const bd = before.data;
  const ad = after.data;
  for (let i = 0; i < ad.length; i += 4) {
    ad[i] = 128 + (ad[i] - bd[i]);
    ad[i + 1] = 128 + (ad[i + 1] - bd[i + 1]);
    ad[i + 2] = 128 + (ad[i + 2] - bd[i + 2]);
    ad[i + 3] = 255;
  }
  sx.putImageData(after, 0, 0);
  const up = resample(small, W, H);
  release(small);
  const res = pixels(up).data;
  release(up);
  const ctx = ctxOf(canvas, true);
  const full = ctx.getImageData(0, 0, W, H);
  const fd = full.data;
  for (let i = 0; i < fd.length; i += 4) {
    fd[i] += res[i] - 128;
    fd[i + 1] += res[i + 1] - 128;
    fd[i + 2] += res[i + 2] - 128;
  }
  ctx.putImageData(full, 0, 0);
  return canvas;
}

// ---------- capture info (for the caption and the photo's metadata) --------

export function captureInfo(base, lookKey) {
  const m = base.glow.meanLum;
  let shutter;
  let iso;
  if (lookKey === 'night') [shutter, iso] = [15, 800];
  else if (lookKey === 'flash') [shutter, iso] = [60, 320];
  else if (m > 0.55) [shutter, iso] = [1000, 50];
  else if (m > 0.42) [shutter, iso] = [400, 50];
  else if (m > 0.3) [shutter, iso] = [120, 64];
  else if (m > 0.18) [shutter, iso] = [40, 200];
  else [shutter, iso] = [20, 500];
  return { shutter, iso, flash: lookKey === 'flash' };
}

// ---------- white border with caption --------------------------------------

export function frame(canvas, info) {
  const w = canvas.width;
  const h = canvas.height;
  const side = Math.round(w * 0.05);
  const bottom = Math.round(w * 0.17);
  const W = w + side * 2;
  const H = h + side + bottom;
  const c = makeCanvas(W, H);
  const x = ctxOf(c);
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, W, H);
  x.drawImage(canvas, side, side);

  const font = '"Helvetica Neue", Helvetica, Arial, sans-serif';
  const size1 = Math.round(w * 0.03);
  const size2 = Math.round(w * 0.021);
  const y1 = h + side + bottom * 0.46;
  const y2 = y1 + size1 * 1.25;

  const lead = 'Shot on ';
  const model = 'iPhone 5';
  x.textBaseline = 'alphabetic';
  x.font = `400 ${size1}px ${font}`;
  const wl = x.measureText(lead).width;
  x.font = `700 ${size1}px ${font}`;
  const wm = x.measureText(model).width;
  const start = (W - wl - wm) / 2;
  x.fillStyle = '#1d1d1f';
  x.font = `400 ${size1}px ${font}`;
  x.fillText(lead, start, y1);
  x.font = `700 ${size1}px ${font}`;
  x.fillText(model, start + wl, y1);

  x.font = `400 ${size2}px ${font}`;
  x.fillStyle = '#8a8a8e';
  x.textAlign = 'center';
  x.fillText(`33mm  f/2.4  1/${info.shutter}s  ISO${info.iso}`, W / 2, y2);
  return c;
}
