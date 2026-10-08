"""
Rig and animate the seahorse: breeds/source/seahorse.glb in,
breeds/rig/seahorse.glb out.

    blender -b -P breeds/rig/seahorse.py        (from packages/saver-metaquarium)

The source is the MINTED breed's one model (breeds/minted.mjs), cut into paint
regions MINT-R<n> / MINT-EYE-R<n>: all 40 seahorse tokens are this model in
their own paint, so this one rig swims them all. The model is never edited.
(It used to be bent by a vertex patch, src/seahorse.ts's first life: a fin
ripple and a tail coil. A skeleton does far more.)

Facing. The delivered seahorse stands upright facing -X (snout at the
lowest x); every rig faces -Y (glTF +Z). So the baked meshes are turned a
quarter turn about Z first — rigid, the whole model.

The lattice, after the turn: 2-unit voxels, a cell iy spanning y 2iy+0.63 ..
2iy+2.63 (x: +1.0, z: +0.81). Centred on x = 0; its left is +X; up is +Z.
Read off the side occupancy (nose -Y):

    head     z 12.8 .. 24.8, the coronet on top; both eyes on its sides
             (z 14.8 .. 20.8, y -5.4 .. 0.6, standing out to x ±7)
    snout    y -11.4 .. -5.4, z 12.8 .. 18.8
    neck     z 6.8 .. 12.8, three cells deep
    trunk    z -11.2 .. 6.8, the belly forward to y -7.4
    fin      the dorsal fin off its back, y 8.6 .. 14.6, z -7.2 .. 2.8
    tail     down from the trunk (y ~0.6) to z -24, then hooked FORWARD
             along the bottom to y -11 and up again to z -18 (TAIL)

Soft throughout (common.soften): every vertex's weights come from where it
lies. The trunk is rigid; the neck blends it into the head, the head into the
snout; the fin is three bones down the back (a ripple runs along it); the
tail is a chain of six along its curve, handed over by arc length — so it
coils smoothly, a spiral, never a set of hinges.

Bones only a dial or a moment moves (non-deforming: each has one driver,
so the mixer never averages two — exported as nodes, common.export layered):

    roll           the whole seahorse, about its middle: twirls and tilts
    lean           its lean forward (the lean dial: it leans into a swim)
    lookY, lookP   the neck's yaw and pitch: the look dials
    c1..c6         one above each tail bone: the curl dial coils the whole
                   tail at once, under any other move

Clips (30 fps; the tank sets their times and weights, never update(dt)):

    swim     2 s loop: the dorsal fin rippling, a wave down it twice a
             second (a real one is a blur; quicker reads as a jitter at
             30 fps), the tail trailing in a slow sideways wave
    hover    3 s loop: a gentler ripple, rocking upright
    burst    1 s loop: the fin hard at work, the tail streaming back
    moments  one-shots from rest to rest (src/seahorse.ts gives every
             seahorse a temperament and a favourite): coil, twirl, dance,
             snick, bow, bob, lookabout, stretch, wag, tilt
    curl, lean, lookYaw, lookPitch
             DIALS, 2 s each: the time is the setting — 0 one way, 1 at
             rest, 2 the other (curl + coiled forward, lean + forward,
             lookYaw + to its left, lookPitch + snout up)
"""
import math
import os
import sys

import bpy
from mathutils import Matrix

sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (  # noqa: E402
    Pose, along, apply_pose, arc_centres, bake, begin, blend, build_armature, ease, env, export, eyes_pure, hat,
    in_scene, knots, lattice, load_source, out_path, segment, soften, track,
)

BREED = 'seahorse'
PITCH = 2.0
# Top to bottom, by -z: the head pure above z 13.6 (its eyes start at 14.8),
# the neck between, the trunk pure below z 6.2.
SPINE = ((-13.6, 'head'), (-10.8, 'neck'), (-8.6, 'neck'), (-6.2, 'trunk'))
# Within the head, by y: the snout ahead of y -8.6, the head behind -5.6
# (the eyes' front faces are at -5.37: pure head).
SNOUT = ((-8.6, 'snout'), (-5.6, 'head'))
# The tail's curve in (y, z), trunk to hook tip, and its six bones.
TAIL = ((1.4, -10.2), (0.63, -14.2), (0.63, -18.2), (0.63, -22.2), (-2.4, -25.4), (-7.4, -25.6), (-9.4, -19.8))
TAIL_BONES = ('t1', 't2', 't3', 't4', 't5', 't6')
CURL = ('c1', 'c2', 'c3', 'c4', 'c5', 'c6')
TAIL_FROM = -9.2  # the trunk hands over to the tail below this z
# The dorsal fin: off the back beyond y 8.63, three bones down it by -z.
FIN_BACK = 8.63
FIN = ((-1.8, 'fin1'), (2.2, 'fin2'), (6.2, 'fin3'))
FIN_Z = (1.8, -2.2, -6.2)
NECK = (0.0, 0.6, 6.8)
HEAD = (0.0, 0.0, 12.8)
MIDDLE = (0.0, 1.0, -2.0)


