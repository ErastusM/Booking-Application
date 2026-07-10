#!/usr/bin/env python3
"""
Generate Bookplus app icons for the NEW brand — a lowercase "b" monogram with the
signature orange accent (customer = smile, business = underline), echoing the
"bookplus" wordmark. Drops the old calendar mark.

Two variants, each written to its app's public/ dir:
  - customer: ink "b" + orange smile on a white squircle  (matches the light logo)
  - business: off-white "b" + orange underline on an ink squircle (matches the dark logo)

Geometry on a 0..100 grid, drawn at 4x supersample then LANCZOS-downscaled.
Run:  python scripts/gen_icons.py
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SS = 4  # supersample

INK_TOP = (31, 31, 33)      # #1f1f21
INK_BOT = (4, 5, 5)         # #040505
INK = (4, 5, 5)             # #040505
OFFWHITE = (245, 246, 245)  # near-white "b" on the dark tile
WHITE = (255, 255, 255)
ORANGE = (240, 62, 22)      # #f03e16


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def ink_gradient(D):
    strip = Image.new("RGB", (1, D))
    for y in range(D):
        strip.putpixel((0, y), lerp(INK_TOP, INK_BOT, y / (D - 1)))
    return strip.resize((D, D))


def draw_mark(size, variant, rounded=True):
    """Return an RGBA image (size x size) of the icon for `variant`."""
    D = size * SS
    u = D / 100.0
    def U(*xs):
        return [x * u for x in xs]

    dark = variant == "business"
    b_color = OFFWHITE if dark else INK

    # ── background tile ────────────────────────────────────────────────
    mask = Image.new("L", (D, D), 0)
    md = ImageDraw.Draw(mask)
    if rounded:
        md.rounded_rectangle(U(2, 2, 98, 98), radius=22 * u, fill=255)
    else:
        md.rectangle([0, 0, D, D], fill=255)   # maskable / apple = full bleed

    bg = ink_gradient(D) if dark else Image.new("RGB", (D, D), WHITE)
    icon = Image.new("RGBA", (D, D), (0, 0, 0, 0))
    icon.paste(bg, (0, 0), mask)

    # ── the "b" (built as an alpha mask, so the counter shows the tile) ─
    bmask = Image.new("L", (D, D), 0)
    bd = ImageDraw.Draw(bmask)
    bd.rounded_rectangle(U(33, 20, 44, 80), radius=5 * u, fill=255)   # stem (ascender)
    bd.ellipse(U(33, 38, 75, 80), fill=255)                          # bowl
    bd.ellipse(U(47, 50, 63, 72), fill=0)                            # counter (hole)
    bd.rounded_rectangle(U(33, 20, 44, 80), radius=5 * u, fill=255)  # stem over hole's left edge
    b_layer = Image.new("RGBA", (D, D), b_color + (255,))
    icon.paste(b_layer, (0, 0), bmask)

    # ── orange accent under the "b" ────────────────────────────────────
    ad = ImageDraw.Draw(icon)
    if dark:
        ad.rounded_rectangle(U(46, 85, 63, 89), radius=2.5 * u, fill=ORANGE + (255,))   # underline
    else:
        ad.arc(U(37, 74, 67, 96), start=22, end=158, fill=ORANGE + (255,), width=int(4.4 * u))  # smile

    return icon.resize((size, size), Image.LANCZOS)


def gen_for(app, variant):
    out = os.path.join(ROOT, "apps", app, "public")
    os.makedirs(out, exist_ok=True)

    # rounded (purpose: any) — tabs / PWA lists
    for size, name in [(64, "favicon-64.png"), (192, "icon-192.png"), (512, "icon-512.png")]:
        draw_mark(size, variant, rounded=True).save(os.path.join(out, name))
    # maskable (full-bleed) — OS applies its own mask
    draw_mark(192, variant, rounded=False).save(os.path.join(out, "icon-192-maskable.png"))
    draw_mark(512, variant, rounded=False).save(os.path.join(out, "icon-512-maskable.png"))
    # apple touch — full bleed, opaque (iOS rounds it itself)
    draw_mark(180, variant, rounded=False).convert("RGB").save(os.path.join(out, "apple-touch-icon.png"))
    # favicon.ico (multi-size, rounded)
    ico = [draw_mark(s, variant, rounded=True) for s in (16, 32, 48)]
    ico[0].save(os.path.join(out, "favicon.ico"), format="ICO",
                sizes=[(16, 16), (32, 32), (48, 48)], append_images=ico[1:])
    print(f"  {app}: wrote 7 icons ({variant})")


if __name__ == "__main__":
    print("Generating new-brand icons…")
    gen_for("customer", "customer")
    gen_for("business", "business")
    print("Done.")
