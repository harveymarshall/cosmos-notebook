//! The picture: a pixel-art view of the star (with particles for winds, nebulae,
//! supernova debris and black-hole accretion discs, and gravitational lensing of
//! the background stars), plus a small Hertzsprung–Russell diagram.
//! Both are drawn into RGBA byte buffers that the page copies straight onto canvases.

use crate::physics::{event, Stage, Star};

pub const VIEW_W: usize = 320;
pub const VIEW_H: usize = 180;
pub const HR_W: usize = 160;
pub const HR_H: usize = 180;
const MAX_PARTICLES: usize = 7000;

// HR diagram axes: temperature runs hot → cool, left → right (as astronomers draw it)
pub const HR_LOG_T_HOT: f64 = 5.2;
pub const HR_LOG_T_COOL: f64 = 3.3;
pub const HR_LOG_L_TOP: f64 = 7.0;
pub const HR_LOG_L_BOTTOM: f64 = -5.0;

const BAYER: [f32; 16] = [0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0];

// ---------- small helpers ----------

pub struct Rng(u32);
impl Rng {
    pub fn new(seed: u32) -> Rng {
        Rng(seed.max(1))
    }
    pub fn next(&mut self) -> f32 {
        // xorshift32
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        (x >> 8) as f32 / (1u32 << 24) as f32
    }
    fn range(&mut self, a: f32, b: f32) -> f32 {
        a + (b - a) * self.next()
    }
}

fn hash(x: i32, y: i32, s: i32) -> f32 {
    let mut h = (x as u32).wrapping_mul(374_761_393) ^ (y as u32).wrapping_mul(668_265_263) ^ (s as u32).wrapping_mul(2_147_483_647);
    h = (h ^ (h >> 13)).wrapping_mul(1_274_126_177);
    ((h ^ (h >> 16)) & 0xffff) as f32 / 65535.0
}

fn vnoise(x: f32, y: f32, s: i32) -> f32 {
    let (xi, yi) = (x.floor() as i32, y.floor() as i32);
    let (fx, fy) = (x - x.floor(), y - y.floor());
    let (sx, sy) = (fx * fx * (3.0 - 2.0 * fx), fy * fy * (3.0 - 2.0 * fy));
    let a = hash(xi, yi, s) + (hash(xi + 1, yi, s) - hash(xi, yi, s)) * sx;
    let b = hash(xi, yi + 1, s) + (hash(xi + 1, yi + 1, s) - hash(xi, yi + 1, s)) * sx;
    a + (b - a) * sy
}

/// Colour of a black body at `kelvin`, 0–1 per channel.
pub fn blackbody(kelvin: f64) -> [f32; 3] {
    let t = (kelvin / 100.0).clamp(10.0, 400.0);
    let r = if t <= 66.0 { 255.0 } else { 329.698_727_446 * (t - 60.0).powf(-0.133_204_759_2) };
    let g = if t <= 66.0 { 99.470_802_586_1 * t.ln() - 161.119_568_166_1 } else { 288.122_169_528_3 * (t - 60.0).powf(-0.075_514_849_2) };
    let b = if t >= 66.0 {
        255.0
    } else if t <= 19.0 {
        0.0
    } else {
        138.517_731_223_1 * (t - 10.0).ln() - 305.044_792_730_7
    };
    [(r / 255.0).clamp(0.0, 1.0) as f32, (g / 255.0).clamp(0.0, 1.0) as f32, (b / 255.0).clamp(0.0, 1.0) as f32]
}

/// Black bodies look washed-out on screen; push the hue a little so a 5,800 K star reads as yellow.
fn vivid(c: [f32; 3]) -> [f32; 3] {
    let p = [c[0].powf(4.5), c[1].powf(4.5), c[2].powf(4.5)];
    let m = p[0].max(p[1]).max(p[2]).max(1e-6);
    [p[0] / m, p[1] / m, p[2] / m]
}

/// Star size on screen. Sizes run from 10 km to 1,000 solar radii, so the scale is logarithmic.
pub fn radius_px(r_sun: f64) -> f32 {
    if r_sun <= 0.0 {
        return 0.0;
    }
    let lr = r_sun.log10();
    if lr < -2.0 {
        (1.0 + (lr + 5.0) / 3.0).clamp(1.0, 2.0) as f32
    } else {
        (2.0 + (lr + 2.0) / (3.18 + 2.0) * 82.0).min(86.0) as f32
    }
}

/// Black-hole shadow size on screen (also logarithmic, and not to scale with stars).
fn shadow_px(m: f64) -> f32 {
    (6.0 + 3.5 * m.max(1.0).log10()).clamp(5.0, 26.0) as f32
}

