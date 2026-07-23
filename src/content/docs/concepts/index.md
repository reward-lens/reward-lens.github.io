---
title: Concepts
description: What do you have to believe before any of the tools make sense? Not much, and it is worth getting straight first, because every instrument in the library is a
section: concepts
order: 49
source: docs/content/concepts/index.md
---

# Concepts

What do you have to believe before any of the tools make sense? Not much, and it is worth getting straight first, because every instrument in the library is a variation on the same few ideas.

These pages are the mental model, six short reads. They assume no interpretability background, only that you know what a reward model is and what a preference pair looks like. Every one of them traces the same example: a student asks why the sky is blue, one answer explains Rayleigh scattering, the other says the sky is blue because it has always been blue. Skywork scores the good answer at $-2.22$ and the bad one at $-26.25$, a margin of about $+24$. You will watch that margin form, see which components wrote it, and learn why the components that wrote it are not the ones that caused it.

- [The reward direction](/docs/concepts/reward-direction/). A reward model has exactly one output direction, and it is known exactly. That single fact is what makes reward models an easier target than the generative models they come from.
- [Preference geometry](/docs/concepts/preference-geometry/). A pair is two points in activation space. Only the difference between them means anything, and there is a reason it has to be that way.
- [Why reward is relative](/docs/concepts/reward-is-relative/). A bare reward number is close to meaningless. A margin is not. The difference is not a technicality, it is the whole reason the numbers behave.
- [Crystallization depth](/docs/concepts/crystallization/). Where along the network the preference actually forms, and why "late" is the common answer.
- [Observational versus causal](/docs/concepts/observational-vs-causal/). The one distinction that keeps you honest, and the measured result that forces you to take it seriously.
- [A measurement you can trust](/docs/concepts/measurement-you-can-trust/). Every number the library returns arrives with a receipt. This page is what the receipt says, in plain words, and it is the door into the deeper half of the site.

Read them in order the first time. After that, [the instruments](/docs/instruments/) are where the ideas turn into calls you can run, and [the measurement discipline](/docs/discipline/) is where the last page opens all the way up.
