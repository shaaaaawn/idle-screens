"""
Rig and animate the sea turtle: breeds/source/seaturtle.glb in,
breeds/rig/seaturtle.glb out.

    blender -b -P breeds/rig/seaturtle.py        (from packages/saver-metaquarium)

The source is the MINTED breed's one model (breeds/minted.mjs), cut into paint
regions MINT-R<n> / MINT-EYE-R<n>: all 16 turtle tokens are this model in
their own paint, so this one rig swims them all. The model is never edited.

Facing. Every delivered turtle's node carries a -30° yaw over perfectly
axis-aligned voxels; the canonical source drops it (breeds/minted.mjs: the
mesh as authored, and a rigged breed without its whole-body clip), so the
turtle comes in square to the axes, facing -Y (glTF +Z), the rig convention.

The lattice: 2-unit voxels, planes at x ≡ 0.09, y ≡ 1.81, z ≡ 0.81 (mod 2);
the shell is centred on x = 2.09. Its left is +X. In voxel indices (ix
across, iy nose -> tail, iz up), read off the occupancy:

    head      the neck and head, iy <= -7, both eyes (rigid on it)
    shell     everything else: the carapace and plastron (its front rim is iy -6)
    front.R   the right fore-flipper, ix <= -6, iy -6..1 (it hangs out and down)
    front.L   the left, ix >= 7
    rear.R    the right hind flipper: iy >= 4 at ix <= -6
    rear.L    the left: iy >= 4 at ix >= 7, or iy >= 6 at ix >= 5

Clips (30 fps; the tank sets their times and weights, never update(dt)):

    swim     2.4 s loop: the fore-flippers fly — down and back in the power
             stroke, feathered up and forward in the recovery — the hind
             flippers trail and trim, the head and shell bob against them
    glide    5 s loop: fore-flippers swept back and held, small trims, the
             head slowly turning
    look     3 s: the head turns to one side, holds, comes back
    paddle   2 s loop: hanging in the water on its hind flippers, the fore-
             flippers sculling

The one-shot starts and ends on the rest pose.
"""
import math
import os
import sys

import bpy

sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (  # noqa: E402
    Pose, apply_pose, bake, begin, in_scene, build_armature, env, export, lattice, load_source, out_path, segment, track,
)

BREED = 'seaturtle'
CX = 2.09  # the shell's centre line
NECK_X = 1.09  # the head's (its eyes sit a voxel left of the shell's middle)


def bone_of(ix, iy, iz, mat):
    if 'EYE' in mat or iy <= -7:
        return 'head'
    if iy >= 4 and ix <= -6:
        return 'rear.R'
    if (iy >= 4 and ix >= 7) or (iy >= 6 and ix >= 5):
        return 'rear.L'
    if -6 <= iy <= 1 and ix <= -6:
        return 'front.R'
    if -6 <= iy <= 1 and ix >= 7:
        return 'front.L'
    return 'shell'


def bone_table():
    # Blender space: nose -Y, its left +X, up +Z. Pivots on the shell's edge.
    return {
        'root': ((CX, 0, -16), (CX, 0, -13), None),
        'shell': ((CX, 8, -2), (CX, -8, -2), 'root'),
        'head': ((NECK_X, -10.19, -1), (NECK_X, -18, 0), 'shell'),
        'front.R': ((-9.91, -3.2, -5), (-20, -1, -7), 'shell'),
        'front.L': ((14.09, -3.2, -5), (24, -1, -7), 'shell'),
        'rear.R': ((-9.91, 9.81, -5), (-14, 15, -6), 'shell'),
        'rear.L': ((12.09, 9.81, -5), (16, 15, -6), 'shell'),
    }