#[derive(Clone, Copy)]
enum Kind {
    Debris,
    Nebula,
    Wind,
    Infall,
    Jet,
}

fn push(list: &mut Vec<Particle>, p: Particle) {
    if list.len() < MAX_PARTICLES {
        list.push(p);
    }
}

#[derive(Clone, Copy)]
struct Particle {
    x: f32,
    y: f32,
    vx: f32,
    vy: f32,
    age: f32,
    life: f32,
    kind: Kind,
    tint: u8,
}

struct DiscBit {
    r: f32,
    phase: f32,
    glow: f32,
}

pub struct Lab {
    pub star: Star,
    pub view: Vec<u8>,
    pub hr: Vec<u8>,
    light: Vec<[f32; 3]>,
    sky: Vec<[f32; 3]>,
    particles: Vec<Particle>,
    disc: Vec<DiscBit>,
    track: Vec<(f32, f32)>,
    zams_line: Vec<(f32, f32)>,
    rng: Rng,
    time: f32,
    flash: f32,
    bang_done: bool,
    last_r_px: f32,
    last_color: [f32; 3],
    ink: [u8; 3],
    outbox: Vec<u32>,
    gentle: bool,
}

impl Lab {
    pub fn new(mass: f64, seed: u32) -> Lab {
        let mut rng = Rng::new(seed);
        let mut sky = vec![[0.0f32; 3]; VIEW_W * VIEW_H];
        // A faint band of Milky Way, then stars
        for y in 0..VIEW_H {
            for x in 0..VIEW_W {
                let band = (-(((y as f32 - 0.35 * x as f32 - 30.0) / 38.0).powi(2))).exp();
                let n = vnoise(x as f32 / 14.0, y as f32 / 14.0, 7) * 0.6 + vnoise(x as f32 / 5.0, y as f32 / 5.0, 9) * 0.4;
                let v = band * n * 0.07;
                sky[y * VIEW_W + x] = [v * 0.8, v * 0.85, v];
            }
        }
        for _ in 0..340 {
            let x = (rng.next() * VIEW_W as f32) as usize;
            let y = (rng.next() * VIEW_H as f32) as usize;
            let b = rng.next().powi(3) * 0.9 + 0.12;
            let c = blackbody((2800.0 + rng.next() as f64 * 12000.0) as f64);
            let px = &mut sky[y * VIEW_W + x];
            for i in 0..3 {
                px[i] += c[i] * b;
            }
            if b > 0.75 {
                for (dx, dy) in [(-1i32, 0i32), (1, 0), (0, -1), (0, 1)] {
                    let (nx, ny) = (x as i32 + dx, y as i32 + dy);
                    if nx >= 0 && ny >= 0 && (nx as usize) < VIEW_W && (ny as usize) < VIEW_H {
                        let q = &mut sky[ny as usize * VIEW_W + nx as usize];
                        for i in 0..3 {
                            q[i] += c[i] * b * 0.3;
                        }
                    }
                }
            }
        }
        // Reference line: the zero-age main sequence
        let mut zams_line = Vec::new();
        let mut m = 0.1f64;
        while m <= 150.0 {
            let s = Star::new(m);
            let (l, t, _) = s.observables();
            zams_line.push(hr_xy(l, t));
            m *= 1.08;
        }
        let mut lab = Lab {
            star: Star::new(mass),
            view: vec![0; VIEW_W * VIEW_H * 4],
            hr: vec![0; HR_W * HR_H * 4],
            light: vec![[0.0; 3]; VIEW_W * VIEW_H],
            sky,
            particles: Vec::with_capacity(MAX_PARTICLES),
            disc: Vec::new(),
            track: Vec::with_capacity(4096),
            zams_line,
            rng,
            time: 0.0,
            flash: 0.0,
            bang_done: false,
            last_r_px: 10.0,
            last_color: [1.0, 1.0, 1.0],
            ink: [17, 17, 17],
            outbox: Vec::new(),
            gentle: false,
        };
        lab.record();
        lab
    }

    pub fn reset(&mut self, mass: f64) {
        self.star = Star::new(mass);
        self.particles.clear();
        self.disc.clear();
        self.track.clear();
        self.outbox.clear();
        self.flash = 0.0;
        self.bang_done = false;
        self.record();
    }

    /// Softer explosions (no bright full-screen flash) for people who prefer reduced motion.
    pub fn set_gentle(&mut self, on: bool) {
        self.gentle = on;
    }

