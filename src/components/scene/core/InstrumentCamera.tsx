/**
 * The camera, driven by the reader's position in the movement.
 *
 * THERE IS NO ORBIT CONTROL AND THERE WILL NOT BE ONE. The camera is part of
 * the argument: it walks the bench in the order the training signal passes
 * through it. A reader who can spin the scene can end up behind a prism looking
 * at nothing, and the composition stops saying anything the moment that is
 * possible. The path itself is data, in `runtime/states.ts`, so it can be
 * reviewed and tested without a renderer.
 *
 * THE PARALLAX IS SMALL AND IT COMES FROM THE WINDOW, NOT FROM THE CANVAS. The
 * canvas is `pointer-events: none`, so React Three Fiber's own pointer state
 * never updates: it has nothing to hit-test against. The offset is read off a
 * window listener instead, which is also the only way it can work while the
 * pointer is over the prose, which is where the pointer is.
 *
 *   - It is off on coarse pointers. A finger dragging the page is not aiming a
 *     camera, and treating it as one makes the scene lurch while scrolling.
 *   - It is zero until the pointer moves. Gate 20 measures the beam axis and
 *     the dispersing element's centroid against the hand-authored room to 8px,
 *     and at this distance and field of view the full offset is worth about
 *     25px. A camera that had drifted before the first measurement would fail a
 *     fidelity gate for a reason nothing in the fidelity code could explain.
 *   - It never touches the target, only the eye, so the framing is unchanged
 *     and only the parallax between near and far parts moves.
 *
 * EXPOSURE IS NOT WRITTEN HERE, and `states.ts` says why in more detail: the
 * render pipeline authors it per theme against measured surface levels, all
 * five states declare 1.00, and a second writer would fight the `gl` prop that
 * React Three Fiber re-applies on every render.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { PerspectiveCamera, Vector3 } from "three";
import { readInstrumentFrame } from "./useInstrument";

/** World units of eye offset at the extreme of the viewport. */
const PARALLAX = 0.12;
/** Fraction of the remaining distance covered per frame. */
const PARALLAX_DAMPING = 0.06;

/**
 * THE ASPECT CORRECTION, and the defect it exists for.
 *
 * Every pose in `runtime/states.ts` is authored in world space against the
 * hand-authored room, which is composed at 1440x840. `InstrumentScene.tsx`
 * solves its default distance the same way and says so:
 *
 *     d * tan(fov/2) * aspect = 6
 *
 * That solve has an `aspect` in it and the authored number does not, so it is
 * only true at one viewport. A perspective camera fixed in world space keeps
 * its VERTICAL field and loses horizontal span as the frame narrows, so the
 * twelve world units of bench spanned about 3.3 units of visible width at 390
 * and 6.4 at 768. Measured, and visible in a screenshot: at 390 the hero drew
 * one mount and part of the prism, with the source, the detector and every
 * station the copy talks about outside the frame. The scene reported
 * `data-scene-ready="true"` and zero console errors the whole time, because
 * nothing was broken — it was aimed at a viewport nobody was using.
 *
 * So the distance is solved from the aspect actually in force. The authored
 * pose is kept exactly at the design aspect and wider, where the composition
 * was designed and where gate 20 measures it to 8px; below it the eye slides
 * back along its own view direction by the ratio, which is the unique distance
 * that restores the horizontal span. It never pulls IN on a wide frame: that
 * would crop a composition somebody placed by hand.
 *
 * AND IT IS CLAMPED, because the uncorrected fit is wrong in the other
 * direction. The full correction at 390 is 3.69, which does restore all twelve
 * units — as roughly thirty pixels per station, behind body copy, in a hero
 * that is mostly type at that width. Shot and looked at: it is not a small
 * instrument, it is a texture. Trading a fragment for a whisper is not a
 * repair.
 *
 * The clamp shows a legible DETAIL instead. At 2.0 a 390-wide frame spans about
 * 6.5 world units around the pose's target, which holds the dispersing element
 * at x = +1.44 and the beam through it: the part of the bench the hero's own
 * sentence is about. The source at -6 and the detector at +6 are outside it,
 * and that is the honest trade — a narrow frame gets one station properly
 * rather than seven illegibly. Every station is still reachable, in the
 * movement below, at a width where it can be read.
 */
const DESIGN_ASPECT = 1440 / 840;
/** The most the eye will slide back. See above: past this it is texture. */
const MAX_ASPECT_CORRECTION = 2.0;

export function InstrumentCamera() {
  const camera = useThree((s) => s.camera);
  const pointer = useRef({ x: 0, y: 0, active: false });
  /** The offset actually applied, which lags the wanted one. */
  const offset = useRef(new Vector3());
  const wanted = useRef(new Vector3());
  const eye = useRef(new Vector3());
  const target = useRef(new Vector3());

  useEffect(() => {
    const fine = window.matchMedia?.("(pointer: fine)").matches ?? false;
    if (!fine) return;
    const onMove = (event: PointerEvent) => {
      pointer.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (event.clientY / window.innerHeight) * 2 - 1;
      pointer.current.active = true;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  useFrame((state) => {
    const { camera: pose } = readInstrumentFrame();

    /*
      Two moves with two different laws, and keeping them separate is the whole
      trick. The pose is assigned outright, because a scrubbed value that eases
      lags the reader on the way back up. The parallax offset carries all of the
      history, because it answers a discrete input rather than a position, and
      an undamped parallax reads as a twitch.
    */
    wanted.current.set(
      pointer.current.active ? pointer.current.x * PARALLAX : 0,
      pointer.current.active ? -pointer.current.y * PARALLAX : 0,
      0,
    );
    offset.current.lerp(wanted.current, PARALLAX_DAMPING);

    eye.current.set(pose.position[0], pose.position[1], pose.position[2]);
    target.current.set(pose.target[0], pose.target[1], pose.target[2]);

    /* Slide the eye back along its own view direction when the frame is
       narrower than the room was composed for. `size` is the drawing buffer in
       CSS pixels, which is what the projection matrix is built from. */
    const { width, height } = state.size;
    if (height > 0) {
      const aspect = width / height;
      if (aspect < DESIGN_ASPECT) {
        const correction = Math.min(DESIGN_ASPECT / aspect, MAX_ASPECT_CORRECTION);
        eye.current.sub(target.current).multiplyScalar(correction).add(target.current);
      }
    }

    camera.position.copy(eye.current).add(offset.current);
    camera.lookAt(target.current);

    if (camera instanceof PerspectiveCamera && Math.abs(camera.fov - pose.fov) > 1e-4) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}
