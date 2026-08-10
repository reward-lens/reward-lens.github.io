/**
 * The last thing that happens to a pixel: one bit of noise, so the dark
 * gradients quantize without stepping.
 *
 * WHY A DARK SCENE NEEDS THIS AND A BRIGHT ONE DOES NOT. The floor's pool of
 * light falls from about 60/255 to about 8/255 across roughly 300 pixels. That
 * is 52 available codes over 300 pixels, so a smooth ramp has to hold each code
 * for six pixels and then step. The step is a hard edge with a fixed shape, and
 * the eye finds fixed shapes: it reads as contour banding, which is the single
 * most reliable signal that an image was rendered rather than photographed. The
 * fix is not more bits at the end, which the display does not have. It is to
 * make the quantization error random instead of correlated, by adding noise
 * smaller than one code before rounding. The ramp then dithers between the two
 * neighbouring codes at a ratio that carries the sub-code value, and averages
 * correctly to the eye.
 *
 * WHERE IT HAS TO SIT, AND THIS IS NOT NEGOTIABLE. Immediately before
 * quantization, in the display-encoded space. Dithering in the linear HDR
 * buffer would be scaled by the tone curve afterwards, and AgX compresses the
 * shadows hard, so exactly the region that bands would have its dither
 * compressed away. So this runs after `OutputPass`, on values already in sRGB,
 * and it is the pass that renders to the screen.
 *
 * `Material.dithering` is three's own version of this and it is set on the
 * scene's materials as well, because the low tier has no composer and its only
 * chance to dither is inside the shading pass. Where both exist the composer
 * path is the one that matters: the material flag dithers into a half-float
 * buffer, which quantizes at 11 bits of mantissa and therefore does nothing.
 *
 * WHY THE NOISE IS DETERMINISTIC. No time uniform, no random seed: the value at
 * a pixel depends only on its coordinates. Animated grain is the more common
 * choice and it looks slightly better in motion, but this site gates on
 * screenshot comparison, and grain that changes every frame makes every visual
 * diff a noise measurement. A still frame is also the deliverable here.
 *
 * The distribution is triangular rather than uniform, which is the standard
 * result from audio dither: the difference of two independent uniform variables
 * removes the dependence of the quantization noise's variance on the signal, so
 * the residual noise is flat rather than pumping with the gradient. It costs one
 * extra hash.
 */
import { Vector2 } from "three";

/**
 * Interleaved gradient noise. Three constants and a `fract`, which is why it is
 * the hash used for this everywhere: it is cheaper than any texture fetch and
 * its spectrum is close enough to blue that the pattern does not resolve into
 * visible structure at one code of amplitude.
 */
const IGN = /* glsl */ `
  float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
  }
`;

export const DitherShader = {
  name: "DitherShader",

  uniforms: {
    tDiffuse: { value: null as unknown },
    /** Amplitude in codes of an 8-bit channel. 1.0 is the textbook value. */
    amount: { value: 1.0 },
    /** Only for the measurement tool, which needs an exact A/B. */
    resolution: { value: new Vector2(1, 1) },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float amount;
    varying vec2 vUv;
    ${IGN}
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // Two decorrelated draws at the same pixel. Their difference is
      // triangular on (-1, 1) with zero mean, so this cannot shift the image.
      float n = ign(gl_FragCoord.xy) - ign(gl_FragCoord.xy + vec2(17.0, 41.0));
      // Alpha is left alone. The canvas composites over the document and a
      // dithered alpha would put noise into the edge of the room.
      gl_FragColor = vec4(c.rgb + n * (amount / 255.0), c.a);
    }
  `,
};