def weights_at(co, eye):
    if eye:
        return {'head': 1.0}
    y, z = co.y, co.z
    w = knots(-z, SPINE)
    if 'head' in w:
        h = w.pop('head')
        for k, v in knots(y, SNOUT).items():
            w[k] = w.get(k, 0) + h * v
    # The tail: below the trunk, along its curve.
    if z < TAIL_FROM + 1:
        f = ease((TAIL_FROM - z) / 3)
        w = blend(w, hat(along(TAIL, y, z), arc_centres(TAIL), TAIL_BONES), f)
    # The dorsal fin: what stands off the back.
    if y > FIN_BACK:
        w = blend(w, knots(-z, FIN), ease((y - FIN_BACK) / 2))
    return w


def bone_of(x, y, z, mat):
    """Only to start the vertex groups (weights_at decides): eyes or not."""
    return '_eye' if 'EYE' in mat else '_part'


def bone_table():
    up = lambda p, d=0.5: (p[0], p[1], p[2] + d)  # noqa: E731 — a short stub bone above a point
    t = {
        'root': ((0, 0, -40), (0, 0, -37), None),
        'roll': (MIDDLE, up(MIDDLE), 'root'),
        'lean': (MIDDLE, up(MIDDLE), 'roll'),
        'trunk': ((0, 1.0, -10.2), (0, 1.0, 6.8), 'lean'),
        'lookY': (NECK, up(NECK), 'trunk'),
        'lookP': (NECK, up(NECK), 'lookY'),
        'neck': (NECK, HEAD, 'lookP'),
        'head': (HEAD, (0, 0, 24.0), 'neck'),
        'snout': ((0, -5.4, 15.8), (0, -11.4, 15.8), 'head'),
    }
    for name, z in zip(('fin1', 'fin2', 'fin3'), FIN_Z):
        t[name] = ((0, FIN_BACK, z), (0, FIN_BACK + 6, z), 'trunk')
    parent = 'trunk'
    for i, (b, c) in enumerate(zip(TAIL_BONES, CURL)):
        (y0, z0), (y1, z1) = TAIL[i], TAIL[i + 1]
        t[c] = ((0, y0, z0), (0, y0, z0 - 0.5), parent)
        t[b] = ((0, y0, z0), (0, y1, z1), c)
        parent = b
    return t


NONDEFORM = ('root', 'roll', 'lean', 'lookY', 'lookP') + CURL


# --------------------------------------------------------------------------
# Posing. Signs (rotations about world axes at rest, each relative to its
# parent, so a chain's turns accumulate):
#   about X: + tips the top FORWARD — the trunk leans, the head nods (the
#            snout dips); on a tail bone + swings it BACK, so a forward coil
#            is − (the way the hook already curls)
#   about Z: + turns to its left (the head looks, the fin swings its edge)
#   about Y: + rolls its top to its right
# --------------------------------------------------------------------------

TAIL_K = (0.6, 0.8, 1.0, 1.1, 1.1, 1.0)  # how much of a curl each tail bone takes


def coil(p, c):
    """The tail coils forward by c (radians at the most-curled bone)."""
    for b, k in zip(TAIL_BONES, TAIL_K):
        p.turn(b, 'x', -c * k)


def tail_wave(p, w, amp, lag=0.6):
    """A sideways wave travelling down the tail."""
    for i, (b, k) in enumerate(zip(TAIL_BONES, TAIL_K)):
        p.turn(b, 'y', amp * k * math.sin(w - lag * i))


def ripple(p, w, amp, lag=0.9):
    """A wave running down the dorsal fin, its edge swinging side to side."""
    for i, b in enumerate(('fin1', 'fin2', 'fin3')):
        p.turn(b, 'z', amp * math.sin(w - lag * i))


def look(p, nod=0.0, yaw=0.0, neck_share=0.4):
    p.turn('neck', 'x', neck_share * nod)
    p.turn('neck', 'z', neck_share * yaw)
    p.turn('head', 'x', (1 - neck_share) * nod)
    p.turn('head', 'z', (1 - neck_share) * yaw)


