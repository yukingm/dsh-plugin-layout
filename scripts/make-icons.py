"""Render the raster storefront tiles from the same geometry as icon.svg.

Storefronts draw the tile at about 96px and refuse SVG, so both sizes are
plain PNGs generated from this script (Pillow, no other dependency):

    python scripts/make-icons.py

Keep the geometry in sync with icon.svg.
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"

FRAME = (74, 107, 138, 255)      # #4a6b8a
BAR = (127, 162, 192, 255)       # #7fa2c0
CANVAS = (0, 0, 0, 0)


def render(size: int) -> Image.Image:
    scale = size / 64
    image = Image.new("RGBA", (size, size), CANVAS)
    draw = ImageDraw.Draw(image)

    def box(x, y, w, h, radius, fill=None, outline=None):
        draw.rounded_rectangle(
            [round(x * scale), round(y * scale), round((x + w) * scale), round((y + h) * scale)],
            radius=round(radius * scale),
            fill=fill,
            outline=outline,
            width=round(4 * scale),
        )

    box(6, 8, 52, 48, 8, outline=FRAME)
    box(14, 20, 20, 6, 3, fill=FRAME)
    box(14, 31, 14, 6, 3, fill=BAR)
    box(14, 42, 24, 6, 3, fill=BAR)

    width = round(4 * scale)
    x = round(44 * scale)
    draw.line([x, round(22 * scale), x, round(34 * scale)], fill=FRAME, width=width)
    draw.line([x, round(34 * scale), x - round(5 * scale), round(29 * scale)], fill=FRAME, width=width)
    draw.line([x, round(34 * scale), x + round(5 * scale), round(29 * scale)], fill=FRAME, width=width)
    return image


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    for size in (180, 512):
        # Overlays need an opaque tile; a transparent background disappears on
        # light and dark storefronts alike, so the border color is the backdrop.
        canvas = Image.new("RGBA", (size, size), (255, 255, 255, 0))
        canvas.alpha_composite(render(size))
        canvas.save(ASSETS / f"icon-{size}.png", optimize=True)
        print(f"assets/icon-{size}.png")


if __name__ == "__main__":
    main()
