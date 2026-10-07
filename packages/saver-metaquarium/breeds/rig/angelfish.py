"""
Rig and animate the angelfish: breeds/source/angelfish.glb in,
breeds/rig/angelfish.glb out.

    blender -b -P breeds/rig/angelfish.py        (from packages/saver-metaquarium)

The source is the MINTED breed's one model (breeds/minted.mjs), its triangles
cut into paint regions MINT-R<n> / MINT-EYE-R<n>: every one of the 200
angelfish tokens is this model in its own paint, so this one rig swims them
all. The model is never edited; the rig says which part each voxel face
belongs to. Its regions are materials, and a face keeps its material through
the rig and the intake, so each token's paint still lands where it should.

Facing. The delivered fish swims along +X (its eyes sit at that end); every
rig faces -Y (glTF +Z, which is what the tank assumes of a rig). So the baked
meshes are turned a quarter turn about Z first — a rigid turn of the whole
model, nothing moved relative to anything else.

The lattice, delivered: 2-unit voxels, planes at x ≡ 1.31, y ≡ 1, z ≡ 1.05
(mod 2). Anatomy is quoted in those DELIVERED voxel indices (ixo along the
body, nose at +ixo; izo up), measured with a side view of the occupancy:

    body    the disc, nose to ixo -4, with both eyes (EYE cells stay here, rigid)
    mid     the back of the disc, ixo -8..-5: it flexes with the beat
    tail    the caudal fin, the bar at ixo <= -9 (izo -8..6)
    dorsal1 the tall back fin, izo >= 3 behind ixo -2
    dorsal2 its trailing streamers, izo >= 7 (they reach back over the tail)
    anal1   the low fin under it, izo <= -5 behind ixo -2
    anal2   its streamers, izo <= -9

Clips (30 fps; the tank sets their times and weights, never update(dt)):

    swim     1 s loop: the tail beats, the back of the disc answers, the
             fins sway on a lag and their streamers on a longer one — a whip
    glide    4 s loop: the tail barely fans, the fins ripple slowly and the
             streamers drift (an angelfish's hang in still water)
    burst    0.9 s: fins fold back flat, two hard beats, then they open again
    display  3 s: the fins rise and spread, the streamers flutter, the body
             tips to show its side — then everything settles back

The one-shots start and end on the rest pose.
"""
import math
import os
import sys

import bpy
from mathutils import Matrix

sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (  # noqa: E402
    Pose, apply_pose, bake, begin, in_scene, build_armature, env, export, lattice, load_source, out_path, segment, track,
)

BREED = 'angelfish'
# The delivered lattice's phases (x, z): faces are classified in delivered voxels.
PHASE_X, PHASE_Z, PITCH = 1.31, 1.05, 2.0


def delivered(x, y, z):
    """Rig space (nose -Y) back to the delivered voxel indices (nose +X)."""
    xo = -y
    return math.floor((xo - PHASE_X) / PITCH), math.floor((z - PHASE_Z) / PITCH)


def bone_of(x, y, z, mat):
    if 'EYE' in mat:
        return 'body'
    ixo, izo = delivered(x, y, z)
    if izo >= 7:
        return 'dorsal2'
    if izo <= -9:
        return 'anal2'
    if ixo <= -9:
        return 'tail'
    if izo >= 3 and ixo <= -2:
        return 'dorsal1'
    if izo <= -5 and ixo <= -2:
        return 'anal1'
    if ixo <= -5:
        return 'mid'
    return 'body'


def bone_table():
    # Rig space: nose toward -Y, up +Z; y = -(delivered x).
    return {
        'root': ((0, 0, -26), (0, 0, -23), None),
        'body': ((0, 6, -2), (0, -12, -2), 'root'),
        'mid': ((0, 6, -2), (0, 15, -2), 'body'),
        'tail': ((0, 15, -2), (0, 22, -2), 'mid'),
        'dorsal1': ((0, -3, 7), (0, 10, 15), 'body'),
        'dorsal2': ((0, 10, 15), (0, 22, 20), 'dorsal1'),
        'anal1': ((0, -3, -9), (0, 10, -17), 'body'),
        'anal2': ((0, 10, -17), (0, 18, -22), 'anal1'),
    }


