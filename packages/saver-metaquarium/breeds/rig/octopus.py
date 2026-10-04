"""
Rig and animate the octopus: breeds/source/octopus.glb in, breeds/rig/octopus.glb out.

    blender -b -P breeds/rig/octopus.py        (from packages/saver-metaquarium)

The model is ours (rig/octopus-model.mjs, the designer's style): a round
mantle bulb leaning back, two big eyes low on its front with horizontal bar
pupils, brow ridges over them, a siphon on its left side, and eight arms that
sweep round as they reach, their tips curled up. Blender axes: it sits on
z = 0 and faces -Y, its left is +X; voxel (i, j, k) is centred on
(2i, 2j, 2k + 1).

    body      the crown the arms grow from (the floor layers, r <= 3): the
              whole animal turns, lifts and pitches on it
    head      the lower bulb, the eyes' and brows' and siphon's parent
    mantle    the upper bulb (k >= 7): it breathes, squeezes for a jet
    siphon    the jet's nozzle, aimed by the clips
    armN.1-4  eight arms (N 0..7 from front-left round to front-right, the
              way the model numbers them), four links each, every link hinged
              UNDERNEATH (z = 0) so an up-curl closes its seams; the vertices
              about each joint blend between the two links, by distance along
              the arm, so a curl bends one arm instead of a string of blocks
    eye.L/R, pupil.L/R, brow.L/R
              bones no clip moves: src/octopus.ts aims the eyes, keeps each
              bar of a pupil LEVEL with the world (an octopus's statocysts
              counter-roll its eyes — Budelmann; Hanke 2019), rounds it in the
              dark or when excited, closes the lids, raises the eyes on stalks
              and lifts each brow. Each eye is one white box and its pupil
              one quad (common.clean_eyes), so the pupil slides and turns
              without a seam.

Clips (30 fps; the tank sets their times, never update(dt)):

    idle      3.4 s loop. Breathing — an octopus at rest draws ~18 breaths a
              minute (Valverde 2004) — the siphon puffing with it, the arm tips
              each curling on a phase of its own.
    crawl     1.6 s loop. Arms reaching and pulling in a ripple round the
              crown, the bulb swaying (no fixed gait: Levy 2015).
    jet       0.9 s loop. Mantle-first, arms trailing together: the bulb
              swells, then squeezes — the thrust — as the arms close.
    drift     2.0 s loop. Parachuting down, the arms spread and the web wide.
    tiptoe    1.2 s loop. Walking on two arms (Abdopus, Huffard 2005): the two
              rear arms roll under like treads, the other six coiled up round
              the head.
    wave      2.0 s. A front arm up, waving.
    beckon    2.2 s. A front arm curling: come here.
    reach     2.4 s. A front arm out toward something, a bend travelling down
              it to the tip (Gutfreund 1996), a curl at the end, back.
    peek      3.0 s. Squashed flat to the floor, then up a little: the eyes
              do the peeking (octopus.ts raises them).
    ink       1.2 s. The bulb swells and squeezes hard, the arms flinch.
    pounce    2.2 s. Up, the arms spread wide over — the web — and down onto it.
    sleep     3.4 s loop. Curled up small, the arms wrapped round, breathing slow.

The one-shots start and end on the rest pose.
"""
import math
import os
import sys

import bpy
from mathutils import Quaternion, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (  # noqa: E402
    Pose, apply_pose, bake, begin, build_armature, clean_eyes, ease, env, export, in_scene, lattice, load_source,
    out_path, segment, track,
)

# The model's arms (octopus-model.mjs): keep in step with it.
ARM_ROOT, ARM_R, CROWN_R, CURL = 2.0, 12.5, 3.0, 0.7
ARM_ANGLES = [math.radians(22.5 + 45 * n) for n in range(8)]
# Where each arm's links meet, in voxels along it.
CUTS = (ARM_ROOT, 4.5, 7.0, 9.75, ARM_R)
BLEND = 0.6


def arm_point(n, along):
    """Arm n's centreline at `along` voxels out (Blender units)."""
    u = max(0.0, (along - ARM_ROOT) / (ARM_R - ARM_ROOT))
    th = ARM_ANGLES[n] + CURL * u * u   # every arm the same way: a pinwheel (crossing arms otherwise)
    return Vector((2 * math.sin(th) * along, -2 * math.cos(th) * along, 0.0))


