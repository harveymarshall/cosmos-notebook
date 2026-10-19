---
title: Find Planck's constant with LEDs
summary: Different coloured LEDs switch on at different voltages. A multimeter and a little maths reveal the number at the heart of quantum physics.
icon: atom
track: quantum
difficulty: 2
time: 2 evenings
cost: "~£15 (multimeter + LED kit)"
---

## The question

Light comes in packets called photons, with energy \(E = hf\). Can I measure \(h\), Planck's constant, on my kitchen table?

## Learn just enough first

- [ ] Read about photons and the photoelectric effect
- [ ] Look up how an LED works: one electron crossing the junction makes one photon

## Kit

- [ ] A cheap digital multimeter
- [ ] At least four LEDs of different colours with known wavelengths (red ~630 nm, yellow ~590 nm, green ~525 nm, blue ~470 nm — check the seller's specs)
- [ ] A 9 V battery and battery clip
- [ ] A 10 kΩ potentiometer and a 1 kΩ resistor
- [ ] A small breadboard and jumper wires

## My prediction

Will blue LEDs need more voltage or less than red ones to switch on? Why?

## Method

1. Wire battery → potentiometer → 1 kΩ resistor → LED, with the multimeter measuring the voltage across the LED.
2. In a dark room, slowly turn up the voltage until the LED *just* starts to glow. Record that voltage.
3. Repeat three times per LED and take the average.

> **Safety:** Always keep the 1 kΩ resistor in the circuit — without it the LED will burn out.

## Data

| Colour | Wavelength \(\lambda\) (nm) | Turn-on voltage \(V\) (V) | \(h\) estimate (J·s) |
| ------ | --------------------------: | ------------------------: | -------------------: |
| Red | | | |
| Yellow | | | |
| Green | | | |
| Blue | | | |

## Result

Each electron gains energy \(eV\) and gives it up as one photon of energy \(hc/\lambda\), so:

$$ h \approx \frac{e \, V \, \lambda}{c} $$

with \(e = 1.602 \times 10^{-19}\) C and \(c = 2.998 \times 10^{8}\) m/s. Better still, plot \(V\) against \(1/\lambda\): the slope of the straight line is \(hc/e\). The accepted value is \(6.626 \times 10^{-34}\) J·s — getting within 10–20% is a great result.

## Explain it to a friend

Bluer light carries more energy per photon, so blue LEDs need a bigger push to switch on. Measuring that push for several colours lets you work out the conversion rate between a photon's colour and its energy. That number, Planck's constant, is the foundation of quantum physics.

## New questions

- Why isn't the "just glowing" point perfectly sharp?
- How does my error compare between the straight-line method and single LEDs?