    fn flash_to(&mut self, f: f32) {
        let f = if self.gentle { f * 0.25 } else { f };
        self.flash = self.flash.max(f);
    }

    pub fn set_ink(&mut self, r: u8, g: u8, b: u8) {
        self.ink = [r, g, b];
    }

    pub fn next_event(&mut self) -> u32 {
        if self.outbox.is_empty() {
            0
        } else {
            self.outbox.remove(0)
        }
    }

    pub fn set_mass(&mut self, m: f64) -> f64 {
        let before = self.star.mass;
        let got = self.star.set_mass(m);
        if got > before && self.star.stage.is_final() || self.star.stage == Stage::TypeIa {
            self.spawn_infall(((got - before) * 400.0).clamp(60.0, 500.0) as usize);
        }
        self.handle_events();
        self.record();
        got
    }

    pub fn skip(&mut self) {
        self.star.skip();
        self.handle_events();
        self.record();
    }

    /// `dt` is real seconds since the last frame; `speed` multiplies how fast the star ages.
    pub fn step(&mut self, dt: f64, speed: f64) {
        let dt = dt.clamp(0.0, 0.1);
        self.time += dt as f32;
        self.star.advance(dt * speed.clamp(0.0, 50.0));
        self.handle_events();
        self.explosions();
        self.winds(dt as f32);
        self.move_particles(dt as f32);
        self.flash *= (-(dt as f32) * 2.2).exp();
        self.record();
    }

    fn handle_events(&mut self) {
        for ev in self.star.take_events() {
            match ev {
                event::PLANETARY_NEBULA => self.spawn_nebula(),
                event::SUPERNOVA | event::TYPE_IA | event::DIRECT_COLLAPSE | event::PAIR_INSTABILITY => self.bang_done = false,
                event::NEUTRON_STAR_COLLAPSE => {
                    self.flash_to(0.9);
                    self.spawn_jets();
                }
                _ => {}
            }
            if matches!(ev, event::BLACK_HOLE | event::NEUTRON_STAR_COLLAPSE) {
                self.make_disc();
            }
            self.outbox.push(ev);
        }
    }

    fn explosions(&mut self) {
        if self.bang_done {
            return;
        }
        let p = self.star.progress;
        match self.star.stage {
            Stage::Supernova if p >= 0.08 => self.bang(2600, 30.0, 1.0),
            Stage::TypeIa if p >= 0.02 => self.bang(2400, 34.0, 1.2),
            Stage::PairInstability if p >= 0.05 => self.bang(4200, 48.0, 1.6),
            Stage::DirectCollapse if p >= 0.85 => self.bang(260, 12.0, 0.3),
            _ => {}
        }
    }

    fn bang(&mut self, n: usize, speed: f32, flash: f32) {
        self.bang_done = true;
        self.flash_to(flash);
        let r0 = self.last_r_px.min(30.0) * 0.6;
        let (p1, p2) = (self.rng.next() * 6.3, self.rng.next() * 6.3);
        for _ in 0..n {
            let a = self.rng.next() * core::f32::consts::TAU;
            let v = speed * (0.25 + 0.75 * self.rng.next().sqrt()) * (0.85 + 0.3 * self.rng.next());
            let wobble = 1.0 + 0.12 * (a * 2.0 + p1).sin() + 0.08 * (a * 5.0 + p2).sin();
            push(&mut self.particles, Particle {
                x: VIEW_W as f32 / 2.0 + a.cos() * r0,
                y: VIEW_H as f32 / 2.0 + a.sin() * r0,
                vx: a.cos() * v * wobble,
                vy: a.sin() * v * wobble,
                age: 0.0,
                life: self.rng.range(22.0, 40.0),
                kind: Kind::Debris,
                tint: (self.rng.next() * 3.0) as u8,
            });
        }
    }

    fn spawn_nebula(&mut self) {
        let r0 = (self.last_r_px * 0.4).min(14.0);
        for _ in 0..1700 {
            let a = self.rng.next() * core::f32::consts::TAU;
            let lobe = 1.0 + 0.45 * a.sin().abs().powi(6);
            let v = self.rng.range(3.5, 8.0) * lobe;
            push(&mut self.particles, Particle {
                x: VIEW_W as f32 / 2.0 + a.cos() * r0,
                y: VIEW_H as f32 / 2.0 + a.sin() * r0,
                vx: a.cos() * v,
                vy: a.sin() * v,
                age: 0.0,
                life: self.rng.range(26.0, 40.0),
                kind: Kind::Nebula,
                tint: if v < 5.5 { 1 } else { 0 },
            });
        }
    }

