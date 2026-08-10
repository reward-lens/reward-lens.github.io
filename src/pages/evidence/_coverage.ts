/**
 * The coverage numbers for /evidence/ section 3, read from gate 5 and from
 * gate 5's own configuration. Nothing here counts anything.
 *
 * Underscore-prefixed, so Astro leaves it out of the routing manifest.
 *
 * WHY IT READS TWO FILES AND COUNTS NOTHING. `pages/evidence.md` §3 states its
 * acceptance criterion as a prohibition: "all three numbers derive from gate
 * 5's own sweep of the rendered output, not from a separate count. If gate 5
 * and this section can disagree, this section is wrong." A tokeniser here would
 * be a second count, and two counts of one thing disagree the first time either
 * changes. So:
 *
 *   numbers_total, numbers_bound   reports/provenance-coverage.json, which is
 *                                  gate 5's own printed summary transcribed by
 *                                  scripts/dev/record-provenance-coverage.mjs.
 *   numbers_allowlisted            scripts/checks/number-allowlist.json, which
 *                                  is gate 5's INPUT. The page and the gate
 *                                  read the same file, so this one cannot
 *                                  disagree at all.
 *
 * THE ONE WAY IT CAN STILL BE WRONG, STATED RATHER THAN HIDDEN. Gate 5 sweeps
 * dist/, and this page is in dist/, so the sweep it renders is the one before
 * the build that renders it. `sweptPages` and `recordedAt` are carried through
 * so the staleness is visible rather than assumed away. The eventual fix is
 * gate 5 emitting the artifact itself as part of the build, which is packet
 * P2's file and not this packet's to change.
 *
 * WHAT THE NUMBERS DO NOT SAY, AND IT MATTERS MORE THAN THEIR SIZE. Gate 5
 * currently defers six whole route families through the `routes` ratchet,
 * /evidence/** among them. Those numerals are neither bound nor exempt: they
 * are unchecked. `bound` published on its own would be a coverage figure over
 * a site with route families removed, so the ratchet entries are rendered in
 * the same list as the permanent exceptions, each carrying its own reason and
 * the packet that owns it. A deferral a reader cannot see is a deferral that
 * reads as coverage.
 */
import bannedTerms from "@data/banned-terms.json";
import allowlist from "../../../scripts/checks/number-allowlist.json";
import sweep from "../../../reports/provenance-coverage.json";

export interface AllowEntry {
  /** The pattern or the route, whichever the entry keys on. */
  subject: string;
  reason: string;
  /** Present on ratchet entries only: the packet that will bind the route. */
  packet?: string;
  recorded?: string;
  deferred: boolean;
}

if (typeof sweep.numerals !== "number" || typeof sweep.bound !== "number") {
  throw new Error(
    "/evidence/: reports/provenance-coverage.json carries no sweep. It is " +
      "gate 5's own summary, transcribed, and copy.yaml:evidence.coverage_body " +
      "binds three numbers to it. Regenerate with: node " +
      "scripts/dev/record-provenance-coverage.mjs. Section 3 does not ship " +
      "with a typed count.",
  );
}

/* The ratchet entries carry an internal build note beside their reason: "P5
   repoints the port at the v3 corpus", "P6 rebuilds /atlas/ and binds them".
   Packet names collide with the campaign's prediction ids, which is D-05's own
   collision argument, and gate 7 reported P3, P5 and P6 on this route the
   first time the list was published whole.

   The sentence naming a packet is dropped and the rest of the reason is kept.
   Sentence-level, not term-level: redacting `P5` out of the middle of a clause
   leaves mangled prose, and the sentence it sits in is a note about who does
   the work rather than about why the numeral is exempt, which is what a reader
   came for. The file itself is in the repository for anyone who wants the
   other half. A reason that redacts to nothing throws rather than rendering an
   empty description. */
const banned = new RegExp(
  `(?<![\\w-])(${bannedTerms.terms
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})(?![\\w-])`,
);
/* The archive's own word, qualified. `campaign` on its own is the project's
   old public abstraction and terms.json forbids it outside /log/; `v2 campaign`
   is the form that rule allows, and it is what the allow-list means: the entry
   is the historical log's route. Applied where the word is not already
   qualified, so re-running this over an already-qualified reason is a no-op. */
