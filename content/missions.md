---
title: The physics behind Mission Control
---

## Every number here is old news

Radio travels at the speed of light, \(c \approx 299{,}792\) km/s — fast, but space is big. The **signal time** on each card is

$$t = \frac{d}{c}$$

where \(d\) is the spacecraft's distance from Earth. A command sent to Voyager 1 takes most of a day to arrive, and its reply takes as long again. Whatever you see from it has already happened.

## Why a distance from Earth wobbles

Each spacecraft's position is measured from the **Sun**, but we listen from **Earth**, and Earth is circling the Sun at about 30 km/s. Voyager 1 only moves outward at about 17 km/s, so for a few months each year Earth swings towards it faster than it flies away — and its distance from us *shrinks* even though it's still leaving the Solar System.

## Borrowing speed from planets

Europa Clipper, Juice, Psyche and Lucy all fly past planets — even Earth — on purpose. In a **gravity assist** the spacecraft falls towards a moving planet and is flung out the other side. In the planet's frame its speed in and out is the same; in the Sun's frame it picks up some of the planet's orbital motion. The planet slows down by an immeasurably tiny amount to pay for it.

## How the map is drawn

Positions come from NASA JPL's **Horizons** system, which holds the navigation teams' latest trajectory for each spacecraft. We fetch one point a day and join them with curves that follow each spacecraft's velocity (cubic Hermite interpolation). The planets come from the same Keplerian orbits used on [Tonight's sky](/tonight/). Seen from above, the Solar System is mostly empty — so the **Whole fleet** view squashes distance with a logarithm to fit Voyager and Mercury on one screen.

Try it yourself: the [orbit simulator experiment](/experiments/orbit-simulator/) builds a tiny version of the same idea.