    fn spawn_jets(&mut self) {
        for _ in 0..500 {
            let up = if self.rng.next() < 0.5 { -1.0 } else { 1.0 };
            let spread = self.rng.range(-0.12, 0.12);
            let v = self.rng.range(60.0, 140.0);
            push(&mut self.particles, Particle {
                x: VIEW_W as f32 / 2.0,
                y: VIEW_H as f32 / 2.0,
                vx: spread * v,
                vy: up * v,
                age: 0.0,
                life: self.rng.range(2.0, 4.0),
                kind: Kind::Jet,
                tint: 0,
            });
        }
    }

    fn spawn_infall(&mut self, n: usize) {
        for _ in 0..n {
            let a = self.rng.next() * core::f32::consts::TAU;
            let d = self.rng.range(150.0, 200.0);
            let x = VIEW_W as f32 / 2.0 + a.cos() * d;
            let y = VIEW_H as f32 / 2.0 + a.sin() * d * 0.6;
            // mostly inward, with a twist so it spirals
            let v = self.rng.range(20.0, 40.0);
            push(&mut self.particles, Particle {
                x,
                y,
                vx: -a.cos() * v - a.sin() * v * 0.8,
                vy: -a.sin() * v * 0.6 + a.cos() * v * 0.5,
                age: 0.0,
                life: 14.0,
                kind: Kind::Infall,
                tint: 0,
            });
        }
    }

    fn make_disc(&mut self) {
        self.disc.clear();
        for _ in 0..1300 {
            let r = 1.6 + self.rng.next().powf(1.6) * 3.2;
            self.disc.push(DiscBit { r, phase: self.rng.next() * core::f32::consts::TAU, glow: self.rng.range(0.5, 1.0) });
        }
    }

    fn winds(&mut self, dt: f32) {
        let (rate, speed) = match self.star.stage {
            Stage::Agb => (90.0, 10.0),
            Stage::RedGiant => (14.0, 7.0),
            Stage::Supergiant => (45.0, 14.0),
            _ => return,
        };
        let n = (rate * dt + self.rng.next()) as usize;
        let r0 = self.last_r_px;
        for _ in 0..n {
            let a = self.rng.next() * core::f32::consts::TAU;
            let v = self.rng.range(0.5, 1.0) * speed;
            push(&mut self.particles, Particle {
                x: VIEW_W as f32 / 2.0 + a.cos() * r0,
                y: VIEW_H as f32 / 2.0 + a.sin() * r0,
                vx: a.cos() * v,
                vy: a.sin() * v,
                age: 0.0,
                life: self.rng.range(5.0, 9.0),
                kind: Kind::Wind,
                tint: 0,
            });
        }
    }

    fn move_particles(&mut self, dt: f32) {
        let (cx, cy) = (VIEW_W as f32 / 2.0, VIEW_H as f32 / 2.0);
        let swallow = match self.star.stage {
            Stage::BlackHole => shadow_px(self.star.mass),
            _ => self.last_r_px.max(2.0),
        };
        for p in self.particles.iter_mut() {
            p.age += dt;
            match p.kind {
                Kind::Debris => {
                    let k = (-dt * 0.35).exp();
                    p.vx *= k;
                    p.vy *= k;
                }
                Kind::Nebula => {
                    let k = (-dt * 0.1).exp();
                    p.vx *= k;
                    p.vy *= k;
                }
                Kind::Wind | Kind::Jet => {}
                Kind::Infall => {
                    let (dx, dy) = (cx - p.x, cy - p.y);
                    let r2 = (dx * dx + dy * dy).max(16.0);
                    let r = r2.sqrt();
                    let g = 9000.0 / r2;
                    p.vx += dx / r * g * dt;
                    p.vy += dy / r * g * dt;
                    let k = (-dt * 0.6).exp();
                    p.vx *= k;
                    p.vy *= k;
                    if r < swallow + 1.0 {
                        p.age = p.life;
                    }
                }
            }
            p.x += p.vx * dt;
            p.y += p.vy * dt;
        }
        self.particles.retain(|p| p.age < p.life && p.x > -60.0 && p.x < VIEW_W as f32 + 60.0 && p.y > -60.0 && p.y < VIEW_H as f32 + 60.0);
    }

    fn record(&mut self) {
        let s = &self.star;
        if matches!(s.stage, Stage::NeutronStar | Stage::BlackHole | Stage::Nothing) {
            return;
        }
        let (l, t, _) = s.observables();
        if l <= 0.0 || t <= 0.0 {
            return;
        }
        let pt = hr_xy(l, t);
        if let Some(&(x, y)) = self.track.last() {
            if (x - pt.0).abs() + (y - pt.1).abs() < 0.6 {
                return;
            }
        }
        if self.track.len() < 4096 {
            self.track.push(pt);
        }
    }

