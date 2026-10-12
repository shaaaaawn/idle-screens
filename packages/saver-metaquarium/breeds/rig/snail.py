"""
Rig and animate the snail: breeds/source/snail.glb in, breeds/rig/snail.glb out. EXPERIMENTAL.

    blender -b -P breeds/rig/snail.py        (from packages/saver-metaquarium)

The model is drawn by rig/snail-model.mjs, in our designer's style, and this
script treats it as it treats theirs: never edited. It sits on z = 0, faces
-Y, its left +X; voxel centres sit at (2i, 2j, 2k + 1).

    shell     the disc on its back, rigid, its pivot at the bottom of the shell
    head      the head block and its smile
    neck      the sole and the body are ONE soft skin over neck, foot and
    foot      tail (and the head's back): every vertex's weights come from
    tail      how far along the body it lies, so the body stretches and
              shrinks as a snail's does and never cracks
    stalk.L/R the upper tentacles, each a column on the head's top; scaled
              down its own length, it pulls in (a snail rolls its eye stalks in)
    eye.L/R   the eyes on the stalks, each rebuilt as ONE white box (common.py
              clean_eyes) so a sliding pupil shows no seam; a blink squashes
              the eye to its middle
    pupil.L/R each pupil one quad on its eye's front face, with a catchlight
              laid on it (high on the viewer's left on both eyes); no clip
              moves them — src/snail.ts slides them to look about and at you
    feeler.L/R the lower tentacles, on the floor; they lift and tap

Every bone points up (+Z). Clips (30 fps; a tank would set their times):

    glide    2.4 s loop. A wave runs down the body front to back (the head
             reaches, the tail follows), the shell rocks, the stalks bob and
             the feelers tap the floor ahead. `mqStride` per cycle.
    idle     4 s loop. Breathing; each stalk looks about on its own; a blink.
    look     3.5 s. Up on its neck, stalks tall: one looks left, the other
             right, then both swing round to you (a little cross-eyed).
    retract  5 s. Startled: the stalks roll in, the head and tail draw under
             the shell and the shell settles on the floor; a beat; the head
             comes out, then one stalk, then the other, and it blinks.
    stretch  3.5 s. A long reach up, stalks splayed tall, eyes squeezed happy, and back.
    munch    3 s. Head down to the floor, nibbling.
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
    Pose, apply_pose, bake, begin, build_armature, clean_eyes, env, export, in_scene, knots, lattice, load_source,
    out_path, segment, track,
)

STRIDE = 6.0          # model units glided per glide cycle
SOFT = '_soft'
# The body's knots along y (model units): the head rigid up to its back face
# (y -9), the neck over the next stretch, the foot under the shell, the tail.
BODY_KNOTS = [(-9.0, 'head'), (-6.0, 'neck'), (-2.0, 'neck'), (2.0, 'foot'), (6.0, 'foot'), (11.0, 'tail')]


def bone_of(x, y, z, mat):
    i, j, k = round(x / 2), round(y / 2), round((z - 1) / 2)
    side = 'L' if i > 0 else 'R'
    if mat in ('PrimaryColor', 'SecondaryColor'):
        return 'shell'
    if k >= 7:
        return f'pupil.{side}' if mat == 'EYES-Black' else f'eye.{side}'
    if k >= 4:
        return f'stalk.{side}'
    if j <= -9:
        return f'feeler.{side}'
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


def bone_table():
    return {
        'root': ((0, 0, -3), (0, 0, -1), None),
        'foot': ((0, 3, 0), (0, 3, 2), 'root'),
        'tail': ((0, 9, 0), (0, 9, 2), 'foot'),
        'neck': ((0, -3, 0), (0, -3, 2), 'foot'),
        'head': ((0, -9, 0), (0, -9, 2), 'neck'),
        'shell': ((0, 3, 2), (0, 3, 6), 'foot'),
        'stalk.L': ((4, -14, 8), (4, -14, 14), 'head'),
        'stalk.R': ((-4, -14, 8), (-4, -14, 14), 'head'),
        'eye.L': ((4, -15, 17), (4, -15, 19), 'stalk.L'),
        'eye.R': ((-4, -15, 17), (-4, -15, 19), 'stalk.R'),
        # On the face, at the pupil's centre at rest (inner and low).
        'pupil.L': ((3, -17, 16), (3, -17, 18), 'eye.L'),
        'pupil.R': ((-3, -17, 16), (-3, -17, 18), 'eye.R'),
        'feeler.L': ((4, -17, 0), (4, -17, 2), 'head'),
        'feeler.R': ((-4, -17, 0), (-4, -17, 2), 'head'),
    }


SIDES = (('L', 1), ('R', -1))


def blink(p, shut):
    for side, _ in SIDES:
        # Bone frame: y runs up the bone (world up): squash top to bottom, to the eye's middle.
        p.scale[f'eye.{side}'] = (1 + 0.1 * shut, 1 - 0.85 * shut, 1 + 0.1 * shut)


def blinking(t, at):
    return track(t, [(at, 0), (at + 0.08, 1), (at + 0.14, 1), (at + 0.3, 0)]) if at <= t <= at + 0.3 else 0.0


def stalk(p, side, lean=0.0, splay=0.0, yaw=0.0, length=1.0):
    """A stalk: lean forward (+), splay outward (+), yaw (turn about its own
    up, + toward the snail's left), and its length (1 at rest)."""
    s = 1 if side == 'L' else -1
    b = f'stalk.{side}'
    if yaw:
        p.turn(b, 'z', yaw)
    if lean:
        p.turn(b, 'x', lean)
    if splay:
        p.turn(b, 'y', s * splay)
    if length != 1.0:
        thin = 0.55 + 0.45 * min(1.0, length)
        p.scale[b] = (thin, length, thin)


def feeler(p, side, lift):
    """Lift a feeler's tip off the floor (+)."""
    p.turn(f'feeler.{side}', 'x', -lift)


def glide(t, T=2.4):
    p = Pose()
    w = 2 * math.pi * t / T
    p.move('neck', (0, -0.7 * math.sin(w), 0))
    p.move('tail', (0, -0.7 * math.sin(w - 1.4), 0))
    p.move('shell', (0, -0.25 * math.sin(w - 0.7), 0.15 * (1 - math.cos(2 * w)) / 2))
    p.turn('shell', 'y', 0.025 * math.sin(w))
    p.turn('shell', 'x', 0.03 * math.sin(w - 0.6))
    p.turn('head', 'x', 0.04 * math.sin(w + 0.5))
    for side, s in SIDES:
        ph = w + (0 if s > 0 else math.pi)
        stalk(p, side, lean=0.12 + 0.07 * math.sin(ph), splay=0.12 + 0.04 * math.sin(2 * w))
        feeler(p, side, 0.18 * max(0.0, math.sin(ph)))
    return p


def idle(t, T=4.0):
    p = Pose()
    w = 2 * math.pi * t / T
    p.move('shell', (0, 0, 0.12 * (1 - math.cos(w)) / 2))
    p.turn('head', 'x', -0.03 * math.sin(w))
    stalk(p, 'L', lean=0.05 * math.sin(2 * w), splay=0.1, yaw=0.3 * math.sin(w))
    stalk(p, 'R', lean=0.05 * math.sin(2 * w + 1), splay=0.1, yaw=0.3 * math.sin(w + 1.6))
    feeler(p, 'L', 0.08 * max(0.0, math.sin(2 * w)))
    feeler(p, 'R', 0.08 * max(0.0, math.sin(2 * w + 2)))
    blink(p, blinking(t, 2.6))
    return p


def look(t, T=3.5):
    p = Pose()
    up = env(t, 0.0, 0.5, T - 0.6, T)
    p.turn('neck', 'x', -0.12 * up)
    p.turn('head', 'x', -0.1 * up)
    # One looks left, the other right, then both round to the front, converging.
    apart = env(t, 0.3, 0.8, 1.6, 2.1)
    together = env(t, 1.8, 2.3, T - 0.6, T)
    stalk(p, 'L', splay=0.1 + 0.35 * apart - 0.12 * together, yaw=0.6 * apart - 0.25 * together, length=1 + 0.3 * up)
    stalk(p, 'R', splay=0.1 + 0.35 * apart - 0.12 * together, yaw=-0.6 * apart + 0.25 * together, length=1 + 0.3 * up)
    blink(p, blinking(t, 2.0))
    return p


def retract(t, T=5.0):
    p = Pose()
    # In: the stalks first (fast), then the head and tail.
    pull = track(t, [(0, 0), (0.25, 1), (3.6, 1), (4.3, 0), (T, 0)])
    stalk_in = {
        'L': track(t, [(0, 0), (0.18, 1), (3.5, 1), (4.1, 0), (T, 0)]),
        'R': track(t, [(0, 0), (0.22, 1), (3.9, 1), (4.5, 0), (T, 0)]),
    }
    body = track(t, [(0, 0), (0.15, 0), (0.75, 1), (2.7, 1), (3.5, 0), (T, 0)])
    for side, _ in SIDES:
        stalk(p, side, length=1 - 0.9 * stalk_in[side], lean=-0.2 * stalk_in[side])
    p.move('neck', (0, 3.5 * body, -0.6 * body))
    p.move('head', (0, 4.5 * body, -0.5 * body))
    p.scale['head'] = (1 - 0.35 * body, 1 - 0.35 * body, 1 - 0.35 * body)
    p.move('tail', (0, -5.0 * body, 0))
    p.scale['tail'] = (1 - 0.3 * body, 1 - 0.3 * body, 1 - 0.3 * body)
    p.move('shell', (0, 0.8 * body, -1.6 * body))
    p.turn('shell', 'x', 0.08 * body)
    # A shiver as it settles.
    p.turn('shell', 'y', 0.04 * math.sin(2 * math.pi * 6 * t) * env(t, 0.5, 0.6, 0.9, 1.2))
    for side, _ in SIDES:
        feeler(p, side, 0.3 * pull * (1 - body))
    blink(p, blinking(t, 4.6))
    return p


def stretch(t, T=3.5):
    p = Pose()
    up = env(t, 0.2, 1.3, 2.3, T)
    # Eyes squeezed shut with the effort of it, happily, at the top.
    blink(p, 0.6 * env(t, 1.0, 1.4, 2.1, 2.5))
    p.turn('neck', 'x', -0.2 * up)
    p.turn('head', 'x', -0.15 * up)
    p.move('neck', (0, -0.8 * up, 0))
    p.move('tail', (0, 0.6 * up, 0))
    for side, _ in SIDES:
        stalk(p, side, splay=0.1 + 0.3 * up, lean=0.2 * up, length=1 + 0.45 * up)
        feeler(p, side, 0.3 * up)
    p.turn('shell', 'x', 0.06 * up)
    return p


def munch(t, T=3.0):
    p = Pose()
    down = env(t, 0.0, 0.5, T - 0.5, T)
    nib = math.sin(2 * math.pi * 3 * t) * env(t, 0.5, 0.7, T - 0.7, T - 0.5)
    p.turn('neck', 'x', 0.12 * down)
    p.turn('head', 'x', 0.14 * down + 0.05 * nib)
    p.move('head', (0, -0.3 * nib, 0))
    for side, s in SIDES:
        stalk(p, side, lean=-0.1 * down, splay=0.15 * down)
        feeler(p, side, 0.12 * down * max(0.0, math.sin(2 * math.pi * 1.5 * t + (0 if s > 0 else math.pi))))
    p.turn('shell', 'x', -0.02 * down)
    return p


CATCH = 1.2      # the catchlight's side (model units)
CATCH_IN = 0.45  # in from the pupil's top and outer corner
CATCH_PROUD = 0.12  # in front of the pupil, so it draws over it


def catchlights(white, rects):
    """A catchlight on each pupil: a small white quad on the eye's white
    mesh, proud of the pupil, high on the viewer's left (the snail's right,
    -x) on both eyes — one light — and weighted wholly to that pupil's bone,
    so it slides with the pupil."""
    groups = {}
    for s, (box, (x0, x1, z0, z1)) in rects.items():
        y = box[0][1] - CATCH_PROUD
        a, b = x0 + CATCH_IN, x0 + CATCH_IN + CATCH
        c, d = z1 - CATCH_IN - CATCH, z1 - CATCH_IN
        bm = bmesh.new()
        bm.from_mesh(white.data)
        before = len(bm.verts)
        f = bm.faces.new([bm.verts.new(v) for v in (Vector((a, y, c)), Vector((b, y, c)), Vector((b, y, d)), Vector((a, y, d)))])
        f.normal_update()
        if f.normal.y > 0:
            f.normal_flip()
        bm.to_mesh(white.data)
        bm.free()
        side = 'L' if s > 0 else 'R'
        groups[side] = list(range(before, before + 4))
    for side, idx in groups.items():
        g = white.vertex_groups.get(f'pupil.{side}') or white.vertex_groups.new(name=f'pupil.{side}')
        g.add(idx, 1.0, 'REPLACE')
    return len(groups)


def blink_clip(t, T=0.4):
    p = Pose()
    blink(p, blinking(t, 0.05))
    return p


CLIPS = [('glide', glide, 2.4), ('idle', idle, 4.0), ('look', look, 3.5), ('retract', retract, 5.0),
         ('stretch', stretch, 3.5), ('munch', munch, 3.0), ('blink', blink_clip, 0.4)]
LOOPS = ('glide', 'idle')


def main():
    scene = bpy.data.scenes.get('snail') or bpy.data.scenes.new('snail')
    with in_scene(scene):
        begin('snail')
        meshes = load_source('snail')
        role = {o['rigMaterials'][0]: o for o in meshes}
        # The eyes: one white box and one pupil quad each (not the smile, low on the head).
        eyes = clean_eyes(role['EYES-White'], role['EYES-Black'], lambda c: c.z > 12)
        assert sorted(eyes) == [-1, 1], eyes
        pitch, phase = lattice(meshes)
        assert (pitch, phase) == (2.0, (1.0, 1.0, 0.0)), (pitch, phase)
        counts = segment(meshes, bone_of, pitch, phase, by_point=True)
        counts['blended vertices'] = soften(meshes)
        counts['catchlights'] = catchlights(role['EYES-White'], eyes)
        rig = build_armature('Snail', meshes, bone_table())
        keyed = {
            'neck': ['rotation_quaternion', 'location'],
            'head': ['rotation_quaternion', 'location', 'scale'],
            'tail': ['location', 'scale'],
            'shell': ['rotation_quaternion', 'location'],
            'stalk.L': ['rotation_quaternion', 'scale'], 'stalk.R': ['rotation_quaternion', 'scale'],
            'eye.L': ['scale'], 'eye.R': ['scale'],
            'feeler.L': ['rotation_quaternion'], 'feeler.R': ['rotation_quaternion'],
        }
        clips = bake(rig, 'snail', CLIPS, apply_pose, LOOPS, keyed)
        out = export(rig, out_path('snail'), {'mqStride': STRIDE})
        return {'faces_per_bone': counts, 'bones': len(rig.data.bones), 'clips': clips, 'out': out,
                'bytes': os.path.getsize(out)}


if __name__ == '__main__':
    result = main()
    print(result)
