#!/usr/bin/env python3
"""
Generate Bookplus app icons from the calendar+plus mark.
Geometry is defined on a 0..100 unit grid (matches the SVG concept):
  - ink squircle background (vertical gradient)
  - off-white calendar body + two binder tabs + header line
  - single gold plus (the only accent)
Drawn at 4x supersample, then LANCZOS-downscaled for crisp edges.
"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "client", "public")
OUT = os.path.abspath(OUT)

SS = 4  # supersample factor

INK_TOP = (31, 31, 33)      # #1f1f21
INK_BOT = (4, 5, 5)         # #040505
OFFWHITE = (230, 232, 231)  # #e6e8e7
HEADER = (233, 189, 179)    # #e9bdb3 (soft orange-tinted divider)
GOLD = (240, 62, 22)        # #f03e16 (brand orange; legacy var name)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def ink_gradient(D):
    """Vertical ink gradient, D x D."""
    strip = Image.new("RGB", (1, D))
    for y in range(D):
        strip.putpixel((0, y), lerp(INK_TOP, INK_BOT, y / (D - 1)))
    return strip.resize((D, D))


def draw_mark(size, rounded=True):
    """Return an RGBA image (size x size) of the full icon."""
    D = size * SS
    u = D / 100.0

    def R(x, y, w, h):  # unit-rect -> pixel box
        return [x * u, y * u, (x + w) * u, (y + h) * u]

    # background mask (rounded squircle or full bleed)
    mask = Image.new("L", (D, D), 0)
    md = ImageDraw.Draw(mask)
    if rounded:
        md.rounded_rectangle(R(2, 2, 96, 96), radius=22 * u, fill=255)
    else:
        md.rectangle([0, 0, D, D], fill=255)

    base = Image.new("RGBA", (D, D), (0, 0, 0, 0))
    base.paste(ink_gradient(D), (0, 0), mask)

    d = ImageDraw.Draw(base)
    # binder tabs
    d.rounded_rectangle(R(37, 26, 5, 12), radius=2.5 * u, fill=OFFWHITE)
    d.rounded_rectangle(R(58, 26, 5, 12), radius=2.5 * u, fill=OFFWHITE)
    # calendar body
    d.rounded_rectangle(R(27, 33, 46, 43), radius=7 * u, fill=OFFWHITE)
    # header divider
    d.rounded_rectangle(R(33, 45, 34, 1.8), radius=0.9 * u, fill=HEADER)
    # gold plus
    d.rounded_rectangle(R(47.5, 51, 5, 20), radius=2.5 * u, fill=GOLD)
    d.rounded_rectangle(R(40, 58.5, 20, 5), radius=2.5 * u, fill=GOLD)

    return base.resize((size, size), Image.LANCZOS)


def save_png(img, name, rgb=False):
    path = os.path.join(OUT, name)
    if rgb:
        bg = Image.new("RGB", img.size, (4, 5, 5))
        bg.paste(img, (0, 0), img)
        bg.save(path, "PNG")
    else:
        img.save(path, "PNG")
    print("wrote", name, img.size)


# Rounded variants (purpose: any) — what shows in tabs / PWA lists
save_png(draw_mark(512, rounded=True), "icon-512.png")
save_png(draw_mark(192, rounded=True), "icon-192.png")
save_png(draw_mark(64, rounded=True), "favicon-64.png")

# Full-bleed variants (purpose: maskable) — OS applies its own mask
save_png(draw_mark(512, rounded=False), "icon-512-maskable.png")
save_png(draw_mark(192, rounded=False), "icon-192-maskable.png")

# Apple touch icon — full bleed, opaque (iOS rounds it itself)
save_png(draw_mark(180, rounded=False), "apple-touch-icon.png", rgb=True)

# favicon.ico (multi-size, rounded)
ico_sizes = [16, 32, 48]
ico_imgs = [draw_mark(s, rounded=True) for s in ico_sizes]
ico_imgs[0].save(
    os.path.join(OUT, "favicon.ico"),
    format="ICO",
    sizes=[(s, s) for s in ico_sizes],
    append_images=ico_imgs[1:],
)
print("wrote favicon.ico", ico_sizes)
