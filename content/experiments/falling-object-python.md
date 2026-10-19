---
title: Simulate a falling object, step by step
summary: Your first physics simulation — a dozen lines of Python that drop a ball, then add air resistance and find its top speed.
icon: star
track: both
difficulty: 2
time: 1–2 evenings
cost: "£0"
---

## The question

Computers don't solve physics equations the way you do on paper. They take lots of tiny steps. Can a few lines of code reproduce what I know about falling objects — and then go further, to things that are hard to work out by hand?

## Learn just enough first

- [ ] Remind yourself of the equations of motion for constant acceleration, especially \(s = \tfrac{1}{2}gt^2\)
- [ ] Find a way to run Python: the free Google Colab works in a browser, or install Python with numpy and matplotlib

## Kit

- [ ] A computer with Python (or Google Colab)

## My prediction

Without air, how long should a ball take to fall 20 m? Work it out on paper first using \(t = \sqrt{2s/g}\).

## Method

1. Type and run this. Each loop moves time forward by a tiny step `dt`: speed changes by acceleration × `dt`, and position by speed × `dt`.

```python
g = 9.81        # m/s², downwards
dt = 0.001      # time step, in seconds
height, speed, t = 20.0, 0.0, 0.0

while height > 0:
    speed = speed + g * dt
    height = height - speed * dt
    t = t + dt

print(f"Hit the ground after {t:.3f} s at {speed:.1f} m/s")
```

2. Compare with your paper answer. Then try `dt = 0.1` and `dt = 0.00001`. What happens to the error?
3. Now add air resistance. The drag force grows with the square of speed: \(F = \tfrac{1}{2}\rho C_d A v^2\). Replace the speed line with:

```python
rho, Cd, A, m = 1.2, 0.47, 0.0038, 0.058   # air density, drag coefficient, area and mass of a tennis ball
speed = speed + (g - 0.5 * rho * Cd * A * speed**2 / m) * dt
```

4. Drop it from 200 m instead and record the speed at the end. Collect `t` and `speed` in lists and plot them with matplotlib.

## Data

| Time step `dt` (s) | Simulated fall time (s) | Paper answer (s) | Difference |
| -----------------: | ----------------------: | ---------------: | ---------: |
| 0.1 | | | |
| 0.001 | | | |
| 0.00001 | | | |

## Result

The speed with drag levels off at the **terminal velocity**, where drag balances weight:

$$ v_t = \sqrt{\frac{2mg}{\rho C_d A}} $$

Check your simulation against this formula (about 23 m/s for the tennis ball).

## Explain it to a friend

A simulation doesn't need clever maths — just "speed changes by a little, position changes by a little", repeated thousands of times. Smaller steps are more accurate. Once that works, you can add things like air resistance that make the paper maths much harder.

## New questions

- What's the terminal velocity of a ping-pong ball, or a person?
- The [orbit simulator](/experiments/orbit-simulator/) uses the same stepping idea in two dimensions — try it next.
