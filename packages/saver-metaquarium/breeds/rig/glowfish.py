"""
Rig and animate the glowfish (an anglerfish): breeds/source/glowfish.glb in,
breeds/rig/glowfish.glb out.

    blender -b -P breeds/rig/glowfish.py        (from packages/saver-metaquarium)

The model is never edited; the rig only says which part each voxel face
belongs to (common.py has the shared machinery, README "Rigged breeds" the
rules). The delivered nodes carry transforms: load_source bakes them first.

The lattice: 2-unit voxels, x planes on odd coordinates, y and z on even
ones. Blender axes (glTF import, Z up): it faces -Y; its left is +X. Voxel
index = (floor((x-1)/2), floor(y/2), floor(z/2)).

    body    the great open lower jaw: PrimaryColor, iz -7..-1, with the teeth
            ringing its rim (Mouth, iz 0)
    tail    the fin cross at the back (PrimaryColor, iy >= 4)
    head    the dome over the back half of the mouth (SecondaryColor, iz 0..3),
            hinged at its back edge (y 8, z 0): it flips up to open the mouth
    eyes    one glowing voxel each (Eyes, ix -2 and 0, at iz 1): they blink by
            squashing flat about their centres
    lure    the illicium in three links up the middle column (SecondaryColor,
            ix -1, iz >= 4) — rising (iy >= -3), the arch (iy -6..-4) and the
            droop (iy -7) — with the esca, the glowing bulb (GLOW-White), on
            the last

Clips (30 fps; the tank sets their times and weights, never update(dt)):

    swim    1 s loop: the tail beats, the body answers, the lure trails and
            swings on its own lag down the links
    lure    4 s: hovers nose-down, mouth agape, the bait dangled in front of
            it and twitched — the angler fishing
    chomp   1.4 s: the head flips wide open and the fish lunges, then the jaws
            snap shut with a shudder and the lure flicks back
    blink   0.3 s: both eyes squash shut and open

The one-shots start and end on the rest pose; the blink keys only the eyes'
scale, so it layers over any of the others.
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


def bone_of(ix, iy, iz, mat):
    if mat == 'GLOW-White':
        return 'lure3'
    if mat == 'Eyes':
        return 'eye.R' if ix <= -2 else 'eye.L'  # x < 0 is its right (it faces -Y)
    if mat == 'SecondaryColor':
        if ix == -1 and iz >= 4:  # the illicium, up the middle column
            return 'lure1' if iy >= -3 else 'lure2' if iy >= -6 else 'lure3'
        return 'head'
    if mat == 'PrimaryColor' and iy >= 4:
        return 'tail'
    return 'body'  # the lower jaw, and the teeth on its rim


def bone_table():
    return {
        'root': ((0, 0, -14), (0, 0, -11), None),
        'body': ((0, 0, -6), (0, 0, 0), 'root'),
        'tail': ((0, 8, -3), (0, 14, -3), 'body'),
        'head': ((0, 8, 0), (0, -2, 0), 'body'),
        'eye.R': ((-2, -3, 3), (-2, -3, 4), 'head'),
        'eye.L': ((2, -3, 3), (2, -3, 4), 'head'),
        'lure1': ((0, -2, 8), (0, -6, 13), 'head'),
        'lure2': ((0, -6, 13), (0, -12, 10), 'lure1'),
        'lure3': ((0, -12, 10), (0, -13, 4), 'lure2'),
    }


def mouth(p, open_):
    """The head flips up about its back edge: the mouth opens."""
    p.turn('head', 'x', -open_)


def lure(p, bend=0.0, sway=0.0, swing=0.0, flick=0.0):
    """bend: the rod droops forward-down (link by link); sway: side to side;
    swing: the bulb's pendulum; flick: whips back over the head."""
    p.turn('lure1', 'x', 0.35 * bend - flick)
    p.turn('lure2', 'x', 0.5 * bend - 0.6 * flick)
    p.turn('lure3', 'x', swing)
    p.turn('lure2', 'z', sway)
    p.turn('lure3', 'z', 0.6 * sway)


