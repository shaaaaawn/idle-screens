"""
Rig and animate the babyfish: breeds/source/babyfish.glb in, breeds/rig/babyfish.glb out.

    blender -b -P breeds/rig/babyfish.py        (from packages/saver-metaquarium)

The babies of the metaquarium: a little box of a fish, blue to green in
bands, a yellow stripe, a ridge of a dorsal fin, eyes on stalks, a forked
tail. The rig never edits the model (common.py has the machinery); every face
is weighted to one part, cut by position — the body's parts as a soft spine
(the vertices on each joint blend between the two), so it bends as one piece (the fork's tips sit half a
voxel off the lattice). Blender axes: it faces -Y, its left is +X, Z is up;
voxel centres on even coordinates.

    body    the two middle slabs (y -10, -8), the stripe with them
    head    the front two slabs (y -14, -12), the mouth dot on its face
    eye.L/R the eye stalks (white in front, black behind) at x = ±4
    dorsal  the fin's three cubes along the top (z 8)
    tail1   the slab at y -6
    tail2   the slab at y -4
    fin     the tail's stem (y -2) and its fork (y 0)

Clips (30 fps; the tank sets their times, never update(dt)):

    swim    0.5 s loop. A quick, fluttery baby stroke: the tail a wave down
            three links, the head countering it, a bob and a squash-and-
            stretch twice a stroke. The tank phases it by the distance swum.
    zoom    1.2 s. A wind-up (tail curled, body squashed), then a burst of
            fast flutters, stretched long, eyes narrowed.
    wiggle  1.6 s. A happy shimmy: rolling side to side, tail flicking,
            eyes squeezed shut in two happy arcs, little hops.
    flip    1.4 s. A barrel roll, a hop up and over.
    peek    2.4 s. It stops, tilts its head one way and the other, and
            blinks twice: who's there?
    blink   0.3 s. The eyes only (every other clip leaves them at rest, so
            the intake keeps no eye channels there): it layers over any clip.

The one-shots start and end on the rest pose.
"""
import math
import os
import sys

import bpy

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (  # noqa: E402
    Pose, apply_pose, bake, begin, build_armature, ease, env, export, in_scene, lattice, load_source, out_path, segment,
    track,
)


def bone_of(x, y, z, mat):
    if abs(x) > 3:
        return 'eye.L' if x > 0 else 'eye.R'
    if z > 7:
        return 'dorsal'
    if y < -11:
        return 'head'
    if y < -7:
        return 'body'
    if y < -5:
        return 'tail1'
    if y < -3:
        return 'tail2'
    return 'fin'


# A soft spine, as the shark's: the body is one piece that bends, not a stack
# of blocks that crack apart as the tail beats. The vertices on each joint's
# plane blend half and half between the two parts; every other one stays with
# its own. The eyes and the dorsal fin stay rigid.
SPINE = ['head', 'body', 'tail1', 'tail2', 'fin']
BENDS = [(-11.0, 1.0), (-7.0, 1.0), (-5.0, 1.0), (-3.0, 1.0)]


def spine_weights(y):
    for i, (yj, h) in enumerate(BENDS):
        if abs(y - yj) < h:
            s = ease((y - (yj - h)) / (2 * h))
            return {SPINE[i]: 1 - s, SPINE[i + 1]: s}
    k = sum(1 for yj, _ in BENDS if y >= yj)
    return {SPINE[k]: 1.0}


def soften(meshes):
    """Re-weight every spine vertex by where it lies along the body."""
    blended = 0
    for o in meshes:
        groups = {g.name: g for g in o.vertex_groups}
        idx = {g.index: g.name for g in o.vertex_groups}
        for v in o.data.vertices:
            names = [idx[g.group] for g in v.groups]
            if not names or names[0] not in SPINE:
                continue
            w = spine_weights(v.co.y)
            for n in SPINE:
                if n in groups:
                    groups[n].remove([v.index])
            for n, x in w.items():
                if n not in groups:
                    groups[n] = o.vertex_groups.new(name=n)
                groups[n].add([v.index], x, 'REPLACE')
            blended += len(w) > 1
    return blended