def nearest_arm(x, y, arms=range(8)):
    """(arm, voxels along it) of the centreline point nearest (x, y), among `arms`."""
    best = None
    for n in arms:
        a = ARM_ROOT
        while a <= ARM_R + 1e-9:
            p = arm_point(n, a)
            d = (p.x - x) ** 2 + (p.y - y) ** 2
            if best is None or d < best[0]:
                best = (d, n, a)
            a += 0.05
    return best[1], best[2]


def link_of(along):
    for i in range(4):
        if along <= CUTS[i + 1]:
            return i + 1
    return 4


def bone_of(x, y, z, mat):
    i, j, k = x / 2, y / 2, round((z - 1) / 2)
    if mat == 'EYES-White':
        return 'eye.L' if x > 0 else 'eye.R'
    if mat == 'EYES-Black':
        return 'pupil.L' if x > 0 else 'pupil.R'
    if mat == 'SecondaryColor' and j < -4.5 and k == 6:
        return 'brow.L' if x > 0 else 'brow.R'
    if mat == 'SecondaryColor' and i >= 4.5 and k == 3 and abs(j - 1) < 0.5:
        return 'siphon'
    if k >= 2:
        return 'mantle' if k >= 7 else 'head'
    if math.hypot(i, j) <= CROWN_R:
        return 'body'
    n, along = nearest_arm(x, y)
    return f'arm{n}.{link_of(along)}'


def soften(meshes):
    """Blend each arm's joints by distance along the arm, and the head into the
    mantle at their seam: a curl bends ONE arm, the mantle breathes on one head."""
    blended = 0
    for o in meshes:
        if o['rigMaterials'][0] == 'GLOW-Rings':
            continue  # each ring rides its one bone, rigid: its light is that bone's (the intake's splitByBone)
        groups = {g.name: g for g in o.vertex_groups}
        idx = {g.index: g.name for g in o.vertex_groups}

        def setw(v, weights):
            for g in list(v.groups):
                groups[idx[g.group]].remove([v.index])
            for name, w in weights.items():
                if name not in groups:
                    groups[name] = o.vertex_groups.new(name=name)
                    idx[groups[name].index] = name
                groups[name].add([v.index], w, 'REPLACE')

        for v in o.data.vertices:
            names = [idx[g.group] for g in v.groups]
            if not names:
                continue
            b = names[0]
            if b.startswith('arm') or b == 'body':
                if v.co.z > 4.01:
                    continue
                if b == 'body' and math.hypot(v.co.x, v.co.y) / 2 < ARM_ROOT + 0.4:
                    continue
                # An arm's vertex measures along ITS arm: the nearest centreline
                # can be a neighbour's, and the vertex would follow that arm.
                own = [int(b[3])] if b.startswith('arm') else range(8)
                n, along = nearest_arm(v.co.x, v.co.y, own)
                for c, (lo, hi) in zip(CUTS[:4], [('body', f'arm{n}.1'), (f'arm{n}.1', f'arm{n}.2'),
                                                  (f'arm{n}.2', f'arm{n}.3'), (f'arm{n}.3', f'arm{n}.4')]):
                    if abs(along - c) < BLEND:
                        s = ease((along - (c - BLEND)) / (2 * BLEND))
                        setw(v, {lo: 1 - s, hi: s})
                        blended += 1
                        break
            elif b in ('head', 'mantle') and abs(v.co.z - 14) < 1e-3:
                setw(v, {'head': 0.5, 'mantle': 0.5})
                blended += 1
    return blended


def bone_table():
    t = {
        'root': ((0, 0, -4), (0, 0, -2), None),
        'body': ((0, 1, 6), (0, 1, 10), 'root'),
        'head': ((0, 0, 4), (0, 0, 8), 'body'),
        'mantle': ((0, 2, 14), (0, 2, 18), 'head'),
        'siphon': ((9, 2, 7), (11, 2, 7), 'head'),
        # An eye turns about its middle, its pupil on its front face; the brow
        # hinges on its back edge, so a raise lifts its front.
        'eye.L': ((5, -10, 9), (5, -8, 9), 'head'),
        'eye.R': ((-5, -10, 9), (-5, -8, 9), 'head'),
        'pupil.L': ((5, -11, 9), (5, -9, 9), 'eye.L'),
        'pupil.R': ((-5, -11, 9), (-5, -9, 9), 'eye.R'),
        'brow.L': ((5, -9, 12), (5, -7, 12), 'head'),
        'brow.R': ((-5, -9, 12), (-5, -7, 12), 'head'),
    }
    for n in range(8):
        for link in range(1, 5):
            h, tl = arm_point(n, CUTS[link - 1]), arm_point(n, CUTS[link])
            t[f'arm{n}.{link}'] = (tuple(h), tuple(tl), 'body' if link == 1 else f'arm{n}.{link - 1}')
    return t


