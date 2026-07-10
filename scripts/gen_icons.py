#!/usr/bin/env python3
"""
Generate Bookplus app icons from the ACTUAL brand wordmark (not a monogram):

  - customer: lowercase "bookplus" — book (ink) · plus (orange) + orange smile,
              on a white tile   (matches the "for customers" logo)
  - business: "Bookplus" — Book (off-white) · plus (orange) + orange underline,
              on an ink tile    (matches the "for business" logo)

The wordmark is rendered in the real brand display face, Plus Jakarta Sans
ExtraBold, taken straight from the app's self-hosted @fontsource-variable copy
(woff2 → ttf in-memory via fontTools) so the icons match the in-app <Wordmark>.

Two-colour trick: draw the whole word in orange, then re-draw the "book"/"Book"
prefix in the ink/white colour on top — the prefix glyphs land in the exact same
pixels, leaving "plus" orange with zero kerning maths.

Requires:  pip install pillow fonttools brotli
Run:       python scripts/gen_icons.py
"""
import io
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SS = 4  # supersample

INK_TOP = (31, 31, 33)      # #1f1f21  (business tile gradient top)
INK_BOT = (4, 5, 5)         # #040505  (business tile gradient bottom / brand black)
INK = (4, 5, 5)             # ink "book" on the light tile
OFFWHITE = (245, 246, 245)  # near-white "Book" on the dark tile
WHITE = (255, 255, 255)
ORANGE = (240, 62, 22)      # #f03e16

# The real brand display face, straight from the app's self-hosted copy.
FONT_WOFF2 = os.path.join(
    ROOT, "node_modules", "@fontsource-variable", "plus-jakarta-sans",
    "files", "plus-jakarta-sans-latin-wght-normal.woff2",
)

_ttf_bytes = None


def _wordmark_ttf():
    """Decompress the variable woff2 to raw ttf bytes once (cached)."""
    global _ttf_bytes
    if _ttf_bytes is None:
        try:
            from fontTools.ttLib import TTFont
        except ImportError as e:
            raise SystemExit("Need fonttools+brotli:  pip install fonttools brotli") from e
        f = TTFont(FONT_WOFF2)
        f.flavor = None  # strip woff2 wrapper -> plain ttf FreeType can read
        buf = io.BytesIO()
        f.save(buf)
        _ttf_bytes = buf.getvalue()
    return _ttf_bytes


def _font(px):
    """Plus Jakarta Sans pinned to ExtraBold (wght 800) at `px`."""
    font = ImageFont.truetype(io.BytesIO(_wordmark_ttf()), int(px))
    try:
        font.set_variation_by_axes([800])
    except Exception:
        pass
    return font


def draw_mark(size, variant, rounded=True, safe=1.0):
    """Return an RGBA (size x size) icon for `variant`.

    rounded : rounded-rect tile (any-purpose) vs full-bleed (maskable/apple).
    safe    : wordmark width as a fraction that leaves a safe margin
              (smaller for maskable so nothing gets clipped by the OS mask).
    """
    D = size * SS
    dark = variant == "business"
    word = "Bookplus" if dark else "bookplus"
    prefix = "Book" if dark else "book"
    book_color = OFFWHITE if dark else INK

    # ── background tile ────────────────────────────────────────────────
    mask = Image.new("L", (D, D), 0)
    md = ImageDraw.Draw(mask)
    if rounded:
        md.rounded_rectangle([2 * SS, 2 * SS, D - 2 * SS, D - 2 * SS], radius=22 * SS, fill=255)
    else:
        md.rectangle([0, 0, D, D], fill=255)

    if dark:
        bg = Image.new("RGB", (D, D))
        bd = ImageDraw.Draw(bg)
        for y in range(D):
            t = y / (D - 1)
            bd.line([(0, y), (D, y)], fill=tuple(
                round(INK_TOP[i] + (INK_BOT[i] - INK_TOP[i]) * t) for i in range(3)))
    else:
        bg = Image.new("RGB", (D, D), WHITE)

    icon = Image.new("RGBA", (D, D), (0, 0, 0, 0))
    icon.paste(bg, (0, 0), mask)
    draw = ImageDraw.Draw(icon)

    # ── size the wordmark to the target width ──────────────────────────
    target_w = D * 0.78 * safe
    fpx = D * 0.30
    f = _font(fpx)
    w = f.getlength(word)
    fpx *= target_w / w                       # single linear correction
    f = _font(fpx)
    w = f.getlength(word)
    pre_w = f.getlength(prefix)

    l, t, r, b = f.getbbox(word)
    text_h = b - t
    x0 = (D - w) / 2
    # nudge the word up so the smile/underline sits inside the tile, centred as a block
    accent_room = D * 0.085
    y0 = (D - text_h - accent_room) / 2

    # two-colour wordmark: full word orange, then prefix over it
    draw.text((x0 - l, y0 - t), word, font=f, fill=ORANGE)
    draw.text((x0 - l, y0 - t), prefix, font=f, fill=book_color)

    # ── orange accent under "plus" ─────────────────────────────────────
    plus_x1 = x0 + pre_w
    word_right = x0 + w
    accent_y = y0 + text_h + D * 0.015
    if dark:
        # short rounded underline beneath "plus"
        inset = w * 0.015
        th = D * 0.020
        draw.rounded_rectangle(
            [plus_x1 + inset, accent_y, word_right - inset, accent_y + th],
            radius=th / 2, fill=ORANGE)
    else:
        # wide shallow smile beneath most of the word
        sm_x1 = x0 + w * 0.14
        sm_x2 = word_right + w * 0.01
        sm_cx = (sm_x1 + sm_x2) / 2
        sm_w = sm_x2 - sm_x1
        sm_h = D * 0.11
        box = [sm_cx - sm_w / 2, accent_y - sm_h * 0.55,
               sm_cx + sm_w / 2, accent_y + sm_h]
        draw.arc(box, start=22, end=158, fill=ORANGE, width=int(D * 0.028))

    return icon.resize((size, size), Image.LANCZOS)


def gen_for(app, variant):
    out = os.path.join(ROOT, "apps", app, "public")
    os.makedirs(out, exist_ok=True)

    # rounded (purpose: any) — tabs / PWA lists
    for size, name in [(64, "favicon-64.png"), (192, "icon-192.png"), (512, "icon-512.png")]:
        draw_mark(size, variant, rounded=True).save(os.path.join(out, name))
    # maskable (full-bleed, tighter safe area) — OS applies its own mask
    draw_mark(192, variant, rounded=False, safe=0.82).save(os.path.join(out, "icon-192-maskable.png"))
    draw_mark(512, variant, rounded=False, safe=0.82).save(os.path.join(out, "icon-512-maskable.png"))
    # apple touch — full bleed, opaque (iOS rounds it itself)
    draw_mark(180, variant, rounded=False).convert("RGB").save(os.path.join(out, "apple-touch-icon.png"))
    # favicon.ico (multi-size, rounded)
    ico = [draw_mark(s, variant, rounded=True) for s in (16, 32, 48)]
    ico[0].save(os.path.join(out, "favicon.ico"), format="ICO",
                sizes=[(16, 16), (32, 32), (48, 48)], append_images=ico[1:])
    print(f"  {app}: wrote 7 icons ({variant})")


if __name__ == "__main__":
    print("Generating wordmark icons…")
    gen_for("customer", "customer")
    gen_for("business", "business")
    print("Done.")
