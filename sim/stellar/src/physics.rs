//! How a star's life depends on its mass — a deliberately simple model.
//!
//! Everything here comes from textbook scaling relations (mass–luminosity,
//! main-sequence lifetime, the initial–final mass relation for white dwarfs,
//! the Chandrasekhar and Tolman–Oppenheimer–Volkoff limits). The numbers are
//! approximate — real boundaries depend on composition, rotation and binaries —
//! but the shape of the story is right. Units: solar masses (M☉), solar
//! luminosities (L☉), solar radii (R☉), kelvin and years.

pub const M_CHANDRASEKHAR: f64 = 1.44; // heaviest a white dwarf can be
pub const M_TOV: f64 = 2.2; // heaviest a neutron star can be (roughly)
pub const M_NS_MIN: f64 = 1.1; // lightest neutron star a supernova makes
pub const LOW_MASS: f64 = 0.5; // below this, a star never burns helium
pub const MASSIVE: f64 = 8.0; // from here up, the core collapses
pub const DIRECT_COLLAPSE: f64 = 40.0; // from here, no bright supernova: the star just vanishes
pub const PAIR_INSTABILITY: f64 = 130.0; // from here, the star blows itself apart completely
pub const MIN_MASS: f64 = 0.08; // lighter "stars" never ignite: brown dwarfs
pub const MAX_MASS: f64 = 300.0;
pub const T_SUN: f64 = 5772.0;
pub const R_SUN_KM: f64 = 695_700.0;
/// Schwarzschild radius of one solar mass, in km (2GM☉/c²).
pub const RS_SUN_KM: f64 = 2.953;
const NS_RADIUS_KM: f64 = 12.0;

#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stage {
    MainSequence = 0,
    Subgiant = 1,
    RedGiant = 2,
    HeliumBurning = 3,
    Agb = 4,
    PlanetaryNebula = 5,
    WhiteDwarf = 6,
    Supergiant = 7,
    Supernova = 8,
    NeutronStar = 9,
    BlackHole = 10,
    TypeIa = 11,
    DirectCollapse = 12,
    PairInstability = 13,
    Nothing = 14,
}

impl Stage {
    /// Still fusing: changing the mass changes how it lives.
    pub fn is_burning(self) -> bool {
        use Stage::*;
        matches!(self, MainSequence | Subgiant | RedGiant | HeliumBurning | Agb | Supergiant)
    }
    /// A dead remnant (or nothing) that stays put until something changes it.
    pub fn is_final(self) -> bool {
        use Stage::*;
        matches!(self, WhiteDwarf | NeutronStar | BlackHole | Nothing)
    }
    pub fn is_explosion(self) -> bool {
        use Stage::*;
        matches!(self, Supernova | TypeIa | DirectCollapse | PairInstability)
    }
}

/// What a newly born star of a given mass will end up as.
#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fate {
    WhiteDwarf = 0,
    NeutronStar = 1,
    BlackHole = 2,
    DirectCollapseBlackHole = 3,
    NoRemnant = 4,
}

pub fn fate(m: f64) -> Fate {
    if m < MASSIVE {
        Fate::WhiteDwarf
    } else if m < 20.0 {
        Fate::NeutronStar
    } else if m < DIRECT_COLLAPSE {
        Fate::BlackHole
    } else if m < PAIR_INSTABILITY {
        Fate::DirectCollapseBlackHole
    } else {
        Fate::NoRemnant
    }
}

/// Things that happen, for the page to announce. Kept as plain numbers for the C ABI.
pub mod event {
    pub const LEFT_MAIN_SEQUENCE: u32 = 1;
    pub const RED_GIANT: u32 = 2;
    pub const HELIUM_FLASH: u32 = 3;
    pub const HELIUM_IGNITION: u32 = 4;
    pub const AGB: u32 = 5;
    pub const PLANETARY_NEBULA: u32 = 6;
    pub const WHITE_DWARF: u32 = 7;
    pub const SUPERGIANT: u32 = 8;
    pub const SUPERNOVA: u32 = 9;
    pub const NEUTRON_STAR: u32 = 10;
    pub const BLACK_HOLE: u32 = 11;
    pub const TYPE_IA: u32 = 12;
    pub const DIRECT_COLLAPSE: u32 = 13;
    pub const PAIR_INSTABILITY: u32 = 14;
    pub const NEUTRON_STAR_COLLAPSE: u32 = 15;
    pub const HELIUM_WHITE_DWARF: u32 = 16;
    pub const ACCRETION: u32 = 17;
}

