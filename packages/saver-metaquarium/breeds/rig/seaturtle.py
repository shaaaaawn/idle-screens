"""
Rig and animate the sea turtle: breeds/source/seaturtle.glb in,
breeds/rig/seaturtle.glb out.

    blender -b -P breeds/rig/seaturtle.py        (from packages/saver-metaquarium)

The source is the MINTED breed's one model (breeds/minted.mjs), cut into paint
regions MINT-R<n> / MINT-EYE-R<n>: all 16 turtle tokens are this model in
their own paint, so this one rig swims them all. The model is never edited.

Facing. Every delivered turtle's node carries a -30° yaw over perfectly
axis-aligned voxels; the canonical source drops it (breeds/minted.mjs: the
mesh as authored, and a rigged breed without its whole-body clip), so the
turtle comes in square to the axes, facing -Y (glTF +Z), the rig convention.

The lattice: 2-unit voxels, a cell ix spanning x 2ix+0.09 .. 2ix+2.09 (y:
+1.81, z: +0.81). The shell is centred on x = 2.09, its walls at x -9.91 and
14.09; its left is +X. Read off the occupancy (nose -Y):

    head     y -20.2 .. -14.2, both eyes in it (they reach y -14.19)
    neck     y -14.2 .. -10.2, x -1.9 .. 8.1
    shell    the carapace and plastron, y -10.2 .. 16.8
    fore     a flipper hangs off each wall at y -10 .. 2, sloping down and
             out: the right a voxel thick to x -19.9, the left three thick
             to x 24.1 (the model's own asymmetry)
    hind     a stub at each back corner (y 10 .. 17, low)
    tail     a two-cell bump at y 16.8 .. 20.8

Soft throughout, the angelfish's way (common.soften): every vertex's weights
come from where it lies, so the skin bends and never cracks. The shell is
rigid; the neck blends it into the head; each fore-flipper is a chain of
three (shoulder, wrist, tip) handed over by distance out along its span, so
a stroke runs out along the wing and the tip curls after it; the hind
flippers and the tail blend in at their roots.

Bones that only a dial or a moment moves (non-deforming, so each has one
driver and the mixer never averages two):

    bank           the whole turtle, about its middle: barrel rolls and
                   somersaults (moments only — the tank already banks it
                   into turns)
    lookY, lookP   the neck's yaw and pitch: the look dials
    withdraw       the head drawn in (the tuck moment)
    reach          the head stretched out or drawn in: the reach dial
    steerR, steerL above each fore-flipper: the steer dial

Clips (30 fps; the tank sets their times and weights, never update(dt)):

    swim     2.4 s loop: the fore-flippers fly — down and back in the power
             stroke, feathered up and forward in the recovery — the wave
             running out to the tips; the hind flippers trim, the shell
             rides the strokes
    glide    5 s loop: wings swept back and held, the tips trimming
    paddle   2 s loop: holding station, sculling, the hind flippers pedalling
    burst    1.3 s loop: hard, deep strokes
    moments  one-shots from rest to rest (src/turtle.ts gives every turtle a
             temperament and a favourite): breathe, lookback, barrel,
             somersault, wave, wipe, stretch, tuck, nod, flap. Ramps of half
             a second or more and nothing quicker than ~1 Hz: at 30 fps a
             faster move reads as a snap
    steer, lookYaw, lookPitch, reach
             DIALS, 2 s each: the time is the setting — 0 one way, 1 at
             rest, 2 the other (steer + turning to its left, lookYaw + to
             its left, lookPitch + nose up, reach + stretched out)
"""
import math
import os
import sys

import bpy

sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (  # noqa: E402
    Pose, apply_pose, bake, begin, blend, build_armature, ease, env, export, eyes_pure, in_scene, knots, lattice,
    load_source, out_path, segment, soften, track,
)

