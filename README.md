# Gridfinity Outline

Mobile-first, fully client-side PWA. Photograph an object on a printed A4 sheet (any camera angle); the app straightens the
photo with the sheet's corner markers, traces the outline in true millimetres and builds a Gridfinity bin STL with a
pocket per object. Nothing leaves the device. No backend, no CDN, no paid services.

## Run
    cd dist && python3 -m http.server 8123      # any static server works
    open http://localhost:8123/                 # on a phone: serve over HTTPS or your LAN, then "Add to Home Screen"
Service workers need HTTPS or localhost. After the first load the whole app (OpenCV.js, manifold WASM, three.js) works offline.

## Workflow
1. Print `dist/sheet.pdf` (or open `sheet.html`) at 100% on A4. Check the 100 mm scale bar.
2. Add object: Take photo / Photo library. Photo is downscaled to 2000 px long side in the browser.
3. Review: **zoom up to 8x** (pinch, two-finger drag to pan, double-tap, mouse wheel, + / - / Fit buttons; when zoomed a one-finger drag pans, a short tap selects), tolerance slider + number, Select / Add area / Remove area taps, Auto. Warnings for steep angle, tall objects, loose calibration, object touching the area edge.
4. Plan view: drag pockets, rotate with the handle (or slider / Rotate 90), add a notch (Add notch, then tap the pocket edge; drag the dot to move). Overlaps are auto-nudged; red means overlap or outside the bin.
5. Per object sliders (each with a typeable number): depth (default 20 mm), margin (default 2 mm), notch size (default 16 mm), rotation. Defaults live under Bin. An object value overrides the default until you press Reset.
6. 3D tab: orbitable view of the exact mesh that is exported, each pocket labelled with its depth.
7. Export: bin STL (binary), layout SVG/DXF, selected object SVG/DXF (all mm). SVG/DXF layers: outline (traced), POCKET (with margin), NOTCH circles, BIN.

If the markers cannot be found the app offers **manual calibration**: tap four corners of a rectangle of known size (cutting mat, graph paper), enter its width in mm and optionally its height (blank = estimated from perspective, about 1 percent accurate).

## Auto arrange (plan view, `dist/js/pack.js`, `pack-worker.js`)
One tap on **Auto arrange** (above the plan; **Options**: wall between pockets 1.2 to 10 mm slider + number, default 3; Allow rotation, default on; **Undo** appears after a run; per object **Lock** keeps position and rotation). It packs the true shapes, not bounding boxes: shape = outline + margin (the pocket) united with the notch discs (a notch cuts a disc of its size centred on the pocket edge, so it is part of the shape and never reaches into a neighbour or the outer wall).
Search: raster occupancy grid at 1 mm (cell centre inside the pocket, margin measured exactly to the outline segments, shapes grown 0.5 mm so sampling does not under-cover), candidate rotations every 15 degrees plus the minimum-area-rectangle alignments (long side along x / y) plus the current angle, wall between pockets by distance-transform dilation (Felzenszwalb EDT) of placed shapes, outer wall 1.2 mm as exact bounding limits. Placement is bottom-left style with 4 scoring modes (y-first, x-first, diagonal, square-ish) on a 2 mm scan plus 1 mm refinement; objects ordered by area descending, longest first, then random perturbations (seeded). Bin sizes: all nx x ny up to 8 x 8 in ascending cell count, ties by compactness (smaller perimeter, then the current orientation); a quick pass finds the first size that fits, then smaller sizes get random restarts inside a 1.8 s budget (about 2 to 3 s on a desktop; phone speed untested). Runs in a module Web Worker, main-thread fallback.
Safety: the result is checked with exact polygon geometry (`verifyLayout`: polygon distance between outlines minus margins, notch discs, exact bounding box vs outer wall). If the raster missed the wall by a hair, the search repeats with extra slack. After applying, the app re-runs `analyze()`; any overlap or outside-bin issue reverts the layout. If the new layout needs more cells than the current one (e.g. because your wall is larger than the old 1.2 mm), the current layout is kept and the message says so. If nothing fits up to 8 x 8 cells the message says so. Bin size is set to automatic. Bin height does not depend on the layout (only on the deepest pocket); the message warns anyway if it changes. Limits: heuristic, not optimal (a longer search sometimes finds a smaller bin); objects are never mirrored; the 1.2 mm old-style placement of freshly added objects is unchanged. Tests: `node tests/arrange_test.mjs`, `node tests/arrange_ui.mjs`.

