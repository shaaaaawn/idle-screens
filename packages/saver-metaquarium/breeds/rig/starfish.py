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

Standing up, it is a little person (front arms legs, side arms arms, back
arm its head):

    rise      1.2 s. Up onto its front tips; backwards, it lies down.
    standing  4 s loop. Upright at rest, breathing, a blink.
    walk      1 s loop. Two steps, arms swinging; `mqWalkStride` per cycle.
              Standing, its feet are `mqFeet` ahead of where its disc lay.
    march jacks reach kick twist circles disco spin
              its aerobics: one bar each (four beats, authored at 120 BPM,
              the tank sets the tempo), each a loop starting and ending on
              the same upright pose, so a routine cuts between them on the bar.
    mambo sway lead_twirl twirl dip_lead dip_follow lift_lead lift_fly
              partners (the Dirty Dancing number), lead and follow facing
              each other in a dance frame: the basic, a slow sway, a twirl
              under his hand, the dip, and the lift — he raises her overhead,
              arms spread. Each starts and ends on the same frame pose.

The flat one-shots start and end on the rest pose.
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


# ---------------------------------------------------------------------------
# Upright: the starfish as a little person. Its two front arms are legs, the
# side arms are arms, the back arm is its head; its face looks the way it
# faces. Every upright clip is the neutral pose UPRIGHT plus offsets, and
# starts and ends exactly on it, so the tank can cut between them on a bar
# line (breeds.test.ts checks the joins).
#
# Authored, like everything here, in the rest frame's axes: lifting a limb
# (turning it about its lift axis) brings it toward the viewer once standing;
# swaying it (about the rest up) moves it in the picture plane. The hinges
# are on the arms' undersides — the back, standing — so a limb bent toward
# the viewer closes its seams; bent away, it would open them to the camera.
# Knees, then, bend little: hips and feet do the work.
# ---------------------------------------------------------------------------

WALK_STRIDE = 22.0    # model units walked per upright walk cycle (two steps)
LEGS, ARMS, HEAD = (0, 4), (1, 3), 2
BEAT = 0.5            # dance clips are authored at 120 BPM: four beats in 2 s


def side(n):
    """+1 for the starfish's left limbs (arms 0, 1), -1 for its right (3, 4)."""
    return 1 if n in (0, 1) else -1


def raise_(p, n, link, a):
    """In the picture plane, standing: an arm up (a leg out) by `a`, either side."""
    sway(p, n, link, side(n) * a)


def upright(p, phi=math.pi / 2, hop=0.0):
    """Up on its front tips: the body tipped `phi` about them (they stay put)."""
    p.turn('body', 'x', phi)
    p.move('body', (0, -TIP_FRONT * (1 - math.cos(phi)), TIP_FRONT * math.sin(phi) + hop))
    for n in LEGS:
        lift(p, n, 0.0, 0.0, -0.15 * math.sin(phi))


def body_turn(p, axis, a):
    """Turn the standing body about a world axis through the disc: 'z' twists
    it about the vertical, 'y' rolls it side to side in the picture plane."""
    p.turn('body', axis, a)


def rise(t, T=1.2):
    """From lying flat to standing, over its front tips; played backwards, it lies down."""
    p = Pose()
    upright(p, (math.pi / 2) * track(t, [(0, 0), (T, 1)]))
    return p


def standing(t, T=4.0):
    """Upright at rest: breathing, arms loose, the head tilting, a blink."""
    p = Pose()
    w = 2 * math.pi * t / T
    upright(p, hop=0.35 * (1 - math.cos(w)) / 2)
    for n in ARMS:
        raise_(p, n, 1, -0.12 + 0.06 * math.sin(w))
        raise_(p, n, 3, 0.1 * math.sin(w - 0.8))
    sway(p, HEAD, 3, 0.08 * math.sin(w))
    blink(p, blinking(t, 2.4))
    return p


def walk(t, T=1.0):
    """Two steps on its front arms, the arms swinging against them."""
    p = Pose()
    w = 2 * math.pi * t / T
    upright(p, phi=math.pi / 2 - 0.06, hop=0.5 * (1 - math.cos(2 * w)) / 2)  # leans into it, bobbing each step
    for n, ph in ((0, 0.0), (4, math.pi)):
        sw = math.sin(w + ph)
        lift(p, n, 0.38 * sw, -0.12 * max(0.0, sw), 0.12 * max(0.0, -sw))
    for n, ph in ((1, math.pi), (3, 0.0)):
        lift(p, n, 0.3 * math.sin(w + ph), 0.12 * math.sin(w + ph - 0.5), 0.0)
        raise_(p, n, 1, -0.25)
    body_turn(p, 'y', 0.07 * math.sin(w))
    sway(p, HEAD, 2, 0.05 * math.sin(w))
    return p


