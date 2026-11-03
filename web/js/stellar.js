// Loads Stellar Lab's engine — Rust in sim/stellar, compiled to WebAssembly — and wraps
// its plain C-style exports. No bindings generator: numbers in, numbers out, and two
// RGBA frame buffers read straight out of WebAssembly memory.

export const STAGES = [
  'Main sequence',
  'Subgiant',
  'Red giant',
  'Helium burning',
  'Asymptotic giant branch',
  'Planetary nebula',
  'White dwarf',
  'Supergiant',
  'Supernova',
  'Neutron star',
  'Black hole',
  'Type Ia supernova',
  'Failed supernova',
  'Pair-instability supernova',
  'Nothing left',
];

export const FATES = ['White dwarf', 'Neutron star', 'Black hole', 'Black hole (no explosion)', 'Nothing at all'];

/** Event codes from sim/stellar/src/physics.rs → `event` */
export const EVENT = {
  LEFT_MAIN_SEQUENCE: 1,
  RED_GIANT: 2,
  HELIUM_FLASH: 3,
  HELIUM_IGNITION: 4,
  AGB: 5,
  PLANETARY_NEBULA: 6,
  WHITE_DWARF: 7,
  SUPERGIANT: 8,
  SUPERNOVA: 9,
  NEUTRON_STAR: 10,
  BLACK_HOLE: 11,
  TYPE_IA: 12,
  DIRECT_COLLAPSE: 13,
  PAIR_INSTABILITY: 14,
  NEUTRON_STAR_COLLAPSE: 15,
  HELIUM_WHITE_DWARF: 16,
  ACCRETION: 17,
};

const REQUIRED = ['memory', 'lab_new', 'lab_step', 'lab_render', 'lab_set_mass', 'lab_view_ptr', 'lab_hr_ptr', 'lab_stage', 'lab_fate'];

/** `source`: a URL, or the .wasm bytes. */
export async function loadStellar(source) {
  let instance;
  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
    ({ instance } = await WebAssembly.instantiate(source, {}));
  } else {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Couldn't download the simulator (${res.status}).`);
    const bytes = await res.arrayBuffer();
    ({ instance } = await WebAssembly.instantiate(bytes, {}));
  }
  const missing = REQUIRED.filter((k) => !(k in instance.exports));
  if (missing.length) throw new Error(`The simulator is out of date (missing ${missing.join(', ')}).`);
  return new Engine(instance.exports);
}

class Engine {
  constructor(x) {
    this.x = x;
    this.limits = {
      chandrasekhar: x.lab_limit(0),
      tov: x.lab_limit(1),
      massive: x.lab_limit(2),
      directCollapse: x.lab_limit(3),
      pairInstability: x.lab_limit(4),
      min: x.lab_limit(5),
      max: x.lab_limit(6),
    };
  }
  /** A new lab with one star in it. */
  lab(mass = 1, seed = (Math.random() * 2 ** 32) >>> 0) {
    return new Lab(this.x, mass, seed);
  }
  fate(mass) {
    return this.x.lab_fate(mass);
  }
  msLifetime(mass) {
    return this.x.lab_ms_lifetime(mass);
  }
  schwarzschildKm(mass) {
    return this.x.lab_schwarzschild_km(mass);
  }
}

