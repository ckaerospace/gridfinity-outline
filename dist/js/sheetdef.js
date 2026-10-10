// Calibration sheet geometry (millimetres, origin = top-left of the A4 page, x right, y down).
// Page 210 x 297. Four 20 x 20 mm markers, outer edge 10 mm from the page edges.
// Marker = 5x5 grid of 4 mm cells: outer ring black, inner 3x3 = 9-bit code (1 = black), bit index = 3*row + col.
export const SHEET = {
  w: 210, h: 297, marker: 20, cell: 4,
  origins: [[10, 10], [180, 10], [10, 267], [180, 267]], // top-left corner of marker id 0..3 (TL, TR, BL, BR)
  codes: [7, 27, 28, 45],
  roi: { x0: 10, y0: 36, x1: 200, y1: 261 },            // usable object area between the markers
  gridMinor: 10, gridMajor: 50,
};
export function codeGrid(id) {
  const c = SHEET.codes[id], g = [];
  for (let i = 0; i < 3; i++) { g.push([]); for (let j = 0; j < 3; j++) g[i].push((c >> (3 * i + j)) & 1); }
  return g;
}
// Physical outer corners of marker id, clockwise from its top-left (viewed from above): TL, TR, BR, BL.
export function markerCorners(id) {
  const [ox, oy] = SHEET.origins[id], m = SHEET.marker;
  return [[ox, oy], [ox + m, oy], [ox + m, oy + m], [ox, oy + m]];
}
