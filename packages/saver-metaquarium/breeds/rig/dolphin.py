"""
Rig and animate the dolphin: breeds/source/dolphin.glb in, breeds/rig/dolphin.glb out. EXPERIMENTAL.

    blender -b -P breeds/rig/dolphin.py        (from packages/saver-metaquarium)

Dot's friend. The model is drawn by rig/dolphin-model.mjs in our designer's
style, and this script treats it as it treats theirs: never edited, only cut
into parts. It faces -Y, its left +X; voxel centres sit at (2i, 2j, 2k + 1),
its spine runs along y at z 8.5. Drawn at the house scale (24 cubes long, the
dori 17): big cubes, so every joint here is a few cubes, not a dozen.

    head      the nose, the melon, the smile and the cheeks (rigid to y -9)
    body      the chest and the back, the dorsal fin riding it
    tail1/2   the tail stock
    flukes    the flat tail fin
              — the head, body, tail and flukes are ONE soft skin: every
              vertex's weights come from how far along the body it lies
              (BODY_KNOTS), so it bends as one animal and never cracks
    jaw       the lower jaw and its tongue, hinged at the corner of the smile
    flipper.L/R  the pectoral flippers, rigid, hinged at the chest
    blowhole  the dark spot on top: it opens (scale) when it blows a bubble
    eye.L/R   each eye ONE white box on the side of the head (side_eyes): a
              blink squashes it to its middle, a happy squint nearly shut
    pupil.L/R each pupil ONE quad on its eye's outer face, a catchlight on it;
              no clip moves them — src/dolphin.ts slides them to look about,
              at its friends, at you

A dolphin swims with its tail going UP AND DOWN (a shark's goes side to
side): every stroke here is a pitch, about x. Clips (30 fps; the tank sets
their times and weights, never update(dt)):

    swim     1.0 s loop. The stroke: a wave down the body, the flukes beating
             widest; the head bobs a little against it.
    glide    3.0 s loop. Coasting: a slow, shallow beat, flippers out.
    burst    0.5 s loop. Fast, deep strokes, head down, flippers tucked.
    hover    2.4 s loop. Holding station: the flukes scull, the flippers paddle.
    chatter  2.6 s. Head up, the jaw clacking open and shut — a dolphin's
             laugh — the eyes squeezed happy, a little shimmy.
    nod      1.6 s. Yes: the head dips twice.
    shake    1.6 s. No: the head swings side to side.
    spin     2.2 s. A barrel roll, flippers tucked.
    flip     2.8 s. A backflip: a whole loop, head up and over.
    wave     2.4 s. Rolls onto its side and waves a flipper, squinting happy.
    bubble   2.6 s. Settles, the blowhole opens and puffs (the tank lets the
             bubble go), and it watches it rise.
    blink    0.4 s. The eyes only (scale keys), so it layers over any clip.

The one-shots start and end on the rest pose.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (  # noqa: E402
    Pose, _box_quads, _replace, apply_pose, bake, begin, build_armature, env, export, in_scene, knots, lattice,
    load_source, out_path, segment, track,
)

SOFT = '_soft'
LINE = 'PAINT-#14243a'  # dolphin-model.mjs LINE
SPINE_Z = 8.5
# The soft skin's knots along y (model units): the head rigid to y -9, eased
# into the body over the neck; the body rigid over the chest; then the tail
# stock in two links, and the flukes.
BODY_KNOTS = [(-9.0, 'head'), (-3.0, 'body'), (3.0, 'body'), (10.0, 'tail1'), (16.0, 'tail2'), (20.0, 'flukes')]
HINGE = (0.0, -17.0, 6.0)   # the jaw's hinge, at the corner of the smile


def bone_of(x, y, z, mat):
    i, j, k = round(x / 2), round(y / 2), round((z - 1) / 2)
    side = 'L' if x > 0 else 'R'
    if mat == 'EYES-White':
        return f'eye.{side}'
    if mat == 'EYES-Black':
        return f'pupil.{side}'
    if mat == LINE and k >= 7:
        return 'blowhole'
    if abs(i) >= 4 and k <= 1 and -5 <= j <= -3:
        return f'flipper.{side}'
    if j <= -9 and k <= 2:
        return 'jaw'
    return SOFT


def soften(meshes):
    """The body's vertices, weighted by where along it they lie (BODY_KNOTS).
    Every face carries its own vertices, so two faces meeting at a corner get
    the same weights there by position alone: no crack can open."""
    blended = 0
    for o in meshes:
        groups = {g.name: g for g in o.vertex_groups}
        soft = groups.get(SOFT)
        if soft is None:
            continue
        for v in o.data.vertices:
            if not any(g.group == soft.index for g in v.groups):
                continue
            w = knots(v.co.y, BODY_KNOTS)
            for n, x in w.items():
                if n not in groups:
                    groups[n] = o.vertex_groups.new(name=n)
                groups[n].add([v.index], x, 'REPLACE')
            blended += len(w) > 1
        o.vertex_groups.remove(soft)
    return blended


def side_eyes(white, black):
    """Each eye (one per side of x = 0) rebuilt for a pupil that SLIDES — the
    dolphin's are on the sides of its head, so the pupil lies on the box's
    OUTER face (common.clean_eyes puts it on the front). One white box of the
    eye's full extent and one black quad, the pupil's footprint, on its
    outer face (a hair proud). Returns, per side, the box and the pupil's rectangle (y0, y1, z0, z1)."""
    out = {}
    for side in (1, -1):
        wf = [f for f in white.data.polygons if f.center.x * side > 0]
        bf = [f for f in black.data.polygons if f.center.x * side > 0]
        assert wf and bf, side
        pts = [white.data.vertices[i].co for f in wf for i in f.vertices] + [black.data.vertices[i].co for f in bf for i in f.vertices]
        lo = Vector([min(p[i] for p in pts) for i in range(3)])
        hi = Vector([max(p[i] for p in pts) for i in range(3)])
        x = hi.x if side > 0 else lo.x
        px = x + side * PUPIL_PROUD
        face = [f for f in bf if f.normal.x * side > 0.9 and abs(f.center.x - x) < 0.01]
        fp = [black.data.vertices[i].co for f in face for i in f.vertices]
        y0, y1 = min(p.y for p in fp), max(p.y for p in fp)
        z0, z1 = min(p.z for p in fp), max(p.z for p in fp)
        _replace(white, {f.index for f in wf}, _box_quads(lo, hi))
        quad = [Vector((px, y0, z0)), Vector((px, y1, z0)), Vector((px, y1, z1)), Vector((px, y0, z1))]
        _replace(black, {f.index for f in bf}, [(quad, Vector((side, 0, 0)))])
        out[side] = ((tuple(lo), tuple(hi)), (y0, y1, z0, z1))
    return out


