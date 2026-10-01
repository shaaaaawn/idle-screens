"""
Rig and animate the shark: breeds/source/shark.glb in, breeds/rig/shark.glb out.

    blender -b -P breeds/rig/shark.py           (from packages/saver-metaquarium)

The model is never edited; the rig only says which part each face belongs to
(common.py, README "Rigged breeds"). Its parts are not all on one lattice (the
fins sit off it, and its source node carries a 1.3 scale: 2.6-unit voxels), so
it is cut by POSITION. Blender axes (glTF import, Z up): it faces -Y; its left
is +X.

    head     the snout, y < -25, eyes on its sides (eyes, eyes2 at x ±11)
    jaw      the lower jaw under the head (y < -30, z < -15.5) with the teeth
             that ring it (mouth): it drops on a hinge at (y -30, z -15.5)
    body     the trunk and the dorsal fin, -25 < y < 5
    tail     three links back to the caudal fin: tail1 (5..20), tail2 (20..32),
             caudal (y > 32) — the swim is a wave that grows down them

The spine BENDS: rigid links would open a wedge at every joint (the body
reads as three pieces), so across a zone at each joint the vertices blend
between the two links (`soften`). The jaw, eyes and fins stay rigid parts.
    fins     the pectorals, beyond the flanks (|x| > 16), hinged at the body

Clips (30 fps; the tank sets their times and weights, never update(dt)):

    swim    1.2 s loop: a wave down the body, small at the snout, widest at
            the caudal fin; the pectorals trim; the jaw a menacing gape
    bite    1.8 s: the snout lifts and the jaw drops, the eyes roll back, it
            lunges and the jaws snap, then it thrashes, and settles
"""
import math
import os
import sys

import bpy

sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (  # noqa: E402
    Pose, apply_pose, bake, begin, build_armature, ease, env, export, in_scene, lattice, load_source, out_path, segment,
    track,
)

SPINE = ['head', 'body', 'tail1', 'tail2', 'caudal']
# Where each pair of links meets (y), and the half-width of the zone it bends over.
BENDS = [(-25.0, 5.2), (5.0, 5.2), (20.0, 3.9), (32.0, 2.6)]


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


def bone_of(x, y, z, mat):
    if mat in ('eyes', 'eyes2'):
        return 'eye.L' if x > 0 else 'eye.R'
    if y < -5 and x < -16.5:
        return 'fin.R'
    if y < -5 and x > 16.5:
        return 'fin.L'
    if y < -30 and z < -15.5:
        return 'jaw'
    if y < -25:
        return 'head'
    if y > 32:
        return 'caudal'
    if y > 20:
        return 'tail2'
    if y > 5:
        return 'tail1'
    return 'body'


def bone_table():
    return {
        'root': ((0.6, -10, -26), (0.6, -10, -22), None),
        'body': ((0.6, -10, -5), (0.6, 5, -5), 'root'),
        'head': ((0.6, -25, -3), (0.6, -55, -3), 'body'),
        'jaw': ((0.6, -30, -15.5), (0.6, -54, -18), 'head'),
        'eye.R': ((-11, -33.8, -2.6), (-11, -33.8, 0), 'head'),
        'eye.L': ((11, -33.8, -2.6), (11, -33.8, 0), 'head'),
        'fin.R': ((-15.7, -16, -15), (-31, -12, -20), 'body'),
        'fin.L': ((15.7, -16, -15), (29, -12, -20), 'body'),
        'tail1': ((0.6, 5, -5), (0.6, 20, -5), 'body'),
        'tail2': ((0.6, 20, -5), (0.6, 32, -5), 'tail1'),
        'caudal': ((0.6, 32, -5), (0.6, 53, -5), 'tail2'),
    }


def gape(p, a):
    """The jaw drops about its hinge: positive opens."""
    p.turn('jaw', 'x', a)


def wave(p, w, amp=1.0):
    """A wave down the body: each link a little later and a little wider."""
    p.turn('head', 'z', 0.05 * amp * math.sin(w))
    p.turn('body', 'z', -0.03 * amp * math.sin(w - 0.6))
    p.turn('tail1', 'z', 0.14 * amp * math.sin(w - 1.2))
    p.turn('tail2', 'z', 0.22 * amp * math.sin(w - 1.9))
    p.turn('caudal', 'z', 0.38 * amp * math.sin(w - 2.6))


def swim(t, T=1.2):
    p = Pose()
    w = 2 * math.pi * t / T
    wave(p, w)
    gape(p, 0.03 + 0.015 * math.sin(2 * w))
    for side, m in (('R', 1), ('L', -1)):
        p.turn(f'fin.{side}', 'y', m * 0.05 * math.sin(w + 0.8))
    return p


def bite(t, T=1.8):
    p = Pose()
    rear = env(t, 0.0, 0.35, 0.42, 0.55)                      # snout up, jaw wide
    jaw = track(t, [(0, 0.03), (0.35, 0.6), (0.44, 0.62), (0.5, -0.02), (0.62, 0.04), (1.2, 0.05), (T, 0.03)])
    gape(p, jaw)
    p.turn('head', 'x', -0.16 * rear)
    lunge = env(t, 0.3, 0.46, 0.55, 1.1)
    p.move('body', (0, -5 * lunge, 0))
    roll = env(t, 0.2, 0.32, 0.9, 1.1)                        # the eyes roll back
    for side in 'RL':
        p.scale[f'eye.{side}'] = (1, 1 - 0.85 * roll, 1)
    thrash = math.sin(2 * math.pi * 3 * (t - 0.5)) * env(t, 0.5, 0.6, 1.0, 1.35)
    # Spread down the body: a big turn at one joint splits the voxels there.
    p.turn('head', 'z', 0.12 * thrash)
    p.turn('body', 'z', 0.06 * thrash)
    p.turn('tail1', 'z', -0.12 * thrash)
    p.turn('tail2', 'z', -0.12 * thrash)
    p.turn('caudal', 'z', -0.3 * thrash)
    for side, m in (('R', 1), ('L', -1)):
        p.turn(f'fin.{side}', 'y', m * 0.25 * rear)             # fins flare as it strikes
    return p


CLIPS = [('swim', swim, 1.2), ('bite', bite, 1.8)]


def main():
    scene = bpy.data.scenes.get('shark') or bpy.data.scenes.new('shark')
    with in_scene(scene):
        begin('shark')
        meshes = load_source('shark')
        pitch, _ = lattice(meshes)
        assert pitch == 2.6, pitch
        counts = segment(meshes, bone_of, pitch, (0, 0, 0), by_point=True)
        counts['blended vertices'] = soften(meshes)
        rig = build_armature('Shark', meshes, bone_table())
        keyed = {}
        for pb in rig.pose.bones:
            if pb.name == 'root':
                continue
            keyed[pb.name] = ['rotation_quaternion']
            if pb.name == 'body':
                keyed[pb.name].append('location')
            if pb.name.startswith('eye.'):
                keyed[pb.name].append('scale')
        clips = bake(rig, 'shark', CLIPS, apply_pose, ('swim',), keyed)
        out = export(rig, out_path('shark'), {})
        return {'faces_per_bone': counts, 'bones': len(rig.data.bones), 'clips': clips, 'out': out,
                'bytes': os.path.getsize(out)}


if __name__ == '__main__':
    result = main()
    print(result)
