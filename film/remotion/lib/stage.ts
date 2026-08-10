import { useVideoConfig } from "remotion";

export type FormatKind = "wide" | "square" | "tall";

export type Stage = {
  kind: FormatKind;
  width: number;
  height: number;
  /** The drawing area, above the caption band. */
  top: number;
  left: number;
  right: number;
  bottom: number;
  cx: number;
  cy: number;
  captionTop: number;
  /** Traces run along the long axis. Shot 7 is horizontal at 16:9, vertical at 9:16. */
  vertical: boolean;
};

/**
 * Each format is composed rather than cropped, so every shot asks the stage what
 * shape it is in and lays itself out. The one rule that survives all three: the
 * caption band owns the bottom of the frame and no shot draws into it.
 */
export const useStage = (): Stage => {
  const { width, height } = useVideoConfig();
  const kind: FormatKind = width > height ? "wide" : width === height ? "square" : "tall";
  const pad = kind === "wide" ? 56 : 40;
  const captionBand = kind === "tall" ? 132 : kind === "square" ? 104 : 92;
  const top = pad;
  const bottom = height - captionBand;
  return {
    kind,
    width,
    height,
    top,
    left: pad,
    right: width - pad,
    bottom,
    cx: width / 2,
    cy: (top + bottom) / 2,
    captionTop: bottom + (kind === "wide" ? 16 : 20),
    vertical: kind === "tall",
  };
};