PUPIL_PROUD = 0.03  # a hair proud of the white, so no renderer z-fights it (the tank's decal bias also holds it)
CATCH = 1.4       # the catchlight's side (model units)
CATCH_IN = 0.5    # in from the pupil's top front corner
CATCH_PROUD = 0.12


def catchlights(white, rects):
    """A catchlight on each pupil: a small white quad on the eye's white mesh,
    proud of the pupil, high and to the front (toward the beak), weighted
    wholly to that pupil's bone, so it slides with the pupil."""
    groups = {}
    for s, (box, (y0, y1, z0, z1)) in rects.items():
        x = (box[1][0] if s > 0 else box[0][0]) + s * CATCH_PROUD
        a, b = y0 + CATCH_IN, y0 + CATCH_IN + CATCH
        c, d = z1 - CATCH_IN - CATCH, z1 - CATCH_IN
        bm = bmesh.new()
        bm.from_mesh(white.data)
        before = len(bm.verts)
        f = bm.faces.new([bm.verts.new(v) for v in (Vector((x, a, c)), Vector((x, b, c)), Vector((x, b, d)), Vector((x, a, d)))])
        f.normal_update()
        if f.normal.x * s < 0:
            f.normal_flip()
        bm.to_mesh(white.data)
        bm.free()
        groups['L' if s > 0 else 'R'] = list(range(before, before + 4))
    for side, idx in groups.items():
        g = white.vertex_groups.get(f'pupil.{side}') or white.vertex_groups.new(name=f'pupil.{side}')
        g.add(idx, 1.0, 'REPLACE')
    return len(groups)


