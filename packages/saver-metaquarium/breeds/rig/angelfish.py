"""
Rig and animate the angelfish: breeds/source/angelfish.glb in,
breeds/rig/angelfish.glb out.

    blender -b -P breeds/rig/angelfish.py        (from packages/saver-metaquarium)

The source is the MINTED breed's one model (breeds/minted.mjs), its triangles
cut into paint regions MINT-R<n> / MINT-EYE-R<n>: every one of the 200
angelfish tokens is this model in its own paint, so this one rig swims them
all. The model is never edited; the rig says which bones each vertex follows.
Its regions are materials, and a face keeps its material through the rig and
the intake, so each token's paint still lands where it should.

Facing. The delivered fish swims along +X (its eyes sit at that end); every
rig faces -Y (glTF +Z, which the tank assumes of a rig). So the baked meshes
are turned a quarter turn about Z first — rigid, the whole model.

An angelfish is fluid: its body curves in a travelling wave that grows toward
the tail, its tall dorsal and anal fins ripple — a wave running back along
them — and its streamers follow through on a lag. So nothing here is a rigid
part. Every vertex's weights come from where it lies (the shark's way), so two
faces that meet always move together:

    spine    five bones nose to tail — the head (rigid, with both eyes: the
             eye cells sit in its pure zone, y <= -1), then four along the
             body; each vertex blends between the two nearest by y, so the
             body bends as one smooth curve, never at a joint
    fins     three bones up the dorsal arm and three down the anal arm, each
             on the spine bone beside it; a vertex is fin by how far above
             (below) the body's core it is, blended along the fin by y
    streamers  one bone each, riding the last fin bone, for the filaments
             that trail back over the tail (blended in over their first voxel)
    flex1..4 non-deforming, each the parent of a spine bone. Only the `bend`
             dial moves them: a turn curves the whole body, under any stroke.

Rig space (after the turn): nose -Y, up +Z, its left +X. Read off the side
occupancy: the eyes at y -7.3..-1.3, the peduncle at y ~12.5, the caudal fin
y 15..18, the body's core within |z| < 6, the streamers at |z| > 15.

Clips (30 fps; the tank sets their times and weights, never update(dt)):

    swim     1.6 s loop: a travelling wave down the body, growing to the
             tail; the fins ripple behind it; the streamers whip after
    hover    3.2 s loop: holding station — the body all but still, the fins
             rippling (the angelfish's own way of hanging in the water)
    burst    0.9 s: fins laid back, three hard strokes of the whole body
    display  3 s: fins spread and rippling, the body leaning to show itself
    bend     a DIAL, 2 s: its time is the bend — 0 curved hard to its right,
             1 straight, 2 hard to its left
"""
import math
import os
import sys

import bpy
from mathutils import Matrix

sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (  # noqa: E402
    Pose, apply_pose, bake, begin, in_scene, build_armature, ease, env, export, lattice, load_source, out_path, segment,
)

BREED = 'angelfish'
PITCH = 2.0

# The spine: each bone's weight peaks at its centre (rig-space y) and hands
# over linearly to the next. The head is pure up to y = -1: the eyes are rigid.
SPINE = ('head', 's1', 's2', 's3', 's4')
SPINE_AT = (-1.0, 1.5, 6.25, 10.5, 15.0)
# The fins: weight peaks along the fin, and how far off the body's core a
# vertex must be to be fin (eased in from CORE to CORE + FIN_IN).
DORSAL = ('d1', 'd2', 'd3')
ANAL = ('a1', 'a2', 'a3')
FIN_AT = (1.0, 7.0, 13.0)
CORE, FIN_IN, FIN_FROM_Y = 5.0, 6.0, -4.0
# The streamers stand on the planes z = 15.05 (dorsal) and -14.95 (anal).
DORSAL_ROOT, ANAL_ROOT, STREAMER_IN = 15.05, -14.95, 3.0


def hat(y, centres, names):
    """Linear hand-over between neighbouring centres: two bones at most."""
    if y <= centres[0]:
        return {names[0]: 1.0}
    for i in range(len(centres) - 1):
        a, b = centres[i], centres[i + 1]
        if y <= b:
            u = ease((y - a) / (b - a))
            return {names[i]: 1 - u, names[i + 1]: u}
    return {names[-1]: 1.0}