def swim(t, T=2.0):
    p = Pose()
    ripple(p, 2 * math.pi * t / 0.5, 0.09)
    w = 2 * math.pi * t / T
    tail_wave(p, w, 0.05)
    p.move('trunk', (0, 0, 0.3 * math.sin(w)))
    look(p, nod=0.03 * math.sin(w - 1.0))
    p.turn('snout', 'x', 0.03 * math.sin(2 * w))
    return p


def hover(t, T=3.0):
    p = Pose()
    ripple(p, 2 * math.pi * t / 0.6, 0.07)
    w = 2 * math.pi * t / T
    p.turn('trunk', 'x', 0.03 * math.sin(w))
    p.turn('trunk', 'y', 0.02 * math.sin(w + 1))
    coil(p, 0.04 * (1 + math.sin(w - 0.8)))
    look(p, nod=-0.03 * math.sin(w), yaw=0.04 * math.sin(w))
    return p


def burst(t, T=1.0):
    p = Pose()
    ripple(p, 2 * math.pi * t / 0.5, 0.11, lag=0.8)
    w = 2 * math.pi * t / T
    coil(p, -0.06)  # streaming back
    tail_wave(p, w, 0.06, lag=0.8)
    p.turn('trunk', 'x', 0.1)
    look(p, nod=-0.08)
    return p


# --- moments -------------------------------------------------------------

def coil_up(t, T=5.0):
    """The tail winds into a tight spiral, squeezes, and lets go."""
    p = Pose()
    c = env(t, 0.0, 1.5, T - 1.6, T)
    squeeze = 0.08 * math.sin(math.pi * (t - 1.5) / 1.8) ** 2 if 1.5 <= t <= 3.3 else 0.0
    coil(p, (0.34 + squeeze) * c)
    p.turn('trunk', 'x', 0.06 * c)
    look(p, nod=0.1 * c)
    ripple(p, 2 * math.pi * t / 0.7, 0.05 * c)
    return p


def twirl(t, T=4.6):
    """A slow pirouette about its own upright axis, the tail swinging out."""
    p = Pose()
    p.turn('roll', 'z', 2 * math.pi * ease((t - 0.6) / (T - 1.2)))
    out = env(t, 0.0, 1.0, T - 1.2, T)
    coil(p, -0.08 * out)
    tail_wave(p, 2 * math.pi * t / 2.3, 0.06 * out)
    ripple(p, 2 * math.pi * t / 0.5, 0.08 * out)
    look(p, nod=-0.08 * out)
    return p


def dance(t, T=5.2):
    """Courtship: swaying side to side, rising, head held high."""
    p = Pose()
    on = env(t, 0.0, 1.0, T - 1.2, T)
    sway = math.sin(2 * math.pi * (t - 0.4) / 2.6)
    p.turn('roll', 'y', 0.16 * on * sway)
    look(p, nod=-0.18 * on, yaw=-0.1 * on * sway)
    p.move('trunk', (0, 0, 1.2 * on * math.sin(math.pi * t / T) ** 2))
    tail_wave(p, 2 * math.pi * (t - 0.4) / 2.6 + math.pi, 0.06 * on)
    coil(p, 0.1 * on)
    ripple(p, 2 * math.pi * t / 0.55, 0.08 * on)
    return p


def snick(t, T=3.0):
    """Feeding: the snout aims down at something, holds — then the head
    flicks up to take it, and settles."""
    p = Pose()
    aim = env(t, 0.0, 0.8, 1.6, 2.05)
    strike = env(t, 1.6, 2.05, 2.3, T)
    look(p, nod=0.35 * aim - 0.3 * strike, neck_share=0.3)
    p.turn('snout', 'x', -0.12 * strike)
    p.turn('trunk', 'x', 0.05 * aim - 0.04 * strike)
    coil(p, 0.08 * env(t, 0.0, 0.8, 2.0, T))
    return p


def bow(t, T=3.6):
    """A deep, slow bow."""
    p = Pose()
    b = env(t, 0.0, 1.1, T - 1.3, T)
    p.turn('trunk', 'x', 0.16 * b)
    look(p, nod=0.5 * b, neck_share=0.5)
    coil(p, 0.08 * b)
    ripple(p, 2 * math.pi * t / 0.7, 0.05 * b)
    return p


def bob(t, T=3.4):
    """Two slow rises and dips, the tail curling with each rise."""
    p = Pose()
    up = math.sin(math.pi * (t - 0.3) / 1.4) ** 2 if 0.3 <= t <= 3.1 else 0.0
    p.move('trunk', (0, 0, 1.6 * up))
    look(p, nod=-0.1 * up)
    coil(p, 0.1 * up)
    ripple(p, 2 * math.pi * t / 0.5, 0.06 * up)
    return p


