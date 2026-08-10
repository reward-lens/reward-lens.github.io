import React from "react";
import { AbsoluteFill, Composition, Sequence, interpolate, useCurrentFrame } from "remotion";

import "./theme.css";
import manifest from "../manim/out/manifest.json";
import filmCopy from "../out/copy.json";
import { run } from "./lib/data";
import { buildTimeline, captionTrack, FPS } from "./lib/timeline.mjs";
import { Insert, SHOT_COMPONENTS } from "./Shots";
import {
  FIGURE_HEIGHT,
  FIGURE_WIDTH,
  GraderFigureFilm,
  GRADER_FIGURE_FRAMES,
  RewardModelFigureFilm,
  REWARD_FIGURE_FRAMES,
  RunFigureFilm,
  RUN_FIGURE_FRAMES,
  RUN_FIGURE_HEIGHT,
  RUN_FIGURE_WIDTH,
} from "./Figures";
import { useStage } from "./lib/stage";

const timeline = buildTimeline(run, manifest, filmCopy);
const cues = captionTrack(timeline);

/**
 * The caption track, burned. scripts/render.mjs writes the same cue list to
 * .vtt from the same function, so the two cannot drift.
 *
 * It sits on the ground, in --ink, at the site's own body-small role. No scrim,
 * no drop shadow, no outline: the shots leave the band empty on purpose.
 */
const Captions: React.FC = () => {
  const stage = useStage();
  const frame = useCurrentFrame();
  const cue = cues.find((c) => frame >= c.from && frame < c.until);
  if (!cue) return null;
  const fade = interpolate(frame, [cue.from, cue.from + 6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div className="caption" style={{ top: stage.captionTop, opacity: fade }}>
      <span className="type-body-sm" style={{ maxWidth: "var(--measure-caption)" }}>
        {cue.text}
      </span>
    </div>
  );
};

export const Film: React.FC = () => (
  <AbsoluteFill className="film">
    {timeline.shots.map((shot) => {
      const Shot = shot.kind === "insert" ? null : SHOT_COMPONENTS[shot.kind];
      return (
        <Sequence key={shot.id} from={shot.from} durationInFrames={shot.frames} name={shot.id}>
          {shot.kind === "insert" ? (
            <Insert formats={manifest[shot.insert as "insertA" | "insertB"].formats} />
          ) : Shot ? (
            <Shot />
          ) : null}
        </Sequence>
      );
    })}
    <Captions />
  </AbsoluteFill>
);

export const RemotionRoot: React.FC = () => (
  <>
    {/* Each format is laid out at half its output size and rendered at scale 2,
        so the site's 17px body is the film's 17px body. See theme.css. */}
    <Composition
      id="film-wide"
      component={Film}
      durationInFrames={timeline.frames}
      fps={FPS}
      width={960}
      height={540}
    />
    <Composition
      id="film-square"
      component={Film}
      durationInFrames={timeline.frames}
      fps={FPS}
      width={540}
      height={540}
    />
    <Composition
      id="film-tall"
      component={Film}
      durationInFrames={timeline.frames}
      fps={FPS}
      width={540}
      height={960}
    />
    {/* The three figure films. Same frame for all three, because a reader meets
        them as a set in the same component on three act pages. */}
    <Composition
      id="figure-run"
      component={RunFigureFilm}
      durationInFrames={RUN_FIGURE_FRAMES}
      fps={FPS}
      width={RUN_FIGURE_WIDTH}
      height={RUN_FIGURE_HEIGHT}
    />
    <Composition
      id="figure-reward-model"
      component={RewardModelFigureFilm}
      durationInFrames={REWARD_FIGURE_FRAMES}
      fps={FPS}
      width={FIGURE_WIDTH}
      height={FIGURE_HEIGHT}
    />
    <Composition
      id="figure-grader"
      component={GraderFigureFilm}
      durationInFrames={GRADER_FIGURE_FRAMES}
      fps={FPS}
      width={FIGURE_WIDTH}
      height={FIGURE_HEIGHT}
    />
  </>
);