def swim(t, T=1.0):
    p = Pose()
    w = 2 * math.pi * t / T
    p.turn('tail', 'z', 0.5 * math.sin(w))
    p.turn('body', 'z', -0.07 * math.sin(w - 0.3))
    p.turn('body', 'y', 0.03 * math.sin(w))
    mouth(p, 0.05 + 0.03 * math.sin(2 * w))  # breathing
    # The rod trails the beat, each link a little later: a whip, not a stick.
    p.turn('lure1', 'x', 0.05 * math.sin(w - 0.8))
    p.turn('lure2', 'x', 0.09 * math.sin(w - 1.4))
    p.turn('lure3', 'x', 0.2 * math.sin(w - 2.0))
    p.turn('lure2', 'z', -0.08 * math.sin(w - 1.2))
    p.turn('lure3', 'z', -0.14 * math.sin(w - 1.9))
    return p


def luring(t, T=4.0):
    p = Pose()
    on = env(t, 0.0, 0.6, T - 0.6, T)
    p.turn('body', 'x', 0.1 * on)  # nose down, presenting the bait
    mouth(p, 0.16 * on)           # agape, waiting
    # Twitch, twitch… pause… twitch: small quick swings of the bulb, and a
    # slow circle of the whole rod.
    twitch = sum(env(t, a, a + 0.08, a + 0.16, a + 0.3) for a in (1.0, 1.35, 2.4, 2.65, 2.9))
    circle = 2 * math.pi * t / 1.7
    lure(p, bend=0.75 * on, sway=0.22 * math.sin(circle) * on, swing=(0.15 * math.cos(circle) + 0.32 * twitch) * on)
    p.turn('tail', 'z', 0.18 * math.sin(2 * math.pi * t / 1.3) * on)  # a slow fan, holding station
    return p


def chomp(t, T=1.4):
    p = Pose()
    gape = track(t, [(0, 0), (0.32, 0.62), (0.42, 0.66), (0.5, -0.04), (0.62, 0.03), (0.75, 0), (T, 0)])
    mouth(p, gape)
    lunge = env(t, 0.25, 0.42, 0.5, 0.9)
    p.move('body', (0, -2.2 * lunge, 0))
    p.turn('body', 'x', -0.12 * env(t, 0.1, 0.32, 0.42, 0.6))  # rears back to strike
    shudder = 0.06 * math.sin(2 * math.pi * 9 * t) * env(t, 0.48, 0.52, 0.6, 0.85)
    p.turn('body', 'z', shudder)
    p.turn('tail', 'z', 0.65 * math.sin(2 * math.pi * (t - 0.25) / 0.35) * env(t, 0.2, 0.3, 0.55, 0.8))
    lure(p, flick=0.5 * env(t, 0.3, 0.45, 0.6, 1.2), swing=-0.3 * env(t, 0.35, 0.5, 0.7, 1.3))
    return p


def blink(t, T=0.3):
    p = Pose()
    shut = track(t, [(0, 0), (0.1, 1), (0.14, 1), (T, 0)])
    for side in 'RL':
        # Bone frame: y runs along the bone, i.e. world up. Flat, a touch wider.
        p.scale[f'eye.{side}'] = (1 + 0.15 * shut, 1 - 0.88 * shut, 1 + 0.15 * shut)
    return p


CLIPS = [('swim', swim, 1.0), ('lure', luring, 4.0), ('chomp', chomp, 1.4), ('blink', blink, 0.3)]


def main():
    scene = bpy.data.scenes.get('glowfish') or bpy.data.scenes.new('glowfish')
    with in_scene(scene):
        begin('glowfish')
        meshes = load_source('glowfish')
        pitch, phase = lattice(meshes)
        assert (pitch, phase) == (2.0, (1.0, 0.0, 0.0)), (pitch, phase)
        counts = segment(meshes, bone_of, pitch, phase)
        rig = build_armature('Glowfish', meshes, bone_table())
        keyed = {}
        for pb in rig.pose.bones:
            if pb.name == 'root':
                continue
            keyed[pb.name] = ['rotation_quaternion']
            if pb.name == 'body':
                keyed[pb.name].append('location')
            if pb.name.startswith('eye.'):
                keyed[pb.name].append('scale')
        clips = bake(rig, 'glowfish', CLIPS, apply_pose, ('swim',), keyed)
        out = export(rig, out_path('glowfish'), {})
        return {'faces_per_bone': counts, 'bones': len(rig.data.bones), 'clips': clips, 'out': out,
                'bytes': os.path.getsize(out)}


if __name__ == '__main__':
    result = main()
    print(result)
