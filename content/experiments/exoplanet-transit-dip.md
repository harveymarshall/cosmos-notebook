---
title: Simulate an exoplanet transit
summary: Extend your orbit code to make a planet cross its star, and see the tiny dip in starlight that astronomers use to find new worlds.
icon: star
track: astro
difficulty: 2
time: 2 evenings
cost: "£0"
---

## The question

Most known planets around other stars were found because they block a little of their star's light as they pass in front of it. How big is that dip, and what can it tell us about the planet?

## Learn just enough first

- [ ] Do the [orbit simulator](/experiments/orbit-simulator/) first — this builds on it
- [ ] Look up the "transit method" and what NASA's Kepler and TESS missions found with it

## Kit

- [ ] A computer with Python, numpy and matplotlib (or Google Colab)
- [ ] Optional hands-on version: a lamp, a small ball on a stick, and a phone light-meter app

## My prediction

Jupiter is about one-tenth the width of the Sun. What fraction of the Sun's light do you think it would block for a faraway observer?

## Method

1. Seen edge-on from far away, the planet moves across the star's face in a straight line. The fraction of light blocked is the fraction of the star's disc it covers:

$$ \frac{\Delta F}{F} = \left(\frac{R_\text{planet}}{R_\text{star}}\right)^2 $$

2. Simulate the brightness as the planet crosses:

```python
import numpy as np
import matplotlib.pyplot as plt

R_star, R_planet = 1.0, 0.1           # Jupiter-sized planet, Sun-sized star
x = np.linspace(-1.5, 1.5, 2000)       # planet's position across the star's face
grid = np.linspace(-1, 1, 400)
X, Y = np.meshgrid(grid, grid)
star = X**2 + Y**2 <= R_star**2        # pixels on the star's disc

brightness = []
for xp in x:
    blocked = star & ((X - xp)**2 + Y**2 <= R_planet**2)
    brightness.append(1 - blocked.sum() / star.sum())

plt.plot(x, brightness)
plt.xlabel("Planet position (star radii)")
plt.ylabel("Relative brightness")
plt.show()
```

3. Try an Earth-sized planet (`R_planet = 0.0092`). It's only a few pixels across on this grid, so the dip comes out a little too big — raise the grid from 400 to 2000 points for a better answer (it takes longer). Then change the planet's path so it crosses higher up the star (add an offset to `Y`) and watch the dip get shorter.

## Data

| Planet | \(R_\text{planet}/R_\text{star}\) | Simulated dip | Formula \((R_p/R_s)^2\) |
| ------ | --------------------------------: | ------------: | ----------------------: |
| Jupiter-size | 0.10 | | |
| Neptune-size | 0.035 | | |
| Earth-size | 0.0092 | | |

## Result

A Jupiter-sized planet dims a Sun-like star by about 1%; an Earth-sized one by less than 0.01% — about 84 parts per million. The depth gives the planet's size, the time between dips gives its year, and Kepler's third law then gives its distance from the star.

## Explain it to a friend

When a planet passes in front of its star, the star gets very slightly dimmer. How much dimmer tells you how big the planet is, and how often it happens tells you how long its year is. Space telescopes watch thousands of stars at once for these tiny regular dips.

## New questions

- Real light curves have curved bottoms, not flat ones. Look up "limb darkening" — why does it happen?
- Could an astronomer on another planet spot the Earth this way?
