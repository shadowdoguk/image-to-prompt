#!/usr/bin/env python3
"""Generate image-to-prompt app icon (256x256 PNG + matching SVG)."""
from PIL import Image, ImageDraw, ImageFilter
import math
import os

SIZE = 256
PAD = 8
RADIUS = 48  # rounded square corner radius

# --- Color palette (deep indigo → magenta, AI/tech feel) ---
BG_TOP    = (99,  102, 241)   # indigo-500
BG_BOT    = (217,  70, 239)   # fuchsia-500
WHITE     = (255, 255, 255)
WHITE_DIM = (235, 230, 255)
ACCENT    = (252, 211,  77)   # amber-300 (sun + arrow)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


# --- Base: rounded-square with vertical gradient ---
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)
for y in range(SIZE):
    t = y / (SIZE - 1)
    draw.line([(0, y), (SIZE, y)], fill=lerp(BG_TOP, BG_BOT, t) + (255,))


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return m


mask = rounded_mask(SIZE, RADIUS)
canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
canvas.paste(img, (0, 0), mask)
draw = ImageDraw.Draw(canvas)

# --- Image glyph (left half): photo with mountain + sun ---
gx, gy = 30, 50   # glyph origin
gw, gh = 96, 96
# photo frame
draw.rounded_rectangle((gx, gy, gx + gw, gy + gh), radius=10, fill=WHITE)
# mountain (large, then small in front)
draw.polygon([
    (gx + 6,        gy + gh - 6),
    (gx + 30,       gy + 32),
    (gx + 54,       gy + 60),
    (gx + gw - 6,   gy + gh - 6),
], fill=( 99, 102, 241))  # indigo, same as bg top
draw.polygon([
    (gx + 38,       gy + gh - 6),
    (gx + 58,       gy + 50),
    (gx + 86,       gy + gh - 6),
], fill=( 79,  70, 229))  # darker indigo
# sun
sun_r = 10
draw.ellipse((gx + gw - 28, gy + 16, gx + gw - 28 + sun_r * 2, gy + 16 + sun_r * 2),
             fill=ACCENT)


# --- Arrow connecting the two halves ---
arrow_y = gy + gh // 2
arrow_x0 = gx + gw + 10
arrow_x1 = gx + gw + 30
# shaft
draw.rectangle((arrow_x0, arrow_y - 4, arrow_x1, arrow_y + 4), fill=WHITE)
# head
draw.polygon([
    (arrow_x1,        arrow_y - 10),
    (arrow_x1 + 14,   arrow_y),
    (arrow_x1,        arrow_y + 10),
], fill=WHITE)


# --- Text glyph (right half): three lines simulating a prompt ---
tx, ty = gx + gw + 50, 60
tw = 64
line_h = 12
gap    = 12
for i, frac in enumerate([1.00, 0.78, 0.55]):
    y = ty + i * (line_h + gap)
    draw.rounded_rectangle((tx, y, tx + int(tw * frac), y + line_h),
                           radius=line_h // 2, fill=WHITE if i == 0 else WHITE_DIM)


# --- Subtle inner highlight ring ---
ring = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
rd = ImageDraw.Draw(ring)
rd.rounded_rectangle((1, 1, SIZE - 2, SIZE - 2), radius=RADIUS - 1,
                     outline=(255, 255, 255, 50), width=2)
canvas.alpha_composite(ring)


# --- Save PNG ---
icon_dir = os.path.expanduser("~/.local/share/icons")
os.makedirs(icon_dir, exist_ok=True)
png_path = os.path.join(icon_dir, "image-to-prompt.png")
canvas.save(png_path, "PNG", optimize=True)
print(f"WROTE {png_path}  ({os.path.getsize(png_path)} bytes)")