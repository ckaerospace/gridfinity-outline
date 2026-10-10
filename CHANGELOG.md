# What the test loop found and fixed
1. STL not watertight: hull-built feet produced sliver triangles that collapsed under float32 rounding. Fixed: lofted rings for the foot, vertex coordinates snapped to float32-exact values, welded export. Now watertight, winding consistent, zero degenerate faces.
2. Notch sphere tangent to the pocket floor created degenerate geometry: sphere now sits 0.2 mm lower.
3. Sheet detection failed on 5 of 15 synthetic photos: markers merged with the grid top line (2 mm gap) and test framing cropped markers. Grid now starts 6 mm below the markers (object area y 36..261); synthetic framing fixed. Now 15/15 find 4 markers.
4. Outlines 1 to 3 mm oversize because the cast shadow was included (mean IoU 0.93). Default tolerance now picks the strongest-gradient iso-level: mean IoU 0.98.
5. Removed a 0.5 px outward contour offset that over-compensated (dims then within 0.3 mm).
6. UI: `[hidden]` was overridden by flex display (invisible dialog intercepting taps); margin or rotation changes now auto-nudge overlaps; per-object controls compacted.