# ---------------------------------------------------------------------------
# Posing. An arm link's "lift" axis is horizontal, square to the link: a
# positive turn curls it UP (its tip rises). Its "sweep" is about world z.
# ---------------------------------------------------------------------------

def link_dir(n, link):
    d = arm_point(n, CUTS[link]) - arm_point(n, CUTS[link - 1])
    d.z = 0
    return d.normalized()


def turnv(p, bone, axis, angle):
    p.rot[bone] = Quaternion(axis, angle) @ p.rot.get(bone, Quaternion())


def curl(p, n, *angles):
    """Curl arm n's links up (positive) or down (negative), base to tip."""
    for link, a in enumerate(angles, start=1):
        if a:
            d = link_dir(n, link)
            turnv(p, f'arm{n}.{link}', d.cross(Vector((0, 0, 1))), a)


def sweep(p, n, link, a):
    """Swing arm n's link round the crown (about world up)."""
    if a:
        p.turn(f'arm{n}.{link}', 'z', a)


def breathe(p, t, T, depth=0.04):
    """A breath: the bulb swells, the siphon puffs."""
    b = math.sin(2 * math.pi * t / T)
    p.scale['mantle'] = (1 + depth * b, 1 + depth * b, 1 + 0.6 * depth * b)
    p.scale['siphon'] = (1 + 2 * depth * max(0.0, -b), 1, 1 + 2 * depth * max(0.0, -b))


FRONT_L, FRONT_R = 0, 7   # the two front arms (22.5° either side of ahead)
REAR_L, REAR_R = 3, 4     # the two rear arms


def idle(t, T=3.4):
    p = Pose()
    breathe(p, t, T)
    w = 2 * math.pi * t / T
    for n in range(8):
        ph = n * 0.79
        curl(p, n, 0.03 * math.sin(w + ph), 0.06 * math.sin(w + ph - 0.5), 0.14 * math.sin(w + ph - 1.0),
             0.25 + 0.2 * math.sin(w + ph - 1.5))
        sweep(p, n, 2, 0.05 * math.sin(w + ph + 1))
    p.turn('head', 'y', 0.02 * math.sin(w))
    return p


def crawl(t, T=1.6):
    p = Pose()
    w = 2 * math.pi * t / T
    breathe(p, t, T, 0.03)
    for n in range(8):
        # A ripple round the crown: each arm reaches (curls its tip up, sweeps
        # forward) then pulls (lays flat, sweeps back), a step behind the next.
        ph = w - n * (2 * math.pi / 8)
        reach = 0.5 + 0.5 * math.sin(ph)
        forward = -1 if math.sin(ARM_ANGLES[n]) > 0 else 1   # toward the front, for this side
        curl(p, n, 0.12 * reach, 0.18 * reach - 0.05, 0.25 * reach, 0.35 * reach + 0.1)
        sweep(p, n, 1, forward * 0.12 * math.cos(ph))
    p.move('body', (0, 0, 0.4 + 0.3 * math.sin(2 * w)))
    p.turn('head', 'y', 0.05 * math.sin(w))
    p.turn('head', 'x', 0.04 * math.sin(2 * w))
    return p