BREED = 'seaturtle'
CX = 2.09  # the shell's centre line
WALL_R, WALL_L = -9.91, 14.09  # the shell's sides, where the fore-flippers hang
# Nose to tail: the head pure ahead of y -13.6 (its eyes end at -14.19, well
# inside), the neck between, the shell pure behind -10.4 (its front rim).
SPINE = ((-13.6, 'head'), (-12.0, 'neck'), (-10.4, 'shell'))
# Each fore-flipper's chain by distance out along its span (x): the shoulder
# blends into the wrist and the wrist into the tip, each pivot midway.
SPAN_R = ((11.91, 'fR1'), (15.91, 'fR2'), (19.91, 'fR3'))  # by -x
SPAN_L = ((16.09, 'fL1'), (20.09, 'fL2'), (24.09, 'fL3'))  # by x
CHAIN_R = ((-9.91, -5.19, -4.19), (-13.91, -4.19, -6.19), (-17.91, -1.69, -8.19), (-20.4, -0.19, -8.19))
CHAIN_L = ((14.09, -5.19, -6.19), (18.09, -3.19, -7.19), (22.09, -0.69, -8.19), (24.6, 0.31, -8.19))
NECK = (1.6, -10.4, -0.2)
HEAD = (1.09, -12.6, -0.2)


def weights_at(co, eye):
    if eye:
        return {'head': 1.0}
    x, y = co.x, co.y
    w = knots(y, SPINE)
    # The tail: only the bump on the centre line (the hind corners stay shell).
    if y > 15.6:
        w = blend(w, {'tail': 1.0}, ease((y - 15.6) / 2.4) * (1 - ease((abs(x - CX) - 3) / 2)))
    # The fore-flippers: from each wall out, over the band they hang in.
    fore = ease((y + 12.2) / 2) * (1 - ease((y - 2.8) / 2))
    if x < WALL_R:
        w = blend(w, knots(-x, SPAN_R), ease((WALL_R - x) / 2) * fore)
    if x > WALL_L:
        w = blend(w, knots(x, SPAN_L), ease((x - WALL_L) / 2) * fore)
    # The hind flippers: their root cell is the hip.
    hind = ease((y - 8.8) / 2)
    if x < -7.91:
        w = blend(w, {'rR': 1.0}, ease((-7.91 - x) / 4) * hind)
    if x > 12.09:
        w = blend(w, {'rL': 1.0}, ease((x - 12.09) / 4) * hind)
    return w


def bone_of(x, y, z, mat):
    """Only to start the vertex groups (weights_at decides): eyes or not."""
    return '_eye' if 'EYE' in mat else '_part'


def bone_table():
    # Blender space: nose -Y, its left +X, up +Z.
    t = {
        'root': ((CX, 0, -16), (CX, 0, -13), None),
        'bank': ((CX, 0, -1), (CX, 0.5, -1), 'root'),
        'shell': ((CX, 0, -1), (CX, -8, -1), 'bank'),
        'lookY': (NECK, (NECK[0], NECK[1] - 0.5, NECK[2]), 'shell'),
        'lookP': (NECK, (NECK[0], NECK[1] - 0.5, NECK[2]), 'lookY'),
        'neck': (NECK, HEAD, 'lookP'),
        'withdraw': (HEAD, (HEAD[0], HEAD[1] - 0.5, HEAD[2]), 'neck'),
        'reach': (HEAD, (HEAD[0], HEAD[1] - 0.5, HEAD[2]), 'withdraw'),
        'head': (HEAD, (HEAD[0], -20.4, HEAD[2]), 'reach'),
        'rR': ((-8.9, 11.8, -6.19), (-12.4, 14.3, -6.19), 'shell'),
        'rL': ((13.1, 11.8, -7.19), (16.6, 15.3, -7.19), 'shell'),
        'tail': ((CX, 16.8, -0.2), (CX, 21.0, -0.2), 'shell'),
    }
    for side, chain in (('R', CHAIN_R), ('L', CHAIN_L)):
        t[f'steer{side}'] = (chain[0], tuple(c + d for c, d in zip(chain[0], (0, 0, 0.5))), 'shell')
        parent = f'steer{side}'
        for i in range(3):
            t[f'f{side}{i + 1}'] = (chain[i], chain[i + 1], parent)
            parent = f'f{side}{i + 1}'
    return t


