/**
 * Mounts the post chain and drives it.
 *
 * The chain itself is in `chain.ts` and has no React in it. This file exists to
 * own three things that are genuinely React's problem: rebuilding when the tier
 * or the theme changes, resizing when the canvas does, and taking the render
 * loop away from the library.
 */
import { useEffect, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { buildPostChain, hasPostChain, type PostChain as PostChainApi } from "./chain";
import type { SceneTier } from "../runtime/tier";

export { hasPostChain };

interface Props {
  tier: SceneTier;
  theme: "dark" | "light";
  /** Handed up so the measurement handle can toggle individual passes. */
  onChain: (chain: PostChainApi | null) => void;
}

export function PostChain({ tier, theme, onChain }: Props) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  const [chain, setChain] = useState<PostChainApi | null>(null);

  /**
   * Built in an effect rather than a memo, because it allocates render targets
   * and a memo can be thrown away and recomputed without its cleanup running,
   * which would leak several megabytes of GPU memory per discarded render.
   *
   * The size is deliberately not a dependency: rebuilding the whole chain on
   * every resize frame would recompile shaders while the reader drags a window.
   * Resizing is handled separately below, which is what `setSize` is for.
   */
  useEffect(() => {
    if (!hasPostChain(tier)) {
      setChain(null);
      onChain(null);
      return;
    }

    const built = buildPostChain({
      renderer: gl,
      scene,
      camera,
      tier,
      theme,
      width: size.width,
      height: size.height,
    });

    setChain(built);
    onChain(built);

    return () => {
      built.dispose();
      setChain(null);
      onChain(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera, tier, theme, onChain]);

  useEffect(() => {
    chain?.setSize(size.width, size.height);
  }, [chain, size.width, size.height]);

  /**
   * Priority 1, which is what takes rendering away from React Three Fiber.
   * Confirmed in the installed source rather than from memory: fiber's
   * `subscribe` does `internal.priority + (priority > 0 ? 1 : 0)` and skips its
   * own `gl.render` for as long as that count is positive. At priority 0 the
   * scene would be drawn twice a frame, the composer's result second, which
   * looks entirely correct and costs double.
   *
   * The hook is called unconditionally, because hooks cannot be conditional, and
   * falls through to the library's own render when there is no chain.
   */
  useFrame(({ gl: renderer, scene: s, camera: c }) => {
    if (chain) chain.render();
    else renderer.render(s, c);
  }, 1);

  return null;
}