def lookabout(t, T=4.4):
    """It looks to its left, then its right."""
    p = Pose()
    yaw = track(t, [(0, 0), (1.0, 0.55), (1.8, 0.55), (2.8, -0.55), (3.4, -0.55), (T, 0)])
    look(p, yaw=yaw, neck_share=0.4)
    p.turn('trunk', 'z', 0.06 * yaw)
    return p


def stretch(t, T=4.0):
    """Snout up, the tail let all the way out, a shiver at the top."""
    p = Pose()
    a = env(t, 0.0, 1.3, T - 1.3, T)
    shiver = 0.03 * math.sin(2 * math.pi * t / 0.7) * env(t, 1.1, 1.5, T - 1.6, T - 1.2)
    look(p, nod=-0.35 * a + shiver, neck_share=0.4)
    coil(p, -0.1 * a)
    p.turn('trunk', 'x', -0.06 * a)
    return p


def wag(t, T=3.6):
    """The tail swishes side to side, playful."""
    p = Pose()
    on = env(t, 0.0, 0.8, T - 1.0, T)
    tail_wave(p, 2 * math.pi * t / 1.2, 0.12 * on)
    p.turn('trunk', 'y', -0.03 * on * math.sin(2 * math.pi * t / 1.2))
    return p


def tilt(t, T=3.6):
    """It cocks its whole self to one side, curious, then straightens."""
    p = Pose()
    a = env(t, 0.0, 1.0, T - 1.1, T)
    p.turn('roll', 'y', -0.25 * a)
    p.turn('head', 'y', -0.15 * a)
    for b, k in zip(TAIL_BONES, TAIL_K):
        p.turn(b, 'y', 0.06 * k * a)
    return p


# --- dials ---------------------------------------------------------------

def curl(t, T=2.0):
    p = Pose()
    u = t - 1
    for c, k in zip(CURL, TAIL_K):
        p.turn(c, 'x', -0.2 * k * u)
    return p


def lean(t, T=2.0):
    p = Pose()
    p.turn('lean', 'x', 0.35 * (t - 1))
    return p


def look_yaw(t, T=2.0):
    p = Pose()
    p.turn('lookY', 'z', 0.5 * (t - 1))
    return p


def look_pitch(t, T=2.0):
    p = Pose()
    p.turn('lookP', 'x', -0.3 * (t - 1))
    return p


CLIPS = [
    ('swim', swim, 2.0), ('hover', hover, 3.0), ('burst', burst, 1.0),
    ('coil', coil_up, 5.0), ('twirl', twirl, 4.6), ('dance', dance, 5.2), ('snick', snick, 3.0), ('bow', bow, 3.6),
    ('bob', bob, 3.4), ('lookabout', lookabout, 4.4), ('stretch', stretch, 4.0), ('wag', wag, 3.6), ('tilt', tilt, 3.6),
    ('curl', curl, 2.0), ('lean', lean, 2.0), ('lookYaw', look_yaw, 2.0), ('lookPitch', look_pitch, 2.0),
]


def main():
    scene = bpy.data.scenes.get(BREED) or bpy.data.scenes.new(BREED)
    with in_scene(scene):
        begin(BREED)
        meshes = load_source(BREED)
        # Face the rig convention: snout -X -> -Y. Rigid, the whole model at once.
        turn = Matrix.Rotation(math.pi / 2, 4, 'Z')
        for o in meshes:
            o.data.transform(turn)
        pitch, phase = lattice(meshes)
        assert pitch == PITCH and tuple(round(v, 2) for v in phase) == (1.0, 0.63, 0.81), (pitch, phase)
        segment(meshes, bone_of, pitch, phase, by_point=True)
        eyes_pure(meshes, weights_at, 'head')
        blended = soften(meshes, weights_at)
        rig = build_armature('Seahorse', meshes, bone_table(), nondeform=NONDEFORM)
        keyed = {pb.name: ['rotation_quaternion'] for pb in rig.pose.bones if pb.name != 'root'}
        keyed['trunk'].append('location')
        clips = bake(rig, BREED, CLIPS, apply_pose, ('swim', 'hover', 'burst'), keyed)
        out = export(rig, out_path(BREED), {}, layered=True)
        return {'blended_vertices': blended, 'bones': len(rig.data.bones), 'clips': clips, 'out': out,
                'bytes': os.path.getsize(out)}


if __name__ == '__main__':
    result = main()
    print(result)
