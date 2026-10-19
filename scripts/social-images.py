"""Draws the site's share image and app icons in the Observatory Logbook style.

    python3 scripts/social-images.py      (needs Pillow: pip install pillow)

Writes public/og-image.png (1200x630, used when a link is shared), public/apple-touch-icon.png
(180x180) and public/favicon.svg. Re-run it if the title, tagline or Saturn icon change; the
output files are committed, so the site build itself needs nothing extra.
"""
import re
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
PAPER, INK, INK2, GRID = (244, 243, 238), (17, 17, 17), (92, 92, 92), (226, 225, 219)

# The Saturn icon, read straight from src/icons.js so it always matches the site
icons = (ROOT / 'src/icons.js').read_text()
w, h, path = re.search(r"planet:\s*\[(\d+),\s*(\d+),\s*'([^']+)'\]", icons).groups()
SATURN_W, SATURN_H = int(w), int(h)
SATURN = [tuple(map(int, m)) for m in re.findall(r'M(\d+) (\d+)h(\d+)v1h-\d+z', path)]  # (x, y, run)

# A small pixel font for the title: 5x7 cells, '#' = ink
FONT = {
    'C': ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
    'O': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    'S': ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
    'M': ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
    'N': ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
    'T': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    'B': ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
    'K': ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
    ' ': ['.....'] * 7,
}


def pixel_text(draw, text, x, y, scale):
    for ch in text:
        for row, line in enumerate(FONT[ch]):
            for col, c in enumerate(line):
                if c == '#':
                    draw.rectangle([x + col * scale, y + row * scale, x + (col + 1) * scale - 1, y + (row + 1) * scale - 1], fill=INK)
        x += 6 * scale
    return x


def saturn(draw, x, y, scale, fill=INK):
    for sx, sy, run in SATURN:
        draw.rectangle([x + sx * scale, y + sy * scale, x + (sx + run) * scale - 1, y + (sy + 1) * scale - 1], fill=fill)


def mono(size):
    for name in ['DejaVuSansMono.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 'Menlo.ttc', 'Consolas.ttf']:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def share_image():
    W, H = 1200, 630
    img = Image.new('RGB', (W, H), PAPER)
    d = ImageDraw.Draw(img)
    for gx in range(0, W, 24):
        d.line([(gx, 0), (gx, H)], fill=GRID)
    for gy in range(0, H, 24):
        d.line([(0, gy), (W, gy)], fill=GRID)

    # Window card with a hard shadow, like the site's .win panels
    x0, y0, x1, y1 = 60, 60, W - 72, H - 84
    d.rectangle([x0 + 12, y0 + 12, x1 + 12, y1 + 12], fill=INK)
    d.rectangle([x0, y0, x1, y1], fill=(255, 255, 255), outline=INK, width=6)
    d.rectangle([x0, y0, x1, y0 + 44], fill=PAPER, outline=INK, width=6)
    d.text((x0 + 22, y0 + 10), 'A COMMUNITY LAB NOTEBOOK', font=mono(22), fill=INK)
    for dx in range(x0 + 380, x1 - 20, 4):  # dither strip in the title bar
        for dy in range(y0 + 16, y0 + 30, 4):
            d.rectangle([dx, dy, dx + 1, dy + 1], fill=INK)

    saturn(d, x0 + 46, y0 + 150, 13)
    tx = x0 + 46 + SATURN_W * 13 + 56
    pixel_text(d, 'COSMOS', tx, y0 + 112, 12)
    pixel_text(d, 'NOTEBOOK', tx, y0 + 112 + 8 * 12 + 24, 12)

    f = mono(30)
    d.text((x0 + 46, y1 - 132), 'Learn astrophysics and quantum physics', font=f, fill=INK)
    d.text((x0 + 46, y1 - 88), 'by doing \u2014 one home experiment at a time.', font=f, fill=INK2)

    # Ruler along the bottom
    for i, rx in enumerate(range(60, W - 60, 10)):
        d.line([(rx, H - 30), (rx, H - (52 if i % 5 == 0 else 40))], fill=INK, width=2)
    img.save(ROOT / 'public/og-image.png', optimize=True)


def touch_icon():
    S = 180
    img = Image.new('RGB', (S, S), PAPER)
    d = ImageDraw.Draw(img)
    scale = 8
    saturn(d, (S - SATURN_W * scale) // 2, (S - SATURN_H * scale) // 2, scale)
    img.save(ROOT / 'public/apple-touch-icon.png', optimize=True)


def favicon():
    pad = 2
    vw, vh = SATURN_W + pad * 2, SATURN_W + pad * 2
    oy = (vh - SATURN_H) // 2
    (ROOT / 'public/favicon.svg').write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vw} {vh}" shape-rendering="crispEdges">'
        f'<style>rect{{fill:#F4F3EE}}path{{fill:#111}}@media (prefers-color-scheme:dark){{rect{{fill:#0B0B0B}}path{{fill:#F2F1EC}}}}</style>'
        f'<rect width="{vw}" height="{vh}" rx="2"/>'
        f'<path transform="translate({pad} {oy})" d="{path}"/></svg>\n'
    )


share_image()
touch_icon()
favicon()
print('Wrote public/og-image.png, public/apple-touch-icon.png and public/favicon.svg')
