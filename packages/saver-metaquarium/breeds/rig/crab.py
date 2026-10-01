"""
Rig and animate the crab: breeds/source/crab.glb in, breeds/rig/crab.glb out.

    blender -b -P breeds/rig/crab.py            (from packages/saver-metaquarium)

or run it in a live Blender (build.py runs every rig into one .blend). The
shared machinery — load, lattice, segment, armature, bake, export — is
common.py; this file is the crab's anatomy and its clips.

The model is never edited. Every vertex keeps its position, material and
colour; the rig only says which part each voxel face belongs to. The bind pose
IS the delivered crab, and the intake proves it (breeds.test.ts).

Parts are rigid: a face is weighted 1.0 to exactly one bone, decided by the
voxel it skins. That is how a voxel creature should move (a stop-motion
puppet, not rubber), and it lets the intake greedy-mesh each part on its own.

The lattice: 2-unit voxels; x and z planes on odd coordinates, y planes on
even ones (measured, not assumed). Blender axes (glTF import, Z up): the crab
faces -Y; its left is +X. Voxel index = (floor((x-1)/2), floor(y/2), floor((z-1)/2)).

    body    ix -1..10, iy 5..20, iz -8..-4 (belly and mouth ride along)
    legs    four pairs, iy {7,8} {11,12} {15,16} {19,20}; each an arch from
            the hip (x -1, z -13) up to the knee (-7, -9) and down to the foot
            (-12, -17), mirrored about x = 11
    claws   ix -5..-1 and 10..14, iy -1..6, iz -4..1: a lower jaw and palm,
            and an upper jaw (iz 0..1, plus the teeth hanging at iz -1) that
            hinges at the back (y 14, z 1)
    eyes    stalks at ix 1..3 and 6..8, iz -3..-1

Clips (30 fps; the tank samples them by time, never by update(dt)):

    walk    1 s loop. Sideways toward +X, alternating tetrapod gait (R1 L2 R3 L4
            against L1 R2 L3 R4), duty 0.55. Feet are placed by analytic
            two-bone IK, so a planted foot is still in the ground frame: the
            tank advances the clip by distance / (STRIDE / DUTY) and the feet
            never slide.
            Played backwards it walks toward -X.
    idle    4 s loop. Breathing, eyes that look about on their own, a shuffle.
    pinch   2 s. Claws up, jaws snap open and shut, out of step.
    forage  3 s. Each claw in turn picks at the floor and feeds the mouth.
    wave    3 s. The fiddler crab's wave: the left claw up and waving.
    cheer   2.5 s. Both claws up and open, a little bounce: delight.

The one-shots start and end on the rest pose, so the tank can fade them in
and out of idle without a pop.
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (  # noqa: E402
    Pose as BasePose, apply_pose, bake, begin, in_scene, build_armature, ease, env, export, lattice, load_source,
    out_path, qa, segment, to_local, track,
)

STRIDE = 6.0     # model units a planted foot sweeps during its stance
LIFT = 3.2       # swing height of a foot
MID_X = 11.0     # the crab's mirror plane
LEG_Y = {1: 16.0, 2: 24.0, 3: 32.0, 4: 40.0}
LEG_ROWS = {7: 1, 8: 1, 11: 2, 12: 2, 15: 3, 16: 3, 19: 4, 20: 4}


def mirror_x(x):
    return 2 * MID_X - x


def bone_of(ix, iy, iz, mat):
    """Which part a voxel face belongs to."""
    side = 'R' if ix <= 4 else 'L'           # x < 11 is the crab's right (it faces -Y)
    mx = ix if side == 'R' else 9 - ix       # mirrored onto the right side
    if mat == 'SecondaryColor':
        leg = LEG_ROWS.get(iy)
        assert leg, f'leg voxel off a leg row: {(ix, iy, iz)}'
        return f'{"thigh" if mx >= -4 else "shin"}{leg}.{side}'
    if mat == 'GLOW-claws':
        return f'jaw.{side}' if iz >= 0 or (iz == -1 and iy <= 0) else f'claw.{side}'
    if mat in ('EYES-White', 'EYES-Black') and iz >= -3:
        return f'eye.{side}'
    return 'body'



# Bone heads/tails in model space. Pivots sit on voxel boundaries, where a
# rotation opens the smallest seam.
def bone_table():
    t = {
        'root': ((MID_X, 26, -17), (MID_X, 26, -14), None),
        'body': ((MID_X, 26, -11), (MID_X, 26, -5), 'root'),
    }
    for side in 'RL':
        X = (lambda x: x) if side == 'R' else mirror_x
        t[f'eye.{side}'] = ((X(6), 13, -5), (X(6), 13, -1), 'body')
        t[f'claw.{side}'] = ((X(1), 13, -7), (X(-4), 2, -5), 'body')
        t[f'jaw.{side}'] = ((X(-4), 14, 1), (X(-4), -2, 1), f'claw.{side}')
        for leg, y in LEG_Y.items():
            t[f'thigh{leg}.{side}'] = ((X(-1), y, -13), (X(-7), y, -9), 'body')
            t[f'shin{leg}.{side}'] = ((X(-7), y, -9), (X(-12), y, -17), f'thigh{leg}.{side}')
    return t


class Pose(BasePose):
    """A crab's frame: the body's offset and rotation, foot targets (ground
    frame), and extra rotations per bone."""

    def __init__(self):
        super().__init__()
        self.body_off = Vector((0, 0, 0))
        self.body_rot = Quaternion()
        self.feet = {}   # (leg, side) -> (dx, dy, dz) from the rest foot, ground frame


def claw(p, side, lift=0.0, out=0.0, inward=0.0, jaw=0.0):
    """Claw arm: lift (front up), out (raised away from the body), inward (toward
    the mouth); jaw opens the upper finger. Mirrored for the left."""
    m = 1 if side == 'R' else -1
    p.turn(f'claw.{side}', 'x', -lift)
    p.turn(f'claw.{side}', 'z', m * inward)
    p.turn(f'claw.{side}', 'y', m * out)
    p.turn(f'jaw.{side}', 'x', -jaw)


def eye(p, side, swivel=0.0, tilt=0.0, nod=0.0):
    m = 1 if side == 'R' else -1
    p.turn(f'eye.{side}', 'z', swivel)
    p.turn(f'eye.{side}', 'y', m * tilt)
    p.turn(f'eye.{side}', 'x', nod)


def solve_leg(rig, leg, side, foot_ground, body_mat):
    """Two-bone IK in the leg's x-z plane. Returns (thigh, shin) world-axis
    rotations about -Y... expressed as angles in the x-z plane."""
    bones = rig.data.bones
    th, sh = bones[f'thigh{leg}.{side}'], bones[f'shin{leg}.{side}']
    hip, knee, foot = th.head_local, th.tail_local, sh.tail_local
    a, b = (knee - hip).length, (foot - knee).length
    tgt = body_mat.inverted() @ foot_ground          # into the body's rest frame
    d = Vector((tgt.x - hip.x, tgt.z - hip.z))
    dist = min(a + b - 1e-3, max(abs(a - b) + 1e-3, d.length))
    alpha = math.atan2(d.y, d.x)
    beta = math.acos(max(-1, min(1, (a * a + dist * dist - b * b) / (2 * a * dist))))
    best = None
    for k in (alpha + beta, alpha - beta):            # the knee that stands highest
        kz = hip.z + a * math.sin(k)
        if best is None or kz > best[1]:
            best = (k, kz)
    k = best[0]
    kx, kz = hip.x + a * math.cos(k), hip.z + a * math.sin(k)
    f = (hip.x + dist * math.cos(alpha), hip.z + dist * math.sin(alpha))
    phi = math.atan2(f[1] - kz, f[0] - kx)
    th0 = math.atan2(knee.z - hip.z, knee.x - hip.x)
    sh0 = math.atan2(foot.z - knee.z, foot.x - knee.x)
    d1 = k - th0
    d2 = (phi - sh0) - d1
    # Raising atan2(z, x) by d is a rotation about -Y by d.
    return Quaternion((0, -1, 0), d1), Quaternion((0, -1, 0), d2)


def apply(rig, p):
    pbs = rig.pose.bones
    body = rig.data.bones['body']
    pivot = body.head_local
    body_mat = Matrix.Translation(p.body_off + pivot) @ p.body_rot.to_matrix().to_4x4() @ Matrix.Translation(-pivot)
    pbs['body'].rotation_quaternion = to_local(rig, 'body', p.body_rot)
    pbs['body'].location = body.matrix_local.to_quaternion().inverted() @ p.body_off
    for side in 'RL':
        for leg in LEG_Y:
            rest = rig.data.bones[f'shin{leg}.{side}'].tail_local
            dx, dy, dz = p.feet.get((leg, side), (0, 0, 0))
            q1, q2 = solve_leg(rig, leg, side, rest + Vector((dx, dy, dz)), body_mat)
            pbs[f'thigh{leg}.{side}'].rotation_quaternion = to_local(rig, f'thigh{leg}.{side}', q1)
            pbs[f'shin{leg}.{side}'].rotation_quaternion = to_local(rig, f'shin{leg}.{side}', q2)
    apply_pose(rig, p)


# --------------------------------------------------------------------------
# Clips: functions of seconds -> Pose
# --------------------------------------------------------------------------

GROUP_A = {(1, 'R'), (2, 'L'), (3, 'R'), (4, 'L')}
DUTY = 0.55


def walk(t, T=1.0):
    p = Pose()
    u0 = t / T
    for side in 'RL':
        for leg in LEG_Y:
            off = (0.0 if (leg, side) in GROUP_A else 0.5) + 0.05 * (leg - 1)
            u = (u0 + off) % 1.0
            if u < DUTY:  # stance: the body walks +X past a planted foot
                s = u / DUTY
                dx, dz = STRIDE * (0.5 - s), 0.0
            else:         # swing: lift and reach back ahead
                s = (u - DUTY) / (1 - DUTY)
                dx = STRIDE * (-0.5 + ease(s))
                dz = LIFT * math.sin(math.pi * s)
            p.feet[(leg, side)] = (dx, 0, dz)
    w = 2 * math.pi * u0
    p.body_off = Vector((0.25 * math.sin(w), 0, 0.45 + 0.35 * math.cos(2 * w)))
    p.body_rot = qa('y', 0.035 * math.sin(w)) @ qa('x', 0.02 * math.sin(2 * w))
    for side in 'RL':
        lag = 0.0 if side == 'R' else 0.4
        claw(p, side, lift=0.14 + 0.06 * math.sin(2 * w - 0.7 - lag), inward=0.04, jaw=0.06 + 0.04 * math.sin(w + lag))
        eye(p, side, tilt=-0.05 * math.sin(w - 0.6), swivel=(0.12 if side == 'L' else -0.12))
    return p


def idle(t, T=4.0):
    p = Pose()
    w = 2 * math.pi * t / T
    p.body_off = Vector((0.1 * math.sin(w), 0, 0.25 * math.sin(2 * w)))
    p.body_rot = qa('y', 0.015 * math.sin(w))
    # A shuffle: one foot lifts and sets back down.
    tap = env(t, 2.4, 2.6, 2.75, 2.95)
    p.feet[(2, 'L')] = (0.8 * tap, 0, 1.8 * tap)
    tap2 = env(t, 0.6, 0.8, 0.95, 1.15)
    p.feet[(3, 'R')] = (-0.6 * tap2, 0, 1.4 * tap2)
    # Eyes look about, each on its own (crabs' do).
    sr = track(t, [(0, 0), (0.5, 0.35), (1.4, 0.35), (1.6, -0.3), (2.8, -0.3), (3.2, 0), (4, 0)])
    sl = track(t, [(0, 0), (0.9, -0.3), (1.9, -0.3), (2.1, 0.25), (3.0, 0.25), (3.6, 0), (4, 0)])
    eye(p, 'R', swivel=sr, tilt=0.04 * math.sin(w), nod=0.06 * math.sin(w + 1))
    eye(p, 'L', swivel=sl, tilt=0.04 * math.sin(w + 2), nod=0.06 * math.sin(w + 2.5))
    for side, ph in (('R', 0.0), ('L', 1.7)):
        claw(p, side, lift=0.08 + 0.03 * math.sin(w + ph), jaw=0.12 * env(t, 1.0 + ph * 0.6, 1.2 + ph * 0.6, 1.5 + ph * 0.6, 1.8 + ph * 0.6))
    return p


def snap(t, at, open_=0.55):
    """A jaw that opens wide and snaps shut at `at`."""
    return open_ * env(t, at - 0.22, at - 0.06, at - 0.03, at)


def pinch(t, T=2.0):
    p = Pose()
    up = env(t, 0.0, 0.3, 1.65, T)
    p.body_off = Vector((0, 0, 0.9 * up))
    p.body_rot = qa('x', -0.06 * up)
    for side, d in (('R', 0.0), ('L', 0.17)):
        j = sum(snap(t, a + d) for a in (0.55, 0.9, 1.3))
        claw(p, side, lift=0.42 * up + 0.05 * math.sin(14 * t + d * 9) * up, out=0.18 * up, jaw=j)
    for side in 'RL':
        eye(p, side, nod=-0.12 * up)
    return p


def forage(t, T=3.0):
    p = Pose()
    down_any = 0.0
    for side, t0 in (('R', 0.0), ('L', 1.4)):
        tt = t - t0
        reach = env(tt, 0.0, 0.45, 0.6, 0.85)        # down to the floor
        feed = env(tt, 0.6, 0.95, 1.2, 1.5)          # up to the mouth
        grab = 0.35 * env(tt, 0.1, 0.35, 0.45, 0.6)  # open, then close on a morsel
        nibble = 0.12 * feed * max(0.0, math.sin(30 * tt))
        # The mouth is low and central: feeding swings the claw in and dips it.
        claw(p, side, lift=-0.55 * reach - 0.12 * feed, inward=0.08 * reach + 0.5 * feed, jaw=grab + nibble)
        down_any = max(down_any, reach)
    p.body_rot = qa('x', 0.07 * down_any)
    p.body_off = Vector((0, 0, -0.3 * down_any))
    for side in 'RL':
        eye(p, side, nod=0.18 * down_any)
    return p


def wave(t, T=3.0):
    """The fiddler crab's wave: the left claw swings out, rises and beats."""
    p = Pose()
    up = env(t, 0.0, 0.5, 2.3, T)
    flap = math.sin(2 * math.pi * (t - 0.5) / 0.7) * env(t, 0.5, 0.7, 2.0, 2.3)
    claw(p, 'L', lift=0.75 * up + 0.28 * flap, inward=-0.4 * up, out=0.2 * up, jaw=0.35 * up + 0.15 * max(0.0, flap))
    claw(p, 'R', lift=0.1 * up)
    p.body_off = Vector((0.6 * up, 0, 0.5 * up))
    p.body_rot = qa('y', 0.06 * up)
    eye(p, 'L', swivel=-0.2 * up, nod=-0.1 * up)
    eye(p, 'R', swivel=-0.1 * up, nod=-0.1 * up)
    return p


