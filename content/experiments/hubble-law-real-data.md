---
title: Discover Hubble's law from real data
summary: Look up real galaxies' distances and speeds, plot them in Python, and find out how fast the universe is expanding — and how old it is.
icon: spectrum
track: astro
difficulty: 2
time: 2 evenings
cost: "£0"
---

## The question

In 1929 Edwin Hubble showed that the further away a galaxy is, the faster it's moving away from us. Can I find the same pattern in published data, and use it to estimate the age of the universe?

## Learn just enough first

- [ ] Look up redshift: how the stretching of a galaxy's light tells us its speed (\(v \approx cz\) for small redshifts)
- [ ] Read a short piece on the "expanding universe" and what Hubble's constant, \(H_0\), means
- [ ] The [CD spectroscope](/experiments/cd-spectroscope/) shows the kind of spectral lines astronomers use

## Kit

- [ ] A computer with Python, numpy and matplotlib (or Google Colab)
- [ ] An internet connection to look up galaxy data

## My prediction

If everything is moving apart evenly, what shape should a graph of speed against distance be?

## Method

1. Choose 10–15 galaxies **more than about 10 megaparsecs (Mpc) away**. Closer ones are pulled around by their neighbours — Andromeda is actually heading towards us. Good starting points: galaxies in the Virgo, Fornax and Coma clusters.
2. For each, look up its distance (in Mpc, ideally from Cepheid stars or supernovae) and its redshift or recession velocity. Wikipedia's galaxy pages and the NASA/IPAC Extragalactic Database (NED) both list them. Note where each number came from.
3. If you only have redshift \(z\), convert: \(v = cz\), with \(c\) = 299,792 km/s.
4. Fit a straight line through the origin:

```python
import numpy as np
import matplotlib.pyplot as plt

d = np.array([...])   # distances in Mpc
v = np.array([...])   # speeds in km/s

H0 = (d @ v) / (d @ d)   # best-fit slope of a line through the origin
print(f"H0 = {H0:.0f} km/s per Mpc")

plt.scatter(d, v)
plt.plot([0, d.max()], [0, H0 * d.max()])
plt.xlabel("Distance (Mpc)")
plt.ylabel("Recession speed (km/s)")
plt.show()
```

## Data

| Galaxy | Distance (Mpc) | Redshift \(z\) | Speed \(v\) (km/s) | Source |
| ------ | -------------: | -------------: | -----------------: | ------ |
| | | | | |
| | | | | |

## Result

The slope is Hubble's constant. Modern measurements give roughly 67–74 km/s per Mpc (the exact value is still being argued about). Turning it upside down gives a rough age for the universe:

$$ t \approx \frac{1}{H_0} = \frac{3.086 \times 10^{19}\ \text{km per Mpc}}{70\ \text{km/s per Mpc}} \approx 4.4 \times 10^{17}\ \text{s} \approx 14\ \text{billion years} $$

## Explain it to a friend

Galaxies further away are moving away faster, in a straight-line relationship. That's what you'd expect if space itself is stretching everywhere at once. Run the expansion backwards and everything was together about 14 billion years ago — the Big Bang.

## New questions

- Why do nearby galaxies scatter so much around the line?
- Look up the "Hubble tension". Why do different methods give different values of \(H_0\)?