def jet(t, T=0.9):
    """Mantle-first: the whole animal pitched over so the bulb leads (+Y) and
    the arms trail (-Y) — the driver turns its back to the way it goes."""
    p = Pose()
    u = t / T
    squeeze = track(u, [(0, 0), (0.25, 1), (0.45, 1), (1.0, 0)])   # the thrust, then the slow refill
    p.turn('body', 'x', -1.35)
    p.move('body', (0, 0, 6))
    p.scale['mantle'] = (1 - 0.14 * squeeze + 0.06 * (1 - squeeze), 1 - 0.14 * squeeze, 1 + 0.08 * squeeze)
    p.turn('siphon', 'z', 0.6)
    p.scale['siphon'] = (1 + 0.4 * squeeze, 1, 1 + 0.4 * squeeze)
    for n in range(8):
        close = 1.25 + 0.25 * squeeze
        curl(p, n, -close, 0.15 - 0.1 * squeeze, 0.1, 0.15 + 0.25 * (1 - squeeze))
    return p


def drift(t, T=2.0):
    p = Pose()
    w = 2 * math.pi * t / T
    breathe(p, t, T, 0.05)
    for n in range(8):
        ph = w + n * 0.4
        curl(p, n, 0.35 + 0.08 * math.sin(ph), -0.12 + 0.06 * math.sin(ph - 0.6), -0.1 + 0.08 * math.sin(ph - 1.2),
             0.25 + 0.15 * math.sin(ph - 1.8))
    p.move('body', (0, 0, 2.0 + 0.6 * math.sin(w)))
    return p


def tiptoe(t, T=1.2):
    """Walking on two arms. The rear pair roll under like treads (half a
    stride apart); the other six coil up round the head; it rides high."""
    p = Pose()
    w = 2 * math.pi * t / T
    p.move('body', (0, 0, 7 + 0.6 * abs(math.sin(w))))
    p.turn('body', 'y', 0.06 * math.sin(w))
    for n in range(8):
        if n in (REAR_L, REAR_R):
            ph = w + (math.pi if n == REAR_R else 0)
            # Down to the floor and rolling: the arm bends down at its root
            # and its outer half curls under, the curl running out as it rolls.
            curl(p, n, -0.9 + 0.15 * math.sin(ph), -0.35 + 0.25 * math.sin(ph - 0.8), -0.4 + 0.35 * math.sin(ph - 1.6),
                 -0.5 + 0.4 * math.sin(ph - 2.4))
        else:
            curl(p, n, 0.55, 1.0, 1.1, 1.2)
    return p


def wave(t, T=2.0):
    p = Pose()
    up = env(t, 0.0, 0.35, 1.6, T)
    curl(p, FRONT_L, 0.6 * up, 0.5 * up, 0.25 * up, (0.4 + 0.4 * math.sin(2 * math.pi * 2.5 * t)) * up)
    sweep(p, FRONT_L, 2, 0.45 * math.sin(2 * math.pi * 2.5 * t) * up)
    sweep(p, FRONT_L, 3, 0.3 * math.sin(2 * math.pi * 2.5 * t - 0.8) * up)
    p.turn('head', 'y', -0.08 * up)
    breathe(p, t, 1.0, 0.03)
    return p


def beckon(t, T=2.2):
    p = Pose()
    up = env(t, 0.0, 0.35, 1.8, T)
    come = sum(env(t, a, a + 0.15, a + 0.25, a + 0.45) for a in (0.45, 0.9, 1.35))
    curl(p, FRONT_R, 0.5 * up, 0.25 * up, 0.15 * up + 0.7 * come, 0.3 * up + 1.1 * come)
    p.turn('head', 'y', 0.06 * up)
    p.turn('head', 'x', -0.05 * up)
    return p


def reach(t, T=2.4):
    """A bend travels from the base of the arm to its tip (Gutfreund 1996)."""
    p = Pose()
    out = env(t, 0.0, 0.5, 1.7, T)
    def bend(at):  # a pulse of bend passing link `at`
        return env(t, 0.15 + 0.18 * at, 0.3 + 0.18 * at, 0.45 + 0.18 * at, 0.65 + 0.18 * at)
    curl(p, FRONT_L, 0.35 * out + 0.25 * bend(0), 0.1 * out + 0.3 * bend(1), -0.05 * out + 0.3 * bend(2),
         0.7 * env(t, 0.9, 1.1, 1.5, 1.8) + 0.3 * bend(3))
    sweep(p, FRONT_L, 1, -0.3 * out)   # in toward the front
    p.move('body', (0, -0.8 * out, 0.3 * out))
    p.turn('head', 'x', 0.06 * out)
    return p