    // ---------- drawing ----------

    pub fn render(&mut self) {
        self.draw_view();
        self.draw_hr();
    }

    fn add(&mut self, x: i32, y: i32, c: [f32; 3], k: f32) {
        if x < 0 || y < 0 || x >= VIEW_W as i32 || y >= VIEW_H as i32 {
            return;
        }
        let px = &mut self.light[y as usize * VIEW_W + x as usize];
        px[0] += c[0] * k;
        px[1] += c[1] * k;
        px[2] += c[2] * k;
    }

    fn draw_view(&mut self) {
        let (cx, cy) = (VIEW_W as f32 / 2.0, VIEW_H as f32 / 2.0);
        let stage = self.star.stage;
        let (_, teff, r_sun) = self.star.observables();
        let t = self.time;

        // Background stars, bent by gravity around a black hole
        let lens = if stage == Stage::BlackHole { shadow_px(self.star.mass) * 1.7 } else { 0.0 };
        let e2 = lens * lens;
        for y in 0..VIEW_H {
            for x in 0..VIEW_W {
                let (mut sx, mut sy) = (x as f32, y as f32);
                if lens > 0.0 {
                    let (dx, dy) = (x as f32 + 0.5 - cx, y as f32 + 0.5 - cy);
                    let th = (dx * dx + dy * dy).sqrt().max(0.3);
                    let beta = th - e2 / th; // point-lens equation: β = θ − θE²/θ
                    sx = cx + dx * beta / th;
                    sy = cy + dy * beta / th;
                }
                let (ix, iy) = (sx.floor() as i32, sy.floor() as i32);
                let c = if ix >= 0 && iy >= 0 && (ix as usize) < VIEW_W && (iy as usize) < VIEW_H {
                    let s = self.sky[iy as usize * VIEW_W + ix as usize];
                    let tw = 0.82 + 0.18 * (t * (1.0 + hash(ix, iy, 3) * 3.0) + hash(ix, iy, 5) * 6.3).sin();
                    [s[0] * tw, s[1] * tw, s[2] * tw]
                } else {
                    [0.0; 3]
                };
                self.light[y * VIEW_W + x] = c;
            }
        }

        // The back half of a black hole's disc, behind the hole
        if stage == Stage::BlackHole {
            self.draw_disc(false);
        }

        // Particles
        for i in 0..self.particles.len() {
            let p = self.particles[i];
            let fade = 1.0 - p.age / p.life;
            let (c, k) = match p.kind {
                Kind::Debris => {
                    let temp = 1500.0 + 14000.0 * (-p.age / 1.8).exp();
                    let mut c = blackbody(temp as f64);
                    if p.tint == 1 {
                        c = [c[0], c[1] * 0.6, c[2] * 0.5];
                    } else if p.tint == 2 {
                        c = [c[0] * 0.5, c[1] * 0.8, c[2]];
                    }
                    (c, 0.32 * fade * fade + 0.45 * (-p.age * 1.5).exp())
                }
                Kind::Nebula => (if p.tint == 1 { [0.25, 0.95, 0.8] } else { [1.0, 0.28, 0.32] }, 0.42 * fade.powf(0.7)),
                Kind::Wind => ([0.9, 0.45, 0.2], 0.22 * fade),
                Kind::Infall => ([1.0, 0.75, 0.45], 0.55 * fade.max(0.3)),
                Kind::Jet => ([0.75, 0.85, 1.0], 0.45 * fade),
            };
            self.add(p.x as i32, p.y as i32, c, k);
        }

        // The star (or what's left of it)
        match stage {
            s if s.is_burning() || s == Stage::PlanetaryNebula || s == Stage::WhiteDwarf => {
                let mut r = radius_px(r_sun);
                if stage == Stage::Agb {
                    r *= 1.0 + 0.06 * (t * 1.7).sin(); // Mira-like pulsing
                }
                let rough = match stage {
                    Stage::RedGiant | Stage::Agb => 0.32,
                    Stage::Supergiant if teff < 6000.0 => 0.38,
                    Stage::Subgiant | Stage::HeliumBurning => 0.16,
                    _ => 0.08,
                };
                let c = vivid(blackbody(teff));
                self.last_r_px = r;
                self.last_color = c;
                self.draw_star(cx, cy, r, c, rough, 1.0);
            }
            Stage::Supernova | Stage::PairInstability => {
                let p = self.star.progress as f32;
                if !self.bang_done {
                    let flicker = 1.0 + 0.12 * (t * 9.0).sin();
                    let shrink = if stage == Stage::Supernova { 1.0 - (p / 0.08).min(1.0) * 0.15 } else { 1.0 };
                    let (r, c) = (self.last_r_px * shrink, self.last_color);
                    self.draw_star(cx, cy, r, c, 0.4, flicker);
                } else if stage == Stage::Supernova {
                    // the newborn remnant, faint in the middle of the debris
                    self.draw_star(cx, cy, 1.0, [0.8, 0.9, 1.0], 0.0, 0.7);
                }
            }
            Stage::TypeIa => {
                if !self.bang_done {
                    self.draw_star(cx, cy, 3.0, [0.9, 0.95, 1.0], 0.0, 1.4);
                }
            }
            Stage::DirectCollapse => {
                let p = self.star.progress as f32;
                let r = self.last_r_px * (1.0 - p).powf(1.5);
                let flicker = 1.0 - 0.25 * (0.5 + 0.5 * (t * 11.0).sin());
                self.draw_star(cx, cy, r.max(0.0), self.last_color, 0.4, (1.0 - p) * flicker);
            }
            Stage::NeutronStar => self.draw_pulsar(cx, cy),
            Stage::BlackHole => self.draw_black_hole(cx, cy),
            _ => {}
        }

        if stage == Stage::BlackHole {
            self.draw_disc(true);
        }

        // Write out: flash, then ordered dither down to a small palette for the pixel look
        let flash = self.flash;
        for y in 0..VIEW_H {
            for x in 0..VIEW_W {
                let i = y * VIEW_W + x;
                let mut c = self.light[i];
                if flash > 0.001 {
                    c = [c[0] + flash, c[1] + flash * 0.96, c[2] + flash * 0.88];
                }
                let d = BAYER[(y & 3) * 4 + (x & 3)] / 16.0 - 0.5;
                let o = i * 4;
                for ch in 0..3 {
                    let v = c[ch].max(0.0);
                    let v = v / (1.0 + v * 0.15); // soft highlights
                    let q = ((v * 7.0 + d).round() / 7.0).clamp(0.0, 1.0);
                    self.view[o + ch] = (q * 255.0) as u8;
                }
                self.view[o + 3] = 255;
            }
        }
    }

