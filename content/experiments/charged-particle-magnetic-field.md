---
title: A charged particle in a magnetic field
summary: Simulate the spiral path of a charged particle in Python — the motion behind auroras, particle accelerators and the Earth's radiation belts.
icon: atom
track: both
difficulty: 3
time: 2 evenings
cost: "£0"
---

## The question

A magnetic field pushes a moving charge sideways, never forwards. What path does that make — and why do the northern lights happen near the poles?

## Learn just enough first

- [ ] Look up the magnetic (Lorentz) force, \(\vec{F} = q\,\vec{v} \times \vec{B}\), and the right-hand rule
- [ ] Do the [falling object simulation](/experiments/falling-object-python/) first if you haven't written a simulation before

## Kit

- [ ] A computer with Python, numpy and matplotlib (or Google Colab)

## My prediction

A particle moves across a magnetic field, with a little speed along the field too. Sketch the path you expect.

## Method

1. Start with the simplest stepping method (simple units: charge, mass and field all 1):

```python
import numpy as np
import matplotlib.pyplot as plt

q, m, dt = 1.0, 1.0, 0.01
B = np.array([0.0, 0.0, 1.0])     # field along z
v = np.array([1.0, 0.0, 0.2])     # mostly across the field, a little along it
r = np.zeros(3)
path = []
for step in range(5000):
    a = (q / m) * np.cross(v, B)
    v = v + a * dt
    r = r + v * dt
    path.append(r.copy())
print("speed at the end:", np.linalg.norm(v))
```

2. A magnetic force can't speed a particle up, yet your speed creeps up. That's an error from the stepping method. Swap the two lines that update `v` for the **Boris method**, which rotates the velocity exactly:

```python
    t = (q * B / m) * dt / 2
    s = 2 * t / (1 + t @ t)
    v_prime = v + np.cross(v, t)
    v = v + np.cross(v_prime, s)
```

3. Plot the path in 3D:

```python
p = np.array(path)
ax = plt.figure().add_subplot(projection="3d")
ax.plot(p[:, 0], p[:, 1], p[:, 2])
plt.show()
```

4. Double `B`, then double `m`, and measure the radius of the circle each time.

## Data

| \(B\) | \(m\) | Speed across field | Radius (measured) | Radius (formula) |
| ----: | ----: | -----------------: | ----------------: | ---------------: |
| 1 | 1 | 1 | | |
| 2 | 1 | 1 | | |
| 1 | 2 | 1 | | |

## Result

The particle circles around the field lines while drifting along them: a **helix**. The radius and the time for one loop are

$$ r = \frac{m v_\perp}{qB}, \qquad T = \frac{2\pi m}{qB} $$

Notice that the loop time doesn't depend on speed — the idea behind the cyclotron particle accelerator.

## Explain it to a friend

A magnetic field can't speed up a charged particle, only steer it, so the particle ends up spiralling around the field lines. Charged particles from the Sun get caught by the Earth's magnetic field and spiral down along it towards the poles, where they make the air glow: the aurora.

## New questions

- What happens if you add an electric field too?
- Why do the Earth's radiation belts trap particles instead of letting them reach the ground?