def weights_at(co, eye):
    if eye:
        return {'head': 1.0}
    spine = hat(co.y, SPINE_AT, SPINE)
    side = 1 if co.z >= 0 else -1
    off = abs(co.z) - CORE
    f = ease(off / FIN_IN) if co.y > FIN_FROM_Y else 0.0
    if f <= 0:
        return spine
    fin = hat(co.y, FIN_AT, DORSAL if side > 0 else ANAL)
    root = DORSAL_ROOT if side > 0 else ANAL_ROOT
    s = ease((co.z - root) / STREAMER_IN) if side > 0 else ease((root - co.z) / STREAMER_IN)
    out = {}
    for k, v in spine.items():
        out[k] = out.get(k, 0) + v * (1 - f)
    for k, v in fin.items():
        out[k] = out.get(k, 0) + v * f * (1 - s)
    if s > 0:
        stream = 'dstream' if side > 0 else 'astream'
        out[stream] = out.get(stream, 0) + f * s
    return {k: v for k, v in out.items() if v > 1e-4}


def bone_of(x, y, z, mat):
    """Only to start the vertex groups (weights_at decides): eyes or not."""
    return 'eye' if 'EYE' in mat else 'body'


def soften(meshes):
    blended, most = 0, 0
    for o in meshes:
        groups = {g.name: g for g in o.vertex_groups}
        idx = {g.index: g.name for g in o.vertex_groups}
        for v in o.data.vertices:
            names = [idx[g.group] for g in v.groups]
            if not names:
                continue
            w = weights_at(v.co, names[0] == 'eye')
            total = sum(w.values())
            for g in list(groups.values()):
                g.remove([v.index])
            for n, x in w.items():
                if n not in groups:
                    groups[n] = o.vertex_groups.new(name=n)
                groups[n].add([v.index], x / total, 'REPLACE')
            blended += len(w) > 1
            most = max(most, len(w))
        for stale in ('eye', 'body'):
            if stale in groups:
                o.vertex_groups.remove(groups[stale])
    assert most <= 4, most  # glTF skins carry four influences a vertex
    return blended


def bone_table():
    t = {'root': ((0, 0, -26), (0, 0, -23), None)}
    # The spine, nose to tail, each bone from its centre to the next; a flex
    # bone above each body bone for the bend dial.
    t['head'] = ((0, SPINE_AT[0], -1), (0, -12, -1), 'root')
    parent = 'head'
    for i, name in enumerate(SPINE[1:], start=1):
        head = SPINE_AT[i - 1]
        tail = SPINE_AT[i + 1] if i + 1 < len(SPINE_AT) else 20.0
        t[f'flex{i}'] = ((0, head, -1), (0, head + 0.5, -1), parent)
        t[name] = ((0, head, -1), (0, tail, -1), f'flex{i}')
        parent = name
    # The fins: each on the spine bone beside it, standing off the core.
    spine_at = lambda y: SPINE[1:][min(range(4), key=lambda k: abs(SPINE_AT[k + 1] - y))]
    for names, sign in ((DORSAL, 1), (ANAL, -1)):
        for name, y in zip(names, FIN_AT):
            t[name] = ((0, y, sign * CORE), (0, y + 3, sign * (CORE + 8)), spine_at(y))
    t['dstream'] = ((0, 9, DORSAL_ROOT), (0, 21, 20), 'd3')
    t['astream'] = ((0, 7, ANAL_ROOT), (0, 14, -20), 'a3')
    return t


def wave(p, w, amps, lag=0.7):
    """A travelling wave down the spine: each body bone turns (relative to its
    parent, so the curve accumulates) a little later than the one before."""
    for i, (name, a) in enumerate(zip(SPINE[1:], amps)):
        p.turn(name, 'z', a * math.sin(w - lag * i))