def flippers(p, stroke=0.0, sweep=0.0, feather=0.0):
    """Both fore-flippers, mirrored. stroke: + is DOWN (the tip drops, about
    the body's long axis); sweep: + is BACK (the tip swings toward the tail,
    about Z); feather: + pitches the leading edge up (about the flipper's
    own span, approximated by X)."""
    p.turn('front.R', 'y', stroke)
    p.turn('front.L', 'y', -stroke)
    p.turn('front.R', 'z', sweep)
    p.turn('front.L', 'z', -sweep)
    p.turn('front.R', 'x', feather)
    p.turn('front.L', 'x', feather)


def hinds(p, trim=0.0, paddle_r=0.0, paddle_l=0.0):
    """trim: both hind flippers tilt (+ up); paddle: each one's own stroke."""
    p.turn('rear.R', 'y', -trim + paddle_r)
    p.turn('rear.L', 'y', trim - paddle_l)


def swim(t, T=2.4):
    p = Pose()
    w = 2 * math.pi * t / T
    # The power stroke is the down-and-back half; the recovery up and forward,
    # feathered so it slips through. The wing's tip traces a loop, not a line.
    flippers(p, stroke=0.5 * math.sin(w), sweep=0.32 * math.sin(w - math.pi / 2), feather=0.25 * math.cos(w))
    hinds(p, trim=0.08 * math.sin(w - 1.2))
    # The body rides the strokes: lifted a little on each down-beat.
    p.move('shell', (0, 0, 0.6 * math.sin(w - 0.4)))
    p.turn('shell', 'x', -0.035 * math.sin(w - 0.6))
    p.turn('head', 'x', 0.06 * math.sin(w - 1.4))
    return p


def glide(t, T=5.0):
    p = Pose()
    w = 2 * math.pi * t / T
    flippers(p, stroke=0.12 + 0.05 * math.sin(w), sweep=0.5, feather=0.08 * math.sin(2 * w))
    hinds(p, trim=0.05 * math.sin(w + 0.8))
    p.turn('head', 'z', 0.16 * math.sin(w))
    p.turn('head', 'x', 0.04 * math.sin(2 * w))
    return p


def look(t, T=3.0):
    p = Pose()
    turn = track(t, [(0, 0), (0.7, 0.42), (1.9, 0.42), (2.3, 0.2), (T, 0)])
    p.turn('head', 'z', turn)
    p.turn('head', 'x', -0.08 * env(t, 0.4, 0.9, 1.8, 2.6))
    flippers(p, sweep=0.2 * env(t, 0.0, 0.6, 2.2, T))
    return p


def paddle(t, T=2.0):
    p = Pose()
    w = 2 * math.pi * t / T
    flippers(p, stroke=0.18 * math.sin(w), sweep=-0.1 + 0.18 * math.sin(w + math.pi / 2), feather=0.2 * math.cos(w))
    hinds(p, paddle_r=0.35 * math.sin(w), paddle_l=0.35 * math.sin(w + math.pi))
    p.turn('head', 'x', 0.05 * math.sin(w))
    return p


CLIPS = [('swim', swim, 2.4), ('glide', glide, 5.0), ('look', look, 3.0), ('paddle', paddle, 2.0)]


def main():
    scene = bpy.data.scenes.get(BREED) or bpy.data.scenes.new(BREED)
    with in_scene(scene):
        begin(BREED)
        meshes = load_source(BREED)
        pitch, phase = lattice(meshes)
        assert pitch == 2.0 and tuple(round(v, 2) for v in phase) == (0.09, 1.81, 0.81), (pitch, phase)
        counts = segment(meshes, bone_of, pitch, phase)
        rig = build_armature('Seaturtle', meshes, bone_table())
        keyed = {pb.name: ['rotation_quaternion'] for pb in rig.pose.bones if pb.name != 'root'}
        keyed['shell'].append('location')
        clips = bake(rig, BREED, CLIPS, apply_pose, ('swim', 'glide', 'paddle'), keyed)
        out = export(rig, out_path(BREED), {})
        return {'faces_per_bone': counts, 'bones': len(rig.data.bones), 'clips': clips, 'out': out,
                'bytes': os.path.getsize(out)}


if __name__ == '__main__':
    result = main()
    print(result)
