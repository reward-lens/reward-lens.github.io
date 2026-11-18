# Pocket lab generator

The homepage hero's room and its moving instruments are built here from Python, in Blender 4.5, and then optimised for the web by `scripts/lab-hero/assets.mjs`. Nothing in this folder is hand-modelled: change a number, rebuild, and the room, its baked occlusion and the anchors the runtime reads all move together.

## Layout of the folder

- `source/layout.py` holds every shared dimension: plinth, wall, gallery, stair path, bench, gantry, optical axis, furniture spots. Run `python3 source/layout.py` to check that the big volumes clear each other (it prints `problems: none`).
- `source/lib.py` is the modelling kit (bmesh builders, materials, AO bake, preview renders, glTF export). Blender metres, Z up, the room faces -Y; Blender (x, y, z) exports as glTF (x, z, -y).
- `source/arch.py` (plinth, wall, gallery, stair, railings), `dressing.py` (display cases, gallery counter, door, print, shelves), `instruments.py` (bench, cabinets, static optics), `gantry.py` (portal frame), `furniture.py`, `plants.py` and `smallprops.py` build the static room. `build_room.py` assembles it.
- `source/build_rig.py` builds the articulated mechanism (carriage, microscope, source, specimen selector, detector) with the node names the runtime animates.
- `source/textures.py` draws the texture set into `textures/` (deterministic; numpy, scipy and Pillow).
- `source/_demo_*.py` render close-ups of one module for review.
- `tools/` holds review helpers: `runtime-shots.mjs` and `shots-viewport.mjs` screenshot the live hero, `glb-bytes.mjs`, `glb-tris.mjs` and `tris-by-material.mjs` break down a GLB, `load-marks.mjs` and `time-to-live.mjs` time a cold load, and `perf-scroll.mjs` times every rendered frame on the GPU while it idles, follows the pointer and scrolls (see below).
- `raw/`, `optimized/` and `previews/` are build output and are not committed.

## Rebuilding

From this folder, with `B` pointing at a Blender 4.5 binary:

```bash
python3 source/textures.py
```

```bash
$B --background --factory-startup --python source/build_room.py -- --preview room
```

```bash
$B --background --factory-startup --python source/build_rig.py
```

`build_room.py` bakes per-vertex ambient occlusion (about four minutes on an RTX 4060) and writes `raw/lab.glb` and `raw/anchors.json`. `--no-bake` skips the bake, `--no-export` stops before writing, `--skip gantry,instruments` leaves modules out and `--preview TAG` renders `previews/TAG-hero.png`. Do not pipe Blender's output into `head`: the closed pipe can kill Blender mid-render.

Then, from the site root:

```bash
node scripts/lab-hero/assets.mjs
```

This joins the room per material, drops UVs that no texture reads, smooths and quantises the baked occlusion, simplifies small hardware and leaves, simplifies the floor, walls, gallery and bench with the occlusion and normals as weighted attributes (flat, evenly lit stretches become large triangles, contact shadows keep their vertices), simplifies each rig part within 1.5 mm, compresses with meshopt and writes `public/lagoon/{lab,lab-compact,rig}.glb` and `anchors.json`. It fails if a rig attachment is not where the static anchor says the beam meets it.

## Performance

Most visitors' browsers draw this hero on an integrated GPU, so that is the budget. Time a build with

```bash
node design/pocket-lab/tools/perf-scroll.mjs http://127.0.0.1:4410/ 1920x1080 1 dark
```

which runs headless Chromium on the laptop's Intel graphics (`LAB_GPU=nvidia` for the discrete card) and prints the GPU milliseconds per rendered frame and the dropped frames for each phase. The 3.1 hero measured about 9 ms. Three things decide the cost: triangles that are small on screen (multisampling shades a pixel once per triangle that touches it, which is why the occlusion grid and the hardware are simplified), the key light's shadow pass (redrawn only when the carriage or focus moves, at most every other frame), and the multisampled scene pass (only the scene is multisampled; bloom and tone mapping run on the resolved image).

After any change to the room or its lighting, regenerate the posters and fallback clips with `scripts/lab-hero/media.mjs` (see its header), or the swap from poster to live room jumps.

## Anchors

`anchors.json` (version 3) carries the beam and camera anchors, the room bounds, the rig's articulated nodes and a `practicals` table: the position, aim and kind of every modelled lamp (desk lamps, display-case lights, gallery soffit downlights). The runtime places its lights from that table, so moving a lamp in Blender moves its light.