NONDEFORM = ('root', 'bank', 'lookY', 'lookP', 'withdraw', 'reach', 'steerR', 'steerL')


# --------------------------------------------------------------------------
# Posing. Signs (rotations about world axes at rest, each relative to its
# parent, so a chain's turns accumulate):
#   a fore-flipper's LIFT + raises its tip; SWEEP + carries it back toward
#   the tail; FEATHER + pitches its leading edge up
#   the head and neck: about X + dips the nose, about Z + turns to its left
# --------------------------------------------------------------------------

def flipper(p, side, i, lift=0.0, sweep=0.0, feather=0.0):
    s = 1 if side == 'R' else -1
    b = f'f{side}{i + 1}'
    p.turn(b, 'y', s * lift)
    p.turn(b, 'z', -s * sweep)
    p.turn(b, 'x', -feather)


def wings(p, lift=(0, 0, 0), sweep=(0, 0, 0), feather=(0, 0, 0), sides='RL'):
    for side in sides:
        for i in range(3):
            flipper(p, side, i, lift[i], sweep[i], feather[i])


def stroke(p, ph, amp=(0.32, 0.14, 0.12), sweep=(0.22, 0.08, 0.05), feather=(0.22, 0.12, 0.14), lag=0.45, sides='RL'):
    """One wingbeat at phase ph (0 the top): down and back in the power half,
    up and forward, feathered, in the recovery; each segment a little behind
    the one inside it, so the beat runs out to the tip and the tip curls."""
    for side in sides:
        for i in range(3):
            q = ph - lag * i
            flipper(p, side, i, amp[i] * math.cos(q), sweep[i] * math.sin(q), -feather[i] * math.sin(q))


def hinds(p, trim=0.0, pedal_r=0.0, pedal_l=0.0, spread=0.0):
    """trim: both hind flippers pitch (+ trailing edge up); pedal: each its
    own stroke; spread: + splays them out."""
    p.turn('rR', 'x', -trim + pedal_r)
    p.turn('rL', 'x', -trim + pedal_l)
    p.turn('rR', 'z', spread)
    p.turn('rL', 'z', -spread)


def look(p, nod=0.0, yaw=0.0, neck_share=0.4):
    """The head and neck together: nod + dips the nose, yaw + to its left."""
    p.turn('neck', 'x', neck_share * nod)
    p.turn('neck', 'z', neck_share * yaw)
    p.turn('head', 'x', (1 - neck_share) * nod)
    p.turn('head', 'z', (1 - neck_share) * yaw)


def swim(t, T=2.4):
    p = Pose()
    w = 2 * math.pi * t / T
    stroke(p, w)
    hinds(p, trim=0.1 * math.sin(w - 1.2), spread=0.04 * math.sin(w))
    # The body rides the strokes: lifted on each down-beat, nose rising.
    p.move('shell', (0, 0, 0.5 * math.sin(w - 0.4)))
    p.turn('shell', 'x', -0.03 * math.sin(w - 0.6))
    look(p, nod=0.06 * math.sin(w - 1.4))
    p.turn('tail', 'z', 0.06 * math.sin(w))
    return p


def glide(t, T=5.0):
    p = Pose()
    w = 2 * math.pi * t / T
    wings(p, lift=(-0.05, 0.03, 0.06 + 0.04 * math.sin(w)), sweep=(0.42, 0.1, 0.05 + 0.03 * math.sin(2 * w)),
          feather=(0.04 * math.sin(w), 0.0, 0.05 * math.sin(w + 1)))
    hinds(p, trim=0.05 * math.sin(w + 0.8))
    look(p, nod=0.03 * math.sin(2 * w), yaw=0.12 * math.sin(w))
    p.turn('tail', 'z', 0.04 * math.sin(w))
    return p