    fn draw_star(&mut self, cx: f32, cy: f32, r: f32, c: [f32; 3], rough: f32, bright: f32) {
        let glow_r = r * 1.7 + 3.0;
        let (x0, x1) = ((cx - glow_r).floor() as i32, (cx + glow_r).ceil() as i32);
        let (y0, y1) = ((cy - glow_r).floor() as i32, (cy + glow_r).ceil() as i32);
        let cell = (r / 4.5).max(1.5);
        let tq = (self.time * 1.5).floor() as i32;
        for y in y0..=y1 {
            for x in x0..=x1 {
                if x < 0 || y < 0 || x >= VIEW_W as i32 || y >= VIEW_H as i32 {
                    continue;
                }
                let (dx, dy) = (x as f32 + 0.5 - cx, y as f32 + 0.5 - cy);
                let d = (dx * dx + dy * dy).sqrt();
                let i = y as usize * VIEW_W + x as usize;
                if d <= r.max(0.7) {
                    let mu = (1.0 - (d / r.max(0.7)).powi(2)).max(0.0).sqrt();
                    let limb = 0.45 + 0.55 * mu;
                    let g = vnoise(x as f32 / cell, y as f32 / cell, tq) - 0.5;
                    let k = bright * limb * (1.0 + rough * 2.0 * g) * 1.05;
                    self.light[i] = [c[0] * k, c[1] * k, c[2] * k];
                } else if d < glow_r {
                    let f = 1.0 - (d - r) / (glow_r - r);
                    let k = bright * 0.35 * f * f;
                    let px = &mut self.light[i];
                    px[0] += c[0] * k;
                    px[1] += c[1] * k;
                    px[2] += c[2] * k;
                }
            }
        }
    }