## Save material (optional, off by default; Bin dialog)
Replaces part of the solid block by sealed hexagonal voids to save filament. Everything is generated from the same bin (3D preview, STL export). Rules: voids start at z = foot height 4.75 mm + wall (the Gridfinity foot, the base profile and the baseplate fit are untouched), end **wall** below the top surface (closed, clean top) and wall below every pocket floor, stay **wall** (default 1.6, 1.2 to 4) away from the outer walls (measured on the rounded outline), pockets and notch discs, are separated by ribs (at least wall; 2.4 mm at Saving 0 down to wall at Saving 100), and are hexagons (flat to flat 7 mm at Saving 0 up to 12.5 mm at 100, so the largest span, corner to corner, is at most about 14 mm: bridgeable) with 0.8 mm rounded corners and vertical walls (no overhang). Voids smaller than 12 mm2 or 2 mm tall are dropped. Estimated saving percent (volume of the same bin solid vs hollow, from manifold) is shown in the Bin dialog; 3D has a **Cutaway** button to look inside. The voids are closed cavities (air trapped inside): fine for FDM; not suitable for resin printing. Typical saving: 20 to 35 percent for a packed bin, more for a bin with lots of web. Verified with trimesh (`tests/save_material_test.py`).

## Calibration sheet (exact geometry, `tools/make_sheet.py`, `dist/js/sheetdef.js`)
A4 portrait 210 x 297 mm, origin top-left, x right, y down.
- 4 markers, each 20 x 20 mm, top-left corners at (10,10) id0, (180,10) id1, (10,267) id2, (180,267) id3. They sit 10 mm inside the page edge, so a printer margin of up to about 5 mm is safe.
- Marker = 5 x 5 grid of 4 mm cells. The outer ring of 16 cells is black. The inner 3 x 3 cells hold a 9-bit code (1 = black, bit index = 3*row + col): ids 0..3 = 7, 27, 28, 45. All 16 rotations of the four codes are distinct with Hamming distance >= 3, so each marker gives its id and orientation (ArUco-like). All 16 outer corners are used for the homography (>= 3 markers needed, 12 corners).
- Object area x 10..200, y 36..261 mm is printed in a **mid-tone blue-teal (RGB 150,192,210)** (sheet v2) so white, cream and light-grey objects contrast with it; the margins and markers stay white. Grid: 10 mm lines (RGB 128,172,192, 0.2 mm) and 50 mm lines (RGB 100,146,168, 0.35 mm). Thin lines are suppressed by morphological closing. Marker geometry is unchanged, so **a sheet printed with the old white design (v1) still calibrates identically**; only pale-object segmentation is weaker on it. Uses more ink; any plain colour printer works. A 100 mm scale bar is at y = 283 mm.
- Output of rectification: top-down image of that 190 x 225 mm area at 4 px/mm.

## Segmentation and outline
Closing (7x7) removes the thin grid lines. The paper (illumination) field is estimated at low resolution in **log-RGB** with iteratively re-weighted averaging that excludes objects and shadows. Per pixel d = log(pixel) - log(paper): its mean m is a lightness change (m < 0 darker), the rest C is a chromaticity change. A cast shadow is darker with a colour shift roughly proportional to its depth, a pale or white object is about as bright as the paper but has a different colour. So the distance is
`hypot(100 * lum, 450 * max(0, C - k*|m|))`, where darkening is down-weighted and the chroma a shadow of that depth would explain is subtracted; both scale with the **Remove shadow** setting (0..100, default 85; slider plus typeable number in the review screen). Darkening deeper than ratio 0.35 is counted in full (too dark for a shadow). If nothing is found the app retries with less shadow removal (40, then 0). Lower Remove shadow if a dark or grey object on a white sheet is cut off, raise it if a shadow is included.
The default tolerance is the **most stable threshold**: where the foreground area changes least when the threshold moves, restricted to candidates that keep at least 60 percent of the area found at tolerance 16 (so a lone shadow edge is not chosen). Largest blob (or the tapped one), holes filled, contour resampled at 0.25 mm, Gaussian-smoothed (sigma 0.5 mm), simplified (Douglas-Peucker 0.06 mm).

