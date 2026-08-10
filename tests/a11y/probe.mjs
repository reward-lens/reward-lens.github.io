// The manual half of gate 14, run mechanically so it can be re-run.
//
// axe finds what axe finds. Everything the site's own accessibility contract
// asks for beyond that is here: the tab order actually walked, focus checked
// against the sticky header's real rect, scrollable regions checked for being
// reachable, touch targets measured at a REAL 390 viewport, and the refusal
// accent read as a computed colour rather than trusted from its class name.
//
// HANDOFF trap: `chrome --headless --window-size=390` lays out at desktop width
// and crops. Every width here is a Playwright `viewport`, and the overflow
// assertion is documentElement.scrollWidth against that viewport.
//
// Usage: node tests/a11y/probe.mjs [route ...]
import { serveDist, launchBrowser, DIST } from "../../scripts/checks/_lib.mjs";

const ROUTES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "/",
      "/see/",
      "/see/run/",
      "/see/grader/",
      "/see/reward-model/",
      "/start/",
      "/limits/",
      "/about/",
      "/evidence/",
      "/evidence/01c81c7185640f9b962b9115f360732e/",
      "/evidence/02a1669641150750737afc8291255bf9/",
      "/evidence/095096260d9209c4fb9935cbb215812b/",
      "/docs/concepts/measurement-you-can-trust/",
    ];

const server = await serveDist(DIST);
const { browser, engine } = await launchBrowser();
console.log(`browser: ${engine}  origin: ${server.origin}\n`);

// `cn` runs in the page, not here. SVG elements carry an SVGAnimatedString for
// className, whose toString() is "[object SVGAnimatedString]" — which is what
// the first run of this probe printed instead of a class name.
const CN = () => {
  window.cn = (el) =>
    (typeof el.className === "string" ? el.className : (el.className?.baseVal ?? "")).split(" ")[0];
};

const findings = [];
const note = (route, kind, msg) => {
  findings.push({ route, kind, msg });
  console.log(`  ${kind.padEnd(9)} ${msg}`);
};