def beats(t):
    return t / BEAT


def march(t, T=2.0):
    """Knees up on every beat, the other arm pumping."""
    p = Pose()
    b = beats(t)
    k = math.sin(math.pi * (b % 1)) ** 2          # each beat a knee up and down
    left = int(b) % 2 == 0
    upright(p, hop=0.6 * k)
    for n in LEGS:
        up = k if (n == 0) == left else 0.0
        lift(p, n, 0.7 * up, -0.25 * up, 0.2 * up)
    for n in ARMS:
        up = k if (n == 3) == left else 0.0          # the opposite arm
        lift(p, n, 0.55 * up, 0.35 * up, 0.0)
        raise_(p, n, 1, -0.2 * k)
    sway(p, HEAD, 3, 0.1 * math.sin(math.pi * b))
    return p


def jacks(t, T=2.0):
    """Jumping jacks: out on the beat (arms up, legs wide, a hop), in on the next."""
    p = Pose()
    b = beats(t)
    out = (1 - math.cos(math.pi * b)) / 2           # 0 in, 1 out, every other beat
    upright(p, hop=2.2 * math.sin(math.pi * (b % 1)) ** 2)
    for n in ARMS:
        raise_(p, n, 1, 1.05 * out)
        raise_(p, n, 2, 0.25 * out)
    for n in LEGS:
        raise_(p, n, 1, 0.32 * out)
    return p


def reach(t, T=2.0):
    """Side reaches: lean, and the far arm goes over the head; then the other way."""
    p = Pose()
    b = beats(t)
    r = math.sin(math.pi * b / 2)                    # + to its left over beats 0-2, - to its right over 2-4
    upright(p, hop=0.3 * abs(r))
    body_turn(p, 'y', 0.22 * r)
    for n in ARMS:
        over = max(0.0, -side(n) * r)               # the arm away from the lean goes up and over
        raise_(p, n, 1, 0.9 * over - 0.25 * max(0.0, side(n) * r))
        raise_(p, n, 2, 0.45 * over)
        raise_(p, n, 3, 0.35 * over)
    for n in LEGS:
        raise_(p, n, 1, 0.2 * max(0.0, side(n) * r))  # a step out toward the lean
    sway(p, HEAD, 3, 0.15 * r)
    return p


def kick(t, T=2.0):
    """Front kicks, left then right, arms up for balance."""
    p = Pose()
    b = beats(t)
    k = math.sin(math.pi * (b % 2) / 2) ** 2         # a kick over two beats
    left = b < 2
    upright(p, hop=0.8 * k)
    for n in LEGS:
        up = k if (n == 0) == left else 0.0
        lift(p, n, 1.0 * up, 0.15 * up, 0.25 * up)
    for n in ARMS:
        raise_(p, n, 1, 0.5 * k)
        lift(p, n, 0.25 * k, 0.0, 0.0)
    body_turn(p, 'x', 0.08 * k)  # leans back from the kick
    return p


def twist(t, T=2.0):
    """Twists: the body turns about the vertical, arms swinging out."""
    p = Pose()
    b = beats(t)
    tw = math.sin(math.pi * b / 2)                   # left on beat 1, right on beat 3
    upright(p, hop=0.4 * abs(tw))
    body_turn(p, 'z', 0.5 * tw)
    for n in ARMS:
        raise_(p, n, 1, 0.25 * abs(tw))
        lift(p, n, -0.0 + 0.3 * side(n) * tw, 0.0, 0.0)
    sway(p, HEAD, 3, -0.12 * tw)
    return p


def circles(t, T=2.0):
    """Arm circles, two a bar, with a bounce on every beat."""
    p = Pose()
    b = beats(t)
    psi = math.pi * b                               # a circle every two beats
    upright(p, hop=0.5 * math.sin(math.pi * (b % 1)) ** 2)
    for n in ARMS:
        raise_(p, n, 1, 0.75 * math.sin(psi))
        lift(p, n, 0.75 * (1 - math.cos(psi)) / 2 * 1.4, 0.0, 0.0)
        raise_(p, n, 3, 0.25 * math.sin(psi))
    return p


