"""
Rig and animate the starfish: breeds/source/starfish.glb in, breeds/rig/starfish.glb out.

    blender -b -P breeds/rig/starfish.py        (from packages/saver-metaquarium)

The model is drawn by rig/starfish-model.mjs, in our designer's style, and
this script treats it as it treats theirs: never edited, every face weighted
1.0 to one rigid part (common.py has the machinery). It lies in the XY plane
on z = 0, faces -Y, its left +X; voxel centres sit at (2i, 2j, 2k + 1).

    body    the disc (r ≤ 2.9 voxels) with the smile set in its top
    eye.L/R the eyes on top of the disc, pupils and all; they blink
    armN.1  each arm (N = 0..4, at 36° + 72°·N from the front toward the left)
    armN.2  in three rigid links, cut across the arm at 4.5 and 7.5 voxels
    armN.3  out. Hinges sit on the arm's underside, so curling up closes
            each joint's seam rather than opening it.

Clips (30 fps; the tank sets their times, never update(dt)):

    crawl   2 s loop. A ripple runs round the arms, tips lifting in turn, the
            two leading arms feeling ahead; the disc bobs. The tank sets its
            phase from the distance crawled (`mqStride` per cycle).
    idle    4 s loop. Breathing, the tips curling one after another, a blink.
    wave    3 s. The left side arm comes up from the shoulder and waves.
    stand   4.6 s. Up on its two front arms, face to you: a five-pointed star
            with arms waving and a little bounce, then back down flat.
    curl    3 s. Every arm curls up round the disc, a slow hug, and lets go.

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
    Pose, apply_pose, bake, begin, build_armature, env, export, in_scene, lattice, load_source, out_path, segment,
    track,
)

DISC_R = 2.9
CUTS = (4.5, 7.5)     # voxels out along an arm: link 1 | link 2 | link 3
ARM_R = 10.5
ANGLES = [math.radians(36 + 72 * n) for n in range(5)]
STRIDE = 24.0         # model units crawled per crawl cycle
TIP_FRONT = 2 * ARM_R * math.cos(math.radians(36))  # how far forward the front tips reach (units)


def direction(n):
    th = ANGLES[n]
    return Vector((math.sin(th), -math.cos(th), 0))


def lift_axis(n):
    """Turning an arm about this by +a lifts its tip: direction × up."""
    return direction(n).cross(Vector((0, 0, 1)))


def bone_of(x, y, z, mat):
    i, j, k = x / 2, y / 2, round((z - 1) / 2)
    if k == 3:
        return 'eye.L' if i > 0 else 'eye.R'
    r = math.hypot(i, j)
    if r <= DISC_R:
        return 'body'
    th = math.degrees(math.atan2(i, -j)) % 360
    n = round((th - 36) / 72) % 5
    along = r * math.cos(math.radians(th) - ANGLES[n])
    link = 1 if along <= CUTS[0] else 2 if along <= CUTS[1] else 3
    return f'arm{n}.{link}'


def bone_table():
    t = {
        'root': ((0, 0, -3), (0, 0, -1), None),
        'body': ((0, 0, 0), (0, 0, 6), 'root'),
        'eye.R': ((-3, 1, 6), (-3, 1, 8), 'body'),
        'eye.L': ((3, 1, 6), (3, 1, 8), 'body'),
    }
    stops = (DISC_R, *CUTS, ARM_R)
    for n in range(5):
        d = direction(n)
        for link in (1, 2, 3):
            h, tl = d * (2 * stops[link - 1]), d * (2 * stops[link])
            t[f'arm{n}.{link}'] = (tuple(h), tuple(tl), 'body' if link == 1 else f'arm{n}.{link - 1}')
    return t


def turnv(p, bone, axis, angle):
    p.rot[bone] = Quaternion(axis, angle) @ p.rot.get(bone, Quaternion())


def lift(p, n, a1=0.0, a2=0.0, a3=0.0):
    ax = lift_axis(n)
    for link, a in ((1, a1), (2, a2), (3, a3)):
        if a:
            turnv(p, f'arm{n}.{link}', ax, a)


def sway(p, n, link, a):
    """Swing an arm link about the disc's own up: sideways lying flat, in the
    star's plane when it stands."""
    p.turn(f'arm{n}.{link}', 'z', a)


def blink(p, shut):
    for side in 'RL':
        # Bone frame: y runs up the bone (world up), z is world -Y: squash front to back.
        p.scale[f'eye.{side}'] = (1 + 0.1 * shut, 1, 1 - 0.85 * shut)


def blinking(t, at):
    return track(t, [(at, 0), (at + 0.08, 1), (at + 0.14, 1), (at + 0.3, 0)]) if at <= t <= at + 0.3 else 0.0


def crawl(t, T=2.0):
    p = Pose()
    w = 2 * math.pi * t / T
    for n in range(5):
        ph = w - n * 2 * math.pi / 5
        lead = 1.0 if n in (0, 4) else 0.0
        lift(p, n, 0.04 * lead + 0.03 * math.sin(ph), 0.07 + 0.07 * math.sin(ph - 0.5) + 0.05 * lead,
             0.1 + 0.12 * math.sin(ph - 1.0) + 0.08 * lead)
        sway(p, n, 3, 0.06 * math.sin(ph - 1.4))
    p.move('body', (0, 0, 0.3 + 0.25 * math.sin(2 * w)))
    p.turn('body', 'x', 0.02 * math.sin(w))
    return p


