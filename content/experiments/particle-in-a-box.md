---
title: Simulate a particle in a box
summary: Solve the simplest quantum system in Python — an electron trapped between two walls — and see why its energy comes in steps.
icon: atom
track: quantum
difficulty: 3
time: 2 evenings
cost: "£0"
---

## The question

A ball in a box can have any energy at all. Quantum mechanics says an electron trapped in a tiny box can only have certain energies. What are they, and what do the electron's wave patterns look like?

## Learn just enough first

- [ ] Look up the "particle in a box" and the time-independent Schrödinger equation
- [ ] Read about quantum dots: why changing their size changes their colour

## Kit

- [ ] A computer with Python, numpy and matplotlib (or Google Colab)

## My prediction

If the lowest allowed energy is \(E_1\), what do you think the next ones will be: \(2E_1, 3E_1, \dots\) or something else?

## Method

1. **On paper.** For a box of width \(L\), the allowed wave patterns and energies are

$$ \psi_n(x) = \sqrt{\frac{2}{L}}\,\sin\!\left(\frac{n\pi x}{L}\right), \qquad E_n = \frac{n^2 h^2}{8 m L^2}, \quad n = 1, 2, 3, \dots $$

   Work out \(E_1\) for an electron (\(m = 9.109 \times 10^{-31}\) kg) in a box 1 nanometre wide, with \(h = 6.626 \times 10^{-34}\) J s. Convert to electronvolts by dividing by \(1.602 \times 10^{-19}\).
2. **In code.** Split the box into 500 points and let numpy find the allowed energies directly from the Schrödinger equation:

```python
import numpy as np
import matplotlib.pyplot as plt

hbar, m, L, N = 1.0546e-34, 9.109e-31, 1e-9, 500
x = np.linspace(0, L, N + 2)[1:-1]          # points inside the box
dx = x[1] - x[0]
H = (hbar**2 / (2 * m * dx**2)) * (2 * np.eye(N) - np.eye(N, k=1) - np.eye(N, k=-1))
E, psi = np.linalg.eigh(H)

print("Energies (eV):", E[:4] / 1.602e-19)
for n in range(4):
    plt.plot(x * 1e9, psi[:, n] ** 2 + n * psi[:, 0].max() ** 2, label=f"n = {n + 1}")
plt.xlabel("Position (nm)")
plt.legend()
plt.show()
```

3. Halve the box width and run it again. What happens to the energies?

## Data

| Level \(n\) | Energy on paper (eV) | Energy from code (eV) | \(E_n / E_1\) |
| ----------: | -------------------: | --------------------: | ------------: |
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |

## Result

For a 1 nm box you should get \(E_1 \approx 0.38\) eV, with the next levels at 4, 9 and 16 times that — the \(n^2\) pattern. An electron dropping from level 2 to level 1 gives out a photon of energy \(3E_1 \approx 1.1\) eV, which is infrared light (about 1,100 nm). Shrinking the box pushes all the levels up as \(1/L^2\), which is why smaller quantum dots glow bluer.

## Explain it to a friend

Trap an electron in a tiny space and it behaves like a wave on a guitar string: only whole numbers of half-waves fit, so only certain energies are allowed. The smaller the box, the bigger the steps between energies — and the colour of light it gives out changes with it.

## New questions

- What does \(\psi^2\) mean physically, and why does the \(n = 2\) pattern have a gap in the middle?
- What changes if the walls aren't infinitely high? Look up "quantum tunnelling".
