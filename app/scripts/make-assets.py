"""Rebuild the geometric app mark; requires Pillow only for asset authoring."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "assets"
OUT.mkdir(exist_ok=True)


def mark(size, paper, ink):
    # Three linked strokes held in a square: one shared memory, many readers.
    image = Image.new("RGB", (size, size), paper)
    draw = ImageDraw.Draw(image)
    unit = size / 1024
    def box(coords, fill):
        draw.rectangle(tuple(round(x * unit) for x in coords), fill=fill)
    box((222, 222, 802, 802), ink)
    box((244, 244, 780, 780), paper)
    box((366, 358, 396, 666), ink)
    box((497, 432, 527, 592), "#E2462C")
    box((628, 358, 658, 666), ink)
    return image


mark(1024, "#F3F0E8", "#151513").save(OUT / "icon.png")
mark(256, "#F3F0E8", "#151513").save(OUT / "favicon.png")
mark(1024, "#F3F0E8", "#151513").save(OUT / "splash.png")
mark(1024, "#0F0F0D", "#EDEAE2").save(OUT / "splash-dark.png")
