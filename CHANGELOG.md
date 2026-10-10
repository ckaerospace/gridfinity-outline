# What the test loop found and fixed
1. STL not watertight: hull-built feet produced sliver triangles that collapsed under float32 rounding. Fixed: lofted rings for the foot, vertex coordinates snapped to float32-exact values, welded export. Now watertight, winding consistent, zero degenerate faces.
2. Notch sphere tangent to the pocket floor created degenerate geometry: sphere now sits 0.2 mm lower.
3. Sheet detection failed on 5 of 15 synthetic photos: markers merged with the grid top line (2 mm gap) and test framing cropped markers. Grid now starts 6 mm below the markers (object area y 36..261); synthetic framing fixed. Now 15/15 find 4 markers.
4. Outlines 1 to 3 mm oversize because the cast shadow was included (mean IoU 0.93). Default tolerance now picks the strongest-gradient iso-level: mean IoU 0.98.
5. Removed a 0.5 px outward contour offset that over-compensated (dims then within 0.3 mm).
6. UI: `[hidden]` was overridden by flex display (invisible dialog intercepting taps); margin or rotation changes now auto-nudge overlaps; per-object controls compacted.

# Round 2: shadows and white objects (CK's phone test)
Real photos: a cream part with a hard shadow (old code traced only the shadow strip: 7.7 x 83.8 mm), a blue floss box with hard shadow (old outline included the shadow, 68.6 x 59.4 mm).
Fix: log-RGB paper model, lightness vs chroma split with shadow-explained chroma removed, 'Remove shadow' slider, stable-threshold default tolerance, new tinted sheet (v2). Now part 43.7 x 85.4 mm hugging the part, floss 62.9 x 59.0 mm without shadow.
Synthetic hard set (24 cases: white / light-grey / cream / steel / dark / blue, hard and soft shadows 0.15-0.6, glossy highlights, tilt 0-40 deg), mean IoU / mean size error:
- old code, old white sheet: 0.316 / 20.7 mm (19 of 24 below 0.9)
- new code, old white sheet: 0.672 / 11.3 mm (pale objects 0.108 -> 0.583; others unchanged 0.940)
- old code, new tinted sheet: 0.511 / 14.1 mm
- new code, new tinted sheet: 0.979 / 0.40 mm (0 of 24 below 0.9; pale objects 0.981)
Regression sets: standard 15 synthetic cases on the tinted sheet 0.969 (old code on same photos 0.839); 12 standard cases on the white sheet 0.970 vs 0.976 old (old code lost 1 of 12, new finds all). Manual mode unchanged (0.947). UI flow, STL checks unaffected. 12 MP photo: prep about 0.4 s, total under 1 s in headless Chromium.

# Round 3: size check on a real floss box (CK: 52.5 x 43 mm)
- Root cause of "62.9 x 59.0 mm": that was the **axis-aligned bounding box** of a box lying rotated about 30 degrees, not its size. The minimum-area rectangle of the same outline is 53.3 x 44.9 mm, i.e. +0.8 / +1.9 mm (1.5 / 4.4 percent) over the true 52.5 x 43. The review screen now shows the minimum rectangle (long x short) first.
- Calibration is fine: in the straightened photo the A4 paper measures 209.0-209.5 x 297.8 mm (nominal 210 x 297), 50 mm grid lines are 49.8 mm apart. No halo: the outline hugs the box edge in an overlay; the pipeline adds no dilation/margin.
- Remaining excess is consistent with parallax of the box height (camera about 240 mm above the sheet by the homography with a guessed focal length; 36 mm sideways from the box). Camera pose estimate and **Object height** correction added (off by default = 0): footprint = silhouette shrunk by (z-h)/z about the point under the camera, clipped by the silhouette hull. Synthetic tall boxes (tools/synth.py tall, tests/run_tall.mjs): mean size error 25 mm tall +8.2 -> +0.1 mm, 35 mm tall +11.4 -> -0.4 mm (focal length guess 8 percent off); 30 degree tilt cases still a few mm off.
- Dimensions shown in the review screen, the plan view and the object panel (object and pocket, minimum rectangle).
- Contour smoothing slider (0-100, default 40; Gaussian along the outline, corners pinned): synthetic mean IoU 0.9641 -> 0.9629 (standard set) and 0.979 -> 0.979 (hard set), real photos' total turning roughly halved.
- Exposure normalisation (1-99 percentile stretch) before marker detection; capture tips added.
