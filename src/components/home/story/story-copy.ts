/**
 * The five states of the instrument story, read from copy.yaml once.
 *
 * WHY THIS FILE EXISTS. Two things have to agree and are written in different
 * places: the copy keys under `home.story` and the state ids the scene binds
 * to, which are frozen in `src/components/scene/types/truth.ts` as
 * `INSTRUMENT_STATES`. The fifth is `run-boundary` in the scene and `run` in
 * copy.yaml. Pairing them here, once, means the narrative column and the scene
 * cannot come apart, and a copy key that goes missing fails the build with the
 * key named rather than rendering an empty article.
 *
 * Nothing here writes a string. Every field is read from design/copy.yaml.
 */
import { copy } from "../../../copy";
import { INSTRUMENT_STATES } from "@components/scene/types/truth";
import type { InstrumentStateId } from "@components/scene/types/truth";

/** One state's copy, as copy.yaml carries it. */
interface StateCopy {
  kicker: string;
  heading: string;
  body_1: string;
  body_2?: string;
  /** Present on `update` and `run` only. */
  caveat?: string;
}

interface StorySection {
  section_label: string;
  section_headline: string;
  [key: string]: unknown;
}

/**
 * The scene's state id against the copy key that carries its words. The scene
 * calls the fifth state `run-boundary`; copy.yaml calls it `run`. Neither is
 * renamed here: the pairing is stated instead, because renaming one of them
 * would put the site's vocabulary and the frozen contract out of step.
 */
const COPY_KEY: Record<InstrumentStateId, string> = {
  scorer: "scorer",
  selection: "selection",
  update: "update",
  response: "response",
  "run-boundary": "run",
};

export interface InstrumentState extends StateCopy {
  /** The frozen scene id. Rendered as `data-instrument-state`. */
  id: InstrumentStateId;
  /** The copy.yaml key this state's words came from. */
  copyKey: string;
}

const home = copy.home as Record<string, unknown>;
const story = home?.story as StorySection | undefined;

if (!story) {
  throw new Error(
    "home story: copy.yaml:home.story is missing, so the five narrative states " +
      "have no words. Every heading, paragraph and caveat on this movement comes " +
      "from that block. design/copy.yaml is the build lead's.",
  );
}

export const sectionLabel = story.section_label;
export const sectionHeadline = story.section_headline;

export const states: InstrumentState[] = INSTRUMENT_STATES.map((id) => {
  const copyKey = COPY_KEY[id];
  const block = story[copyKey] as StateCopy | undefined;
  if (!block?.heading || !block?.body_1) {
    throw new Error(
      `home story: copy.yaml:home.story.${copyKey} is missing its heading or its ` +
        `first paragraph, and scene state "${id}" binds to it. The five states are ` +
        `frozen in src/components/scene/types/truth.ts; the words are in ` +
        `design/copy.yaml, which is the build lead's.`,
    );
  }
  return { id, copyKey, ...block };
});
