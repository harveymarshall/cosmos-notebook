---
title: Simulate an orbit in code
summary: Start with PhET's ready-made simulations, then write a 30-line Python program that makes a planet orbit the Sun.
icon: planet
track: astro
phase: level-up
order: 2
difficulty: 2
time: 2–3 evenings
cost: "£0"
---

## The question

If I only tell a computer Newton's law of gravity, will it produce a planet going round the Sun all by itself?

## Learn just enough first

- [ ] Play with the "Gravity and Orbits" and "My Solar System" simulations on [PhET](https://phet.colorado.edu)
- [ ] Read about Newton's law of gravitation: \(F = GMm/r^2\)

## Kit

- [ ] A computer with Python 3 (plus `matplotlib` if you want a picture)

## My prediction

If I start the planet with slightly too little speed, what shape will its orbit be?

## Method

1. Start with the planet at 1 AU from the Sun, moving sideways at Earth's speed.
2. Every small time step: work out the gravity pull, update the velocity, then the position.
3. Plot the path. Then try changing the starting speed.

```python
import math

G, M = 6.674e-11, 1.989e30          # gravity constant, mass of the Sun
x, y = 1.496e11, 0.0                # start 1 AU from the Sun (m)
vx, vy = 0.0, 29_780.0              # Earth's orbital speed (m/s)
dt = 3600                           # one-hour steps
path = []

for step in range(24 * 365):        # one year
    r = math.hypot(x, y)
    ax, ay = -G * M * x / r**3, -G * M * y / r**3
    vx += ax * dt; vy += ay * dt     # update velocity, then position
    x += vx * dt;  y += vy * dt
    path.append((x, y))

print(f"Back near the start? x = {x/1.496e11:.3f} AU, y = {y/1.496e11:.3f} AU")

try:
    import matplotlib.pyplot as plt
    plt.plot(*zip(*path)); plt.plot(0, 0, "yo"); plt.axis("equal"); plt.show()
except ImportError:
    print("Install matplotlib to see the orbit drawn.")
```

## Data

| Starting speed (km/s) | Orbit shape | Time for one orbit (days) |
| --------------------: | ----------- | ------------------------: |
| 29.78 | | |
| 25 | | |
| 35 | | |
| 42.1 | | |

## Result

What happens at about 42 km/s? (That's the Sun's escape speed at Earth's distance.)

## Explain it to a friend

Nothing in the code says "go round in a circle". It only says "pull towards the Sun a little, then move a little" — repeated thousands of times. Orbits, ellipses and escape all fall out on their own.

## New questions

- Can I add a second planet, or a moon?
- What happens if I make the time step much bigger?
