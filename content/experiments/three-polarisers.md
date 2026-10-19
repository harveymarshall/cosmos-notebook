---
title: The three-polariser puzzle
summary: Two crossed polarising filters block all light — until you slip a third one between them. A tabletop doorway into quantum measurement.
icon: wave
track: quantum
difficulty: 1
time: 1 evening
cost: "~£5 (polarising film)"
---

## The question

Two polarising filters at right angles block the light completely. How can adding a third filter — which can only block more light — make light come through again?

## Learn just enough first

- [ ] Look up what polarised light is, and Malus's law, \(I = I_0 \cos^2\theta\)
- [ ] Watch a short video on the "three polariser paradox" and how it's explained with photons

## Kit

- [ ] Three pieces of linear polarising film (sold cheaply in sheets online), or two pairs of polarised sunglasses and one piece of film
- [ ] A printed protractor, to set the angles
- [ ] A light source: a laptop or monitor screen (most give out polarised light), or a torch with one film in front of it
- [ ] Optional: a phone light-meter app to measure brightness

## My prediction

Cross two filters so the light is blocked. If you put a third filter between them at 45°, what will happen? Write your answer down first.

## Method

1. Look through one filter at a white screen and rotate it. If the screen dims and brightens, the screen's light is already polarised.
2. Hold two filters together and turn one until the light through them is as dark as possible. They're now **crossed** (90° apart).
3. Slide a third filter **between** them and rotate it slowly. Note where it's brightest.
4. Now put that third filter **in front of** or **behind** the crossed pair instead. Does it still let light through?
5. With the light meter: measure brightness through two filters as you turn one from 0° to 90° in 15° steps.

## Data

| Angle between two filters \(\theta\) (°) | Brightness (lux) | \(\cos^2\theta\) |
| ---------------------------------------: | ---------------: | ---------------: |
| 0 | | 1.00 |
| 15 | | 0.93 |
| 30 | | 0.75 |
| 45 | | 0.50 |
| 60 | | 0.25 |
| 75 | | 0.07 |
| 90 | | 0.00 |

## Result

Plot brightness against \(\cos^2\theta\): it should be close to a straight line (Malus's law). With three ideal filters at 0°, 45° and 90°, unpolarised light is halved by the first, then multiplied by \(\cos^2 45^\circ = \tfrac{1}{2}\) twice:

$$ I = \frac{I_0}{2} \times \frac{1}{2} \times \frac{1}{2} = \frac{I_0}{8} $$

Real film absorbs a bit more, so expect somewhat less.

## Explain it to a friend

Think of each photon as being asked a yes/no question by each filter: "are you lined up with me?" Each answer resets the photon's state. Crossed filters ask opposite questions, so nothing passes. A filter at 45° in the middle asks a different question in between, and about half the photons that get a "yes" there then have a 50:50 chance at the last filter. In quantum mechanics, measuring something changes it.

## New questions

- What happens with many filters, each turned a few degrees more than the last?
- Why do polarised sunglasses cut glare from water and roads?
