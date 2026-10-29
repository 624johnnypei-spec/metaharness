"""Render the layered-memory symbol. Pillow is only an authoring dependency."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "assets"
OUT.mkdir(exist_ok=True)
LAYERS = [
    [(10, 37), (32, 49), (54, 37), (54, 46), (32, 58), (10, 46)],
    [(10, 24), (32, 36), (54, 24), (54, 33), (32, 45), (10, 33)],
    [(10, 20), (32, 8), (54, 20), (32, 32)],
]


def mark(size, background, foreground):
    canvas = Image.new("RGB", (size * 3, size * 3), background)
    draw = ImageDraw.Draw(canvas)
    scale = size * 3 * 0.72 / 64
    offset = size * 3 * 0.14
    for points in LAYERS:
        draw.polygon([(round(offset + x * scale), round(offset + y * scale)) for x, y in points], fill=foreground)
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


mark(1024, "#FFFFFF", "#0066CC").save(OUT / "icon.png")
mark(256, "#FFFFFF", "#0066CC").save(OUT / "favicon.png")
mark(1024, "#FFFFFF", "#0066CC").save(OUT / "splash.png")
mark(1024, "#000000", "#64ABFF").save(OUT / "splash-dark.png")