## Gridfinity geometry (checked against Zack Freedman's spec as documented by gridfinity-rebuilt-openscad and community docs)
42 mm pitch, 7 mm height unit, bin footprint 41.5 mm (0.25 mm clearance per side; bin outer = 42n - 0.5 mm), top corner radius 3.75 mm.
Foot per cell: 0.8 mm 45 degree chamfer, 1.8 mm vertical, 2.15 mm 45 degree chamfer (4.75 mm), bottom 35.6 mm square with 0.8 mm corner radius, concentric radii. Verified by slicing the exported STL: 35.7 (z=0.05), 37.0 (z=0.7), 37.2 (z=1.5 and 2.55), 40.0 (z=4.0), 41.4 (z=4.7) mm.
Height = number of 7 mm units: the deepest pocket + floor (default 2 mm, but never less than foot height 4.75 + 0.8 = 5.55 mm: a thinner floor would cut through the foot grooves and open slots along the cell boundaries; so depth 10 gives a 3u / 21 mm bin) rounded up to whole units (min 2, max 12). Each pocket depth is clamped to height - floor. Cells are chosen automatically (grow in whole cells) or set manually.

### Simplifications (exactly)
- **Stacking lip: optional** (Bin > Stacking lip, off by default). Standard lip profile on the inside (from the bin top: 0.7 mm 45 degree, 1.8 mm vertical, 1.9 mm 45 degree; 4.4 mm tall, added above H = 7n mm), with a 0.4 mm flat on top instead of a knife edge (the top chamfer is about 38 degrees instead of 45). With the lip on, pockets keep 2.6 mm from the outside so they don't cut the lip; notches still cut through the wall and lip.
- **Magnet holes: optional** (Bin > Magnet holes). 6.5 mm diameter x 2.4 mm deep in every foot, 4 per cell on a 26 mm square (for 6 x 2 mm magnets, press fit or glue). No screw holes. The pocket floor is always at least 5.55 mm above the base, which is at least 0.8 mm above the foot top (4.75 mm) and 3.15 mm above the magnet holes.
- No hollow feet, no scoops/dividers. The bin is a **solid block** with pockets cut in (or use Save material).
- Wall to bin edge is at least 1.2 mm (2.6 mm with the lip); between pockets at least 1.2 mm (enforced by the overlap check).
- Finger notch = vertical round shaft with a spherical bottom, diameter = notch size, centred on the pocket edge (including margin); its sphere sits 0.2 mm below the pocket floor.
- Baseplate fit was verified geometrically against the published numbers only, not test-printed. Printer-fit compensation is not included.
- Geometry is built with manifold-3d (WASM) CSG; the STL export welds vertices on a 0.1 micron grid and drops sliver triangles so it stays closed after float32 rounding. Checked watertight with trimesh (`tests/check_stl.py`).

## Projects, undo, measuring (v9)
- **Projects**: saved automatically on this device (IndexedDB, `dist/js/store.js`): outlines, a small straightened photo per object, depths, notches, bin settings. Menu (top left) lists projects with thumbnails: open, new, rename, duplicate, delete (tap twice). Nothing is uploaded.
- **Undo / redo** (top right, or Ctrl/Cmd+Z, Shift for redo): whole-project snapshots, committed once an edit settles (about 0.35 s), up to 80 steps. Includes removing objects.
- **Long-press** an object (in 2D or on its chip): rename, change depth, delete.
- **Measure** (Outline step): tap two points in the straightened photo to read the distance in mm. Good to sanity-check the scale against a ruler or the object.
- **Print estimate** (rough): solid volume x 0.45 (about 2 walls, 15% infill, 0.2 mm layers) at about 8 mm3/s, plus 6 min; grams at 1.24 g/cm3 (PLA). Expect your slicer to differ by 30% or more.
- **UI**: step bar Photo > Outline > Bin > Export, one main button at the bottom, advanced settings under "More", plain-language hints for missing sheet corners and shadows, a 3-screen intro on first run (Skip).

## Size, height and smoothing
- The review screen reports the **minimum-area rectangle** (long x short side) of the outline. The axis-aligned box is shown separately; a rotated object has a much bigger axis-aligned box.
- **Object height** (default 0 = off): tall objects look bigger from above because their top edge is closer to the camera. The app estimates the camera from the sheet homography (focal length guessed as 0.78 x long side, so the camera height is only good to about 30 percent) and, if you enter a height, shrinks the outline toward the point under the camera by (z-h)/z and clips it to the silhouette. The corrected outline is drawn dashed orange. Best practice: shoot from far away and zoom in, camera above the object centre.
- **Smoothing** slider (0-100, default 40): Gaussian smoothing along the outline (sigma 0.04 mm per unit), corners (turning above 25 degrees) are pinned so straight edges and corners stay.

