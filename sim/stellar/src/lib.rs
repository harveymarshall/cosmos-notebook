//! Stellar Lab — the engine behind Cosmos Notebook's /lab/ page.
//!
//! Compiled to WebAssembly with plain `cargo build --target wasm32-unknown-unknown`.
//! The page calls the C-ABI functions below and copies the RGBA frame buffers
//! straight out of WebAssembly memory onto two canvases. No bindings generator needed.

pub mod physics;
pub mod render;

use physics::Stage;
use render::Lab;

fn lab<'a>(p: *mut Lab) -> &'a mut Lab {
    // SAFETY: the page only ever passes the pointer `lab_new` returned, on one thread.
    unsafe { &mut *p }
}

#[no_mangle]
pub extern "C" fn lab_new(mass: f64, seed: u32) -> *mut Lab {
    Box::into_raw(Box::new(Lab::new(mass, seed)))
}

#[no_mangle]
pub extern "C" fn lab_free(p: *mut Lab) {
    if !p.is_null() {
        // SAFETY: pointer came from lab_new and is not used again
        drop(unsafe { Box::from_raw(p) });
    }
}

#[no_mangle]
pub extern "C" fn lab_reset(p: *mut Lab, mass: f64) {
    lab(p).reset(mass)
}

/// Advance `dt` real seconds; `speed` scales how fast the star ages (1 = normal).
#[no_mangle]
pub extern "C" fn lab_step(p: *mut Lab, dt: f64, speed: f64) {
    lab(p).step(dt, speed)
}

#[no_mangle]
pub extern "C" fn lab_render(p: *mut Lab) {
    lab(p).render()
}

#[no_mangle]
pub extern "C" fn lab_skip(p: *mut Lab) {
    lab(p).skip()
}

/// Change the mass of the star — or of its remnant. Returns the mass actually used.
#[no_mangle]
pub extern "C" fn lab_set_mass(p: *mut Lab, mass: f64) -> f64 {
    lab(p).set_mass(mass)
}

/// Colour for lines on the HR diagram, so it matches the page theme.
#[no_mangle]
pub extern "C" fn lab_set_ink(p: *mut Lab, r: u32, g: u32, b: u32) {
    lab(p).set_ink(r.min(255) as u8, g.min(255) as u8, b.min(255) as u8)
}

/// 1 = softer explosions, for prefers-reduced-motion.
#[no_mangle]
pub extern "C" fn lab_set_gentle(p: *mut Lab, on: u32) {
    lab(p).set_gentle(on != 0)
}

/// The next thing that happened (see physics::event), or 0 when there's nothing new.
#[no_mangle]
pub extern "C" fn lab_next_event(p: *mut Lab) -> u32 {
    lab(p).next_event()
}

#[no_mangle]
pub extern "C" fn lab_view_ptr(p: *mut Lab) -> *const u8 {
    lab(p).view.as_ptr()
}
#[no_mangle]
pub extern "C" fn lab_hr_ptr(p: *mut Lab) -> *const u8 {
    lab(p).hr.as_ptr()
}
#[no_mangle]
pub extern "C" fn lab_view_width() -> u32 {
    render::VIEW_W as u32
}
#[no_mangle]
pub extern "C" fn lab_view_height() -> u32 {
    render::VIEW_H as u32
}
#[no_mangle]
pub extern "C" fn lab_hr_width() -> u32 {
    render::HR_W as u32
}
#[no_mangle]
pub extern "C" fn lab_hr_height() -> u32 {
    render::HR_H as u32
}

// ---------- readouts ----------

#[no_mangle]
pub extern "C" fn lab_stage(p: *mut Lab) -> u32 {
    lab(p).star.stage as u32
}
#[no_mangle]
pub extern "C" fn lab_progress(p: *mut Lab) -> f64 {
    lab(p).star.progress
}
#[no_mangle]
pub extern "C" fn lab_age(p: *mut Lab) -> f64 {
    lab(p).star.age
}
#[no_mangle]
pub extern "C" fn lab_mass(p: *mut Lab) -> f64 {
    lab(p).star.mass
}
#[no_mangle]
pub extern "C" fn lab_initial_mass(p: *mut Lab) -> f64 {
    lab(p).star.initial_mass
}
#[no_mangle]
pub extern "C" fn lab_progenitor_mass(p: *mut Lab) -> f64 {
    lab(p).star.progenitor_mass
}
#[no_mangle]
pub extern "C" fn lab_luminosity(p: *mut Lab) -> f64 {
    lab(p).star.observables().0
}
#[no_mangle]
pub extern "C" fn lab_temperature(p: *mut Lab) -> f64 {
    lab(p).star.observables().1
}
/// Radius in solar radii (the event horizon for a black hole).
#[no_mangle]
pub extern "C" fn lab_radius(p: *mut Lab) -> f64 {
    lab(p).star.observables().2
}
/// Years since the stage began (cooling age for a white dwarf).
#[no_mangle]
pub extern "C" fn lab_cooling_age(p: *mut Lab) -> f64 {
    lab(p).star.cooling_years()
}
#[no_mangle]
pub extern "C" fn lab_can_change_mass(p: *mut Lab) -> u32 {
    let s = lab(p).star.stage;
    (s.is_burning() || matches!(s, Stage::WhiteDwarf | Stage::NeutronStar | Stage::BlackHole)) as u32
}

// ---------- pure helpers for the page ----------

/// What a new star of this mass will become (see physics::Fate).
#[no_mangle]
pub extern "C" fn lab_fate(mass: f64) -> u32 {
    physics::fate(mass) as u32
}
#[no_mangle]
pub extern "C" fn lab_ms_lifetime(mass: f64) -> f64 {
    physics::ms_lifetime(mass)
}
#[no_mangle]
pub extern "C" fn lab_schwarzschild_km(mass: f64) -> f64 {
    physics::schwarzschild_km(mass)
}
#[no_mangle]
pub extern "C" fn lab_limit(which: u32) -> f64 {
    match which {
        0 => physics::M_CHANDRASEKHAR,
        1 => physics::M_TOV,
        2 => physics::MASSIVE,
        3 => physics::DIRECT_COLLAPSE,
        4 => physics::PAIR_INSTABILITY,
        5 => physics::MIN_MASS,
        6 => physics::MAX_MASS,
        _ => 0.0,
    }
}