    fn draw_pulsar(&mut self, cx: f32, cy: f32) {
        let a = self.time * 2.6;
        let c = [0.7, 0.85, 1.0];
        // Two beams sweeping round like a lighthouse, tilted from the spin axis
        for side in [0.0f32, core::f32::consts::PI] {
            let ang = a + side;
            let (dx, dy) = (ang.cos(), ang.sin() * 0.45 - 0.3 * if side == 0.0 { 1.0 } else { -1.0 });
            let n = (dx * dx + dy * dy).sqrt();
            let (dx, dy) = (dx / n, dy / n);
            let mut s = 3.0;
            while s < 85.0 {
                let w = 0.6 + s * 0.05;
                let k = 0.5 * (1.0 - s / 85.0);
                let mut o = -w;
                while o <= w {
                    let x = cx + dx * s - dy * o;
                    let y = cy + dy * s + dx * o;
                    self.add(x as i32, y as i32, c, k * (1.0 - (o / w).abs()) * 0.5);
                    o += 0.7;
                }
                s += 0.7;
            }
        }
        let pulse = if a.cos().abs() > 0.96 { 1.8 } else { 1.0 };
        self.draw_star(cx, cy, 1.6, [0.85, 0.92, 1.0], 0.0, pulse);
    }

    fn draw_black_hole(&mut self, cx: f32, cy: f32) {
        let sh = shadow_px(self.star.mass);
        let (x0, x1) = ((cx - sh - 3.0) as i32, (cx + sh + 3.0) as i32);
        let (y0, y1) = ((cy - sh - 3.0) as i32, (cy + sh + 3.0) as i32);
        for y in y0..=y1 {
            for x in x0..=x1 {
                if x < 0 || y < 0 || x >= VIEW_W as i32 || y >= VIEW_H as i32 {
                    continue;
                }
                let (dx, dy) = (x as f32 + 0.5 - cx, y as f32 + 0.5 - cy);
                let d = (dx * dx + dy * dy).sqrt();
                let i = y as usize * VIEW_W + x as usize;
                if d < sh {
                    self.light[i] = [0.0; 3];
                } else if d < sh + 1.6 {
                    // photon ring: light orbiting just outside the shadow
                    let k = 0.9 * (1.0 - (d - sh) / 1.6) * (0.8 + 0.4 * (dx / d).max(0.0));
                    let px = &mut self.light[i];
                    px[0] += 1.0 * k;
                    px[1] += 0.7 * k;
                    px[2] += 0.4 * k;
                }
            }
        }
    }

    fn draw_disc(&mut self, front: bool) {
        if self.disc.is_empty() {
            return;
        }
        let (cx, cy) = (VIEW_W as f32 / 2.0, VIEW_H as f32 / 2.0);
        let sh = shadow_px(self.star.mass);
        let t = self.time;
        for i in 0..self.disc.len() {
            let b = &self.disc[i];
            let (r, glow) = (b.r, b.glow);
            let phi = b.phase + t * 2.4 * r.powf(-1.5); // Kepler: inner gas orbits faster
            let (c_, s_) = (phi.cos(), phi.sin());
            let in_front = s_ > 0.0;
            if in_front != front {
                continue;
            }
            let heat = vivid(blackbody((9_000.0 * (r / 1.6).powf(-0.75)) as f64));
            let doppler = 1.0 + 0.7 * c_; // the side coming towards us is brighter
            let k = 0.55 * glow * doppler;
            let x = cx + r * sh * c_;
            let y = cy + r * sh * 0.26 * s_;
            self.add(x as i32, y as i32, heat, k);
            if !front {
                // light from the far side of the disc bent up over the top of the hole
                let lx = cx + r * sh * c_ * 0.8;
                let ly = cy - sh * (1.05 + 0.22 * (r - 1.6)) * (0.6 + 0.4 * (-s_));
                self.add(lx as i32, ly as i32, heat, k * 0.55);
            }
        }
    }