def idle(t, T=4.0):
    p = Pose()
    w = 2 * math.pi * t / T
    for n in range(5):
        ph = w - n * 2 * math.pi / 5
        lift(p, n, 0.0, 0.04 + 0.04 * math.sin(ph), 0.08 + 0.1 * math.sin(ph - 0.7))
    p.move('body', (0, 0, 0.2 + 0.2 * math.sin(w)))
    blink(p, blinking(t, 2.6))
    return p


def wave(t, T=3.0):
    p = Pose()
    up = env(t, 0.0, 0.6, T - 0.7, T)
    hello = math.sin(2 * math.pi * 1.8 * (t - 0.6)) * env(t, 0.5, 0.8, T - 0.9, T - 0.6)
    # The left side arm, up from the shoulder (a front arm would cross the face
    # it is turned to show you), flapping hello at the elbow and the tip.
    lift(p, 1, 0.75 * up, 0.15 * up + 0.3 * hello, 0.1 * up + 0.35 * math.sin(2 * math.pi * 1.8 * (t - 0.6) - 0.7) * env(t, 0.5, 0.8, T - 0.9, T - 0.6))
    sway(p, 1, 1, 0.12 * hello)
    turnv(p, 'body', lift_axis(1), 0.07 * up)   # leans into it
    for n in (0, 2, 3, 4):
        lift(p, n, 0.0, 0.05 * up, 0.1 * up)
    blink(p, blinking(t, 2.1))
    return p


def stand(t, T=4.6):
    p = Pose()
    phi = (math.pi / 2) * track(t, [(0, 0), (0.25, 0), (1.25, 1), (3.45, 1), (4.35, 0), (T, 0)])
    up = math.sin(phi)
    # Tip up about the front tips: they stay planted, the face turns to the front.
    p.turn('body', 'x', phi)
    hold = env(t, 1.15, 1.45, 3.25, 3.55)
    beat = 2 * math.pi * 1.6 * (t - 1.3)
    bounce = 0.9 * (1 - math.cos(beat)) / 2 * hold
    p.move('body', (0, -TIP_FRONT * (1 - math.cos(phi)), TIP_FRONT * up + bounce))
    # The star: the side arms wave in its plane, the top arm tilts like a head.
    for n, s in ((1, 1), (4, -1)):
        sway(p, n, 1, s * 0.12 * hold)
        sway(p, n, 2, s * 0.25 * math.sin(beat) * hold)
        sway(p, n, 3, s * 0.35 * math.sin(beat - 0.6) * hold)
    for n in (2, 3):
        lift(p, n, 0.0, 0.04 * hold, 0.08 * hold)
    sway(p, 2, 3, 0.18 * math.sin(beat * 0.5) * hold)
    sway(p, 3, 3, 0.18 * math.sin(beat * 0.5) * hold)
    # The legs: straight while it stands, the tips curled to plant.
    for n in (0, 4):
        lift(p, n, 0.0, 0.0, -0.15 * up)
    blink(p, blinking(t, 2.3))
    return p


def curl(t, T=3.0):
    p = Pose()
    hug = env(t, 0.2, 1.1, 2.0, 2.85)
    for n in range(5):
        lag = 0.08 * n
        h = env(t, 0.2 + lag, 1.1 + lag, 1.9 + lag * 0.5, 2.85)
        lift(p, n, 0.12 * h, 0.55 * h, 0.85 * h)
    p.move('body', (0, 0, 1.4 * hug))
    blink(p, track(t, [(0, 0), (1.0, 0), (1.2, 0.85), (1.9, 0.85), (2.1, 0), (T, 0)]))
    return p


CLIPS = [('crawl', crawl, 2.0), ('idle', idle, 4.0), ('wave', wave, 3.0), ('stand', stand, 4.6), ('curl', curl, 3.0)]


def main():
    scene = bpy.data.scenes.get('starfish') or bpy.data.scenes.new('starfish')
    with in_scene(scene):
        begin('starfish')
        meshes = load_source('starfish')
        pitch, phase = lattice(meshes)
        assert (pitch, phase) == (2.0, (1.0, 1.0, 0.0)), (pitch, phase)
        counts = segment(meshes, bone_of, pitch, phase, by_point=True)
        rig = build_armature('Starfish', meshes, bone_table())
        keyed = {}
        for pb in rig.pose.bones:
            if pb.name == 'root':
                continue
            keyed[pb.name] = ['scale'] if pb.name.startswith('eye.') else ['rotation_quaternion']
            if pb.name == 'body':
                keyed[pb.name].append('location')
        clips = bake(rig, 'starfish', CLIPS, apply_pose, ('crawl', 'idle'), keyed)
        out = export(rig, out_path('starfish'), {'mqStride': STRIDE})
        return {'faces_per_bone': counts, 'bones': len(rig.data.bones), 'clips': clips, 'out': out,
                'bytes': os.path.getsize(out)}


if __name__ == '__main__':
    result = main()
    print(result)