def paddle(t, T=2.0):
    p = Pose()
    w = 2 * math.pi * t / T
    # Sculling: the wings sweep forward and back, flipping their pitch at
    # each end, so it hangs in the water rather than flying.
    for side in 'RL':
        for i, (a, f) in enumerate(((0.2, 0.3), (0.08, 0.14), (0.05, 0.12))):
            flipper(p, side, i, lift=0.06 * math.sin(w - 0.4 * i), sweep=a * math.sin(w - 0.4 * i) - (0.08 if i == 0 else 0),
                    feather=f * math.cos(w - 0.4 * i))
    hinds(p, pedal_r=0.3 * math.sin(w), pedal_l=0.3 * math.sin(w + math.pi), spread=0.08)
    look(p, nod=0.04 * math.sin(w))
    p.move('shell', (0, 0, 0.15 * math.sin(w)))
    return p


def burst(t, T=1.3):
    p = Pose()
    w = 2 * math.pi * t / T
    stroke(p, w, amp=(0.45, 0.2, 0.15), sweep=(0.32, 0.12, 0.06), feather=(0.25, 0.12, 0.12))
    hinds(p, trim=0.12, spread=-0.06)  # tucked, streamlined
    look(p, nod=-0.05)
    p.move('shell', (0, 0, 0.7 * math.sin(w - 0.4)))
    p.turn('shell', 'x', -0.04 * math.sin(w - 0.6))
    return p


# --- moments -------------------------------------------------------------

def breathe(t, T=4.4):
    """Up for a breath: the head lifts and stretches toward the light, two
    slow gulps, and back down."""
    p = Pose()
    up = env(t, 0.0, 1.1, T - 1.2, T)
    gulp = sum(math.sin(math.pi * (t - a) / 0.9) ** 2 for a in (1.4, 2.4) if a <= t <= a + 0.9)
    look(p, nod=-0.4 * up + 0.08 * gulp, neck_share=0.6)
    p.turn('shell', 'x', -0.1 * up)  # the whole turtle tips nose-up
    wings(p, sweep=(0.12 * up * math.sin(2 * math.pi * t / 2.2), 0, 0), feather=(0.15 * up * math.cos(2 * math.pi * t / 2.2), 0, 0))
    hinds(p, spread=0.1 * up)
    return p


def lookback(t, T=4.0):
    """A long look back over its left shoulder, the body turning with it."""
    p = Pose()
    yaw = track(t, [(0, 0), (1.3, 1.0), (2.4, 1.0), (T, 0)])
    look(p, yaw=1.0 * yaw, nod=-0.08 * yaw, neck_share=0.55)
    p.turn('shell', 'z', 0.1 * yaw)
    wings(p, sweep=(-0.15 * yaw, 0, 0), sides='L')  # braced, reaching
    hinds(p, pedal_r=0.12 * yaw)
    return p


def barrel(t, T=4.4):
    """A slow, lazy barrel roll, wings spread wide."""
    p = Pose()
    p.turn('bank', 'y', 2 * math.pi * ease((t - 0.6) / (T - 1.2)))
    spread = env(t, 0.0, 0.7, T - 0.8, T)
    wings(p, lift=(0.12 * spread, 0.06 * spread, 0.08 * spread), sweep=(-0.1 * spread, 0, 0))
    look(p, nod=-0.08 * spread)
    hinds(p, spread=0.15 * spread)
    return p


def somersault(t, T=5.0):
    """A forward flip, nose over tail: one big stroke to start it, wings
    tucked through the turn, spread to stop."""
    p = Pose()
    p.turn('bank', 'x', 2 * math.pi * ease((t - 0.8) / (T - 1.6)))
    kick = env(t, 0.0, 0.5, 0.7, 1.4)
    tuck = env(t, 1.0, 1.6, T - 1.8, T - 1.0)
    for side in 'RL':
        flipper(p, side, 0, lift=-0.3 * kick, sweep=0.25 * kick + 0.5 * tuck)
        flipper(p, side, 1, lift=-0.1 * kick, sweep=0.1 * tuck)
    look(p, nod=0.25 * tuck)
    hinds(p, trim=0.15 * tuck)
    return p


