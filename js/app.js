import { LOOKS, Developer, SENSOR, compress, frame, captureInfo, toBlob, release } from './engine.js';
import { readDateTaken, withIphone5Exif } from './exif.js';

const $ = (id) => document.getElementById(id);
const PREVIEW_LONG = 1400;
const DRAFT_LONG = 640;
const THUMB = 168;
const SLIDERS = ['strength', 'warmth', 'flare', 'grain', 'softness', 'compression'];

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('i5:' + k);
      return v === null ? d : JSON.parse(v);
    } catch (_) {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('i5:' + k, JSON.stringify(v));
    } catch (_) {
      /* private mode: settings just won't stick */
    }
  },
};

const state = {
  dev: null,
  imgUrl: null,
  date: null,
  look: LOOKS[store.get('look', 'classic')] ? store.get('look', 'classic') : 'classic',
  values: {},
  aspect: store.get('aspect', 'original'),
  frame: store.get('frame', false),
  tag: store.get('tag', true),
  flare: null, // {x, y} in 0..1 photo coordinates once the person taps; null = auto
  busy: false,
  last: null, // { base, layout } of the latest preview
};

const els = {
  app: $('app'),
  vf: $('viewfinder'),
  view: $('view'),
  orig: $('orig'),
  origBadge: $('origBadge'),
  marker: $('marker'),
  empty: $('empty'),
  busy: $('busy'),
  busyText: $('busyText'),
  hint: $('hint'),
  error: $('error'),
  controls: $('controls'),
  looks: $('looks'),
  actionbar: $('actionbar'),
  file: $('file'),
  flareAuto: $('flareAuto'),
  frame: $('frame'),
  tag: $('tag'),
  shape: $('shape'),
  result: $('result'),
  resultImg: $('resultImg'),
  resultMeta: $('resultMeta'),
  share: $('share'),
};

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// ---------- params ---------------------------------------------------------

function lookDefaults(key) {
  const l = LOOKS[key];
  return Object.fromEntries(SLIDERS.map((k) => [k, l[k]]));
}

function params() {
  return { ...LOOKS[state.look], ...state.values };
}

function flarePoint(base, p) {
  if (p.flare <= 0) return null;
  if (state.flare) return { x: state.flare.x, y: state.flare.y, amount: p.flare, purple: 1 };
  const l = base.glow.light;
  return { x: l.x, y: l.y, amount: p.flare * l.factor, purple: l.purple };
}

// ---------- sliders --------------------------------------------------------

const toUi = (k, v) => Math.round(v * 100);
const fromUi = (k, v) => Number(v) / 100;

function formatValue(k, v) {
  const n = Math.round(v * 100);
  if (k === 'warmth') return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0';
  if (k === 'strength') return `${n}%`;
  return String(n);
}