// ---------- scaling relations ----------

/// Main-sequence luminosity (L☉) — the piecewise mass–luminosity relation.
pub fn l_ms(m: f64) -> f64 {
    if m < 0.43 {
        0.23 * m.powf(2.3)
    } else if m < 2.0 {
        m.powi(4)
    } else if m < 55.0 {
        1.4 * m.powf(3.5)
    } else {
        32_000.0 * m
    }
}

/// Zero-age main-sequence radius (R☉).
pub fn r_zams(m: f64) -> f64 {
    if m < 1.0 {
        0.9 * m.powf(0.9)
    } else {
        0.9 * m.powf(0.6)
    }
}

/// Main-sequence lifetime in years: t ≈ 10 Gyr × M^-2.5, with a floor of a few Myr for the giants.
pub fn ms_lifetime(m: f64) -> f64 {
    1.0e10 * m.powf(-2.5) + 2.5e6
}

/// Stefan–Boltzmann: L = R² (T/T☉)⁴ in solar units.
pub fn teff_of(l: f64, r: f64) -> f64 {
    T_SUN * (l / (r * r)).powf(0.25)
}
pub fn radius_of(l: f64, t: f64) -> f64 {
    l.sqrt() * (T_SUN / t).powi(2)
}

/// Initial–final mass relation: how heavy a white dwarf a star leaves.
pub fn white_dwarf_mass(m: f64) -> f64 {
    if m < LOW_MASS {
        m.clamp(MIN_MASS, LOW_MASS) // a helium white dwarf: the whole star, nothing shed
    } else {
        (0.109 * m + 0.394).clamp(0.5, 1.38)
    }
}

/// White dwarfs shrink as they get heavier, down to nothing at the Chandrasekhar limit.
pub fn white_dwarf_radius(m: f64) -> f64 {
    let x = (m / M_CHANDRASEKHAR).min(0.999).powf(4.0 / 3.0);
    (0.0126 * m.powf(-1.0 / 3.0) * (1.0 - x).sqrt()).max(0.0015)
}

/// Mestel cooling: a white dwarf fades as L ∝ t^-1.4.
pub fn white_dwarf_luminosity(m: f64, cooling_years: f64) -> f64 {
    (30.0 * (m / 0.6) * (cooling_years.max(1.0e4) / 1.0e6).powf(-1.4)).min(1000.0)
}

/// What a core-collapse supernova leaves behind (M☉).
pub fn supernova_remnant_mass(m: f64) -> f64 {
    if m < 20.0 {
        1.2 + 0.025 * (m - MASSIVE).max(0.0)
    } else {
        3.0 + 0.35 * (m - 20.0) // fallback onto the core makes a black hole
    }
}

/// Black hole left when a very massive star collapses without exploding (after its winds).
pub fn direct_collapse_mass(m: f64) -> f64 {
    (0.45 * m).min(10.0 + 0.2 * m)
}

pub fn schwarzschild_km(m: f64) -> f64 {
    RS_SUN_KM * m
}

// ---------- the star ----------

#[derive(Clone, Copy, Debug)]
struct Pt {
    l: f64,
    t: f64,
}

fn lerp(a: f64, b: f64, s: f64) -> f64 {
    a + (b - a) * s
}
fn smooth(s: f64) -> f64 {
    let s = s.clamp(0.0, 1.0);
    s * s * (3.0 - 2.0 * s)
}
fn lerp_log(a: Pt, b: Pt, s: f64) -> Pt {
    Pt {
        l: 10f64.powf(lerp(a.l.log10(), b.l.log10(), s)),
        t: 10f64.powf(lerp(a.t.log10(), b.t.log10(), s)),
    }
}

