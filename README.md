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
3. Review: tolerance slider + number, Select / Add area / Remove area taps, Auto. Warnings for steep angle, tall objects, loose calibration, object touching the area edge.
4. Plan view: drag pockets, rotate with the handle (or slider / Rotate 90), add a notch (Add notch, then tap the pocket edge; drag the dot to move). Overlaps are auto-nudged; red means overlap or outside the bin.
5. Per object sliders (each with a typeable number): depth (default 20 mm), margin (default 2 mm), notch size (default 16 mm), rotation. Defaults live under Bin. An object value overrides the default until you press Reset.
6. 3D tab: orbitable view of the exact mesh that is exported, each pocket labelled with its depth.
7. Export: bin STL (binary), layout SVG/DXF, selected object SVG/DXF (all mm). SVG/DXF layers: outline (traced), POCKET (with margin), NOTCH circles, BIN.

If the markers cannot be found the app offers **manual calibration**: tap four corners of a rectangle of known size (cutting mat, graph paper), enter its width in mm and optionally its height (blank = estimated from perspective, about 1 percent accurate).

## Calibration sheet (exact geometry, `tools/make_sheet.py`, `dist/js/sheetdef.js`)
A4 portrait 210 x 297 mm, origin top-left, x right, y down.
- 4 markers, each 20 x 20 mm, top-left corners at (10,10) id0, (180,10) id1, (10,267) id2, (180,267) id3. They sit 10 mm inside the page edge, so a printer margin of up to about 5 mm is safe.
- Marker = 5 x 5 grid of 4 mm cells. The outer ring of 16 cells is black. The inner 3 x 3 cells hold a 9-bit code (1 = black, bit index = 3*row + col): ids 0..3 = 7, 27, 28, 45. All 16 rotations of the four codes are distinct with Hamming distance >= 3, so each marker gives its id and orientation (ArUco-like). All 16 outer corners are used for the homography (>= 3 markers needed, 12 corners).
- Grid: 10 mm lines (RGB 206,216,226, 0.2 mm) and 50 mm lines (RGB 176,191,207, 0.35 mm), only inside the object area x 10..200, y 36..261 mm. Pale lines are suppressed by morphological closing, so they are not mistaken for the object. A 100 mm scale bar is at y = 283 mm.
- Output of rectification: top-down image of that 190 x 225 mm area at 4 px/mm.

## Segmentation and outline
Closing (7x7) removes the thin grid lines; the paper colour field is estimated at low resolution with object-masked averaging (handles lighting gradients); the per-pixel difference in Lab (L weighted 0.8) is thresholded. The default tolerance is the iso-level with the strongest edge gradient, which picks a crisp object edge over the soft ramp of a cast shadow. Largest blob (or the tapped one), holes filled, contour resampled at 0.25 mm, Gaussian-smoothed (sigma 0.5 mm), simplified (Douglas-Peucker 0.06 mm).

## Gridfinity geometry (checked against Zack Freedman's spec as documented by gridfinity-rebuilt-openscad and community docs)
42 mm pitch, 7 mm height unit, bin footprint 41.5 mm (0.25 mm clearance per side; bin outer = 42n - 0.5 mm), top corner radius 3.75 mm.
Foot per cell: 0.8 mm 45 degree chamfer, 1.8 mm vertical, 2.15 mm 45 degree chamfer (4.75 mm), bottom 35.6 mm square with 0.8 mm corner radius, concentric radii. Verified by slicing the exported STL: 35.7 (z=0.05), 37.0 (z=0.7), 37.2 (z=1.5 and 2.55), 40.0 (z=4.0), 41.4 (z=4.7) mm.
Height = number of 7 mm units: the deepest pocket + floor (default 2 mm) rounded up to whole units (min 2, max 12). Each pocket depth is clamped to height - floor. Cells are chosen automatically (grow in whole cells) or set manually.

### Simplifications (exactly)
- **No stacking lip** (flat top at H = 7n mm).
- **No magnet or screw holes**, no hollow feet, no scoops/dividers. The bin is a **solid block** with pockets cut in (heavy on filament; set infill low).
- Wall to bin edge and between pockets is at least 1.2 mm (enforced by the overlap check).
- Finger notch = vertical round shaft with a spherical bottom, diameter = notch size, centred on the pocket edge (including margin); its sphere sits 0.2 mm below the pocket floor.
- Baseplate fit was verified geometrically against the published numbers only, not test-printed. Printer-fit compensation is not included.
- Geometry is built with manifold-3d (WASM) CSG; the STL export welds vertices on a 0.1 micron grid and drops sliver triangles so it stays closed after float32 rounding. Checked watertight with trimesh (`tests/check_stl.py`).

## Limits
- Outline is the silhouette as seen by the camera: exact only for flat objects; tall objects at an angle trace oversize (the app warns with `depth x tan(tilt)`; shoot from above).
- Pale or white objects on white paper, shiny or transparent objects segment poorly (use Add area / Remove area).
- No lens distortion model; focal length assumed about 0.78 x long side for the tilt warning only (the homography itself needs no focal length).
- One connected region per photo (merge parts with Add area).
- Not tested on a real iPhone/Safari (headless Chromium only).

## Tests (`tests/`, `tools/`)
    python3 -m venv .venv && .venv/bin/pip install trimesh numpy opencv-python-headless scipy shapely pillow ; npm i playwright && npx playwright install chromium
    .venv/bin/python tools/make_sheet.py dist    # regenerates sheet.svg / .pdf / .html
    .venv/bin/python tools/synth.py              # synthetic photos + ground truth -> tests/synth
    node tests/run_synth.mjs && .venv/bin/python tests/metrics.py      # accuracy through the real app in headless Chromium
    node tests/run_manual.mjs && .venv/bin/python tests/metrics.py tests/manual_results.json   # manual 4-corner mode
    node tests/ui_flow.mjs                       # full phone flow + screenshots + exports (needs server on :8123)
    node tests/e2e_stl.mjs <photo> out.stl && .venv/bin/python tests/check_stl.py out.stl
    node tests/offline.mjs                       # service worker offline check
    node tests/bin_test.mjs                      # manifold build smoke test
Third-party: OpenCV.js (Apache-2.0), manifold-3d (Apache-2.0), three.js (MIT), all vendored in `dist/vendor`.