def peek(t, T=3.0):
    p = Pose()
    flat = env(t, 0.0, 0.4, 2.3, T)
    p.move('head', (0, 0, -2.5 * flat))
    p.scale['mantle'] = (1 + 0.15 * flat, 1 + 0.15 * flat, 1 - 0.4 * flat)
    for n in range(8):
        curl(p, n, -0.05 * flat, 0.0, 0.1 * flat, 0.4 * flat)
    return p


def ink(t, T=1.2):
    p = Pose()
    swell = env(t, 0.0, 0.35, 0.4, 0.5)
    squeeze = env(t, 0.4, 0.5, 0.7, 1.1)
    p.scale['mantle'] = (1 + 0.12 * swell - 0.15 * squeeze, 1 + 0.12 * swell - 0.15 * squeeze, 1 + 0.06 * swell)
    p.turn('siphon', 'z', 0.7 * squeeze)
    p.scale['siphon'] = (1 + 0.8 * squeeze, 1, 1 + 0.8 * squeeze)
    flinch = env(t, 0.38, 0.48, 0.6, 1.0)
    for n in range(8):
        curl(p, n, 0.3 * flinch, -0.2 * flinch, -0.2 * flinch, 0.3 * flinch)
    return p


def pounce(t, T=2.2):
    p = Pose()
    up = track(t, [(0, 0), (0.15, 0), (0.6, 1), (0.95, 1), (1.25, 0), (T, 0)])
    over = env(t, 0.3, 0.6, 1.2, 1.5)
    hold = env(t, 1.1, 1.3, 1.8, T)
    p.move('body', (0, -1.5 * up, 5 * up))
    for n in range(8):
        curl(p, n, 0.5 * over - 0.1 * hold, -0.2 * over - 0.15 * hold, -0.45 * over - 0.3 * hold, -0.4 * over - 0.4 * hold)
    p.scale['mantle'] = (1, 1, 1 + 0.1 * over)
    return p


def sleep(t, T=3.4):
    p = Pose()
    breathe(p, t, T, 0.025)
    p.move('head', (0, 0, -1.2))
    # Curled low, still breathing: the curl's scale times the breath's.
    p.scale['mantle'] = tuple(a * b for a, b in zip((1.04, 1.04, 0.86), p.scale['mantle']))
    w = 2 * math.pi * t / T
    for n in range(8):
        twitch = 0.04 * math.sin(w * 2 + n)
        curl(p, n, 0.35, 0.85, 1.05, 1.15 + twitch)
    return p


CLIPS = [('idle', idle, 3.4), ('crawl', crawl, 1.6), ('jet', jet, 0.9), ('drift', drift, 2.0), ('tiptoe', tiptoe, 1.2),
         ('wave', wave, 2.0), ('beckon', beckon, 2.2), ('reach', reach, 2.4), ('peek', peek, 3.0), ('ink', ink, 1.2),
         ('pounce', pounce, 2.2), ('sleep', sleep, 3.4)]
LOOPS = ('idle', 'crawl', 'jet', 'drift', 'tiptoe', 'sleep')


def main():
    scene = bpy.data.scenes.get('octopus') or bpy.data.scenes.new('octopus')
    with in_scene(scene):
        begin('octopus')
        meshes = load_source('octopus')
        role = {o['rigMaterials'][0]: o for o in meshes}
        eyes = clean_eyes(role['EYES-White'], role['EYES-Black'], lambda c: True)
        pitch, phase = lattice(meshes)
        counts = segment(meshes, bone_of, pitch, phase, by_point=True)
        counts['blended vertices'] = soften(meshes)
        rig = build_armature('Octopus', meshes, bone_table())
        keyed = {'body': ['rotation_quaternion', 'location'], 'head': ['rotation_quaternion', 'location'],
                 'mantle': ['scale'], 'siphon': ['rotation_quaternion', 'scale']}
        for n in range(8):
            for link in range(1, 5):
                keyed[f'arm{n}.{link}'] = ['rotation_quaternion']
        clips = bake(rig, 'octopus', CLIPS, apply_pose, LOOPS, keyed)
        out = export(rig, out_path('octopus'), {})
        return {'faces_per_bone': counts, 'bones': len(rig.data.bones), 'clips': clips, 'out': out,
                'bytes': os.path.getsize(out), 'lattice': (pitch, phase), 'eyes': eyes}


if __name__ == '__main__':
    result = main()
    print(result)