/// Key points on the HR diagram for a star of mass `m`.
struct Track {
    zams: Pt,
    tams: Pt,
    base_rgb: Pt,
    tip_rgb: Pt,
    he_start: Pt,
    he_end: Pt,
    agb_tip: Pt,
    rsg: Pt,
}

fn track(m: f64) -> Track {
    let lz = 0.72 * l_ms(m);
    let zams = Pt { l: lz, t: teff_of(lz, r_zams(m)) };
    let tams = Pt { l: lz * 1.8, t: zams.t * if m > 1.2 { 0.8 } else { 0.95 } };
    let low = m < 2.0;
    let base_rgb = Pt { l: tams.l * if low { 1.2 } else { 1.1 }, t: if low { 4800.0 } else { 4300.0 } };
    let tip_rgb = Pt { l: if low { 2500.0 } else { (tams.l * 4.0).max(300.0) }, t: if low { 3300.0 } else { 3900.0 } };
    let he_start = Pt { l: if low { 50.0 } else { tams.l * 2.0 }, t: if low { 4700.0 } else { 5500.0 } };
    let he_end = Pt { l: he_start.l * 1.5, t: he_start.t * 0.9 };
    let agb_tip = Pt { l: if low { 6000.0 } else { (tams.l * 20.0).min(60_000.0) }, t: 3000.0 };
    // Above ~40 M☉ winds strip the envelope: a hot Wolf–Rayet star instead of a red supergiant
    let rsg = if m < DIRECT_COLLAPSE { Pt { l: tams.l * 1.3, t: 3600.0 } } else { Pt { l: tams.l * 1.2, t: 45_000.0 } };
    Track { zams, tams, base_rgb, tip_rgb, he_start, he_end, agb_tip, rsg }
}

/// How long each stage takes on screen at 1× speed, in seconds.
pub fn playback_seconds(stage: Stage) -> f64 {
    use Stage::*;
    match stage {
        MainSequence => 14.0,
        Subgiant => 3.0,
        RedGiant => 6.0,
        HeliumBurning => 4.0,
        Agb => 4.0,
        PlanetaryNebula => 8.0,
        WhiteDwarf => 12.0,
        Supergiant => 9.0,
        Supernova => 8.0,
        TypeIa => 7.0,
        DirectCollapse => 6.0,
        PairInstability => 8.0,
        NeutronStar | BlackHole | Nothing => 10.0,
    }
}

const WD_MAX_PROGRESS: f64 = 1.4; // 1.0 ≈ 10 Gyr of cooling; past that it's older than the universe

pub struct Star {
    pub mass: f64,
    pub initial_mass: f64,
    pub stage: Stage,
    /// 0 → 1 through the current stage (white dwarfs and other remnants keep going past 1).
    pub progress: f64,
    pub age: f64,
    /// Luminosity at the top of the AGB, so the planetary nebula's star starts there.
    pn_start_l: f64,
    /// Mass of the star that exploded or collapsed (the remnant's mass is in `mass`).
    pub progenitor_mass: f64,
    events: Vec<u32>,
}

impl Star {
    pub fn new(m: f64) -> Star {
        let m = m.clamp(MIN_MASS, MAX_MASS);
        Star { mass: m, initial_mass: m, stage: Stage::MainSequence, progress: 0.0, age: 0.0, pn_start_l: 0.0, progenitor_mass: m, events: Vec::new() }
    }

    pub fn take_events(&mut self) -> Vec<u32> {
        core::mem::take(&mut self.events)
    }

    /// Years the current stage lasts (infinite for remnants).
    pub fn stage_years(&self) -> f64 {
        use Stage::*;
        let t = ms_lifetime(self.mass);
        match self.stage {
            MainSequence => t,
            Subgiant => 0.08 * t,
            RedGiant => 0.1 * t,
            HeliumBurning => 0.012 * t,
            Agb => 0.002 * t,
            PlanetaryNebula => 3.0e4,
            Supergiant => 0.1 * t,
            Supernova | TypeIa | DirectCollapse | PairInstability => 1.0,
            WhiteDwarf | NeutronStar | BlackHole | Nothing => f64::INFINITY,
        }
    }