def disco(t, T=2.0):
    """The point: its right arm up to the sky, then down across, hips swinging."""
    p = Pose()
    b = beats(t)
    upp = math.sin(math.pi * min(b, 2) / 2) ** 2 if b < 2 else 0.0
    down = math.sin(math.pi * (b - 2) / 2) ** 2 if b >= 2 else 0.0
    upright(p, hop=0.4 * math.sin(math.pi * (b % 1)) ** 2)
    raise_(p, 3, 1, 1.15 * upp - 0.7 * down)         # its right arm (viewer's left)
    raise_(p, 3, 2, 0.15 * upp)
    lift(p, 3, 0.35 * down, 0.0, 0.0)
    raise_(p, 1, 1, -0.55 * (upp + down))            # the other hand on its hip
    lift(p, 1, 0.0, 0.6 * (upp + down), 0.4 * (upp + down))
    body_turn(p, 'y', 0.12 * math.sin(math.pi * b))  # hips side to side on the beat
    raise_(p, 4, 1, 0.12 * (upp + down))
    sway(p, HEAD, 3, -0.15 * (upp - down))
    return p


def spin(t, T=2.0):
    """A full turn about the vertical over three beats, arms up; a bounce to land."""
    p = Pose()
    b = beats(t)
    a = 2 * math.pi * track(b, [(0, 0), (3, 1), (4, 1)])
    land = math.sin(math.pi * max(0.0, b - 3)) ** 2
    upright(p, hop=1.2 * math.sin(math.pi * min(b, 3) / 3) + 0.6 * land)
    body_turn(p, 'z', a % (2 * math.pi))
    up = math.sin(math.pi * min(b, 3) / 3)
    for n in ARMS:
        raise_(p, n, 1, 0.9 * up)
        raise_(p, n, 3, 0.3 * up)
    return p


DANCES = [('march', march), ('jacks', jacks), ('reach', reach), ('kick', kick),
          ('twist', twist), ('circles', circles), ('disco', disco), ('spin', spin)]


# ---------------------------------------------------------------------------
# Partners (the Dirty Dancing number). Two starfish face each other in a dance
# frame: HOLD is the upright pose with the arms out to the partner — one hand
# held, one on the shoulder — and every partner clip starts and ends on it, so
# the tank cuts between them on the bar (breeds.test.ts checks). Roles: the
# lead and the follow; where their parts differ there is a clip for each.
# ---------------------------------------------------------------------------

LIFT_HEIGHT = 34.0    # model units the follow rises in the lift: her feet at his raised hands


def hold(p, phi=math.pi / 2, hop=0.0, frame=1.0):
    """Upright, in the dance frame: its right hand out to its partner's, its
    left on the partner's shoulder (both toward its front: toward the partner)."""
    upright(p, phi, hop)
    lift(p, 3, 0.75 * frame, 0.2 * frame, 0.0)
    raise_(p, 3, 1, -0.15 * frame)
    lift(p, 1, 0.55 * frame, 0.35 * frame, 0.0)
    raise_(p, 1, 1, 0.2 * frame)


def mambo(t, T=2.0):
    """The basic: forward on one, back on the other, the hips rolling every beat."""
    p = Pose()
    b = beats(t)
    step = math.sin(math.pi * b / 2)
    hold(p, hop=0.35 * math.sin(math.pi * (b % 1)) ** 2)
    lift(p, 0, 0.3 * max(0.0, step), 0.0, 0.1 * max(0.0, step))
    lift(p, 4, 0.3 * max(0.0, -step), 0.0, 0.1 * max(0.0, -step))
    body_turn(p, 'y', 0.14 * math.sin(math.pi * b))
    sway(p, HEAD, 3, 0.1 * math.sin(math.pi * b))
    return p


def sway_close(t, T=2.0):
    """Cheek to cheek: a slow sway together, side to side over the bar."""
    p = Pose()
    b = beats(t)
    s = math.sin(math.pi * b / 2)
    hold(p, hop=0.2 * abs(s))
    body_turn(p, 'y', 0.2 * s)
    for n in LEGS:
        raise_(p, n, 1, 0.12 * max(0.0, side(n) * s))
    sway(p, HEAD, 2, 0.18 * s)
    return p


def lead_twirl(t, T=2.0):
    """He raises their joined hands, and she turns under them."""
    p = Pose()
    b = beats(t)
    up = math.sin(math.pi * b / 4)
    hold(p, hop=0.3 * math.sin(math.pi * (b % 1)) ** 2)
    raise_(p, 3, 1, 1.25 * up)
    lift(p, 3, -0.5 * up, -0.15 * up, 0.0)
    body_turn(p, 'y', 0.1 * math.sin(math.pi * b))
    return p


