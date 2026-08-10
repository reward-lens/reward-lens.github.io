---
title: How-to guides
description: You know the job and you want the exact calls. Each recipe is one page, one task, and code you can paste. The runnable ones use the tiny CPU signal, so they
section: how-to
order: 6
source: docs/content/how-to/index.md
libraryVersion: 3.0.0
staleMarkers: []
---

# How-to guides

**You know the job and you want the exact calls.** Each recipe is one page, one task, and code you can paste. The runnable ones use the tiny CPU signal, so they finish in under a minute with no download; anything that needs an 8B model is marked and names the call rather than pretending to run.

If you want to understand why the calls are shaped the way they are, the [instruments](/docs/instruments/) and [concepts](/docs/concepts/) are the longer read.

## Point reward-lens at your grader

<div class="grid cards" markdown>

-   __[Load or wrap a reward model](/docs/how-to/load-a-reward-model/)__

    Wrap a model already in memory, or build a tiny one on CPU. The hub loader is gated and says so.

-   __[Use a DPO checkpoint as a signal](/docs/how-to/dpo-implicit-reward/)__

    A DPO policy is a reward model with no head. Read its implicit log-ratio reward.

-   __[Use an LLM judge as a signal](/docs/how-to/llm-judge-signal/)__

    Read a verdict off the unembedding, and validate that the judgment lands where you think.

-   __[Score with a process reward model](/docs/how-to/process-reward-model/)__

    One reward per reasoning step. The delimiter split is exact; the learned detector is a stub.

-   __[Write an adapter](/docs/how-to/write-an-adapter/)__

    Make a model family reward-lens does not ship support for speak the signal protocol.

</div>

## Read an instrument

<div class="grid cards" markdown>

-   __[Detect length bias](/docs/how-to/detect-length-bias/)__

    Run the bias battery across axes and read a standardized effect size with an honest sample size.

-   __[Attribute a reward score](/docs/how-to/attribute-a-score/)__

    Split a margin into per-component contributions, and know why that is only the first look.

-   __[Patch without running out of memory](/docs/how-to/patching-memory/)__

    Triage with the cheap tools, then patch only the components that matter.

-   __[Compare two reward models](/docs/how-to/compare-two-models/)__

    See where two models form the same preference, and why raw numbers need a shared frame first.

</div>

## Trust the number

<div class="grid cards" markdown>

-   __[Effective sample size of an eval set](/docs/how-to/effective-sample-size/)__

    Thirty rows from six seeds are not thirty data points. Count what the data actually earned.

-   __[Effective group size of a GRPO group](/docs/how-to/effective-group-size/)__

    Sixteen rollouts is not sixteen independent observations once the grader disagrees with itself.

-   __[Calibrate a detector on an organism](/docs/how-to/calibrate-on-an-organism/)__

    No instrument earns more than exploratory trust without an answer key to check it against.

-   __[Freeze and run a study](/docs/how-to/freeze-and-run-a-study/)__

    Write the prediction down first, freeze it, then let the spec adjudicate the result.

-   __[Build a card, check a manuscript](/docs/how-to/cards-and-claims/)__

    A card can only say what the evidence store can back. A claim check fails on an unbacked number.

</div>

## Wire a training loop

<div class="grid cards" markdown>

-   __[Hook into a training loop](/docs/how-to/training-loop-hooks/)__

    Attach a reward function and log the geometry as optimization pressure builds.

</div>
