"""
Rig and animate the hackerfish (half fish, half computer): breeds/source/
hackerfish.glb in, breeds/rig/hackerfish.glb out.

    blender -b -P breeds/rig/hackerfish.py      (from packages/saver-metaquarium)

The model is never edited; the rig only says which part each voxel face
belongs to (common.py, README "Rigged breeds"). Its face is not animated here:
the screen is a display the tank draws (src/screen.ts) — expressions, code
rain, a loading spinner — on the screen voxels' front faces.

The lattice: 2-unit voxels, every plane on odd coordinates. Blender axes
(glTF import, Z up): it faces -Y; its left is +X. Voxel index =
(floor((x-1)/2), floor((y-1)/2), floor((z-1)/2)).

    body    the monitor-head box (Material.007), iy -9..2, its bezel the front
            ring at iy -9
    screen  the 5x5 display recessed one voxel behind the bezel (iy -8): the
            black glass (Material.002) and the face pixels (Material.006)
    fins    the purple plates on its flanks (Material.008), x ±7..9, hinged at
            their front edges (y -11): they paddle
    tail    the taper and the fin behind it (Material.007, iy >= 3)

Clips (30 fps; the tank sets their times and weights, never update(dt)):

    swim    1 s loop: the tail wags, the fins paddle in turn, the box answers
    type    2.4 s: the fins tap like hands on a keyboard, leaning in to the
            screen — hacking
    glitch  1 s: a shiver through the box, the screen rattling in its bezel
"""
import math
import os
import sys

import bpy

sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (  # noqa: E402
    Pose, apply_pose, bake, begin, build_armature, env, export, in_scene, lattice, load_source, out_path, segment,
)


def bone_of(ix, iy, iz, mat):
    if mat in ('Material.002', 'Material.006'):
        return 'screen'
    if mat == 'Material.008':
        return 'fin.R' if ix < -1 else 'fin.L'  # x < 0 is its right (it faces -Y)
    if iy >= 3:
        return 'tail'
    return 'body'


def bone_table():
    return {
        'root': ((0, 0, -9), (0, 0, -6), None),
        'body': ((0, 0, -3), (0, 0, 3), 'root'),
        'screen': ((0, -15, 0), (0, -17, 0), 'body'),
        'fin.R': ((-7, -11, 0), (-7, -1, 0), 'body'),
        'fin.L': ((7, -11, 0), (7, -1, 0), 'body'),
        'tail': ((0, 7, 0), (0, 17, 0), 'body'),
    }


def fins(p, out_r=0.0, out_l=0.0, tap_r=0.0, tap_l=0.0):
    """out: the fin's back edge swings away from the box; tap: it pats down
    about its own length, like a hand on keys."""
    p.turn('fin.R', 'z', out_r)
    p.turn('fin.L', 'z', -out_l)
    p.turn('fin.R', 'y', tap_r)
    p.turn('fin.L', 'y', -tap_l)


def swim(t, T=1.0):
    p = Pose()
    w = 2 * math.pi * t / T
    p.turn('tail', 'z', 0.42 * math.sin(w))
    p.turn('body', 'z', -0.05 * math.sin(w - 0.3))
    p.move('body', (0, 0, 0.3 * math.sin(2 * w)))
    fins(p, out_r=0.12 + 0.22 * (0.5 + 0.5 * math.sin(w)), out_l=0.12 + 0.22 * (0.5 - 0.5 * math.sin(w)))
    return p


def type_(t, T=2.4):
    p = Pose()
    on = env(t, 0.0, 0.3, T - 0.35, T)
    keys = 2 * math.pi * 3.2 * t
    fins(p, out_r=0.3 * on, out_l=0.3 * on,
         tap_r=0.35 * on * abs(math.sin(keys)), tap_l=0.35 * on * abs(math.sin(keys + 1.3)))
    p.turn('body', 'x', 0.08 * on)                                    # leaning in to the screen
    p.move('body', (0, 0, 0.25 * on * math.sin(2 * keys)))
    p.turn('screen', 'x', 0.05 * on * math.sin(keys * 0.5))
    p.turn('tail', 'z', 0.15 * on * math.sin(2 * math.pi * t / 1.2))
    return p


def glitch(t, T=1.0):
    p = Pose()
    on = env(t, 0.0, 0.1, 0.7, T)
    p.turn('body', 'z', 0.06 * on * math.sin(2 * math.pi * 11 * t))
    p.turn('body', 'y', 0.04 * on * math.sin(2 * math.pi * 7 * t + 1))
    # The screen rattles in its bezel: little steps, not a blur.
    jx = 0.5 * on * math.copysign(1, math.sin(2 * math.pi * 8 * t))
    p.move('screen', (jx, 0, 0.3 * on * math.copysign(1, math.sin(2 * math.pi * 5 * t + 2))))
    fins(p, out_r=0.25 * on * abs(math.sin(2 * math.pi * 6 * t)), out_l=0.25 * on * abs(math.sin(2 * math.pi * 6 * t + 2)))
    return p


CLIPS = [('swim', swim, 1.0), ('type', type_, 2.4), ('glitch', glitch, 1.0)]


def main():
    scene = bpy.data.scenes.get('hackerfish') or bpy.data.scenes.new('hackerfish')
    with in_scene(scene):
        begin('hackerfish')
        meshes = load_source('hackerfish')
        pitch, phase = lattice(meshes)
        assert (pitch, phase) == (2.0, (1.0, 1.0, 1.0)), (pitch, phase)
        counts = segment(meshes, bone_of, pitch, phase)
        rig = build_armature('Hackerfish', meshes, bone_table())
        keyed = {pb.name: ['rotation_quaternion'] + (['location'] if pb.name in ('body', 'screen') else [])
                 for pb in rig.pose.bones if pb.name != 'root'}
        clips = bake(rig, 'hackerfish', CLIPS, apply_pose, ('swim',), keyed)
        out = export(rig, out_path('hackerfish'), {})
        return {'faces_per_bone': counts, 'bones': len(rig.data.bones), 'clips': clips, 'out': out,
                'bytes': os.path.getsize(out)}


if __name__ == '__main__':
    result = main()
    print(result)