def ripple(p, w, amp, lag=0.75, stream=0.0, spread=0.0, fold=0.0):
    """The fins ripple sideways — a wave running back along each — the
    streamers whip after; spread raises them, fold lays them back."""
    for names, sign in ((DORSAL, 1), (ANAL, -1)):
        for i, name in enumerate(names):
            p.turn(name, 'y', sign * amp * math.sin(w - 0.9 - lag * i))
            # About X, + carries an up-pointing tip forward: spread tips them
            # forward (open), fold back (shut).
            p.turn(name, 'x', sign * (0.06 * spread - 0.12 * fold))
    p.turn('dstream', 'z', stream * math.sin(w - 3.0))
    p.turn('astream', 'z', stream * math.sin(w - 3.2))
    p.turn('dstream', 'x', 0.05 * math.sin(w - 2.4))
    p.turn('astream', 'x', -0.05 * math.sin(w - 2.6))


def swim(t, T=1.6):
    p = Pose()
    w = 2 * math.pi * t / T
    p.turn('head', 'z', -0.025 * math.sin(w + 0.6))  # the head barely counters
    wave(p, w, (0.04, 0.06, 0.09, 0.2))
    ripple(p, w, 0.12, stream=0.22)
    return p


def hover(t, T=3.2):
    p = Pose()
    w = 2 * math.pi * t / T
    wave(p, w, (0.01, 0.015, 0.02, 0.05))
    # The fins carry it: two ripples a loop, a fuller wave than when it swims.
    ripple(p, 2 * w, 0.16, lag=0.9, stream=0.18, spread=0.4)
    return p


def burst(t, T=0.9):
    p = Pose()
    strokes = env(t, 0.04, 0.12, 0.6, 0.85)
    w = 2 * math.pi * t / 0.3
    wave(p, w, tuple(a * strokes for a in (0.08, 0.12, 0.16, 0.32)), lag=0.8)
    ripple(p, w, 0.06 * strokes, stream=0.2 * strokes, fold=env(t, 0.0, 0.1, 0.65, T))
    return p


def display(t, T=3.0):
    p = Pose()
    on = env(t, 0.0, 0.8, T - 0.8, T)
    w = 2 * math.pi * t / 1.0
    p.turn('head', 'y', 0.1 * on)  # leans to show its side
    wave(p, w, tuple(a * on for a in (0.015, 0.02, 0.03, 0.06)))
    ripple(p, w, 0.14 * on, stream=0.2 * on, spread=on)
    return p


def bend(t, T=2.0):
    """The dial: time 0 curved hard to its right, 1 straight, 2 hard to its left."""
    p = Pose()
    b = t - 1.0
    for i in range(1, 5):
        p.turn(f'flex{i}', 'z', 0.1 * b)
    return p


CLIPS = [('swim', swim, 1.6), ('hover', hover, 3.2), ('burst', burst, 0.9), ('display', display, 3.0), ('bend', bend, 2.0)]


def main():
    scene = bpy.data.scenes.get(BREED) or bpy.data.scenes.new(BREED)
    with in_scene(scene):
        begin(BREED)
        meshes = load_source(BREED)
        # Face the rig convention: nose +X -> -Y. Rigid, the whole model at once.
        turn = Matrix.Rotation(-math.pi / 2, 4, 'Z')
        for o in meshes:
            o.data.transform(turn)
        pitch, phase = lattice(meshes)
        assert pitch == PITCH, (pitch, phase)
        segment(meshes, bone_of, pitch, phase, by_point=True)
        blended = soften(meshes)
        nondeform = ('root', 'flex1', 'flex2', 'flex3', 'flex4')
        rig = build_armature('Angelfish', meshes, bone_table(), nondeform=nondeform)
        keyed = {pb.name: ['rotation_quaternion'] for pb in rig.pose.bones if pb.name != 'root'}
        clips = bake(rig, BREED, CLIPS, apply_pose, ('swim', 'hover'), keyed)
        out = export(rig, out_path(BREED), {})
        return {'blended_vertices': blended, 'bones': len(rig.data.bones), 'clips': clips, 'out': out,
                'bytes': os.path.getsize(out)}


if __name__ == '__main__':
    result = main()
    print(result)
