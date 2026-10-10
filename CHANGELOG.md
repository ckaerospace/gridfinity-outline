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