def twirl(t, T=2.0):
    """She turns once under his hand, her hand up to his."""
    p = Pose()
    b = beats(t)
    a = 2 * math.pi * track(b, [(0, 0), (0.5, 0), (3.2, 1), (4, 1)])
    up = math.sin(math.pi * b / 4)
    hold(p, hop=0.5 * up, frame=1 - up)
    body_turn(p, 'z', a % (2 * math.pi))
    raise_(p, 3, 1, 1.2 * up)
    raise_(p, 1, 1, -0.3 * up)
    return p


def dip_lead(t, T=4.0):
    """He leans in over her, lunging, his hand at her back."""
    p = Pose()
    b = beats(t)
    e = env(b, 1, 3, 5, 7)
    hold(p, phi=math.pi / 2 - 0.3 * e)
    lift(p, 3, 0.35 * e, 0.0, 0.0)
    lift(p, 0, 0.45 * e, -0.15 * e, 0.1 * e)        # the lunge
    return p


def dip_follow(t, T=4.0):
    """She drops back over his arm, her free arm flung up and back, a leg up."""
    p = Pose()
    b = beats(t)
    e = env(b, 1, 3, 5, 7)
    hold(p, phi=math.pi / 2 + 0.5 * e, hop=-0.6 * e, frame=1 - 0.5 * e)
    raise_(p, 1, 1, 1.0 * e)
    raise_(p, 1, 2, 0.4 * e)
    lift(p, 4, 0.9 * e, 0.2 * e, 0.2 * e)            # the leg up
    sway(p, HEAD, 3, 0.25 * e)
    return p


def lift_lead(t, T=8.0):
    """The lift: he takes her weight and raises her overhead, holds, sets her down."""
    p = Pose()
    b = beats(t)
    up = env(b, 2, 4, 12, 14)
    hold(p, frame=1 - up, hop=-0.8 * up)
    wobble = 0.04 * math.sin(math.pi * b) * up
    for n in ARMS:
        raise_(p, n, 1, 1.15 * up + wobble)
        raise_(p, n, 2, 0.2 * up)
    for n in LEGS:
        raise_(p, n, 1, 0.16 * up)                   # a wide, braced stance
    body_turn(p, 'x', 0.06 * up)
    return p


def lift_fly(t, T=8.0):
    """…and she flies: high over him, arms spread wide, legs together, a star in the sky."""
    p = Pose()
    b = beats(t)
    up = env(b, 2, 4, 12, 14)
    glide = 0.8 * math.sin(math.pi * (b - 4) / 4) * env(b, 4, 5, 11, 12)
    hold(p, frame=1 - up, hop=LIFT_HEIGHT * up + glide)
    for n in ARMS:
        raise_(p, n, 1, 0.45 * up)
        lift(p, n, -0.25 * up, 0.0, 0.0)
    for n in LEGS:
        raise_(p, n, 1, -0.18 * up)                  # legs together, pointed
        lift(p, n, -0.12 * up, 0.0, 0.25 * up)
    body_turn(p, 'x', -0.18 * up)                    # leaning out over the room
    sway(p, HEAD, 1, 0.0)
    return p


PARTNERS = [('mambo', mambo, 4), ('sway', sway_close, 4), ('lead_twirl', lead_twirl, 4), ('twirl', twirl, 4),
            ('dip_lead', dip_lead, 8), ('dip_follow', dip_follow, 8), ('lift_lead', lift_lead, 16), ('lift_fly', lift_fly, 16)]

CLIPS = [('crawl', crawl, 2.0), ('idle', idle, 4.0), ('wave', wave, 3.0), ('stand', stand, 4.6), ('curl', curl, 3.0),
         ('rise', rise, 1.2), ('standing', standing, 4.0), ('walk', walk, 1.0),
         *[(name, fn, 4 * BEAT) for name, fn in DANCES],
         *[(name, fn, n * BEAT) for name, fn, n in PARTNERS]]
LOOPS = ('crawl', 'idle', 'standing', 'walk', *[name for name, _ in DANCES], *[name for name, _, _ in PARTNERS])


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
        clips = bake(rig, 'starfish', CLIPS, apply_pose, LOOPS, keyed)
        out = export(rig, out_path('starfish'), {'mqStride': STRIDE, 'mqWalkStride': WALK_STRIDE, 'mqFeet': TIP_FRONT})
        return {'faces_per_bone': counts, 'bones': len(rig.data.bones), 'clips': clips, 'out': out,
                'bytes': os.path.getsize(out)}


if __name__ == '__main__':
    result = main()
    print(result)
