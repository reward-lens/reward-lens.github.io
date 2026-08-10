/**
 * The page-side instrument, injected before any page script runs.
 *
 * WHY IT IS AN INJECTION AND NOT A SOURCE CHANGE. Every file under
 * src/components/scene/** is reserved to two live scene packets, and the
 * quantities this packet has to report (draw calls, triangles, texture bytes,
 * WebGL context count) are all readable by wrapping the WebGL entry points
 * rather than by asking the renderer. So the scene is measured exactly as it
 * ships, with no instrumentation compiled into it and nothing for a later merge
 * to collide with.
 *
 * WHAT IT COUNTS, AND WHY THOSE ARE THE TRUSTWORTHY ONES. This host has no GPU
 * available to headless Chrome, so every TIMING taken here is a software
 * rasteriser's timing and means nothing about a device. Counts and byte
 * accounting are not timings: a draw call is a draw call and a 384x512 RGBA16F
 * texture is 1.5 MB whether SwiftShader or an RTX 4060 consumes it. That is the
 * line this file is built along, and `softwareRasteriser` below is what lets the
 * report state which side of it a number falls on instead of guessing.
 *
 * The counters are read per-frame-window rather than cumulatively: `reset()`
 * zeroes them, and the caller reads back after a known number of frames, so a
 * "draw calls" figure is per frame and not per session.
 */

