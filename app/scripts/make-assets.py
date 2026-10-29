"""Render the shared agent-and-memory mark. Requires Node and Pillow."""
import json
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw

APP = Path(__file__).resolve().parent.parent
OUT = APP / "assets"
OUT.mkdir(exist_ok=True)
# The SVG logo and raster exports use identical geometry and source colors.
DATA = json.loads(subprocess.check_output([
    "node", "--experimental-strip-types", "--input-type=module", "-e",
    "import {pathToFileURL} from 'node:url'; "
    "const {markGeometry,markColors}=await import(pathToFileURL(process.argv[1]).href); "
    "process.stdout.write(JSON.stringify({geometry:markGeometry,light:markColors(false),dark:markColors(true)}));",
    str(APP / "lib/mark.ts"),
], text=True))


def mark(size, dark=False, inset=0.1):
    canvas = Image.new("RGB", (size * 4, size * 4), "#000000" if dark else "#FFFFFF")
    draw = ImageDraw.Draw(canvas)
    geometry = DATA["geometry"]
    colors = DATA["dark" if dark else "light"]
    scale = size * 4 * (1 - 2 * inset) / geometry["size"]
    offset = size * 4 * inset
    def dot(point, color):
        x, y, radius = offset + point["x"] * scale, offset + point["y"] * scale, point["radius"] * scale
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color)
    for point, color in zip(geometry["agents"], colors["agents"]):
        dot(point, color)
    dot(geometry["center"], colors["center"])
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


mark(1024).save(OUT / "icon.png")
mark(256).save(OUT / "favicon.png")
mark(1024).save(OUT / "splash.png")
mark(1024, dark=True).save(OUT / "splash-dark.png")

# Inspect the asset and the in-app mark at the actual small target size.
proof = APP / "verification"
proof.mkdir(exist_ok=True)
mark(29).save(proof / "icon-29.png")
mark(29, inset=0).save(proof / "mark-29-light.png")
mark(29, dark=True, inset=0).save(proof / "mark-29-dark.png")