    /// Years since the start of the current stage at a given progress.
    fn years_at(&self, p: f64) -> f64 {
        match self.stage {
            Stage::WhiteDwarf => cooling_years(p),
            s if s.is_final() => p * 1.0e7, // ten million years per playback cycle
            _ => p * self.stage_years(),
        }
    }

    pub fn cooling_years(&self) -> f64 {
        if self.stage == Stage::WhiteDwarf {
            cooling_years(self.progress)
        } else {
            0.0
        }
    }

    /// Run the clock for `seconds` of screen time.
    pub fn advance(&mut self, mut seconds: f64) {
        let mut guard = 0;
        while seconds > 0.0 && guard < 32 {
            guard += 1;
            let per = playback_seconds(self.stage);
            if self.stage.is_final() {
                let p = (self.progress + seconds / per).min(if self.stage == Stage::WhiteDwarf { WD_MAX_PROGRESS } else { 1.0e6 });
                self.age += self.years_at(p) - self.years_at(self.progress);
                self.progress = p;
                return;
            }
            let left = (1.0 - self.progress) * per;
            if seconds < left {
                let p = self.progress + seconds / per;
                self.age += self.years_at(p) - self.years_at(self.progress);
                self.progress = p;
                return;
            }
            self.age += self.years_at(1.0) - self.years_at(self.progress);
            seconds -= left;
            self.next_stage();
        }
    }

    /// Jump to the start of the next stage.
    pub fn skip(&mut self) {
        if self.stage.is_final() {
            return;
        }
        self.age += self.years_at(1.0) - self.years_at(self.progress);
        self.next_stage();
    }

    fn enter(&mut self, stage: Stage, ev: u32) {
        self.stage = stage;
        self.progress = 0.0;
        self.events.push(ev);
    }

    fn next_stage(&mut self) {
        use Stage::*;
        match self.stage {
            MainSequence => {
                if self.mass < LOW_MASS {
                    self.progenitor_mass = self.mass;
                    self.mass = white_dwarf_mass(self.mass);
                    self.enter(WhiteDwarf, event::HELIUM_WHITE_DWARF);
                } else if self.mass < MASSIVE {
                    self.enter(Subgiant, event::LEFT_MAIN_SEQUENCE);
                } else {
                    self.enter(Supergiant, event::SUPERGIANT);
                }
            }
            Subgiant => self.enter(RedGiant, event::RED_GIANT),
            RedGiant => {
                let ev = if self.mass < 2.0 { event::HELIUM_FLASH } else { event::HELIUM_IGNITION };
                self.enter(HeliumBurning, ev)
            }
            HeliumBurning => self.enter(Agb, event::AGB),
            Agb => {
                self.pn_start_l = track(self.mass).agb_tip.l;
                self.progenitor_mass = self.mass;
                self.mass = white_dwarf_mass(self.mass); // the envelope drifts off; the core is what's left
                self.enter(PlanetaryNebula, event::PLANETARY_NEBULA)
            }
            PlanetaryNebula => self.enter(WhiteDwarf, event::WHITE_DWARF),
            Supergiant => {
                self.progenitor_mass = self.mass;
                match fate(self.mass) {
                    Fate::NeutronStar | Fate::BlackHole => self.enter(Supernova, event::SUPERNOVA),
                    Fate::DirectCollapseBlackHole => self.enter(DirectCollapse, event::DIRECT_COLLAPSE),
                    Fate::NoRemnant => self.enter(PairInstability, event::PAIR_INSTABILITY),
                    Fate::WhiteDwarf => self.enter(Agb, event::AGB),
                }
            }
            Supernova => {
                let r = supernova_remnant_mass(self.progenitor_mass);
                self.mass = r;
                if r > M_TOV {
                    self.enter(BlackHole, event::BLACK_HOLE)
                } else {
                    self.enter(NeutronStar, event::NEUTRON_STAR)
                }
            }
            DirectCollapse => {
                self.mass = direct_collapse_mass(self.progenitor_mass);
                self.enter(BlackHole, event::BLACK_HOLE)
            }
            TypeIa | PairInstability => {
                self.mass = 0.0;
                self.enter(Nothing, 0);
                self.events.pop();
            }
            WhiteDwarf | NeutronStar | BlackHole | Nothing => {}
        }
    }

