## What decides a star's fate?

Almost entirely one number: **how much mass it's born with.** Mass sets how hard gravity squeezes the core, so it sets how hot the core gets, how fast the star burns its fuel and how it dies.

- **Under about 0.5 M☉** — red dwarfs. They burn so slowly that none has ever finished: their lives are longer than the universe is old. In the end they fade into helium white dwarfs.
- **0.5 to 8 M☉** — stars like the Sun. They swell into red giants, puff off their outer layers as a planetary nebula, and leave a white dwarf.
- **8 to about 20 M☉** — the core fuses all the way to iron, collapses, and the star explodes as a supernova, leaving a neutron star.
- **About 20 to 40 M☉** — a supernova, but so much falls back onto the core that it becomes a black hole.
- **About 40 to 130 M☉** — no bright explosion at all: the star collapses straight into a black hole.
- **Over about 130 M☉** — a pair-instability supernova blows the whole star apart, leaving nothing. Stars this big probably only formed in the early universe.

(The real boundaries depend on what the star is made of, how fast it spins and whether it has a companion — astronomers still argue about them.)

## The numbers behind it

Brightness rises steeply with mass — roughly

$$L \propto M^{3.5}$$

so a star 10 times the Sun's mass is about 3,000 times brighter. It has 10 times the fuel but burns it 3,000 times faster, so it lives far less long:

$$t \approx 10^{10}\ \text{years} \times \left(\frac{M}{M_\odot}\right)^{-2.5}$$

Dead stars have weight limits. A white dwarf is held up by electrons refusing to be squeezed together, which only works up to the **Chandrasekhar limit**, about \(1.44\,M_\odot\). A neutron star is held up by neutrons, up to roughly \(2.2\,M_\odot\). Beyond that, nothing known can stop the collapse, and you get a black hole whose event horizon has the **Schwarzschild radius**

$$r_s = \frac{2GM}{c^2} \approx 2.95\ \text{km} \times \frac{M}{M_\odot}$$

## Things to try

1. **Find the edge.** What's the lightest star that ends in a supernova? Watch the fate line under the slider as you drag.
2. **Feed a white dwarf.** Run the Sun to the end, then press the *Add* button (or drag the slider) until it passes 1.44 M☉. This is how a Type Ia supernova happens: a white dwarf steals gas from a companion star.
3. **Make a black hole the slow way.** Start a 12 M☉ star, let it become a neutron star, then keep adding mass.
4. **Read the HR diagram.** The faint line is the main sequence. Watch the Sun's dot climb up and right as a giant, shoot left as its core is exposed, then slide down to the white-dwarf corner.
5. **Change your mind mid-life.** Start the Sun, wait until it's a red giant, then drag the mass up past 8 M☉.

## How it works

The simulator is written in [Rust](https://www.rust-lang.org/) and compiled to WebAssembly, so it runs on your own device — nothing is sent anywhere. It follows each star along a simplified track built from the scaling laws above, draws every frame pixel by pixel (including the bending of starlight around a black hole, using the lens equation \(\beta = \theta - \theta_E^2/\theta\)), and plots the star on a Hertzsprung–Russell diagram as it goes. Sizes on screen are logarithmic: a red supergiant is about 100 million times wider than a neutron star, which won't fit on any screen.

It's a teaching model, not a research code: the timings and brightnesses are approximate.