export const INSTRUMENT = `(() => {
  const S = {
    drawCalls: 0,
    triangles: 0,
    points: 0,
    lines: 0,
    frames: 0,
    contexts: [],
    textureBytes: 0,
    renderbufferBytes: 0,
    bufferBytes: 0,
    textures: [],
    renderbuffers: [],
    rafActive: 0,
    programs: 0,
    shaderCompileMs: 0,
    linkMs: 0,
  };
  window.__perf = S;

  // --- how many contexts, and is this a real GPU -----------------------------
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    const ctx = getContext.call(this, type, attrs);
    if (ctx && /webgl/i.test(String(type))) {
      let renderer = "unknown";
      let vendor = "unknown";
      try {
        const ext = ctx.getExtension("WEBGL_debug_renderer_info");
        if (ext) {
          renderer = ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL);
          vendor = ctx.getParameter(ext.UNMASKED_VENDOR_WEBGL);
        } else {
          renderer = ctx.getParameter(ctx.RENDERER);
          vendor = ctx.getParameter(ctx.VENDOR);
        }
      } catch (e) {}
      // CREATED is not LIVE. runtime/tier.ts creates a context purely to ask
      // whether WebGL exists and calls loseContext() straight after, on purpose,
      // because browsers cap contexts per document. Counting creations would
      // report two contexts on a page that holds one, so the context object is
      // kept and its liveness read back at measurement time instead.
      S.contexts.push({
        type: String(type),
        renderer: String(renderer),
        vendor: String(vendor),
        antialias: !!(attrs && attrs.antialias),
        // A drawing buffer larger than the CSS box by more than the device
        // pixel ratio is a pixel-ratio bug, and it is invisible in a screenshot
        // because the result still looks right.
        width: ctx.drawingBufferWidth,
        height: ctx.drawingBufferHeight,
        _ctx: ctx,
      });
    }
    return ctx;
  };

  // --- draw calls and primitives --------------------------------------------
  // Both prototypes, because three picks WebGL2 where it can and WebGL1
  // otherwise, and instrumenting only one silently reports zero on the other.
  const protos = [];
  if (window.WebGLRenderingContext) protos.push(WebGLRenderingContext.prototype);
  if (window.WebGL2RenderingContext) protos.push(WebGL2RenderingContext.prototype);

  const prims = (gl, mode, count, instances) => {
    const n = instances || 1;
    if (mode === gl.TRIANGLES) S.triangles += (count / 3) * n;
    else if (mode === gl.TRIANGLE_STRIP || mode === gl.TRIANGLE_FAN) S.triangles += Math.max(0, count - 2) * n;
    else if (mode === gl.POINTS) S.points += count * n;
    else if (mode === gl.LINES) S.lines += (count / 2) * n;
    else if (mode === gl.LINE_STRIP) S.lines += Math.max(0, count - 1) * n;
    else if (mode === gl.LINE_LOOP) S.lines += count * n;
  };

  for (const P of protos) {
    for (const name of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"]) {
      const orig = P[name];
      if (typeof orig !== "function") continue;
      P[name] = function (...args) {
        S.drawCalls += 1;
        try {
          if (name === "drawElements") prims(this, args[0], args[1], 1);
          else if (name === "drawArrays") prims(this, args[0], args[2], 1);
          else if (name === "drawElementsInstanced") prims(this, args[0], args[1], args[4]);
          else if (name === "drawArraysInstanced") prims(this, args[0], args[2], args[3]);
        } catch (e) {}
        return orig.apply(this, args);
      };
    }

    // --- GPU memory, accounted rather than guessed --------------------------
    // Bytes per texel by internal format. Only the formats this scene actually
    // allocates are listed; anything else lands in unknownFormats so the
    // total is never quietly wrong by an unlisted format.
    const BPP = {
      6407: 3, 6408: 4,          // RGB, RGBA (unsized, UNSIGNED_BYTE)
      32849: 4, 32856: 4,        // RGB8, RGBA8
      35907: 4,                  // SRGB8_ALPHA8
      34842: 8, 34836: 16,       // RGBA16F, RGBA32F
      34843: 6, 34837: 12,       // RGB16F, RGB32F
      33189: 2, 33190: 3, 33191: 4, // DEPTH_COMPONENT16/24/32F
      35056: 4, 36012: 4,        // DEPTH24_STENCIL8, DEPTH_COMPONENT32F
      33321: 1, 33323: 2,        // R8, RG8
      33325: 2, 33327: 4,        // R16F, RG16F
      36208: 4, 36214: 4,        // RGBA16UI etc (approximate, flagged)
    };
    S.unknownFormats = S.unknownFormats || [];
    const texBytes = (internalFormat, w, h) => {
      const bpp = BPP[internalFormat];
      if (bpp === undefined) {
        if (!S.unknownFormats.includes(internalFormat)) S.unknownFormats.push(internalFormat);
        return w * h * 4; // charged at 4 bytes and flagged, never silently zero
      }
      return w * h * bpp;
    };

    const texImage2D = P.texImage2D;
    if (typeof texImage2D === "function") {
      P.texImage2D = function (...a) {
        try {
          // (target, level, internalformat, width, height, border, ...) is the
          // 9/10-argument form; the 6-argument form takes a DOM source whose
          // size is on the source object.
          if (a.length >= 8 && typeof a[3] === "number" && typeof a[4] === "number") {
            if (a[1] === 0) {
              const b = texBytes(a[2], a[3], a[4]);
              S.textureBytes += b;
              S.textures.push({ w: a[3], h: a[4], format: a[2], bytes: b, mip: a[1] });
            }
          } else if (a.length === 6 && a[5] && a[1] === 0) {
            const src = a[5];
            const w = src.width || src.videoWidth || src.naturalWidth || 0;
            const h = src.height || src.videoHeight || src.naturalHeight || 0;
            if (w && h) {
              const b = texBytes(a[2], w, h);
              S.textureBytes += b;
              S.textures.push({ w, h, format: a[2], bytes: b, mip: a[1], fromDom: true });
            }
          }
        } catch (e) {}
        return texImage2D.apply(this, a);
      };
    }

    const texStorage2D = P.texStorage2D;
    if (typeof texStorage2D === "function") {
      P.texStorage2D = function (target, levels, internalFormat, w, h) {
        try {
          // texStorage2D allocates every level at once, so the mip chain is
          // part of the allocation and charging only level 0 undercounts by a
          // third on a full chain.
          let b = 0;
          for (let i = 0; i < levels; i += 1) {
            b += texBytes(internalFormat, Math.max(1, w >> i), Math.max(1, h >> i));
          }
          S.textureBytes += b;
          S.textures.push({ w, h, format: internalFormat, bytes: b, levels, storage: true });
        } catch (e) {}
        return texStorage2D.call(this, target, levels, internalFormat, w, h);
      };
    }

    const rbStorage = P.renderbufferStorage;
    if (typeof rbStorage === "function") {
      P.renderbufferStorage = function (target, internalFormat, w, h) {
        try {
          const b = texBytes(internalFormat, w, h);
          S.renderbufferBytes += b;
          S.renderbuffers.push({ w, h, format: internalFormat, bytes: b });
        } catch (e) {}
        return rbStorage.call(this, target, internalFormat, w, h);
      };
    }
    const rbStorageMS = P.renderbufferStorageMultisample;
    if (typeof rbStorageMS === "function") {
      P.renderbufferStorageMultisample = function (target, samples, internalFormat, w, h) {
        try {
          const b = texBytes(internalFormat, w, h) * Math.max(1, samples);
          S.renderbufferBytes += b;
          S.renderbuffers.push({ w, h, format: internalFormat, bytes: b, samples });
        } catch (e) {}
        return rbStorageMS.call(this, target, samples, internalFormat, w, h);
      };
    }

    const bufferData = P.bufferData;
    if (typeof bufferData === "function") {
      P.bufferData = function (...a) {
        try {
          const src = a[1];
          if (typeof src === "number") S.bufferBytes += src;
          else if (src && typeof src.byteLength === "number") S.bufferBytes += src.byteLength;
        } catch (e) {}
        return bufferData.apply(this, a);
      };
    }
  }

  // --- frames, so a per-frame figure is per frame ----------------------------
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    S.rafActive += 1;
    return raf((t) => {
      S.frames += 1;
      cb(t);
    });
  };

  /**
   * Contexts, split into created and still-live. The WebGL objects themselves
   * cannot cross the CDP boundary, so this returns a plain summary.
   */
  window.__perfContexts = () =>
    S.contexts.map((c) => {
      let lost = null;
      try { lost = c._ctx.isContextLost(); } catch (e) { lost = null; }
      let w = c.width, h = c.height;
      try { w = c._ctx.drawingBufferWidth; h = c._ctx.drawingBufferHeight; } catch (e) {}
      return {
        type: c.type, renderer: c.renderer, vendor: c.vendor,
        antialias: c.antialias, lost, width: w, height: h,
        widthAtCreation: c.width, heightAtCreation: c.height,
      };
    });

  window.__perfReset = () => {
    S.drawCalls = 0; S.triangles = 0; S.points = 0; S.lines = 0; S.frames = 0;
  };
  window.__perfMemReset = () => {
    S.textureBytes = 0; S.renderbufferBytes = 0; S.bufferBytes = 0;
    S.textures.length = 0; S.renderbuffers.length = 0;
  };
})()`;

/** SwiftShader and llvmpipe are software; anything else is a real adapter. */
export const isSoftware = (renderer) =>
  /swiftshader|llvmpipe|software|mesa offscreen|microsoft basic/i.test(String(renderer || ""));