    /// Change the mass of whatever the star is now. Returns the mass actually used:
    /// some things can't happen (a black hole can't shrink; an explosion can't be edited).
    pub fn set_mass(&mut self, m: f64) -> f64 {
        use Stage::*;
        let m = m.clamp(MIN_MASS, MAX_MASS);
        match self.stage {
            s if s.is_burning() => {
                self.mass = m;
                match self.stage {
                    Subgiant | RedGiant | HeliumBurning | Agb if m >= MASSIVE => self.enter(Supergiant, event::SUPERGIANT),
                    Supergiant if m < MASSIVE => self.enter(HeliumBurning, event::HELIUM_IGNITION),
                    _ => {}
                }
            }
            WhiteDwarf => {
                if m > self.mass {
                    self.events.push(event::ACCRETION);
                }
                self.mass = m;
                if m > M_CHANDRASEKHAR {
                    self.progenitor_mass = m;
                    self.enter(TypeIa, event::TYPE_IA);
                }
            }
            NeutronStar => {
                let m = m.max(M_NS_MIN);
                if m > self.mass {
                    self.events.push(event::ACCRETION);
                }
                self.mass = m;
                if m > M_TOV {
                    self.enter(BlackHole, event::NEUTRON_STAR_COLLAPSE);
                }
            }
            BlackHole => {
                if m > self.mass {
                    self.events.push(event::ACCRETION);
                    self.mass = m;
                }
            }
            _ => {}
        }
        self.mass
    }

    /// (luminosity L☉, effective temperature K, radius R☉) right now.
    pub fn observables(&self) -> (f64, f64, f64) {
        use Stage::*;
        let p = self.progress.clamp(0.0, 1.0);
        let tr = track(self.mass);
        let pt = match self.stage {
            MainSequence => lerp_log(tr.zams, tr.tams, p),
            Subgiant => lerp_log(tr.tams, tr.base_rgb, smooth(p)),
            RedGiant => lerp_log(tr.base_rgb, tr.tip_rgb, p * p),
            HeliumBurning => lerp_log(tr.he_start, tr.he_end, p),
            Agb => lerp_log(tr.he_end, tr.agb_tip, p * p),
            Supergiant => {
                if p < 0.15 {
                    lerp_log(tr.tams, tr.rsg, smooth(p / 0.15))
                } else {
                    lerp_log(tr.rsg, Pt { l: tr.rsg.l * 1.4, t: tr.rsg.t }, (p - 0.15) / 0.85)
                }
            }
            PlanetaryNebula => {
                let start = Pt { l: self.pn_start_l.max(1.0), t: 3500.0 };
                let hot = Pt { l: start.l, t: 110_000.0 };
                let wd_l = white_dwarf_luminosity(self.mass, cooling_years(0.0));
                let end = Pt { l: wd_l, t: teff_of(wd_l, white_dwarf_radius(self.mass)) };
                if p < 0.35 {
                    lerp_log(start, hot, smooth(p / 0.35))
                } else {
                    lerp_log(hot, end, smooth((p - 0.35) / 0.65))
                }
            }
            WhiteDwarf => {
                let r = white_dwarf_radius(self.mass);
                let l = white_dwarf_luminosity(self.mass, cooling_years(self.progress));
                return (l, teff_of(l, r), r);
            }
            NeutronStar => {
                let r = NS_RADIUS_KM / R_SUN_KM;
                let t = 1.0e6 * (1.0 + self.progress).powf(-0.3);
                return (r * r * (t / T_SUN).powi(4), t, r);
            }
            BlackHole => return (0.0, 0.0, schwarzschild_km(self.mass) / R_SUN_KM),
            Nothing => return (0.0, 0.0, 0.0),
            Supernova => {
                let pre = track(self.progenitor_mass).rsg;
                let pre = Pt { l: pre.l * 1.4, t: pre.t };
                if p < 0.08 {
                    pre
                } else {
                    let q = (p - 0.08) / 0.92;
                    Pt { l: 1.0e9 * 10f64.powf(-2.2 * q), t: lerp(12_000.0, 5_000.0, q) }
                }
            }
            TypeIa => {
                if p < 0.02 {
                    Pt { l: 1.0, t: 30_000.0 }
                } else {
                    let q = (p - 0.02) / 0.98;
                    Pt { l: 5.0e9 * 10f64.powf(-2.5 * q), t: lerp(15_000.0, 5_000.0, q) }
                }
            }
            DirectCollapse => {
                let pre = track(self.progenitor_mass).rsg;
                Pt { l: (pre.l * (1.0 - p).powi(3)).max(1.0e-3), t: pre.t }
            }
            PairInstability => {
                let pre = track(self.progenitor_mass).rsg;
                if p < 0.05 {
                    pre
                } else {
                    let q = (p - 0.05) / 0.95;
                    Pt { l: 3.0e10 * 10f64.powf(-2.0 * q), t: lerp(14_000.0, 6_000.0, q) }
                }
            }
        };
        (pt.l, pt.t, radius_of(pt.l, pt.t))
    }
}

