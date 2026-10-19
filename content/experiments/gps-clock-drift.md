---
title: Why GPS needs relativity
summary: A pen-and-paper calculation of how much GPS satellite clocks drift because of Einstein's relativity — and how far off your map would be without the fix.
icon: planet
track: both
difficulty: 2
time: 1 evening
cost: "£0"
---

## The question

GPS works by timing radio signals from satellites to within billionths of a second. Both of Einstein's theories say the satellites' clocks run at a different rate from ours. By how much — and does it matter?

## Learn just enough first

- [ ] Look up time dilation in **special** relativity: moving clocks run slow
- [ ] Look up gravitational time dilation in **general** relativity: clocks higher up in a gravity field run fast
- [ ] Read a short explainer on how a GPS receiver works out where it is

## Kit

- [ ] Pen, paper and a calculator (or a few lines of Python)

## My prediction

Will the satellites' clocks run fast or slow overall? Guess which effect wins before calculating.

## Method

Use these values: Earth's \(GM = 3.986 \times 10^{14}\ \text{m}^3/\text{s}^2\), Earth's radius \(R_E = 6.371 \times 10^6\) m, GPS orbit radius \(r = 2.656 \times 10^7\) m, \(c = 2.998 \times 10^8\) m/s, and 86,400 seconds in a day.

1. **Orbital speed:** \(v = \sqrt{GM/r}\). (You should get about 3.87 km/s.)
2. **Special relativity — moving clocks run slow.** For speeds much smaller than light, the fraction lost is

$$ \frac{\Delta t}{t} \approx \frac{v^2}{2c^2} $$

   Multiply by 86,400 s to get microseconds lost per day.
3. **General relativity — clocks higher up run fast.** The fraction gained is

$$ \frac{\Delta t}{t} \approx \frac{GM}{c^2}\left(\frac{1}{R_E} - \frac{1}{r}\right) $$

   Again multiply by 86,400 s.
4. Combine the two, then multiply the net drift by \(c\) to see how far a light signal travels in that time.

## Data

| Effect | Fraction | Microseconds per day | Fast or slow? |
| ------ | -------: | -------------------: | ------------- |
| Special relativity (speed) | | | |
| General relativity (height) | | | |
| **Net** | | | |

## Result

You should find the satellite clocks lose about 7 µs a day from their speed and gain about 46 µs a day from being higher up, so they run **about 38 µs a day fast** overall. Light travels about 11 km in 38 µs, so without correction GPS positions would drift by kilometres within a day. Engineers fix it by setting the satellite clocks to tick very slightly slow before launch.

## Explain it to a friend

Einstein's theories aren't just for black holes. GPS satellites move fast (which slows their clocks) and sit high above the Earth's gravity (which speeds them up). The second effect wins, and if nobody corrected for it, your phone's map would be wrong by kilometres by the end of the day.

## New questions

- At what height would the two effects cancel out exactly?
- Would a clock at the top of a mountain run noticeably faster than one at sea level?