def bone_table():
    return {
        'root': ((0, -9, -4), (0, -9, -2), None),
        'body': ((0, -9, 3), (0, -7, 3), 'root'),
        # Pointing tailward like the rest: a bone pointing back exports a rest
        # rotation of q while its keys come out as -q (the same turn), and the
        # intake would not see that a clip leaves it alone.
        'head': ((0, -11, 3), (0, -9, 3), 'body'),
        'eye.L': ((4, -13, 4), (4, -13, 5), 'head'),
        'eye.R': ((-4, -13, 4), (-4, -13, 5), 'head'),
        'dorsal': ((0, -10, 7), (0, -10, 9), 'body'),
        'tail1': ((0, -7, 3), (0, -5, 3), 'body'),
        'tail2': ((0, -5, 3), (0, -3, 3), 'tail1'),
        'fin': ((0, -3, 3), (0, 1, 3), 'tail2'),
    }


def tail(p, a1, a2, a3):
    """The tail as a wave: each link turned about the vertical, on top of its parent."""
    p.turn('tail1', 'z', a1)
    p.turn('tail2', 'z', a2)
    p.turn('fin', 'z', a3)


def squash(p, s):
    """Squash (s < 0) and stretch (s > 0) along the body, keeping its volume.
    Bone frame: y runs along the body bone (the fish's length)."""
    p.scale['body'] = (1 - 0.5 * s, 1 + s, 1 - 0.5 * s)


def eyes(p, shut=0.0, happy=0.0):
    """shut: a blink (squeezed flat); happy: squeezed into arcs, a touch wider."""
    k = max(shut, happy)
    for side in 'LR':
        # Bone frame: y runs up the eye bone (world up).
        p.scale[f'eye.{side}'] = (1 + 0.12 * happy, 1 - 0.85 * k, 1 + 0.12 * happy)


def swim(t, T=0.5):
    p = Pose()
    w = 2 * math.pi * t / T
    tail(p, 0.18 * math.sin(w), 0.32 * math.sin(w - 0.7), 0.6 * math.sin(w - 1.4))
    p.turn('head', 'z', -0.07 * math.sin(w + 0.3))
    p.turn('body', 'z', -0.04 * math.sin(w + 0.9))
    p.move('body', (0, 0, 0.35 * math.sin(2 * w)))
    squash(p, 0.045 * math.sin(2 * w - 0.6))
    p.turn('dorsal', 'y', 0.22 * math.sin(w - 1.0))
    return p


def zoom(t, T=1.2):
    p = Pose()
    wind = env(t, 0.0, 0.22, 0.26, 0.4)
    burst = env(t, 0.26, 0.38, 0.8, 1.15)
    w = 2 * math.pi * 6.5 * t
    tail(p, 0.45 * wind + 0.3 * math.sin(w) * burst, 0.6 * wind + 0.45 * math.sin(w - 0.7) * burst,
         0.8 * wind + 0.7 * math.sin(w - 1.4) * burst)
    squash(p, -0.12 * wind + 0.14 * burst)
    p.turn('head', 'z', -0.12 * wind)
    p.turn('dorsal', 'y', -0.35 * burst)            # swept back
    return p


def wiggle(t, T=1.6):
    p = Pose()
    e = env(t, 0.0, 0.2, T - 0.3, T)
    w = 2 * math.pi * 3 * t
    p.turn('body', 'y', 0.32 * math.sin(w) * e)        # the shimmy: a roll about its length
    p.move('body', (0, 0, 0.9 * abs(math.sin(w / 2)) * e))
    tail(p, 0.15 * math.sin(w + 1) * e, 0.3 * math.sin(w + 0.4) * e, 0.55 * math.sin(w - 0.2) * e)
    p.turn('dorsal', 'y', 0.3 * math.sin(w - 0.8) * e)
    squash(p, 0.06 * math.sin(2 * w) * e)
    return p