def wave(t, T=3.6):
    """It lifts its right fore-flipper and waves — a hello."""
    p = Pose()
    up = env(t, 0.0, 0.8, T - 1.0, T)
    hi = env(t, 0.6, 1.3, T - 1.5, T - 0.9)
    w = 2 * math.pi * (t - 0.6) / 1.1
    flipper(p, 'R', 0, lift=0.6 * up, sweep=-0.15 * up)
    flipper(p, 'R', 1, lift=0.15 * up, sweep=0.25 * hi * math.sin(w))
    flipper(p, 'R', 2, lift=0.1 * up, sweep=0.16 * hi * math.sin(w - 0.6))
    flipper(p, 'L', 0, sweep=0.1 * up * math.sin(2 * math.pi * t / 2.0), feather=0.12 * up)  # balancing
    look(p, yaw=-0.2 * up, nod=-0.06 * up)
    p.turn('head', 'y', 0.12 * up)  # a tilt of the head
    return p


def wipe(t, T=4.2):
    """Its left fore-flipper sweeps up over its face, twice — a turtle
    wiping its eyes."""
    p = Pose()
    # The flipper comes a long way forward: in and back over 0.9 and 1.4 s.
    reach = env(t, 0.0, 0.9, T - 1.4, T)
    stroke_ = math.sin(math.pi * (t - 0.9) / 1.1) ** 2 if 0.9 <= t <= 3.1 else 0.0
    flipper(p, 'L', 0, lift=0.25 * reach + 0.08 * stroke_, sweep=-0.7 * reach - 0.12 * stroke_)
    flipper(p, 'L', 1, sweep=-0.35 * reach - 0.1 * stroke_, lift=0.1 * reach)
    flipper(p, 'L', 2, sweep=-0.25 * reach, lift=0.05 * stroke_)
    look(p, yaw=0.25 * reach, nod=0.15 * reach + 0.05 * stroke_)
    flipper(p, 'R', 0, feather=0.1 * reach)
    return p


def stretch(t, T=4.4):
    """A long stretch: neck out and up, all four flippers reaching wide, the
    tail lifted — a shiver at the top — and it settles."""
    p = Pose()
    a = env(t, 0.0, 1.4, T - 1.4, T)
    shiver = 0.04 * math.sin(2 * math.pi * t / 0.7) * env(t, 1.2, 1.6, T - 1.8, T - 1.4)
    look(p, nod=-0.3 * a, neck_share=0.6)
    wings(p, lift=(0.15 * a, 0.0, 0.15 * a + shiver), sweep=(-0.25 * a, 0.05 * a, 0.0))
    hinds(p, spread=0.3 * a, trim=-0.1 * a)
    p.turn('tail', 'x', 0.25 * a)  # + about X lifts a bone that points back (+Y)
    p.turn('shell', 'x', -0.05 * a)
    return p


def tuck(t, T=5.0):
    """Shy: head drawn in, flippers folded back — then a peek out, and back
    in, before it dares come out."""
    p = Pose()
    p.move('withdraw', (0, 2.4 * track(t, [(0, 0), (0.9, 1), (2.0, 1), (2.6, 0.5), (3.3, 0.5), (3.8, 0.85), (T, 0)]), 0))
    fold = env(t, 0.0, 0.9, T - 1.4, T)
    wings(p, lift=(-0.12 * fold, 0, 0), sweep=(0.65 * fold, 0.25 * fold, 0.1 * fold))
    hinds(p, spread=-0.15 * fold, trim=0.1 * fold)
    peek = env(t, 2.3, 2.8, 3.2, 3.7)
    look(p, nod=0.18 * fold - 0.1 * peek, yaw=0.25 * peek)
    return p


