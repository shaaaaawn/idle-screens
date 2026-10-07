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
the tail, and its long dorsal and anal fins — arcs that sweep up (down) off
the body and run back over the tail as streamers — ripple, a wave running
back along them. So nothing here is a rigid part. Every vertex's weights
come from where it lies (the shark's way), so two faces that meet always
move together. Rigged by eye in Blender against the side view:

    spine    the head (rigid, with both eyes: they sit in its pure zone,
             y <= -1), three bones along the body, and the tail through the
             caudal bar; each vertex blends between the two nearest by y, so
             the body bends as one smooth curve, never at a joint
    fins     three bones laid ALONG each arc (DORSAL_ARC, ANAL_ARC); a vertex
             is fin by how far it stands off the body, and blends along its
             arc by arc length. Each segment rides the spine bone beside it,
             so an arc curves and waves with the body, then ripples on top —
             sideways about its own axis, the streamers widest
    flex1..4 non-deforming, each the parent of a spine bone. Only the `bend`
             dial moves them: a turn curves the whole fish, under any stroke.

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
from mathutils import Matrix, Quaternion, Vector

sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (  # noqa: E402
    Pose, apply_pose, bake, begin, in_scene, build_armature, ease, env, export, lattice, load_source, out_path, segment,
)

BREED = 'angelfish'
PITCH = 2.0

# Read off the side occupancy in rig space (nose -Y, up +Z; one cell is 2):
# a long diamond body from the nose (y -15) to the peduncle (y ~15), the eyes
# at y -7..-1 just under the midline; the caudal fin a bar at y 17..19,
# z -14..10; the DORSAL arc rising off the diamond's top at y ~1 to z ~16,
# then running back along z 18..20 to y 23, over the tail; the ANAL arc
# dropping off its bottom the same way to y ~15.
SPINE = ('head', 's1', 's2', 's3', 'tail')
SPINE_AT = (-1.0, 2.0, 6.5, 11.0, 15.5)  # each bone's weight peaks here (y)
MID_Z = -1.0
DORSAL = ('d1', 'd2', 'd3')
ANAL = ('a1', 'a2', 'a3')
DORSAL_ARC = ((1.0, 9.0), (5.0, 15.0), (11.0, 19.0), (23.0, 20.0))
ANAL_ARC = ((1.0, -10.0), (5.0, -15.0), (10.0, -18.0), (15.5, -20.0))
# A vertex is fin by how far it stands off the body: eased in over these z.
DORSAL_IN, ANAL_IN = (9.0, 13.0), (-10.0, -14.0)
TAIL_FROM = 15.5  # the caudal bar: never fin, however tall


def hat(x, centres, names):
    """Linear hand-over between neighbouring centres: two bones at most."""
    if x <= centres[0]:
        return {names[0]: 1.0}
    for i in range(len(centres) - 1):
        a, b = centres[i], centres[i + 1]
        if x <= b:
            u = ease((x - a) / (b - a))
            return {names[i]: 1 - u, names[i + 1]: u}
    return {names[-1]: 1.0}


def along(arc, y, z):
    """How far along an arc (polyline in y, z) a point lies, by its nearest point."""
    best, run, at = 1e9, 0.0, 0.0
    for (y0, z0), (y1, z1) in zip(arc, arc[1:]):
        dy, dz = y1 - y0, z1 - z0
        L2 = dy * dy + dz * dz
        u = max(0.0, min(1.0, ((y - y0) * dy + (z - z0) * dz) / L2))
        d = (y - (y0 + u * dy)) ** 2 + (z - (z0 + u * dz)) ** 2
        if d < best:
            best, at = d, run + u * math.sqrt(L2)
        run += math.sqrt(L2)
    return at


def arc_centres(arc):
    """Each fin bone's weight peaks at its segment's middle, by arc length."""
    out, run = [], 0.0
    for (y0, z0), (y1, z1) in zip(arc, arc[1:]):
        L = math.hypot(y1 - y0, z1 - z0)
        out.append(run + L / 2)
        run += L
    return out


def weights_at(co, eye):
    if eye:
        return {'head': 1.0}
    spine = hat(co.y, SPINE_AT, SPINE)
    if co.y >= TAIL_FROM:
        return spine
    if co.z > 0:
        lo, hi = DORSAL_IN
        f = ease((co.z - lo) / (hi - lo))
        arc, names = DORSAL_ARC, DORSAL
    else:
        lo, hi = ANAL_IN
        f = ease((lo - co.z) / (lo - hi))
        arc, names = ANAL_ARC, ANAL
    if f <= 0:
        return spine
    fin = hat(along(arc, co.y, co.z), arc_centres(arc), names)
    out = {}
    for k, v in spine.items():
        out[k] = out.get(k, 0) + v * (1 - f)
    for k, v in fin.items():
        out[k] = out.get(k, 0) + v * f
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
    # The spine on the body's midline, nose to caudal bar; a flex bone above
    # each body bone for the bend dial.
    t['head'] = ((0, SPINE_AT[0], MID_Z), (0, -14, MID_Z), 'root')
    parent = 'head'
    for i, name in enumerate(SPINE[1:], start=1):
        head = SPINE_AT[i - 1]
        tail = SPINE_AT[i + 1] if i + 1 < len(SPINE_AT) else 20.0
        t[f'flex{i}'] = ((0, head, MID_Z), (0, head + 0.5, MID_Z), parent)
        t[name] = ((0, head, MID_Z), (0, tail, MID_Z), f'flex{i}')
        parent = name
    # The fin segments along their arcs, each riding the spine bone beside
    # it: the arcs run back alongside the body (the dorsal's streamers over the
    # tail), so they must curve and wave with it, then ripple on top.
    for names, arc in ((DORSAL, DORSAL_ARC), (ANAL, ANAL_ARC)):
        for name, ride, (y0, z0), (y1, z1) in zip(names, ('s1', 's2', 's3'), arc, arc[1:]):
            t[name] = ((0, y0, z0), (0, y1, z1), ride)
    return t


def sway_axis(arc, i):
    """The axis a fin segment swings its tip sideways about: in the body's
    plane, square to the segment (rotating about it carries the tip to ±X)."""
    (y0, z0), (y1, z1) = arc[i], arc[i + 1]
    L = math.hypot(y1 - y0, z1 - z0)
    return Vector((0.0, -(z1 - z0) / L, (y1 - y0) / L))


def turn_about(p, bone, axis, angle):
    p.rot[bone] = Quaternion(axis, angle) @ p.rot.get(bone, Quaternion())


def wave(p, w, amps, lag=0.7):
    """A travelling wave down the spine: each body bone turns (relative to its
    parent, so the curve accumulates) a little later than the one before."""
    for i, (name, a) in enumerate(zip(SPINE[1:], amps)):
        p.turn(name, 'z', a * math.sin(w - lag * i))


def ripple(p, w, amps, lag=0.8, spread=0.0, fold=0.0):
    """The fins ripple sideways — a wave running back along each arc, the
    tips (the streamers) swinging widest; spread opens the arcs away from the
    body, fold lays them back toward it (about X: + carries a tip forward)."""
    for names, arc, sign in ((DORSAL, DORSAL_ARC, 1), (ANAL, ANAL_ARC, -1)):
        for i, (name, a) in enumerate(zip(names, amps)):
            turn_about(p, name, sway_axis(arc, i), a * math.sin(w - 0.9 - lag * i))
            p.turn(name, 'x', sign * (0.05 * spread - 0.08 * fold))


def swim(t, T=1.6):
    p = Pose()
    w = 2 * math.pi * t / T
    p.turn('head', 'z', -0.025 * math.sin(w + 0.6))  # the head barely counters
    wave(p, w, (0.04, 0.06, 0.09, 0.2))
    ripple(p, w, (0.05, 0.08, 0.16))
    return p


def hover(t, T=3.2):
    p = Pose()
    w = 2 * math.pi * t / T
    wave(p, w, (0.01, 0.015, 0.02, 0.05))
    # The fins carry it: two ripples a loop, fuller than when it swims.
    ripple(p, 2 * w, (0.08, 0.12, 0.18), lag=0.9, spread=0.5)
    return p


def burst(t, T=0.9):
    p = Pose()
    strokes = env(t, 0.04, 0.12, 0.6, 0.85)
    w = 2 * math.pi * t / 0.3
    wave(p, w, tuple(a * strokes for a in (0.08, 0.12, 0.16, 0.32)), lag=0.8)
    ripple(p, w, tuple(a * strokes for a in (0.03, 0.06, 0.14)), fold=env(t, 0.0, 0.1, 0.65, T))
    return p


def display(t, T=3.0):
    p = Pose()
    on = env(t, 0.0, 0.8, T - 0.8, T)
    w = 2 * math.pi * t / 1.0
    p.turn('head', 'y', 0.1 * on)  # leans to show its side
    wave(p, w, tuple(a * on for a in (0.015, 0.02, 0.03, 0.06)))
    ripple(p, w, tuple(a * on for a in (0.06, 0.1, 0.16)), spread=on)
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