fn cooling_years(p: f64) -> f64 {
    1.0e5 * 10f64.powf(5.0 * p) // 100,000 years → 10 billion years across one playback
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run_to_end(m: f64) -> (Star, Vec<Stage>, Vec<u32>) {
        let mut s = Star::new(m);
        let mut stages = vec![s.stage];
        let mut events = vec![];
        for _ in 0..40 {
            if s.stage.is_final() {
                break;
            }
            s.skip();
            stages.push(s.stage);
            events.extend(s.take_events());
        }
        (s, stages, events)
    }

    #[test]
    fn the_sun_lives_about_ten_billion_years() {
        let t = ms_lifetime(1.0);
        assert!((9.0e9..1.1e10).contains(&t), "{t}");
        assert!(ms_lifetime(15.0) < 2.0e7);
        assert!(ms_lifetime(0.2) > 1.0e11);
    }

    #[test]
    fn the_sun_looks_like_the_sun_halfway_through() {
        let mut s = Star::new(1.0);
        s.advance(playback_seconds(Stage::MainSequence) * 0.5);
        let (l, t, r) = s.observables();
        assert!((0.8..1.2).contains(&l), "L {l}");
        assert!((5300.0..6100.0).contains(&t), "T {t}");
        assert!((0.8..1.2).contains(&r), "R {r}");
        assert!((4.0e9..6.0e9).contains(&s.age), "age {}", s.age);
    }

    #[test]
    fn a_sun_like_star_ends_as_a_white_dwarf() {
        let (s, stages, events) = run_to_end(1.0);
        use Stage::*;
        assert_eq!(stages, vec![MainSequence, Subgiant, RedGiant, HeliumBurning, Agb, PlanetaryNebula, WhiteDwarf]);
        assert!(events.contains(&event::HELIUM_FLASH));
        assert!((0.5..0.6).contains(&s.mass), "{}", s.mass);
        let (_, _, r) = s.observables();
        assert!((0.008..0.02).contains(&r), "earth-sized: {r}");
    }

    #[test]
    fn red_giants_are_big_and_cool() {
        let mut s = Star::new(1.0);
        s.skip();
        s.skip();
        s.advance(playback_seconds(Stage::RedGiant) * 0.99);
        let (l, t, r) = s.observables();
        assert!(l > 1000.0 && t < 3500.0 && r > 100.0, "{l} {t} {r}");
    }

    #[test]
    fn red_dwarfs_skip_the_giant_phase() {
        let (s, stages, events) = run_to_end(0.3);
        assert_eq!(stages, vec![Stage::MainSequence, Stage::WhiteDwarf]);
        assert_eq!(events, vec![event::HELIUM_WHITE_DWARF]);
        assert!((s.mass - 0.3).abs() < 1e-9);
    }

    #[test]
    fn fates_follow_mass() {
        let (s, stages, _) = run_to_end(15.0);
        assert!(stages.contains(&Stage::Supernova));
        assert_eq!(s.stage, Stage::NeutronStar);
        assert!(s.mass > M_NS_MIN && s.mass < M_TOV);

        let (s, stages, _) = run_to_end(30.0);
        assert!(stages.contains(&Stage::Supernova));
        assert_eq!(s.stage, Stage::BlackHole);
        assert!(s.mass > M_TOV);

        let (s, stages, _) = run_to_end(80.0);
        assert!(stages.contains(&Stage::DirectCollapse) && !stages.contains(&Stage::Supernova));
        assert_eq!(s.stage, Stage::BlackHole);

        let (s, stages, _) = run_to_end(200.0);
        assert!(stages.contains(&Stage::PairInstability));
        assert_eq!(s.stage, Stage::Nothing);
        assert_eq!(s.mass, 0.0);

        assert_eq!(fate(1.0), Fate::WhiteDwarf);
        assert_eq!(fate(10.0), Fate::NeutronStar);
        assert_eq!(fate(25.0), Fate::BlackHole);
        assert_eq!(fate(60.0), Fate::DirectCollapseBlackHole);
        assert_eq!(fate(150.0), Fate::NoRemnant);
    }

    #[test]
    fn feeding_a_white_dwarf_past_chandrasekhar_blows_it_up() {
        let (mut s, _, _) = run_to_end(1.0);
        assert_eq!(s.set_mass(1.2), 1.2);
        assert_eq!(s.stage, Stage::WhiteDwarf);
        let (_, _, r_heavy) = s.observables();
        s.set_mass(0.6);
        let (_, _, r_light) = s.observables();
        assert!(r_heavy < r_light, "heavier white dwarfs are smaller");
        s.set_mass(1.5);
        assert_eq!(s.stage, Stage::TypeIa);
        assert!(s.take_events().contains(&event::TYPE_IA));
        s.skip();
        assert_eq!(s.stage, Stage::Nothing);
        assert_eq!(s.set_mass(5.0), 0.0, "nothing left to change");
    }

    #[test]
    fn feeding_a_neutron_star_makes_a_black_hole() {
        let (mut s, _, _) = run_to_end(12.0);
        assert_eq!(s.stage, Stage::NeutronStar);
        assert_eq!(s.set_mass(0.5), M_NS_MIN, "can't make a neutron star lighter than this");
        s.set_mass(2.5);
        assert_eq!(s.stage, Stage::BlackHole);
        assert!(s.take_events().contains(&event::NEUTRON_STAR_COLLAPSE));
        assert_eq!(s.set_mass(1.0), 2.5, "black holes don't shrink");
        assert_eq!(s.set_mass(10.0), 10.0);
        let (_, _, r) = s.observables();
        assert!((r * R_SUN_KM - 29.53).abs() < 0.1, "event horizon {}", r * R_SUN_KM);
    }

    #[test]
    fn adding_mass_mid_life_changes_the_path() {
        let mut s = Star::new(1.0);
        s.skip();
        s.skip(); // red giant
        s.set_mass(12.0);
        assert_eq!(s.stage, Stage::Supergiant);
        s.skip();
        assert_eq!(s.stage, Stage::Supernova);
        s.set_mass(100.0);
        assert_eq!(s.progenitor_mass, 12.0, "an explosion can't be edited");
    }

    #[test]
    fn heavier_stars_burn_out_faster_on_screen_too() {
        let mut a = Star::new(1.0);
        let mut b = Star::new(20.0);
        a.advance(10.0);
        b.advance(10.0);
        assert!(a.age > b.age * 100.0);
        let (la, ta, _) = a.observables();
        let (lb, tb, _) = b.observables();
        assert!(lb > la * 1.0e4 && tb > ta * 4.0);
    }

    #[test]
    fn advancing_never_produces_nonsense() {
        for &m in &[0.08, 0.3, 0.5, 0.8, 1.0, 2.0, 3.0, 7.9, 8.0, 19.9, 20.0, 39.9, 40.0, 129.0, 130.0, 300.0] {
            let mut s = Star::new(m);
            for _ in 0..4000 {
                s.advance(0.05);
                let (l, t, r) = s.observables();
                assert!(l.is_finite() && t.is_finite() && r.is_finite() && l >= 0.0, "m={m} {:?} {l} {t} {r}", s.stage);
                assert!(s.age.is_finite() && s.age >= 0.0);
            }
            assert!(s.stage.is_final(), "m={m} ended at {:?}", s.stage);
        }
    }
}