function paintSlider(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`);
}

function syncSliders() {
  for (const k of SLIDERS) {
    const input = $(`s-${k}`);
    input.value = toUi(k, state.values[k]);
    input.closest('.slider').querySelector('output').textContent = formatValue(k, state.values[k]);
    paintSlider(input);
  }
  els.flareAuto.hidden = !state.flare;
}

for (const k of SLIDERS) {
  const input = $(`s-${k}`);
  const out = input.closest('.slider').querySelector('output');
  input.addEventListener('input', () => {
    state.values[k] = fromUi(k, input.value);
    out.textContent = formatValue(k, state.values[k]);
    paintSlider(input);
    schedule('draft');
  });
  input.addEventListener('change', () => schedule('full'));
}

els.flareAuto.addEventListener('click', () => {
  state.flare = null;
  els.flareAuto.hidden = true;
  schedule('full');
});

// ---------- looks ----------------------------------------------------------

const lookButtons = {};
for (const [key, look] of Object.entries(LOOKS)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'look';
  b.setAttribute('role', 'radio');
  b.dataset.look = key;
  const c = document.createElement('canvas');
  c.width = THUMB;
  c.height = THUMB;
  c.setAttribute('aria-hidden', 'true');
  const span = document.createElement('span');
  span.textContent = look.name;
  b.append(c, span);
  b.addEventListener('click', () => chooseLook(key));
  els.looks.append(b);
  lookButtons[key] = b;
}

els.looks.addEventListener('keydown', (e) => {
  const keys = Object.keys(LOOKS);
  const i = keys.indexOf(state.look);
  let n = -1;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % keys.length;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + keys.length) % keys.length;
  if (n >= 0) {
    e.preventDefault();
    chooseLook(keys[n]);
    lookButtons[keys[n]].focus();
  }
});

function syncLooks() {
  for (const [key, b] of Object.entries(lookButtons)) {
    const on = key === state.look;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  }
}

function chooseLook(key) {
  state.look = key;
  state.values = lookDefaults(key);
  store.set('look', key);
  syncLooks();
  syncSliders();
  schedule('full');
}

async function renderThumbs() {
  const dev = state.dev;
  if (!dev) return;
  const aspect = '1:1';
  const base = dev.base(THUMB, aspect);
  for (const key of Object.keys(LOOKS)) {
    if (dev !== state.dev) return;
    const p = { ...LOOKS[key], compression: 0 };
    const l = base.glow.light;
    const fp = p.flare > 0 ? { x: l.x, y: l.y, amount: p.flare * l.factor, purple: l.purple } : null;
    const c = dev.develop(base, p, fp);
    const t = lookButtons[key].querySelector('canvas');
    t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
    release(c);
    await nextFrame();
  }
}

// ---------- options --------------------------------------------------------

function syncOptions() {
  for (const b of els.shape.querySelectorAll('button')) {
    const on = b.dataset.aspect === state.aspect;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  els.frame.checked = state.frame;
  els.tag.checked = state.tag;
}

els.shape.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.aspect = b.dataset.aspect;
  store.set('aspect', state.aspect);
  syncOptions();
  schedule('full');
});

els.shape.addEventListener('keydown', (e) => {
  const order = ['original', '4:3', '1:1'];
  const i = order.indexOf(state.aspect);
  let n = -1;
  if (e.key === 'ArrowRight') n = (i + 1) % order.length;
  if (e.key === 'ArrowLeft') n = (i - 1 + order.length) % order.length;
  if (n >= 0) {
    e.preventDefault();
    state.aspect = order[n];
    store.set('aspect', state.aspect);
    syncOptions();
    els.shape.querySelector(`[data-aspect="${order[n]}"]`).focus();
    schedule('full');
  }
});

els.frame.addEventListener('change', () => {
  state.frame = els.frame.checked;
  store.set('frame', state.frame);
  schedule('full');
});

els.tag.addEventListener('change', () => {
  state.tag = els.tag.checked;
  store.set('tag', state.tag);
});

// ---------- preview rendering ---------------------------------------------

let rendering = false;
let queued = null;

function schedule(kind) {
  if (!state.dev) return;
  queued = kind;
  if (!rendering) pump();
}

async function pump() {
  rendering = true;
  try {
    while (queued) {
      const kind = queued;
      queued = null;
      await renderPreview(kind === 'draft');
      await nextFrame();
    }
  } catch (err) {
    console.error(err);
    showError('The preview couldn’t be developed. Try a smaller photo, or reload the page.');
  } finally {
    rendering = false;
  }
}

function frameLayout(w, h) {
  const side = Math.round(w * 0.05);
  const bottom = Math.round(w * 0.17);
  return { px: side, py: side, pw: w, ph: h, W: w + side * 2, H: h + side + bottom };
}

async function renderPreview(draft) {
  const dev = state.dev;
  const p = params();
  const base = dev.base(draft ? DRAFT_LONG : PREVIEW_LONG, state.aspect);
  let c = dev.develop(base, p, flarePoint(base, p));
  c = await compress(c, p.compression);
  if (dev !== state.dev) return release(c);

  let layout = { px: 0, py: 0, pw: base.w, ph: base.h, W: base.w, H: base.h };
  if (state.frame) {
    const f = frame(c, captureInfo(base, state.look));
    release(c);
    c = f;
    layout = frameLayout(base.w, base.h);
  }

  const v = els.view;
  if (v.width !== c.width || v.height !== c.height) {
    v.width = c.width;
    v.height = c.height;
  }
  v.getContext('2d').drawImage(c, 0, 0);
  release(c);

  els.vf.style.setProperty('--ar', `${layout.W} / ${layout.H}`);
  els.vf.style.setProperty('--ar-num', String(layout.W / layout.H));
  state.last = { base, layout };
}

function showOriginal(on) {
  if (on && state.last) {
    const { base, layout } = state.last;
    const o = els.orig;
    o.width = layout.W;
    o.height = layout.H;
    const ctx = o.getContext('2d');
    if (state.frame) {
      const f = frame(base.canvas, captureInfo(base, state.look));
      ctx.drawImage(f, 0, 0, o.width, o.height);
      release(f);
    } else {
      ctx.drawImage(base.canvas, 0, 0, o.width, o.height);
    }
  }
  els.vf.classList.toggle('is-comparing', on);
}

// ---------- tap to place the flare, hold to compare ------------------------

let press = null;

els.vf.addEventListener('contextmenu', (e) => {
  if (state.dev) e.preventDefault();
});

els.vf.addEventListener('pointerdown', (e) => {
  if (!state.dev || state.busy || e.target.closest('.empty')) return;
  press = {
    x: e.clientX,
    y: e.clientY,
    holding: false,
    timer: setTimeout(() => {
      if (!press) return;
      press.holding = true;
      showOriginal(true);
    }, 240),
  };
});

els.vf.addEventListener('pointermove', (e) => {
  if (press && !press.holding && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 12) {
    clearTimeout(press.timer);
    press = null;
  }
});

function endPress(e, cancelled) {
  if (!press) return;
  clearTimeout(press.timer);
  const p = press;
  press = null;
  if (p.holding) {
    showOriginal(false);
    return;
  }
  if (cancelled || !state.last) return;
  placeFlare(e.clientX, e.clientY);
}

els.vf.addEventListener('pointerup', (e) => endPress(e, false));
els.vf.addEventListener('pointercancel', (e) => endPress(e, true));
els.vf.addEventListener('pointerleave', (e) => {
  if (press && press.holding) endPress(e, true);
});

function placeFlare(clientX, clientY) {
  const r = els.view.getBoundingClientRect();
  const { layout } = state.last;
  const fx = ((clientX - r.left) / r.width) * layout.W;
  const fy = ((clientY - r.top) / r.height) * layout.H;
  const x = (fx - layout.px) / layout.pw;
  const y = (fy - layout.py) / layout.ph;
  if (x < -0.05 || x > 1.05 || y < -0.05 || y > 1.05) return;
  state.flare = { x, y };
  if (state.values.flare < 0.15) state.values.flare = 0.6;
  syncSliders();

  const m = els.marker;
  m.style.left = `${clientX - els.vf.getBoundingClientRect().left}px`;
  m.style.top = `${clientY - els.vf.getBoundingClientRect().top}px`;
  m.classList.remove('is-on');
  void m.offsetWidth;
  m.classList.add('is-on');
  schedule('full');
}

// ---------- loading --------------------------------------------------------

function showError(msg) {
  els.error.textContent = msg;
  els.error.hidden = !msg;
}

function setBusy(text) {
  state.busy = Boolean(text);
  els.busy.hidden = !text;
  if (text) els.busyText.textContent = text;
  els.app.setAttribute('aria-busy', String(Boolean(text)));
}

function pick() {
  els.file.value = '';
  els.file.click();
}

$('pickEmpty').addEventListener('click', pick);
$('pick').addEventListener('click', pick);
els.file.addEventListener('change', () => {
  const f = els.file.files && els.file.files[0];
  if (f) loadFile(f);
});

async function loadFile(file) {
  showError('');
  setBusy('Opening photo');
  await nextFrame();
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    if (!img.naturalWidth) throw new Error('empty image');

    if (state.dev) state.dev.dispose();
    if (state.imgUrl) URL.revokeObjectURL(state.imgUrl);
    state.imgUrl = url;
    state.dev = new Developer(img);
    state.flare = null;
    state.values = lookDefaults(state.look);
    state.date = (await readDateTaken(file)) || new Date(file.lastModified || Date.now());

    els.app.dataset.state = 'ready';
    els.empty.hidden = true;
    els.controls.hidden = false;
    els.actionbar.hidden = false;
    els.hint.hidden = false;
    syncSliders();
    syncLooks();
    syncOptions();

    setBusy('Developing');
    await nextFrame();
    queued = null;
    await renderPreview(false);
    setBusy(false);
    renderThumbs();
  } catch (err) {
    console.error(err);
    URL.revokeObjectURL(url);
    setBusy(false);
    showError('That photo couldn’t be opened. Pick it again, or try a JPEG or PNG.');
  }
}

// ---------- saving ---------------------------------------------------------

let resultFile = null;
let resultUrl = null;

$('save').addEventListener('click', save);

async function save() {
  if (!state.dev || state.busy) return;
  showError('');
  setBusy('Developing 8 MP photo');
  await nextFrame();
  // Let any queued preview settle first so the two don't fight over memory.
  while (rendering) await nextFrame();
  try {
    const dev = state.dev;
    const p = params();
    const long = state.aspect === '1:1' ? SENSOR.short : SENSOR.long;
    const base = dev.base(long, state.aspect, false);
    const info = captureInfo(base, state.look);
    let c = dev.develop(base, p, flarePoint(base, p), { inPlace: true });
    base.A = null;
    base.soft = null;
    await nextFrame();
    c = await compress(c, p.compression);
    if (state.frame) {
      const f = frame(c, info);
      release(c);
      c = f;
    }
    const width = c.width;
    const height = c.height;
    let blob = await toBlob(c, 'image/jpeg', 0.92);
    release(c);
    if (state.tag) blob = await withIphone5Exif(blob, { width, height, date: state.date || new Date(), ...info });

    const name = `IMG_${1000 + Math.floor(Math.random() * 9000)}.JPG`;
    resultFile = new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = URL.createObjectURL(resultFile);
    els.resultImg.src = resultUrl;
    els.resultMeta.textContent = `${width} × ${height} pixels, ${(blob.size / 1e6).toFixed(1)} MB`;
    const canShare = navigator.canShare && navigator.canShare({ files: [resultFile] });
    els.share.textContent = canShare ? 'Save to Photos' : 'Download';
    setBusy(false);
    if (typeof els.result.showModal === 'function') els.result.showModal();
    else els.result.setAttribute('open', '');
  } catch (err) {
    console.error(err);
    setBusy(false);
    showError('The full-size photo couldn’t be developed. Close other tabs to free memory and try again.');
  }
}

els.share.addEventListener('click', async () => {
  if (!resultFile) return;
  if (navigator.canShare && navigator.canShare({ files: [resultFile] })) {
    try {
      await navigator.share({ files: [resultFile] });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = resultUrl;
  a.download = resultFile.name;
  document.body.append(a);
  a.click();
  a.remove();
});

$('done').addEventListener('click', () => els.result.close());
els.result.addEventListener('click', (e) => {
  if (e.target === els.result) els.result.close();
});

// ---------- boot -----------------------------------------------------------

state.values = lookDefaults(state.look);
syncSliders();
syncLooks();
syncOptions();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