## Smart select (optional, AI)
Review screen button **Smart select** (tap the object) and **Smart: exclude** (tap a wrongly included shadow). Uses MobileSAM (ONNX export by Acly, MIT; MobileSAM and SAM are Apache-2.0) with onnxruntime-web 1.30 (MIT, WASM backend, single thread) on the straightened image; everything runs on the device. Files are self-hosted: `dist/vendor/models/mobile_sam_image_encoder.onnx` (28 MB) and `sam_mask_decoder_multi.onnx` (16.5 MB), `dist/vendor/ort/` (14 MB wasm + loader). Total about 60 MB, **downloaded only when Smart select is first used**, then cached by the service worker (cache `gf-smart-v2`). The mask replaces the classic threshold mask and then goes through the same cleanup, Smoothing and Object height steps. A single tap is ambiguous (part, whole object, group): of the candidate masks the app takes the largest plausible one; further taps use the model's multi-point mask. **Auto** returns to the classic method (the default). Timing in headless desktop Chromium: about 5 s to analyse the image, 0.3 s per tap; phones are untested and probably slower. Smart select is untested on a real phone.
To refresh the vendored runtime: `npm i onnxruntime-web` and copy `ort.wasm.min.mjs`, `ort-wasm-simd-threaded.mjs`, `ort-wasm-simd-threaded.wasm` from `node_modules/onnxruntime-web/dist` to `dist/vendor/ort/`.

## Limits
- Outline is the silhouette as seen by the camera: exact only for flat objects; tall objects at an angle trace oversize (the app warns with `depth x tan(tilt)`; shoot from above).
- White objects on the old white (v1) sheet, objects whose colour equals the paper, and a dark neutral object whose darkness equals a deep shadow can still fail (use Add area / Remove area, tolerance and Remove shadow). Shiny or transparent objects segment less well.
- The shadow model (chroma ~ 0.3 x depth) was calibrated on one real photo set under warm light; other lighting may need the slider.
- No lens distortion model; focal length assumed about 0.78 x long side for the tilt warning only (the homography itself needs no focal length).
- One connected region per photo (merge parts with Add area).
- Not tested on a real iPhone/Safari (headless Chromium only).

## Tests (`tests/`, `tools/`)
    node tests/lip_magnet_test.mjs                 # lip / magnet / save combos: manifold, floor clearance, height, 2.6 mm lip wall; STLs in samples/
    node tests/ux_flow.mjs  (SCHEME=light too)     # intro, step bar, ruler, undo/redo, long-press, projects, lip toggle, hints; screenshots/v9*/
    python3 -m venv .venv && .venv/bin/pip install trimesh numpy opencv-python-headless scipy shapely pillow ; npm i playwright && npx playwright install chromium
    .venv/bin/python tools/make_sheet.py dist    # regenerates sheet.svg / .pdf / .html
    .venv/bin/python tools/synth.py              # synthetic photos + ground truth -> tests/synth
    node tests/run_synth.mjs && .venv/bin/python tests/metrics.py      # accuracy through the real app in headless Chromium
    node tests/run_manual.mjs && .venv/bin/python tests/metrics.py tests/manual_results.json   # manual 4-corner mode
    .venv/bin/python tools/synth.py hard tint tests/hard_tint   # 24 white / pale / glossy / hard+soft shadow cases (use 'white' for the old sheet)
    DIR=tests/hard_tint OUT=/tmp/r.json node tests/run_synth.mjs && .venv/bin/python tests/compare.py /tmp/r.json
    node tests/run_real2.mjs after                # the two real phone photos in tests/real (white part + hard shadow, blue floss box)
    node tests/ui_flow.mjs                       # full phone flow + screenshots + exports (needs server on :8123)
    node tests/e2e_stl.mjs <photo> out.stl && .venv/bin/python tests/check_stl.py out.stl
    node tests/offline.mjs                       # service worker offline check
    node tests/bin_test.mjs                      # manifold build smoke test
Third-party: OpenCV.js (Apache-2.0), manifold-3d (Apache-2.0), three.js (MIT), all vendored in `dist/vendor`.


Smart select memory (iOS): the ort wasm shared memory maximum is capped at 512 MB in `dist/vendor/ort/ort-wasm-simd-threaded.mjs` (stock 4 GB fails on iOS Safari); peak wasm heap measured 310-395 MB; on a memory failure the Smart buttons are disabled with a message and the classic Select is used. Tests: `PWB=webkit node tests/smart_selftest.mjs`, `node tests/mem_probe.mjs`.