def fins(p, lift=0.0, fold=0.0, sway=0.0, tip=0.0):
    """lift: the fins rise and spread (the dorsal's tip up, the anal's down);
    fold: they lay back toward the body; sway: side to side; tip: the
    streamers' extra swing. About X, + carries a backward-pointing tip UP.
    Small angles: these are rigid voxel slabs hinged at their roots, and a
    big swing opens a seam where a fin meets the disc."""
    p.turn('dorsal1', 'x', 0.07 * lift - 0.1 * fold)
    p.turn('anal1', 'x', -0.07 * lift + 0.1 * fold)
    p.turn('dorsal2', 'x', 0.12 * lift - 0.16 * fold)
    p.turn('anal2', 'x', -0.12 * lift + 0.16 * fold)
    for f in ('dorsal1', 'anal1'):
        p.turn(f, 'z', sway)
    for f in ('dorsal2', 'anal2'):
        p.turn(f, 'z', tip)


def beat(p, w, amp):
    """One tail beat at phase w: the tail swings, the back of the disc answers,
    the head barely counters (an angelfish is a disc: little of it bends)."""
    p.turn('tail', 'z', amp * math.sin(w))
    p.turn('mid', 'z', -0.3 * amp * math.sin(w - 0.5))
    p.turn('body', 'z', 0.05 * amp * math.sin(w - 0.2))


def swim(t, T=1.0):
    p = Pose()
    w = 2 * math.pi * t / T
    beat(p, w, 0.42)
    fins(p, sway=0.1 * math.sin(w - 1.0), tip=0.22 * math.sin(w - 1.9))
    # The fins also ripple fore and aft a little, out of step with the beat.
    p.turn('dorsal1', 'x', 0.04 * math.sin(w - 0.6))
    p.turn('anal1', 'x', -0.04 * math.sin(w - 0.6))
    return p


def glide(t, T=4.0):
    p = Pose()
    w = 2 * math.pi * t / T
    beat(p, 2 * w, 0.1)  # two slow fans in the loop
    fins(p, lift=0.15 + 0.1 * math.sin(w), sway=0.05 * math.sin(w - 0.8), tip=0.16 * math.sin(w - 1.6))
    p.turn('dorsal2', 'x', 0.06 * math.sin(2 * w))
    p.turn('anal2', 'x', -0.06 * math.sin(2 * w + 0.7))
    return p


def burst(t, T=0.9):
    p = Pose()
    fold = env(t, 0.0, 0.15, 0.6, T)
    strokes = env(t, 0.08, 0.18, 0.55, 0.75)
    w = 2 * math.pi * t / 0.32
    beat(p, w, 0.75 * strokes)
    fins(p, fold=fold, tip=0.25 * math.sin(w - 1.2) * strokes)
    return p


def display(t, T=3.0):
    p = Pose()
    on = env(t, 0.0, 0.6, T - 0.7, T)
    flutter = 2 * math.pi * t / 0.45
    fins(p, lift=on, sway=0.06 * math.sin(flutter) * on, tip=0.2 * math.sin(flutter - 1.0) * on)
    p.turn('body', 'y', 0.1 * on)  # leans a little, showing its side
    beat(p, 2 * math.pi * t / 1.5, 0.12 * on)
    return p


CLIPS = [('swim', swim, 1.0), ('glide', glide, 4.0), ('burst', burst, 0.9), ('display', display, 3.0)]


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
        rig = build_armature('Angelfish', meshes, bone_table())
        keyed = {pb.name: ['rotation_quaternion'] for pb in rig.pose.bones if pb.name != 'root'}
        clips = bake(rig, BREED, CLIPS, apply_pose, ('swim', 'glide'), keyed)
        out = export(rig, out_path(BREED), {})
        return {'faces_per_bone': counts, 'bones': len(rig.data.bones), 'clips': clips, 'out': out,
                'bytes': os.path.getsize(out)}


if __name__ == '__main__':
    result = main()
    print(result)