def bone_table(eyes):
    t = {
        'root': ((0, 0, 0), (0, 0, 2), None),
        'body': ((0, -4, SPINE_Z), (0, 4, SPINE_Z), 'root'),
        'head': ((0, -6, SPINE_Z), (0, -22, SPINE_Z), 'body'),
        'jaw': (HINGE, (0, -24, 4), 'head'),
        'blowhole': ((0, -12, 15), (0, -12, 17), 'head'),
        'tail1': ((0, 4, SPINE_Z), (0, 12, SPINE_Z), 'body'),
        'tail2': ((0, 12, SPINE_Z), (0, 19, SPINE_Z), 'tail1'),
        'flukes': ((0, 19, SPINE_Z), (0, 26, SPINE_Z), 'tail2'),
        'flipper.L': ((7, -10, 3), (11, -6, 1), 'body'),
        'flipper.R': ((-7, -10, 3), (-11, -6, 1), 'body'),
    }
    for s, ((lo, hi), (y0, y1, z0, z1)) in eyes.items():
        side = 'L' if s > 0 else 'R'
        cx, cy, cz = (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2
        # Every eye bone points up: a blink squashes it top to bottom, to its middle.
        t[f'eye.{side}'] = ((cx, cy, cz), (cx, cy, cz + 2), 'head')
        x = hi[0] if s > 0 else lo[0]
        t[f'pupil.{side}'] = ((x, (y0 + y1) / 2, (z0 + z1) / 2), (x, (y0 + y1) / 2, (z0 + z1) / 2 + 2), f'eye.{side}')
    return t


SIDES = (('L', 1), ('R', -1))
SPINE = (('head', 0.0, 0.035), ('body', 0.5, -0.025), ('tail1', 1.2, 0.09), ('tail2', 1.9, 0.15), ('flukes', 2.6, 0.27))


def stroke(p, w, amp=1.0):
    """The dolphin's stroke: a wave down the body, UP AND DOWN (about x),
    each link a little later and wider; the flukes beat widest."""
    for bone, lag, a in SPINE:
        p.turn(bone, 'x', a * amp * math.sin(w - lag))
    # The body heaves against the flukes, a little.
    p.move('body', (0, 0, -0.3 * amp * math.sin(w - 2.6)))


def eyes(p, shut):
    """Both eyes: 0 open, 1 shut (a squint is ~0.7), squashed to their middles."""
    for side, _ in SIDES:
        p.scale[f'eye.{side}'] = (1 + 0.08 * shut, 1 - 0.88 * shut, 1 + 0.08 * shut)


def blinking(t, at):
    return track(t, [(at, 0), (at + 0.08, 1), (at + 0.14, 1), (at + 0.3, 0)]) if at <= t <= at + 0.3 else 0.0


def flippers(p, out=0.0, down=0.0, side=None):
    """The flippers: `out` swings them away from the body (about z: + away),
    `down` pitches their tips down (about x). `side` picks one ('L' / 'R')."""
    for sd, m in SIDES:
        if side and sd != side:
            continue
        p.turn(f'flipper.{sd}', 'z', -m * out)
        p.turn(f'flipper.{sd}', 'x', down)


def gape(p, a):
    """The jaw drops about its hinge: + opens."""
    p.turn('jaw', 'x', a)


def swim(t, T=1.0):
    p = Pose()
    w = 2 * math.pi * t / T
    stroke(p, w)
    flippers(p, out=0.05 * math.sin(w + 0.8), down=0.04 * math.sin(w))
    return p


def glide(t, T=3.0):
    p = Pose()
    w = 2 * math.pi * t / T
    stroke(p, w, 0.3)
    flippers(p, out=0.18 + 0.05 * math.sin(w), down=-0.05)
    return p


def burst(t, T=0.5):
    p = Pose()
    w = 2 * math.pi * t / T
    stroke(p, w, 1.6)
    p.turn('head', 'x', 0.06)
    flippers(p, out=-0.12)
    return p


def hover(t, T=2.4):
    p = Pose()
    w = 2 * math.pi * t / T
    stroke(p, w, 0.35)
    for side, m in SIDES:
        p.turn(f'flipper.{side}', 'z', -m * (0.25 + 0.2 * math.sin(w + (0 if m > 0 else math.pi))))
        p.turn(f'flipper.{side}', 'x', 0.15 * math.sin(w))
    p.move('body', (0, 0, 0.35 * math.sin(w)))
    return p


def chatter(t, T=2.6):
    p = Pose()
    up = env(t, 0.0, 0.35, 2.1, 2.6)
    p.turn('head', 'x', -0.22 * up)
    p.turn('body', 'x', -0.08 * up)
    p.turn('flukes', 'x', 0.15 * up)
    # The laugh: the jaw clacks, quick, five times, and the head bobs with it.
    clack = 0.5 - 0.5 * math.cos(2 * math.pi * 2.6 * (t - 0.3))
    gape(p, 0.42 * clack * env(t, 0.25, 0.4, 1.95, 2.25))
    p.turn('head', 'x', -0.05 * clack * up)
    p.turn('body', 'z', 0.05 * math.sin(2 * math.pi * 1.3 * t) * up)
    eyes(p, 0.72 * env(t, 0.2, 0.45, 1.95, 2.3))
    flippers(p, out=0.35 * up)
    p.turn('flipper.L', 'x', 0.25 * math.sin(2 * math.pi * 2.6 * t) * up)
    p.turn('flipper.R', 'x', -0.25 * math.sin(2 * math.pi * 2.6 * t) * up)
    return p


def nod(t, T=1.6):
    p = Pose()
    n = math.sin(2 * math.pi * 2 * t / T) * env(t, 0.0, 0.2, 1.3, 1.6)
    p.turn('head', 'x', 0.2 * max(0.0, n) - 0.08 * max(0.0, -n))
    p.turn('flukes', 'x', -0.1 * n)
    eyes(p, 0.3 * env(t, 0.2, 0.4, 1.1, 1.4))
    return p


def shake(t, T=1.6):
    p = Pose()
    n = math.sin(2 * math.pi * 2 * t / T) * env(t, 0.0, 0.2, 1.3, 1.6)
    p.turn('head', 'z', 0.22 * n)
    p.turn('flukes', 'z', -0.12 * n)
    return p


def spin(t, T=2.2):
    p = Pose()
    r = track(t, [(0.0, 0.0), (0.25, 0.0), (1.85, 2 * math.pi), (T, 2 * math.pi)])
    p.turn('body', 'y', r)
    tuck = env(t, 0.1, 0.4, 1.7, 2.1)
    flippers(p, out=-0.15 * tuck)
    stroke(p, 2 * math.pi * t / 0.6, 0.8 * tuck)
    return p


def flip(t, T=2.8):
    p = Pose()
    # Head up and over: a whole loop about x, the spine curled into it.
    r = track(t, [(0.0, 0.0), (0.3, 0.0), (2.2, -2 * math.pi), (T, -2 * math.pi)])
    p.turn('body', 'x', r)
    curl = env(t, 0.2, 0.6, 1.9, 2.4)
    for bone, a in (('head', -0.18), ('tail1', -0.12), ('tail2', -0.18), ('flukes', -0.3)):
        p.turn(bone, 'x', a * curl)
    p.move('body', (0, 0, 3 * env(t, 0.3, 1.25, 1.25, 2.3)))
    flippers(p, out=0.4 * curl)
    eyes(p, 0.6 * env(t, 0.9, 1.1, 1.5, 1.8))
    return p


def wave(t, T=2.4):
    p = Pose()
    lean = env(t, 0.0, 0.4, 1.9, 2.4)
    # Onto its right side, its left flipper up to wave.
    p.turn('body', 'y', -0.55 * lean)  # + about y rolls its left side down
    p.turn('head', 'x', -0.08 * lean)
    p.turn('flipper.L', 'z', -0.9 * lean)
    p.turn('flipper.L', 'x', 0.45 * math.sin(2 * math.pi * 2.5 * t) * env(t, 0.35, 0.55, 1.7, 1.95))
    eyes(p, 0.68 * env(t, 0.3, 0.5, 1.8, 2.1))
    gape(p, 0.12 * env(t, 0.4, 0.6, 1.6, 1.9))
    return p


def bubble(t, T=2.6):
    p = Pose()
    dip = env(t, 0.0, 0.4, 1.6, 2.2)
    p.turn('head', 'x', 0.08 * dip)
    puff = track(t, [(0, 0), (0.5, 0), (0.62, 1), (0.9, 1.0), (1.2, 0)])
    p.scale['blowhole'] = (1 + 0.8 * puff, 1 + 0.8 * puff, 1 + 0.5 * puff)
    p.move('body', (0, 0, -0.35 * puff))
    # Then it looks up after the bubble (the tank lifts its gaze too).
    p.turn('head', 'x', -0.16 * env(t, 1.0, 1.4, 2.0, 2.5))
    eyes(p, blinking(t, 0.55))
    return p


def blink_clip(t, T=0.4):
    p = Pose()
    eyes(p, blinking(t, 0.05))
    return p


CLIPS = [('swim', swim, 1.0), ('glide', glide, 3.0), ('burst', burst, 0.5), ('hover', hover, 2.4),
         ('chatter', chatter, 2.6), ('nod', nod, 1.6), ('shake', shake, 1.6), ('spin', spin, 2.2),
         ('flip', flip, 2.8), ('wave', wave, 2.4), ('bubble', bubble, 2.6), ('blink', blink_clip, 0.4)]
LOOPS = ('swim', 'glide', 'burst', 'hover')


def main():
    scene = bpy.data.scenes.get('dolphin') or bpy.data.scenes.new('dolphin')
    with in_scene(scene):
        begin('dolphin')
        meshes = load_source('dolphin')
        role = {o['rigMaterials'][0]: o for o in meshes}
        pitch, phase = lattice(meshes)
        assert pitch == 2.0, (pitch, phase)
        eye_rects = side_eyes(role['EYES-White'], role['EYES-Black'])
        counts = segment(meshes, bone_of, pitch, phase, by_point=True)
        counts['blended vertices'] = soften(meshes)
        counts['catchlights'] = catchlights(role['EYES-White'], eye_rects)
        rig = build_armature('Dolphin', meshes, bone_table(eye_rects))
        keyed = {
            'body': ['rotation_quaternion', 'location'],
            'head': ['rotation_quaternion'], 'jaw': ['rotation_quaternion'],
            'tail1': ['rotation_quaternion'], 'tail2': ['rotation_quaternion'], 'flukes': ['rotation_quaternion'],
            'flipper.L': ['rotation_quaternion'], 'flipper.R': ['rotation_quaternion'],
            'eye.L': ['scale'], 'eye.R': ['scale'], 'blowhole': ['scale'],
        }
        clips = bake(rig, 'dolphin', CLIPS, apply_pose, LOOPS, keyed)
        out = export(rig, out_path('dolphin'), {})
        return {'faces_per_bone': counts, 'bones': len(rig.data.bones), 'clips': clips, 'out': out,
                'bytes': os.path.getsize(out)}


if __name__ == '__main__':
    result = main()
    print(result)
