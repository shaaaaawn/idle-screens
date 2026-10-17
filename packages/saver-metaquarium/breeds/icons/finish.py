"""Crop, square and quantize rendered breed icons, then regenerate both copies.

  python3 breeds/icons/finish.py <dir-of-renders>

Expects <dir>/<breed>-<view>.png from render.py. Writes the TV imagesets and
src/lofi-npc-icons.ts (needs Pillow).
"""
import base64, io, os, sys
from PIL import Image

IDS = {"blowfish": 601, "hackerfish": 602, "glowfish": 603, "babyfish": 604, "shark": 605, "crab": 606,
       "dori": 608, "starfish": 609, "octopus": 610, "snail": 611, "dot": 612, "dolphin": 613}
VIEW = {"blowfish": "front", "starfish": "top", "octopus": "top"}
HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.normpath(os.path.join(HERE, "..", ".."))
ASSETS = os.path.normpath(os.path.join(PKG, "..", "..", "apps", "ios", "IdleScreens", "Assets.xcassets"))

def finish(path):
    im = Image.open(path).convert("RGBA")
    bb = im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    im = im.crop(bb)
    side = max(im.size); pad = int(side * 0.04)
    sq = Image.new("RGBA", (side + 2 * pad,) * 2, (0, 0, 0, 0))
    sq.paste(im, ((sq.size[0] - im.size[0]) // 2, (sq.size[1] - im.size[1]) // 2), im)
    sq = sq.resize((256, 256), Image.LANCZOS).resize((128, 128), Image.LANCZOS)
    buf = io.BytesIO()
    sq.quantize(colors=48, method=Image.Quantize.FASTOCTREE).save(buf, format="PNG", optimize=True)
    return buf.getvalue()

src = sys.argv[1]
lines = ["/**",
         " * Side-view icons of the unminted breeds, for the lofi tank's critters —",
         " * byte-identical to the TV's bundled `mqnpc<id>` imagesets. Rendered from",
         " * breeds/source/<breed>.glb in Blender (orthographic, rest pose, flat light,",
         " * 128 px, 48-colour palette); front view for the blowfish, top view for the",
         " * starfish and octopus. Generated — regenerate rather than hand-edit.",
         " */",
         "export const NPC_ICONS: Readonly<Record<number, string>> = {"]
for breed, i in IDS.items():
    png = finish(os.path.join(src, f"{breed}-{VIEW.get(breed, 'side')}.png"))
    d = os.path.join(ASSETS, f"mqnpc{i}.imageset"); os.makedirs(d, exist_ok=True)
    open(os.path.join(d, f"mqnpc{i}.png"), "wb").write(png)
    lines.append(f"  {i}: 'data:image/png;base64,{base64.b64encode(png).decode()}',")
lines.append("};")
open(os.path.join(PKG, "src", "lofi-npc-icons.ts"), "w").write("\n".join(lines) + "\n")
