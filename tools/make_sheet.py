"""Generates the printable A4 calibration sheet (SVG, HTML, PDF) and exposes render_sheet() for synthetic tests.
Geometry must match dist/js/sheetdef.js."""
import numpy as np, cv2, sys, os
W, H, MK, CELL = 210, 297, 20, 4
ORIGINS = [(10, 10), (180, 10), (10, 267), (180, 267)]
CODES = [7, 27, 28, 45]
ROI = (10, 36, 200, 261)
MINOR, MAJOR = 10, 50
MINOR_RGB, MAJOR_RGB = (206, 216, 226), (176, 191, 207)   # legacy white sheet (v1)
# v2 sheet: object area printed in a mid-tone blue-teal so white / pale / grey objects separate from it (chroma + lightness).
TINT_RGB, TINT_MINOR_RGB, TINT_MAJOR_RGB = (150, 192, 210), (128, 172, 192), (100, 146, 168)
V2 = True

def code_grid(i):
    return [[(CODES[i] >> (3 * r + c)) & 1 for c in range(3)] for r in range(3)]

def marker_rects(i):
    """list of black rectangles (x,y,w,h) in mm for marker i"""
    ox, oy = ORIGINS[i]; g = code_grid(i); out = []
    for r in range(5):
        for c in range(5):
            black = r in (0, 4) or c in (0, 4) or g[r - 1][c - 1] == 1
            if black: out.append((ox + c * CELL, oy + r * CELL, CELL, CELL))
    return out

def svg():
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}mm" height="{H}mm" viewBox="0 0 {W} {H}">',
         f'<rect width="{W}" height="{H}" fill="#fff"/>']
    x0, y0, x1, y1 = ROI
    MINOR_RGB, MAJOR_RGB = (TINT_MINOR_RGB, TINT_MAJOR_RGB) if V2 else (globals()['MINOR_RGB'], globals()['MAJOR_RGB'])
    if V2: s.append(f'<rect x="{x0}" y="{y0}" width="{x1-x0}" height="{y1-y0}" fill="rgb{TINT_RGB}"/>')
    for x in range(x0, x1 + 1, MINOR):
        major = (x - x0) % MAJOR == 0
        s.append(f'<line x1="{x}" y1="{y0}" x2="{x}" y2="{y1}" stroke="rgb{MAJOR_RGB if major else MINOR_RGB}" stroke-width="{0.35 if major else 0.2}"/>')
    for y in range(y0, y1 + 1, MINOR):
        major = (y - y0) % MAJOR == 0
        s.append(f'<line x1="{x0}" y1="{y}" x2="{x1}" y2="{y}" stroke="rgb{MAJOR_RGB if major else MINOR_RGB}" stroke-width="{0.35 if major else 0.2}"/>')
    # 100 mm scale bar + label (outside the object area)
    s.append('<path d="M55 283H155M55 280V286M155 280V286" stroke="#000" stroke-width="0.4" fill="none"/>')
    s.append('<text x="105" y="278" font-family="Helvetica,Arial,sans-serif" font-size="3.2" text-anchor="middle" fill="#000">Gridfinity Outline sheet  |  A4  |  print at 100% (no scaling)</text>')
    s.append('<text x="105" y="290" font-family="Helvetica,Arial,sans-serif" font-size="3" text-anchor="middle" fill="#000">scale bar = 100 mm  |  keep all four corner markers visible  |  place object inside the grid</text>')
    for i in range(4):
        for (x, y, w, h) in marker_rects(i):
            s.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="#000"/>')
    s.append('</svg>')
    return '\n'.join(s)

def render_sheet(ppm=10, v2=None):
    """BGR raster of the sheet at ppm pixels per mm (no text). v2=False renders the legacy white sheet."""
    v2 = V2 if v2 is None else v2
    MINOR_RGB, MAJOR_RGB = (TINT_MINOR_RGB, TINT_MAJOR_RGB) if v2 else (globals()['MINOR_RGB'], globals()['MAJOR_RGB'])
    img = np.full((H * ppm, W * ppm, 3), 255, np.uint8)
    x0, y0, x1, y1 = ROI
    P = lambda v: int(round(v * ppm))
    if v2: img[P(y0):P(y1), P(x0):P(x1)] = TINT_RGB[::-1]
    for x in range(x0, x1 + 1, MINOR):
        major = (x - x0) % MAJOR == 0; c = (MAJOR_RGB if major else MINOR_RGB)[::-1]
        cv2.line(img, (P(x), P(y0)), (P(x), P(y1)), c, max(1, P(0.35 if major else 0.2)), cv2.LINE_AA)
    for y in range(y0, y1 + 1, MINOR):
        major = (y - y0) % MAJOR == 0; c = (MAJOR_RGB if major else MINOR_RGB)[::-1]
        cv2.line(img, (P(x0), P(y)), (P(x1), P(y)), c, max(1, P(0.35 if major else 0.2)), cv2.LINE_AA)
    cv2.line(img, (P(55), P(283)), (P(155), P(283)), (0, 0, 0), max(1, P(0.4)))
    for i in range(4):
        for (x, y, w, h) in marker_rects(i):
            cv2.rectangle(img, (P(x), P(y)), (P(x + w) - 1, P(y + h) - 1), (0, 0, 0), -1)
    return img

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'dist'
    s = svg(); open(f'{out}/sheet.svg', 'w').write(s)
    html = ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>Calibration sheet (A4)</title><style>@page{size:A4;margin:0}html,body{margin:0;background:#fff}'
            'svg{display:block;width:210mm;height:297mm;max-width:100vw;height:auto}'
            '.bar{font:14px system-ui;padding:12px;display:flex;gap:12px;align-items:center;background:#111;color:#eee}'
            '.bar button,.bar a{font:inherit;padding:10px 16px;border-radius:10px;border:1px solid #444;background:#222;color:#eee;text-decoration:none}'
            '@media print{.bar{display:none}svg{width:210mm;height:297mm}}</style></head><body>'
            '<div class="bar"><a href="./">Back</a><button onclick="print()">Print (100%, A4)</button><a href="sheet.pdf" download>PDF</a></div>'
            + s + '</body></html>')
    open(f'{out}/sheet.html', 'w').write(html)
    from PIL import Image
    im = cv2.cvtColor(render_sheet(12), cv2.COLOR_BGR2RGB)
    # text via cv2 (raster PDF at 304.8 dpi)
    cv2.putText(im, 'Gridfinity Outline sheet | A4 | print at 100% (no scaling)', (12*42, 12*278), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0,0,0), 2, cv2.LINE_AA)
    cv2.putText(im, 'scale bar = 100 mm | keep all four markers visible', (12*50, 12*290), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0,0,0), 2, cv2.LINE_AA)
    Image.fromarray(im).save(f'{out}/sheet.pdf', resolution=12 * 25.4)
    print('sheet written')