const qualifyCampaign = (text: string): string =>
  text.replace(/(?<!v2\s)\bcampaign\b(?![.\-\w])/g, "v2 campaign");

const publicReason = (subject: string, reason: string): string => {
  const kept = qualifyCampaign(
    reason
      .split(/(?<=\.)\s+/)
      .filter((sentence) => !banned.test(sentence))
      .join(" ")
      .trim(),
  );
  if (!kept) {
    throw new Error(
      `/evidence/: every sentence of the allow-list reason for "${subject}" ` +
        `names an internal identifier, so nothing of it can be published and ` +
        `the row would render an empty description. Rewrite the reason in ` +
        `scripts/checks/number-allowlist.json, which is packet P2's file.`,
    );
  }
  return kept;
};

/* Every entry in gate 5's allow-list, permanent and deferred alike, in the
   file's own order. The count is the length of this list, which is the same
   list gate 5 reads. */
export const allowEntries: AllowEntry[] = [
  ...allowlist.patterns.map((p) => ({
    subject: p.pattern,
    reason: publicReason(p.pattern, p.reason),
    deferred: false,
  })),
  ...(allowlist.exact ?? []).map((e: { value: string; reason: string }) => ({
    subject: e.value,
    reason: publicReason(e.value, e.reason),
    deferred: false,
  })),
  ...allowlist.routes.map((r) => ({
    subject: r.route,
    reason: publicReason(r.route, r.reason),
    packet: r.packet,
    recorded: r.recorded,
    deferred: true,
  })),
];

export const coverage = {
  /* Gate 5's own total: every numeric token it tokenised out of rendered text,
     bound, exempt, deferred and failing together. */
  total: sweep.numerals,
  /* Gate 5's `bound`: numerals inside a [data-provenance] element, which is its
     pass condition and the site's one rule that is not decorative. */
  bound: sweep.bound,
  /* Entries, not occurrences, and PERMANENT entries only.
     This was `allowEntries.length`, which is 3 permanent patterns plus the 6
     ratcheted routes, and the copy called all 9 "forms of numeral listed as
     permanent exceptions". Six of them are not forms and are not permanent:
     they are whole route families the sweep defers, and the sentence beside
     this one already counts their numerals. Counting them twice, once as
     deferred and once as permanent exceptions, described the site as more
     settled than it is. */
  allowlisted: allowEntries.filter((e) => !e.deferred).length,
  /* THE NUMBER THE SECTION PROMISED AND DID NOT SHOW.
     `evidence.coverage_note` says "a claim that every number resolves is worth
     nothing unless the count of the ones that do not is visible beside it", and
     then the section printed a total, a bound count and an entry count, leaving
     the reader to subtract. The count it promised is this one, and it is the
     largest of the three, so leaving it to arithmetic was the flattering
     arrangement. Derived from gate 5's own sweep, not counted here. */
  unresolved: sweep.numerals - sweep.bound,
  /* Deferred entirely: routes gate 5 does not check. Published separately from
     `unresolved` because these are not "unbound and known about" — they are
     unexamined, and the recorder's own note says any surface publishing `bound`
     without this beside it is quoting coverage over a site with whole route
     families removed. */
  deferred: sweep.ratcheted,
  /* Generated verbatim from the library's docstrings on /docs/api/**. Exempt,
     and counted rather than skipped: see the recorder's note. */
  ported: sweep.portedReference,
  /* Matched one of gate 5's context allowances: a release version, the
     interpreter floor, a figure or section label, an arXiv identifier, a data
     table's reference-row baseline, or a definition ported from the library's
     quantity registry.

     PUBLISHED FOR THE REASON THE PORTED CLASS IS. These are exempt, they are
     the second-largest exempt class on the site, and they live in the gate's
     code rather than in number-allowlist.json, so the allow-list this section
     prints below does not contain them. A reader counting the rows in that list
     would find nine and be missing 144 numerals' worth of exemption. The count
     is stated here so the shortfall is not hidden in a file the page does not
     render. */
  contextAllowed: sweep.allowedByContext,
  /* Carried so the page can be checked against the sweep it quotes. */
  sweptPages: sweep.sweptPages,
  recordedAt: sweep.recordedAt,
};