    fn draw_hr(&mut self) {
        let ink = self.ink;
        self.hr.iter_mut().for_each(|b| *b = 0);
        let dot = |hr: &mut Vec<u8>, x: i32, y: i32, c: [u8; 3], a: u8| {
            if x < 0 || y < 0 || x >= HR_W as i32 || y >= HR_H as i32 {
                return;
            }
            let o = (y as usize * HR_W + x as usize) * 4;
            if hr[o + 3] >= a {
                return;
            }
            hr[o] = c[0];
            hr[o + 1] = c[1];
            hr[o + 2] = c[2];
            hr[o + 3] = a;
        };
        // dotted grid: every 2 in log L, and 10,000 K / 3,000 K etc.
        let mut ll = -4.0;
        while ll <= 6.0 {
            let (_, y) = hr_xy(10f64.powf(ll), 10_000.0);
            for x in (0..HR_W as i32).step_by(3) {
                dot(&mut self.hr, x, y as i32, ink, 50);
            }
            ll += 2.0;
        }
        for lt in [5.0f64, 4.5, 4.0, 3.5] {
            let (x, _) = hr_xy(1.0, 10f64.powf(lt));
            for y in (0..HR_H as i32).step_by(3) {
                dot(&mut self.hr, x as i32, y, ink, 50);
            }
        }
        for w in self.zams_line.windows(2) {
            line(w[0], w[1], |x, y| dot(&mut self.hr, x, y, ink, 110));
        }
        for w in self.track.windows(2) {
            line(w[0], w[1], |x, y| dot(&mut self.hr, x, y, ink, 255));
        }
        // Where the star is now
        let s = &self.star;
        let (l, t, _) = s.observables();
        if l > 0.0 && t > 0.0 && !matches!(s.stage, Stage::NeutronStar | Stage::BlackHole | Stage::Nothing) {
            let (x, y) = hr_xy(l, t);
            let c = blackbody(t);
            let c = [(c[0] * 255.0) as u8, (c[1] * 255.0) as u8, (c[2] * 255.0) as u8];
            for dy in -3..=3i32 {
                for dx in -3..=3i32 {
                    let edge = dx.abs() == 3 || dy.abs() == 3;
                    if dx.abs() == 3 && dy.abs() == 3 {
                        continue;
                    }
                    let px = (x as i32 + dx, y as i32 + dy);
                    let o = px.1 as usize * HR_W + px.0 as usize;
                    if px.0 < 0 || px.1 < 0 || px.0 >= HR_W as i32 || px.1 >= HR_H as i32 {
                        continue;
                    }
                    let o = o * 4;
                    let col = if edge { ink } else { c };
                    self.hr[o..o + 4].copy_from_slice(&[col[0], col[1], col[2], 255]);
                }
            }
        }
    }
}

/// Position on the HR diagram canvas (pixels), clamped to its edges.
pub fn hr_xy(l: f64, t: f64) -> (f32, f32) {
    let x = (HR_LOG_T_HOT - t.max(1.0).log10()) / (HR_LOG_T_HOT - HR_LOG_T_COOL) * (HR_W as f64 - 1.0);
    let y = (HR_LOG_L_TOP - l.max(1e-12).log10()) / (HR_LOG_L_TOP - HR_LOG_L_BOTTOM) * (HR_H as f64 - 1.0);
    (x.clamp(0.0, HR_W as f64 - 1.0) as f32, y.clamp(0.0, HR_H as f64 - 1.0) as f32)
}

fn line(a: (f32, f32), b: (f32, f32), mut plot: impl FnMut(i32, i32)) {
    let n = ((b.0 - a.0).abs().max((b.1 - a.1).abs()).ceil() as i32).max(1);
    for i in 0..=n {
        let s = i as f32 / n as f32;
        plot((a.0 + (b.0 - a.0) * s).round() as i32, (a.1 + (b.1 - a.1) * s).round() as i32);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_are_ordered_on_screen() {
        assert!(radius_px(1.5e-5) <= 2.0); // neutron star
        assert!(radius_px(0.013) < radius_px(0.2)); // white dwarf < red dwarf
        assert!(radius_px(1.0) < radius_px(150.0));
        assert!(radius_px(1000.0) <= 86.0); // a red supergiant still fits
    }

    #[test]
    fn colours_run_red_to_blue() {
        let red = blackbody(3000.0);
        let blue = blackbody(30000.0);
        assert!(red[0] > red[2] && blue[2] > blue[0]);
    }

    #[test]
    fn a_whole_life_renders() {
        for m in [1.0, 15.0, 30.0, 80.0, 200.0] {
            let mut lab = Lab::new(m, 42);
            let mut events = vec![];
            for _ in 0..1200 {
                lab.step(1.0 / 30.0, 4.0);
                lab.render();
                loop {
                    let e = lab.next_event();
                    if e == 0 {
                        break;
                    }
                    events.push(e);
                }
            }
            assert!(lab.star.stage.is_final(), "m={m}: {:?}", lab.star.stage);
            assert!(!events.is_empty());
            assert!(lab.view.chunks(4).any(|p| p[0] > 0), "m={m}: something was drawn");
        }
    }

    #[test]
    fn hr_diagram_marks_the_star() {
        let mut lab = Lab::new(1.0, 1);
        lab.render();
        assert!(lab.hr.chunks(4).filter(|p| p[3] == 255).count() > 20);
        let (x, y) = hr_xy(1.0, 5772.0);
        assert!(x > 100.0 && x < 135.0 && y > 90.0 && y < 120.0, "sun at {x},{y}");
    }
}
