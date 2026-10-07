"""
Rig and animate the angelfish: breeds/source/angelfish.glb in,
breeds/rig/angelfish.glb out.

    blender -b -P breeds/rig/angelfish.py        (from packages/saver-metaquarium)

The source is the MINTED breed's one model (breeds/minted.mjs), its triangles
cut into paint regions MINT-R<n> / MINT-EYE-R<n>: every one of the 200
angelfish tokens is this model in its own paint, so this one rig swims them
all. The model is never edited; the rig says which part each vertex follows.
Its regions are materials, and a face keeps its material through the rig and
the intake, so each token's paint still lands where it should.

Facing. The delivered fish swims along +X (its eyes sit at that end); every
rig faces -Y (glTF +Z, which is what the tank assumes of a rig). So the baked
meshes are turned a quarter turn about Z first — rigid, the whole model.

An angelfish is a disc that steers with its fins and bends only a little: its
tall dorsal and anal fins are part of the disc, and what trails and flutters
are their streamers. So the rig is a SOFT SPINE — the disc's front, its back,
the caudal fin — whose vertices blend between neighbouring bones by where they
lie along the body (the shark's way), so the body bends as one piece with no
crack at a joint; and two streamer bones, blended at their roots the same way.
The eye cells ride the front of the disc, rigid.

The lattice, delivered: 2-unit voxels, planes at x ≡ 1.31, z ≡ 1.05 (mod 2).
In delivered voxel indices (ixo along the body, nose at +ixo; izo up):

    body     the front of the disc, with both eyes (rigid)
    mid      the back of the disc, from about ixo -2 (blended across ixo -4..-1)
    tail     the caudal fin, from ixo -9 (blended across the peduncle)
    dorsal   the dorsal fin's streamers, izo >= 7 (blended in over their first voxel)
    anal     the anal fin's streamers, izo <= -9

    flex, flex2   non-deforming: the parents of mid and tail. Only the `bend`
                  dial moves them, so a turn bends the body under whatever
                  stroke is playing.

Clips (30 fps; the tank sets their times and weights, never update(dt)):

    swim     1.6 s loop: an easy beat — the caudal fin sweeps, the back of the
             disc answers, the streamers trail on a lag
    hover    4 s loop: holding station — the tail barely fans, the streamers
             drift and curl
    burst    0.9 s: two hard strokes, streamers swept back
    display  3 s: a slow lean to show its side, streamers lifted and fanned
    bend     a DIAL, 2 s: its time is the bend — 0 hard to its right, 1
             straight, 2 hard to its left
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
PHASE_X, PHASE_Z, PITCH = 1.31, 1.05, 2.0
SPINE = ('body', 'mid', 'tail')
# Rig-space y (nose -Y) of each spine joint and its half-width of blending.
BENDS = ((2.0, 3.0), (15.0, 2.0))
# The streamers' roots (rig-space z) and how far they blend in.
# The planes the streamer cells stand on (izo 7 and -8 delivered), so a root vertex blends at 0.
DORSAL_ROOT, ANAL_ROOT, STREAMER_BLEND = 15.05, -14.95, 3.0


def delivered(x, y, z):
    """Rig space (nose -Y) back to the delivered voxel indices (nose +X)."""
    return math.floor((-y - PHASE_X) / PITCH), math.floor((z - PHASE_Z) / PITCH)


def bone_of(x, y, z, mat):
    if 'EYE' in mat:
        return 'eye'  # rigid on the body: re-weighted below like nothing else
    ixo, izo = delivered(x, y, z)
    if izo >= 7:
        return 'dorsal'
    if izo <= -9:
        return 'anal'
    return 'body'  # the spine: re-weighted by position below


def spine_weights(y):
    for i, (yj, h) in enumerate(BENDS):
        if abs(y - yj) < h:
            s = ease((y - (yj - h)) / (2 * h))
            return {SPINE[i]: 1 - s, SPINE[i + 1]: s}
    k = sum(1 for yj, _ in BENDS if y >= yj)
    return {SPINE[k]: 1.0}


def weights_at(co, part):
    """A vertex's weights from its position alone, so two faces that meet at a
    point always move together there."""
    if part == 'eye':
        return {'body': 1.0}
    spine = spine_weights(co.y)
    if part in ('dorsal', 'anal'):
        into = (co.z - DORSAL_ROOT) if part == 'dorsal' else (ANAL_ROOT - co.z)
        s = ease(into / STREAMER_BLEND)
        out = {k: v * (1 - s) for k, v in spine.items()}
        out[part] = out.get(part, 0) + s
        return {k: v for k, v in out.items() if v > 1e-6}
    return spine


def soften(meshes):
    blended = 0
    for o in meshes:
        groups = {g.name: g for g in o.vertex_groups}
        idx = {g.index: g.name for g in o.vertex_groups}
        for v in o.data.vertices:
            names = [idx[g.group] for g in v.groups]
            if not names:
                continue
            w = weights_at(v.co, names[0])
            for g in list(groups.values()):
                g.remove([v.index])
            for n, x in w.items():
                if n not in groups:
                    groups[n] = o.vertex_groups.new(name=n)
                groups[n].add([v.index], x, 'REPLACE')
            blended += len(w) > 1
        if 'eye' in groups:
            o.vertex_groups.remove(groups['eye'])
    return blended


def bone_table():
    # Rig space: nose toward -Y, up +Z; y = -(delivered x).
    return {
        'root': ((0, 0, -26), (0, 0, -23), None),
        'body': ((0, 2, -2), (0, -12, -2), 'root'),
        'flex': ((0, 2, -2), (0, 2.5, -2), 'body'),
        'mid': ((0, 2, -2), (0, 15, -2), 'flex'),
        'flex2': ((0, 15, -2), (0, 15.5, -2), 'mid'),
        'tail': ((0, 15, -2), (0, 22, -2), 'flex2'),
        'dorsal': ((0, 9, DORSAL_ROOT), (0, 22, 20), 'mid'),
        'anal': ((0, 8, ANAL_ROOT), (0, 18, -22), 'mid'),
    }


def beat(p, w, amp):
    """One stroke at phase w: the caudal fin sweeps, the back of the disc
    answers a beat earlier, the front barely counters — a disc, not an eel."""
    p.turn('tail', 'z', amp * math.sin(w))
    p.turn('mid', 'z', -0.22 * amp * math.sin(w + 0.6))
    p.turn('body', 'z', 0.04 * amp * math.sin(w + 0.3))


def streamers(p, w, swing, lift=0.0, curl=0.0):
    """The streamers trail the beat a quarter cycle late, the tips later still
    (a whip, not a stick); lift spreads them; curl folds them back."""
    p.turn('dorsal', 'z', swing * math.sin(w - 1.4))
    p.turn('anal', 'z', swing * math.sin(w - 1.6))
    p.turn('dorsal', 'x', 0.08 * lift - 0.12 * curl + 0.03 * math.sin(w - 0.9))
    p.turn('anal', 'x', -0.08 * lift + 0.12 * curl - 0.03 * math.sin(w - 1.1))


def swim(t, T=1.6):
    p = Pose()
    w = 2 * math.pi * t / T
    beat(p, w, 0.26)
    streamers(p, w, 0.14)
    return p


def hover(t, T=4.0):
    p = Pose()
    w = 2 * math.pi * t / T
    beat(p, 2 * w, 0.06)
    streamers(p, w, 0.1, lift=0.4 + 0.3 * math.sin(w))
    return p


def burst(t, T=0.9):
    p = Pose()
    strokes = env(t, 0.05, 0.15, 0.55, 0.8)
    w = 2 * math.pi * t / 0.36
    beat(p, w, 0.55 * strokes)
    streamers(p, w, 0.18 * strokes, curl=env(t, 0.0, 0.12, 0.6, T))
    return p


def display(t, T=3.0):
    p = Pose()
    on = env(t, 0.0, 0.8, T - 0.8, T)
    w = 2 * math.pi * t / 1.5
    p.turn('body', 'y', 0.12 * on)  # leans to show its side
    beat(p, w, 0.08 * on)
    streamers(p, w, 0.12 * on, lift=on)
    return p


def bend(t, T=2.0):
    """The dial: time 0 bent hard to its right, 1 straight, 2 hard to its left."""
    p = Pose()
    b = t - 1.0
    p.turn('flex', 'z', 0.16 * b)
    p.turn('flex2', 'z', 0.24 * b)
    return p


CLIPS = [('swim', swim, 1.6), ('hover', hover, 4.0), ('burst', burst, 0.9), ('display', display, 3.0), ('bend', bend, 2.0)]


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
        counts = segment(meshes, bone_of, pitch, phase, by_point=True)
        blended = soften(meshes)
        rig = build_armature('Angelfish', meshes, bone_table(), nondeform=('root', 'flex', 'flex2'))
        keyed = {pb.name: ['rotation_quaternion'] for pb in rig.pose.bones if pb.name != 'root'}
        clips = bake(rig, BREED, CLIPS, apply_pose, ('swim', 'hover'), keyed)
        out = export(rig, out_path(BREED), {})
        return {'faces_per_part': counts, 'blended_vertices': blended, 'bones': len(rig.data.bones), 'clips': clips,
                'out': out, 'bytes': os.path.getsize(out)}


if __name__ == '__main__':
    result = main()
    print(result)