class Lab {
  constructor(x, mass, seed) {
    this.x = x;
    this.p = x.lab_new(mass, seed >>> 0);
    this.viewW = x.lab_view_width();
    this.viewH = x.lab_view_height();
    this.hrW = x.lab_hr_width();
    this.hrH = x.lab_hr_height();
  }
  step(dt, speed) {
    this.x.lab_step(this.p, dt, speed);
  }
  render() {
    this.x.lab_render(this.p);
  }
  reset(mass) {
    this.x.lab_reset(this.p, mass);
  }
  skip() {
    this.x.lab_skip(this.p);
  }
  /** Returns the mass the engine actually used. */
  setMass(mass) {
    return this.x.lab_set_mass(this.p, mass);
  }
  setInk([r, g, b]) {
    this.x.lab_set_ink(this.p, r, g, b);
  }
  setGentle(on) {
    this.x.lab_set_gentle(this.p, on ? 1 : 0);
  }
  /** Everything that happened since last asked, oldest first. */
  events() {
    const out = [];
    for (let e, n = 0; (e = this.x.lab_next_event(this.p)) && n < 64; n++) out.push(e);
    return out;
  }
  // Fresh views each time: the memory buffer is replaced if WebAssembly memory grows
  viewPixels() {
    return new Uint8ClampedArray(this.x.memory.buffer, this.x.lab_view_ptr(this.p), this.viewW * this.viewH * 4);
  }
  hrPixels() {
    return new Uint8ClampedArray(this.x.memory.buffer, this.x.lab_hr_ptr(this.p), this.hrW * this.hrH * 4);
  }
  state() {
    const x = this.x;
    const p = this.p;
    const stage = x.lab_stage(p);
    return {
      stage,
      progress: x.lab_progress(p),
      age: x.lab_age(p),
      mass: x.lab_mass(p),
      initialMass: x.lab_initial_mass(p),
      progenitorMass: x.lab_progenitor_mass(p),
      luminosity: x.lab_luminosity(p),
      temperature: x.lab_temperature(p),
      radius: x.lab_radius(p),
      coolingAge: x.lab_cooling_age(p),
      canChangeMass: x.lab_can_change_mass(p) === 1,
    };
  }
  free() {
    this.x.lab_free(this.p);
    this.p = 0;
  }
}

// ---------- formatting ----------

const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const sup = (n) => String(n).replace(/[-0-9]/g, (c) => SUP[c]);

/** 0.00123 → "1.2×10⁻³", 42 → "42", 1.5e9 → "1.5×10⁹" */
export function sci(v, digits = 2) {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 0.01 && a < 10_000) return Number(v.toPrecision(digits)).toLocaleString('en-GB');
  const e = Math.floor(Math.log10(a));
  const m = v / 10 ** e;
  return `${Number(m.toPrecision(digits))}×10${sup(e)}`;
}

export function years(y) {
  if (!Number.isFinite(y)) return '—';
  if (y >= 1e9) return `${Number((y / 1e9).toPrecision(3))} billion yr`;
  if (y >= 1e6) return `${Number((y / 1e6).toPrecision(3))} million yr`;
  if (y >= 1e4) return `${Math.round(y / 1e3).toLocaleString('en-GB')} thousand yr`;
  if (y >= 2) return `${Math.round(y).toLocaleString('en-GB')} yr`;
  if (y >= 1 / 12) return `${Math.round(y * 12)} months`;
  if (y < 1 / 365) return '0 yr';
  return `${Math.max(1, Math.round(y * 365))} days`;
}

const R_SUN_KM = 695_700;
export function radius(rSun) {
  if (!Number.isFinite(rSun) || rSun <= 0) return '—';
  if (rSun < 0.05) {
    const km = rSun * R_SUN_KM;
    return `${km < 100 ? Number(km.toPrecision(3)) : Math.round(km).toLocaleString('en-GB')} km`;
  }
  return `${sci(rSun, 3)} R☉`;
}

export function kelvin(t) {
  if (!Number.isFinite(t) || t <= 0) return '—';
  if (t >= 1e6) return `${sci(t, 2)} K`;
  const step = t >= 1e4 ? 100 : 10;
  return `${(Math.round(t / step) * step).toLocaleString('en-GB')} K`;
}

export function solarMasses(m) {
  if (!Number.isFinite(m)) return '—';
  return `${m < 10 ? m.toFixed(2) : m < 100 ? m.toFixed(1) : Math.round(m)} M☉`;
}

// The mass slider runs on a log scale from 0.08 to 300 M☉
export const SLIDER_MAX = 1000;
export const sliderToMass = (v, min = 0.08, max = 300) => min * (max / min) ** (v / SLIDER_MAX);
export const massToSlider = (m, min = 0.08, max = 300) => Math.round((Math.log(m / min) / Math.log(max / min)) * SLIDER_MAX);
