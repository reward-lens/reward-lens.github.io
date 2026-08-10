/**
 * Retractions, applied to the evidence store on the way out.
 *
 * WHY THIS FILE EXISTS.
 *
 * The evidence store is frozen. It is the campaign's own record of what it
 * adjudicated, and the site does not rewrite it, because a store that gets
 * edited when its results become inconvenient is not evidence. So the record
 * for `topo-hodge` still reads `confirmed`, and it will keep reading
 * `confirmed` forever.
 *
 * It is also wrong. The claim was intransitive preference mass that no scalar
 * reward can represent, adjudicated at `0.214` against a threshold of `0.03`.
 * The recount found **0 cyclic triples in 186,378 triangles**, and 10,000 of
 * 10,000 sampled tournaments acyclic. `0.214` is not a measurement of
 * intransitivity; it is the *floor* of the decomposition, which the observed
 * value exceeds by 2.8e-17, or nothing. src/data/log-corrections.json carries
 * the recount and its three supporting evidence ids.
 *
 * Until now that correction lived only under /log/. So a reader who followed a
 * number down to /evidence/ — the one route the site says exists specifically
 * so numbers can be checked — landed on a page reading `confirmed` at
 * `registered` trust, with no word of the withdrawal anywhere on it. That is
 * the dead claim rendering outside the archive that retired it, on the route
 * where being wrong costs the most.
 *
 * WHAT THIS DOES, AND WHAT IT REFUSES TO DO.
 *
 * It does not change the store and it does not change the verdict. The record
 * page still prints `confirmed`, because that is what the store says and the
 * page's job is to show the store. This adds the second fact beside it: that
 * the reading was withdrawn, by what, and where to read the recount. The
 * reader sees both, which is the only honest rendering when a frozen record
 * and a later measurement disagree.
 *
 * The join is by card slug, and it is asserted rather than assumed: a
 * correction naming a card that no longer exists is a build failure, not a
 * silently dropped banner. That is the failure mode this whole file is about.
 */
import corrections from "@data/log-corrections.json";
import atlas from "@data/atlas.json";

export interface Correction {
  /** The card slug the correction applies to. */
  card: string;
  /** What the frozen store still says. Rendered, never suppressed. */
  storedVerdict: string;
  storedValue: number;
  threshold: number;
  triangles: number;
  cyclicTriples: number;
  tournaments: number;
  acyclicTournaments: number;
  floor: number;
  observedMinusFloor: number;
  evidence: Record<string, string>;
  source: Record<string, unknown>;
}

const all = (corrections as { corrections: Correction[] }).corrections;

/* The slugs the archive actually has. A correction that names something else is
   a stale correction, and a stale correction is exactly as bad as a stale
   claim: it means nobody rechecked it. Fail the build and say which. */
const known = new Set((atlas as { cards: { slug: string }[] }).cards.map((c) => c.slug));
for (const c of all) {
  if (!known.has(c.card)) {
    throw new Error(
      `log-corrections.json corrects card "${c.card}", which is not in atlas.json. ` +
        `Either the card was renamed and this correction now applies to nothing, or ` +
        `it was removed and the correction should have gone with it. A retraction ` +
        `that points at a card the site does not have is not a retraction.`,
    );
  }
}

const bySlug = new Map(all.map((c) => [c.card, c]));

/** The correction for a card slug, or null. Slug, not evidence id: the
    correction is about the claim, and the claim outlives its adjudication. */
export const correctionForCard = (slug: string | null | undefined): Correction | null =>
  (slug && bySlug.get(slug)) || null;

/** Every corrected slug, for the index's withdrawn markers. */
export const correctedSlugs = (): ReadonlySet<string> => new Set(bySlug.keys());