def wiggle_eyes(t, T=1.6):
    """The wiggle's happy eyes: their own clip, so they layer like a blink."""
    p = Pose()
    eyes(p, happy=env(t, 0.1, 0.3, T - 0.4, T - 0.15))
    return p


def flip(t, T=1.4):
    p = Pose()
    turn = track(t, [(0, 0), (0.2, 0), (1.1, 1), (T, 1)])
    p.turn('body', 'y', 2 * math.pi * turn % (2 * math.pi))
    p.move('body', (0, 0, 3.0 * math.sin(math.pi * min(1.0, max(0.0, (t - 0.1) / 1.1)))))
    up = env(t, 0.1, 0.3, 1.0, 1.3)
    w = 2 * math.pi * 5 * t
    tail(p, 0.25 * math.sin(w) * up, 0.4 * math.sin(w - 0.7) * up, 0.65 * math.sin(w - 1.4) * up)
    squash(p, -0.08 * env(t, 0.0, 0.12, 0.15, 0.3) + 0.06 * up - 0.08 * env(t, 1.1, 1.2, 1.25, T))
    return p


def peek(t, T=2.4):
    p = Pose()
    tilt = track(t, [(0, 0), (0.25, 0), (0.6, 1), (1.0, 1), (1.35, -1), (1.8, -1), (2.15, 0), (T, 0)])
    p.turn('head', 'y', 0.32 * tilt)
    p.turn('head', 'x', -0.1 * env(t, 0.2, 0.5, 1.9, 2.2))   # nose up, curious
    still = env(t, 0.0, 0.25, 2.0, T)
    w = 2 * math.pi * 1.2 * t
    tail(p, 0.08 * math.sin(w) * still, 0.14 * math.sin(w - 0.7) * still, 0.25 * math.sin(w - 1.4) * still)
    p.move('body', (0, 0, 0.5 * math.sin(math.pi * min(1.0, t / 0.5)) * env(t, 0.0, 0.1, 0.4, 0.6)))
    return p


def peek_eyes(t, T=2.4):
    p = Pose()
    eyes(p, shut=track(t, [(0, 0), (0.85, 0), (0.92, 1), (0.98, 1), (1.1, 0), (1.75, 0), (1.82, 1), (1.88, 1), (2.0, 0), (T, 0)]))
    return p


def blink(t, T=0.3):
    p = Pose()
    eyes(p, shut=track(t, [(0, 0), (0.1, 1), (0.14, 1), (T, 0)]))
    return p


CLIPS = [('swim', swim, 0.5), ('zoom', zoom, 1.2), ('wiggle', wiggle, 1.6), ('wiggle_eyes', wiggle_eyes, 1.6),
         ('flip', flip, 1.4), ('peek', peek, 2.4), ('peek_eyes', peek_eyes, 2.4), ('blink', blink, 0.3)]


def main():
    scene = bpy.data.scenes.get('babyfish') or bpy.data.scenes.new('babyfish')
    with in_scene(scene):
        begin('babyfish')
        meshes = load_source('babyfish')
        pitch, phase = lattice(meshes)
        counts = segment(meshes, bone_of, pitch, phase, by_point=True)
        counts['blended vertices'] = soften(meshes)
        rig = build_armature('Babyfish', meshes, bone_table())
        keyed = {}
        for pb in rig.pose.bones:
            if pb.name == 'root':
                continue
            keyed[pb.name] = ['scale'] if pb.name.startswith('eye.') else ['rotation_quaternion']
            if pb.name == 'body':
                keyed[pb.name] += ['location', 'scale']
        clips = bake(rig, 'babyfish', CLIPS, apply_pose, ('swim',), keyed)
        out = export(rig, out_path('babyfish'), {})
        return {'faces_per_bone': counts, 'bones': len(rig.data.bones), 'clips': clips, 'out': out,
                'bytes': os.path.getsize(out), 'lattice': (pitch, phase)}


if __name__ == '__main__':
    result = main()
    print(result)