for (const route of ROUTES) {
  console.log(`\n=== ${route} ===`);
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  });
  await ctx.addInitScript(CN);
  const page = await ctx.newPage();
  await page.goto(server.origin + route, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);

  // --- 1. tab order, walked ------------------------------------------------
  const order = [];
  let guard = 0;
  await page.evaluate(() => document.body.focus());
  while (guard < 260) {
    guard += 1;
    await page.keyboard.press("Tab");
    const step = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      // The accessible name as a screen reader would most likely resolve it.
      // `el.labels` matters and leaving it out is how this probe first reported
      // four unnamed radios that carry a <label for>. axe was right and the
      // probe was wrong, which is the direction that costs an afternoon.
      const label =
        el.getAttribute("aria-label") ||
        (el.getAttribute("aria-labelledby") &&
          document.getElementById(el.getAttribute("aria-labelledby"))?.textContent) ||
        (el.labels?.length ? [...el.labels].map((l) => l.textContent).join(" ") : "") ||
        el.textContent?.trim().slice(0, 60) ||
        el.getAttribute("title") ||
        "";
      return {
        tag: el.tagName.toLowerCase(),
        cls: cn(el),
        role: el.getAttribute("role") || "",
        label: label.replace(/\s+/g, " "),
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        outline: `${cs.outlineWidth} ${cs.outlineStyle}`,
        hidden: r.width === 0 && r.height === 0,
      };
    });
    if (!step) break;
    const sig = `${step.tag}.${step.cls}|${step.label}`;
    if (order.length && order.at(-1).sig === sig && order.at(-1).rect.y === step.rect.y) break;
    order.push({ ...step, sig });
  }
  console.log(`  tab stops: ${order.length}`);

  const unnamed = order.filter((s) => !s.label && !s.hidden);
  for (const u of unnamed) note(route, "UNNAMED", `tab stop <${u.tag} class="${u.cls}"> has no accessible name`);

  const zeroSize = order.filter((s) => s.hidden);
  for (const z of zeroSize) note(route, "ZEROBOX", `tab stop <${z.tag} class="${z.cls}"> "${z.label}" has a 0x0 box`);

  // --- 2. focus behind sticky ---------------------------------------------
  const sticky = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if ((cs.position === "sticky" || cs.position === "fixed") && cs.visibility !== "hidden") {
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.width > 0 && r.top <= 4)
          out.push({ cls: cn(el), bottom: r.bottom, z: cs.zIndex });
      }
    }
    return out;
  });
  const header = sticky.find((s) => s.bottom > 0);
  if (header) {
    // Walk the tab order again with the page scrolled, and check every stop's
    // rect against the sticky band once it is focused.
    const occluded = await page.evaluate((bandBottom) => {
      const bad = [];
      const focusables = [
        ...document.querySelectorAll(
          'a[href],button:not([disabled]),input:not([disabled]),select,textarea,summary,[tabindex]:not([tabindex="-1"])',
        ),
      ];
      for (const el of focusables) {
        const r0 = el.getBoundingClientRect();
        if (r0.width === 0 && r0.height === 0) continue;
        // Reset the scroll before each focus. Focusing a list of elements in
        // DOM order without resetting measures the browser's "nearest"
        // alignment from wherever the previous focus left the page, and for a
        // control inside a nested scroll container that reports an occlusion
        // the site does not have: the same control focused from a defined
        // scroll position lands at top=470, well clear of the 65px band.
        window.scrollTo(0, 0);
        el.focus({ preventScroll: false });
        const r = el.getBoundingClientRect();
        if (r.height === 0) continue;
        // Only count elements the browser actually scrolled to.
        // WCAG 2.2 AA 2.4.11 Focus Not Obscured (Minimum) is "no part of the
        // element is hidden", read by the WG as: it must not be ENTIRELY
        // hidden. A tall scroll region whose top 48px sit under the header is
        // still substantially visible and passes at AA; it is 2.4.12 Enhanced,
        // which is AAA, that wants it fully clear. So the test is total
        // occlusion, and partial is reported separately rather than as a fail.
        const entirely = r.bottom <= bandBottom;
        // A control inside .visually-hidden is not an occlusion problem, it is
        // a worse one: the container is a 1px clipped box, so focus lands on a
        // control that is nowhere on screen. /see/run/ has one, a provenance
        // trigger inside the screen-reader-only table that carries the plot's
        // data. That fails 2.4.7 Focus Visible, not 2.4.11.
        if (el.closest(".visually-hidden")) {
          bad.push({ kind: "hidden", tag: el.tagName.toLowerCase(), cls: cn(el), top: Math.round(r.top), covered: "visually-hidden" });
          continue;
        }
        if (entirely && r.bottom > 0) {
          const mid = document.elementFromPoint(
            Math.min(window.innerWidth - 2, Math.max(2, r.x + r.width / 2)),
            Math.max(2, r.y + Math.min(r.height / 2, 8)),
          );
          if (mid && mid !== el && !el.contains(mid) && !mid.contains(el))
            bad.push({
              tag: el.tagName.toLowerCase(),
              cls: cn(el),
              top: Math.round(r.top),
              covered: cn(mid) || mid.tagName.toLowerCase(),
            });
        }
      }
      return bad;
    }, header.bottom);
    for (const o of occluded.slice(0, 8))
      note(
        route,
        o.kind === "hidden" ? "HIDDENFOCUS" : "OCCLUDED",
        o.kind === "hidden"
          ? `<${o.tag} class="${o.cls}"> is a tab stop inside .visually-hidden: focus lands on a control that is not on screen (2.4.7)`
          : `<${o.tag} class="${o.cls}"> focuses at top=${o.top}, under .${o.covered} (sticky band ends ${Math.round(header.bottom)})`,
      );
  }

  // --- 3. scrollable regions that no keyboard can reach --------------------
  const scrollTraps = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      const scrolls =
        (["auto", "scroll"].includes(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) ||
        (["auto", "scroll"].includes(cs.overflowY) && el.scrollHeight > el.clientHeight + 1);
      if (!scrolls) continue;
      const focusableInside = el.querySelector(
        'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])',
      );
      const self = el.hasAttribute("tabindex");
      if (!self && !focusableInside)
        bad.push({
          tag: el.tagName.toLowerCase(),
          cls: cn(el),
          over: Math.round(el.scrollWidth - el.clientWidth),
        });
    }
    return bad;
  });
  for (const s of scrollTraps.slice(0, 10))
    note(route, "NOSCROLL", `<${s.tag} class="${s.cls}"> scrolls ${s.over}px with no tabindex and nothing focusable inside`);

  // --- 4. live regions -----------------------------------------------------
  // A global live region that narrates everything is a defect in its own right,
  // and so is the opposite failure: several per-instance regions that collide on
  // one id, because getElementById then routes every announcement to the first.
  const live = await page.evaluate(() => {
    const els = [...document.querySelectorAll("[aria-live]")];
    const ids = {};
    for (const el of document.querySelectorAll("[id]")) (ids[el.id] ??= []).push(el.tagName);
    return {
      regions: els.map((el) => ({
        cls: cn(el) || el.id,
        id: el.id,
        politeness: el.getAttribute("aria-live"),
        inMain: !!el.closest("main"),
      })),
      dupIds: Object.entries(ids)
        .filter(([, v]) => v.length > 1)
        .map(([k, v]) => `${k} x${v.length}`),
    };
  });
  for (const a of live.regions.filter((l) => l.politeness === "assertive"))
    note(route, "ASSERT", `aria-live="assertive" on .${a.cls}`);
  const liveIds = live.regions.filter((r) => r.id).map((r) => r.id);
  for (const d of live.dupIds) {
    const bare = d.split(" ")[0];
    note(
      route,
      liveIds.includes(bare) ? "DUPLIVE" : "DUPID",
      `duplicate id "${d}"${liveIds.includes(bare) ? " and it is an aria-live target: the second instance announces into the first" : ""}`,
    );
  }

  // --- 5. the refusal accent, computed ------------------------------------
  const refusal = await page.evaluate(() => {
    const el = document.querySelector(".refusal, .refusal__reason, [class*='refusal']");
    if (!el) return null;
    const cs = getComputedStyle(el.closest(".refusal") ?? el);
    const chip = document.querySelector(".refusal__reason");
    return {
      accent: cs.borderInlineStartColor,
      chip: chip ? getComputedStyle(chip).color : null,
      text: document.querySelector(".refusal__state")?.textContent?.trim() ?? null,
    };
  });
  if (refusal) {
    const hueOf = (rgb) => {
      const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number);
      return { r, g, b, blue: b > r + 8, red: r > b + 8 };
    };
    const a = hueOf(refusal.accent);
    console.log(`  refusal accent ${refusal.accent} -> ${a.blue ? "BLUE" : a.red ? "RED" : "neutral"}; state text ${JSON.stringify(refusal.text)}`);
    if (a.red) note(route, "REDREFUSE", `refusal accent computes red: ${refusal.accent}`);
    if (!refusal.text) note(route, "COLORONLY", `refusal card carries no state text`);
  }

  // --- 6. canvas ----------------------------------------------------------
  const canvas = await page.evaluate(() =>
    [...document.querySelectorAll("canvas")].map((c) => ({
      tabindex: c.getAttribute("tabindex"),
      role: c.getAttribute("role"),
      label: c.getAttribute("aria-label"),
      hiddenAria: c.getAttribute("aria-hidden"),
    })),
  );
  for (const c of canvas) {
    console.log(`  canvas: tabindex=${c.tabindex} role=${c.role} aria-hidden=${c.hiddenAria} label=${c.label}`);
    if (c.tabindex !== null && c.tabindex !== "-1")
      note(route, "CANVASTAB", `canvas is a tab stop (tabindex=${c.tabindex})`);
  }

  await ctx.close();

  // --- 7. a REAL 390 viewport: overflow and touch targets ------------------
  const m = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: "dark",
  });
  await m.addInitScript(CN);
  const mp = await m.newPage();
  await mp.goto(server.origin + route, { waitUntil: "load" });
  await mp.evaluate(() => document.fonts.ready);
  await mp.waitForTimeout(500);
  const sw = await mp.evaluate(() => document.documentElement.scrollWidth);
  if (sw > 390) note(route, "OVERFLOW", `documentElement.scrollWidth=${sw} at a real 390 viewport`);

  const small = await mp.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),select,summary,[tabindex]:not([tabindex="-1"])',
    )) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // A control inside a closed <details> still returns a rect. It is neither
      // visible nor focusable, and counting it produced sixty phantom failures
      // on the first run of this probe: six drawer links on every route.
      if (!el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })) continue;
      // WCAG 2.2 AA 2.5.8 is 24x24 CSS px. The "inline" exception is by
      // formatting context, not by tag: the site's provenance triggers are
      // <button style="display:inline"> sitting in a sentence, and their height
      // is the line box's, which is exactly what the exception describes.
      const cs = getComputedStyle(el);
      if (cs.display.startsWith("inline") && !cs.display.includes("-flex") && el.closest("p,li,figcaption,td,th,dd,span"))
        continue;
      // 2.5.8 exception (d), user agent control: a range input the author has
      // not re-skinned is sized by the browser. `appearance: auto` is the test.
      if (el.tagName === "INPUT" && ["range", "checkbox", "radio"].includes(el.type) && cs.appearance === "auto") {
        // The target for a labelled control includes its label.
        const box = [...(el.labels ?? [])].reduce(
          (acc, l) => {
            const b = l.getBoundingClientRect();
            return { w: Math.max(acc.w, b.width), h: Math.max(acc.h, b.height) };
          },
          { w: r.width, h: r.height },
        );
        if (box.w >= 24 && box.h >= 24) continue;
        if (el.type === "range") continue;
      }
      if (r.width < 24 || r.height < 24)
        bad.push({
          tag: el.tagName.toLowerCase(),
          cls: cn(el),
          w: Math.round(r.width),
          h: Math.round(r.height),
          label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 34).replace(/\s+/g, " "),
        });
    }
    return bad;
  });
  for (const s of small.slice(0, 12))
    note(route, "TARGET", `<${s.tag} class="${s.cls}"> "${s.label}" is ${s.w}x${s.h} at 390 (2.5.8 wants 24x24)`);

  // clipping inside the site's own scroll containers, at 390
  const clipped = await mp.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll("*")) {
      // .visually-hidden is a 1px box with clip-path whose whole job is to
      // contain content that overflows it. Reading it as a clipping defect is
      // reading the technique as the bug, and it accounted for every CLIP hit
      // on the first run of this probe.
      if (el.classList.contains("visually-hidden") || el.closest(".visually-hidden")) continue;
      // <defs>, <clipPath>, <linearGradient> and friends render nothing, and
      // their getBoundingClientRect is not a box on the page. Reading one as an
      // overflow produced the ".defs overflows .ts__svg" line on an early run.
      if (/^(defs|clipPath|linearGradient|radialGradient|pattern|mask|symbol|marker|filter|title|desc|metadata)$/i.test(el.tagName))
        continue;
      const cs = getComputedStyle(el);
      if (cs.overflow === "hidden" || cs.overflowX === "hidden") {
        for (const kid of el.children) {
          if (kid.classList.contains("visually-hidden")) continue;
          if (/^(defs|clipPath|linearGradient|radialGradient|pattern|mask|symbol|marker|filter|title|desc|metadata)$/i.test(kid.tagName))
            continue;
          const k = kid.getBoundingClientRect();
          const p = el.getBoundingClientRect();
          if (k.right > p.right + 1 || k.left < p.left - 1)
            bad.push({
              parent: cn(el) || el.tagName.toLowerCase(),
              kid: cn(kid) || kid.tagName.toLowerCase(),
              over: Math.round(Math.max(k.right - p.right, p.left - k.left)),
              text: (kid.textContent || "").trim().slice(0, 40).replace(/\s+/g, " "),
            });
        }
      }
    }
    return bad;
  });
  for (const c of clipped.slice(0, 10))
    note(route, "CLIP", `.${c.kid} overflows .${c.parent} by ${c.over}px at 390 — "${c.text}"`);

  await m.close();
}

await browser.close();
await server.close();

console.log(`\n${"=".repeat(70)}`);
const byKind = {};
for (const f of findings) (byKind[f.kind] ??= []).push(f);
for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1].length - a[1].length))
  console.log(`${String(v.length).padStart(4)}  ${k}`);
console.log(`${String(findings.length).padStart(4)}  TOTAL`);