def cheer(t, T=2.5):
    """Both claws up and spread, jaws open, a little bounce: delight."""
    p = Pose()
    up = env(t, 0.0, 0.35, 1.9, T)
    beat = env(t, 0.35, 0.5, 1.6, 1.9)
    bounce = abs(math.sin(2 * math.pi * (t - 0.35) / 0.5)) * beat
    for side, ph in (('R', 0.0), ('L', math.pi)):
        claw(p, side, lift=0.8 * up + 0.18 * math.sin(2 * math.pi * t / 0.5 + ph) * beat,
             inward=-0.35 * up, out=0.12 * up, jaw=0.5 * up)
        eye(p, side, nod=-0.15 * up, tilt=0.1 * up)
    p.body_off = Vector((0, 0, 0.6 * up + 1.2 * bounce))
    for side in 'RL':
        for leg in LEG_Y:  # feet stay planted while the body bounces
            p.feet[(leg, side)] = (0, 0, 0)
    return p


CLIPS = [('walk', walk, 1.0), ('idle', idle, 4.0), ('pinch', pinch, 2.0),
         ('forage', forage, 3.0), ('wave', wave, 3.0), ('cheer', cheer, 2.5)]


def main():
    scene = bpy.data.scenes.get('crab') or bpy.data.scenes.new('crab')
    with in_scene(scene):
        begin('crab')
        meshes = load_source('crab')
        pitch, phase = lattice(meshes)
        assert (pitch, phase) == (2.0, (1.0, 0.0, 1.0)), (pitch, phase)
        counts = segment(meshes, bone_of, pitch, phase)
        rig = build_armature('Crab', meshes, bone_table())
        keyed = {pb.name: ['rotation_quaternion'] + (['location'] if pb.name == 'body' else [])
                 for pb in rig.pose.bones if pb.name != 'root'}
        clips = bake(rig, 'crab', CLIPS, apply, ('walk', 'idle'), keyed)
        # The body's travel per walk cycle: a planted foot sweeps STRIDE while the
        # body walks past it for the stance's DUTY of the cycle, so a whole cycle
        # carries the body STRIDE / DUTY. The tank sets the clip's phase from
        # distance with this, and the feet stay put.
        out = export(rig, out_path('crab'), {'mqStride': STRIDE / DUTY})
        return {'faces_per_bone': counts, 'bones': len(rig.data.bones), 'clips': clips, 'out': out,
                'bytes': os.path.getsize(out)}


if __name__ == '__main__':
    result = main()
    print(result)