def nod(t, T=2.8):
    """Two slow nods — a greeting."""
    p = Pose()
    bob = math.sin(math.pi * (t - 0.4) / 0.9) ** 2 if 0.4 <= t <= 2.2 else 0.0
    look(p, nod=0.3 * bob, neck_share=0.3)
    for side in 'RL':
        flipper(p, side, 2, lift=0.1 * bob)
    return p


def flap(t, T=3.0):
    """Two big, joyful wingbeats, the body surging up on each."""
    p = Pose()
    on = env(t, 0.0, 0.5, T - 0.8, T)
    w = 2 * math.pi * t / 1.3
    for side in 'RL':
        for i, (a, s) in enumerate(((0.45, 0.28), (0.2, 0.1), (0.15, 0.05))):
            q = w - 0.45 * i
            # From rest (the top of the beat is the raised wing: start there).
            flipper(p, side, i, lift=a * on * (math.cos(q)), sweep=s * on * math.sin(q), feather=-0.15 * on * math.sin(q))
    p.move('shell', (0, 0, 0.8 * on * math.sin(w - 0.4)))
    look(p, nod=-0.08 * on)
    hinds(p, spread=0.1 * on)
    return p


# --- dials ---------------------------------------------------------------

def steer(t, T=2.0):
    """Turning to its left (+): the inner wing brakes (back and up), the
    outer reaches forward."""
    p = Pose()
    u = t - 1
    p.turn('steerL', 'z', 0.25 * u)    # left (L: + is back)
    p.turn('steerL', 'y', -0.1 * u)    # and up
    p.turn('steerR', 'z', 0.25 * u)    # right forward (R: - is back)
    p.turn('steerR', 'y', -0.1 * u)    # and down
    return p


def look_yaw(t, T=2.0):
    p = Pose()
    p.turn('lookY', 'z', 0.5 * (t - 1))
    return p


def look_pitch(t, T=2.0):
    p = Pose()
    p.turn('lookP', 'x', -0.3 * (t - 1))
    return p


def reach(t, T=2.0):
    p = Pose()
    p.move('reach', (0, -2.0 * (t - 1), 0))
    return p


CLIPS = [
    ('swim', swim, 2.4), ('glide', glide, 5.0), ('paddle', paddle, 2.0), ('burst', burst, 1.3),
    ('breathe', breathe, 4.4), ('lookback', lookback, 4.0), ('barrel', barrel, 4.4), ('somersault', somersault, 5.0),
    ('wave', wave, 3.6), ('wipe', wipe, 4.2), ('stretch', stretch, 4.4), ('tuck', tuck, 5.0), ('nod', nod, 2.8),
    ('flap', flap, 3.0),
    ('steer', steer, 2.0), ('lookYaw', look_yaw, 2.0), ('lookPitch', look_pitch, 2.0), ('reach', reach, 2.0),
]


def main():
    scene = bpy.data.scenes.get(BREED) or bpy.data.scenes.new(BREED)
    with in_scene(scene):
        begin(BREED)
        meshes = load_source(BREED)
        pitch, phase = lattice(meshes)
        assert pitch == 2.0 and tuple(round(v, 2) for v in phase) == (0.09, 1.81, 0.81), (pitch, phase)
        segment(meshes, bone_of, pitch, phase, by_point=True)
        eyes_pure(meshes, weights_at, 'head')
        blended = soften(meshes, weights_at)
        rig = build_armature('Seaturtle', meshes, bone_table(), nondeform=NONDEFORM)
        keyed = {pb.name: ['rotation_quaternion'] for pb in rig.pose.bones if pb.name != 'root'}
        for b in ('shell', 'withdraw', 'reach'):
            keyed[b].append('location')
        clips = bake(rig, BREED, CLIPS, apply_pose, ('swim', 'glide', 'paddle', 'burst'), keyed)
        out = export(rig, out_path(BREED), {}, layered=True)
        return {'blended_vertices': blended, 'bones': len(rig.data.bones), 'clips': clips, 'out': out,
                'bytes': os.path.getsize(out)}


if __name__ == '__main__':
    result = main()
    print(result)
