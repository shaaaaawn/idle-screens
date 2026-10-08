"""
Rig and animate the betafish: breeds/source/betafish.glb in,
breeds/rig/betafish.glb out.

    blender -b -P breeds/rig/betafish.py        (from packages/saver-metaquarium)

The source is the MINTED breed's one model (breeds/minted.mjs), cut into paint
regions MINT-R<n>: all 256 betafish tokens are this model, each painted by
its own texture atlas through the model's UVs — so the UVs are kept, and the
model is never edited. It arrives with an authored four-bone skin and a
Swim clip (a tail wag); both go — this rig replaces them — and with a
hidden icosphere inside the body (never seen; dropped).

Facing. The delivered fish swims along +X; every rig faces -Y (glTF +Z), so
the meshes are turned a quarter turn about Z first — rigid, the whole model.

The lattice, after the turn: 2-unit voxels, a cell iy spanning y 2iy+1.75 ..
(x: 2ix+0.62, z: 2iz+1.93 ..). The centre line is x = -0.38; its left is +X.
Read off the occupancy (nose -Y):

    face     a plate at y -10.25 .. -8.25 (the mouth), x -3.4 .. 2.6
    body     a round block, y -8.25 .. 7.75, x -7.38 .. 6.62, z -6 .. 6
    dorsal   a one-cell fin on the centre line, y -4.25 .. 3.75, z 6 .. 10
    caudal   the fan: a one-cell sheet on the centre line from the peduncle
             (y 7.75 .. 9.75, z -2 .. 2) out to y 17.75, z -6 .. 10, jagged
    pectoral a plate off each flank (x beyond the walls), y -6.25 .. -0.25,
             z -2 .. 4
    ventral  a long fin off each flank, sweeping back and down, y 1.75 ..
             9.75, z -6 .. 0
    gills    the body's outer walls at the front: the gill covers

Soft throughout (common.soften): every vertex's weights come from where it
lies, so the skin bends and never cracks. The spine (head, body, rear,
peduncle) blends along y. The caudal fan is three RAYS (upper, middle,
lower), weighted by angle about the peduncle, each a chain of two weighted
by distance out — so the tail fans, folds, billows and whips like silk. The
dorsal is two bones up its height; each ventral two along its length; each
pectoral one; each gill cover one, pivoting at its front edge so it flares
open — the betta's display.

Bones only a dial or a moment moves (non-deforming, exported as nodes so
each layers on its own — common.export layered):

    roll                 the whole fish: spins, gulps at the surface, bows
    lookY, lookP         the head's yaw and pitch: the look dials
    flexR, flexP         above the rear and the peduncle: the bend dial
    sU, sL, sD, gR, gL   above the upper and lower rays, the dorsal, the
                         gills: the spread dial (fins open, gills ajar)

Clips (30 fps; the tank sets their times and weights, never update(dt)):

    swim     1.6 s loop: a wave down the body into the fan, the rays
             following one after another, the pectorals beating twice
    hover    3 s loop: the pectorals sculling, the fins billowing slow
    burst    0.8 s loop: hard strokes, the fins laid back
    moments  one-shots from rest to rest (src/beta.ts gives every fish a
             temperament and a favourite): flare, spin, gulp, shimmy, rest,
             dance, flick, bow, billow, curl
    bend, lookYaw, lookPitch, spread
             DIALS, 2 s each: the time is the setting — 0 one way, 1 at
             rest, 2 the other (bend + to its left, lookYaw + to its left,
             lookPitch + nose up, spread + fins open)
"""
import math
import os
import sys

import bpy
from mathutils import Matrix

sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (  # noqa: E402
    Pose, apply_pose, bake, begin, blend, build_armature, ease, env, export, hat, in_scene, knots, lattice,
    load_source, out_path, segment, soften, track,
)

BREED = 'betafish'
PITCH = 2.0
CX = -0.38  # the centre line
MID = -0.04  # the body's middle height
WALL_R, WALL_L = -7.38, 6.62  # the flanks
SPINE = ((-5.0, 'head'), (-1.5, 'body'), (2.5, 'body'), (6.0, 'rear'), (8.75, 'ped'))
FAN_FROM = 9.75  # the fan starts beyond the peduncle
PIVOT = (9.75, -1.0)  # the fan's root (y, z): its rays radiate from here
RAYS = ((-30.0, 'cL'), (0.0, 'cM'), (35.0, 'cU'))  # by angle above the fish's axis, degrees
RAY_LEN = 5.0  # each ray: inner bone to here, outer beyond
DORSAL_BASE = 5.93
SIDE = ((-0.25, 'pec'), (1.75, 'ven1'), (4.0, 'ven1'), (8.0, 'ven2'))  # along a flank, by y


def weights_at(co, eye):
    x, y, z = co.x, co.y, co.z
    w = knots(y, SPINE)
    # The fan: by angle about its root (which ray) and distance out (which segment).
    if y > FAN_FROM - 0.5:
        a = math.degrees(math.atan2(z - PIVOT[1], y - PIVOT[0]))
        r = math.hypot(y - PIVOT[0], z - PIVOT[1])
        ray = hat(a, [c for c, _ in RAYS], [n for _, n in RAYS])
        seg = hat(r, [RAY_LEN * 0.6, RAY_LEN * 1.4], ['1', '2'])
        fan = {f'{rn}{sn}': rv * sv for rn, rv in ray.items() for sn, sv in seg.items() if rv * sv > 1e-4}
        w = blend(w, fan, ease((y - FAN_FROM) / 2))
    # The dorsal: what stands above the body, two bones up its height — and
    # only over the body (the fan's upper ray rises as high, behind it).
    if z > DORSAL_BASE and y < FAN_FROM - 3:
        w = blend(w, knots(z, ((7.0, 'd1'), (9.0, 'd2'))), ease((z - DORSAL_BASE) / 2))
    # The gill covers: the outer walls at the front, pivoting at the face.
    off = abs(x - CX)
    if off > 5.0 and y < -1.5:
        side = 'gillR' if x < CX else 'gillL'
        w = blend(w, {side: 1.0}, ease((off - 5.0) / 2) * (1 - ease((y + 3.5) / 2)))
    # The flank fins: beyond the walls, pectoral ahead and ventral behind.
    if x < WALL_R or x > WALL_L:
        s = 'R' if x < CX else 'L'
        f = ease((WALL_R - x) / 2) if s == 'R' else ease((x - WALL_L) / 2)
        w = blend(w, {f'{k}{s}': v for k, v in knots(y, SIDE).items()}, f)
    return w


def bone_of(x, y, z, mat):
    """Only to start the vertex groups (weights_at decides)."""
    return '_part'


def bone_table():
    up = lambda p, d=0.5: (p[0], p[1], p[2] + d)  # noqa: E731 — a stub bone above a point
    neck = (CX, -2.5, MID)
    t = {
        'root': ((CX, 0, -30), (CX, 0, -27), None),
        'roll': ((CX, 0, MID), (CX, 0.5, MID), 'root'),
        'body': ((CX, -1.5, MID), (CX, 2.5, MID), 'roll'),
        'lookY': (neck, up(neck), 'body'),
        'lookP': (neck, up(neck), 'lookY'),
        'head': (neck, (CX, -10.25, MID), 'lookP'),
        'flexR': ((CX, 2.5, MID), up((CX, 2.5, MID)), 'body'),
        'rear': ((CX, 2.5, MID), (CX, 7.0, MID), 'flexR'),
        'flexP': ((CX, 7.0, -1.0), up((CX, 7.0, -1.0)), 'rear'),
        'ped': ((CX, 7.0, -1.0), (CX, FAN_FROM, -1.0), 'flexP'),
        'sD': ((CX, -1.0, DORSAL_BASE), up((CX, -1.0, DORSAL_BASE)), 'body'),
        'd1': ((CX, -1.0, DORSAL_BASE), (CX, 0.0, 8.0), 'sD'),
        'd2': ((CX, 0.0, 8.0), (CX, 1.0, 10.0), 'd1'),
    }
    py, pz = PIVOT
    for angle, ray in RAYS:
        c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
        p0, p1, p2 = (CX, py, pz), (CX, py + RAY_LEN * c, pz + RAY_LEN * s), (CX, py + 2 * RAY_LEN * c, pz + 2 * RAY_LEN * s)
        parent = 'ped'
        if ray != 'cM':
            spread = 'sU' if ray == 'cU' else 'sL'
            t[spread] = (p0, (p0[0], p0[1] + 0.5, p0[2]), 'ped')
            parent = spread
        t[f'{ray}1'] = (p0, p1, parent)
        t[f'{ray}2'] = (p1, p2, f'{ray}1')
    for s, wall in (('R', WALL_R), ('L', WALL_L)):
        out = -2.0 if s == 'R' else 2.0
        t[f'g{s}'] = ((wall, -8.25, MID), up((wall, -8.25, MID)), 'head')
        t[f'gill{s}'] = ((wall, -8.25, MID), (wall, -3.0, MID), f'g{s}')
        t[f'pec{s}'] = ((wall, -6.25, 1.0), (wall, -0.25, 1.0), 'body')
        t[f'ven1{s}'] = ((wall, 2.75, -1.0), (wall + out / 2, 6.75, -4.0), 'body')
        t[f'ven2{s}'] = ((wall + out / 2, 6.75, -4.0), (wall + out / 2, 9.75, -5.0), f'ven1{s}')
    return t


NONDEFORM = ('root', 'roll', 'lookY', 'lookP', 'flexR', 'flexP', 'sU', 'sL', 'sD', 'gR', 'gL')


# --------------------------------------------------------------------------
# Posing. Signs (rotations about world axes at rest, each relative to its
# parent, so a chain's turns accumulate):
#   about Z: + swings a part behind its pivot to the fish's RIGHT (-X) — so
#            the tail swinging + bends the fish to its left; + turns the head
#            to its left
#   about X: + lifts a part behind its pivot (the fan's upper ray opens
#            up); + dips the nose
#   about Y: + rolls a part above its pivot to its left (+X)
# --------------------------------------------------------------------------

BACK = ('body', 'rear', 'ped')
RAY_LAG = {'cU': 0.25, 'cM': 0.0, 'cL': 0.35}  # the upper and lower rays a little behind the middle


def wave(p, w, amps, lag=0.7):
    """A travelling wave down the body."""
    for i, (b, a) in enumerate(zip(BACK, amps)):
        p.turn(b, 'z', a * math.sin(w - lag * i))


def fan(p, w, inner, outer, lag=0.7, start=3):
    """The tail fan following the body's wave: each ray's inner bone, then its
    outer, a little later — the silk trailing the stroke."""
    for ray, extra in RAY_LAG.items():
        p.turn(f'{ray}1', 'z', inner * math.sin(w - lag * start - extra))
        p.turn(f'{ray}2', 'z', outer * math.sin(w - lag * (start + 1) - extra))


def spread_fan(p, a):
    """Open (+) or fold (-) the fan: the upper and lower rays part."""
    p.turn('cU1', 'x', 0.6 * a)
    p.turn('cU2', 'x', 0.3 * a)
    p.turn('cL1', 'x', -0.5 * a)
    p.turn('cL2', 'x', -0.25 * a)


def dorsal(p, sway=0.0, raise_=0.0):
    """Sway (+ to its left) and raise (+ upright and forward, - laid back)."""
    p.turn('d1', 'y', sway)
    p.turn('d2', 'y', 1.4 * sway)
    p.turn('d1', 'x', 0.3 * raise_)
    p.turn('d2', 'x', 0.2 * raise_)


def pecs(p, beat=0.0, sweep=0.0):
    """Both pectorals — plates along the flanks, hinged at their front edge
    like doors: beat and sweep both swing the rear edge out (+)."""
    p.turn('pecR', 'z', beat + sweep)
    p.turn('pecL', 'z', -(beat + sweep))


def ventrals(p, sway=0.0, spread=0.0, lag=0.6):
    """The long ventral fins: sway (both alike, + to its left) and spread (+ out)."""
    for s, sg in (('R', 1), ('L', -1)):
        p.turn(f'ven1{s}', 'z', -sway)
        p.turn(f'ven2{s}', 'z', -1.4 * sway)
        p.turn(f'ven1{s}', 'y', sg * spread)


def gills(p, a):
    """The gill covers open (+): each rear edge swings out."""
    p.turn('gillR', 'z', a)
    p.turn('gillL', 'z', -a)


def swim(t, T=1.6):
    p = Pose()
    w = 2 * math.pi * t / T
    wave(p, w, (0.03, 0.08, 0.1))
    fan(p, w, 0.12, 0.15)
    dorsal(p, sway=0.08 * math.sin(w - 1.2))
    pecs(p, beat=0.17 * math.sin(2 * w))
    ventrals(p, sway=0.12 * math.sin(w - 1.6))
    p.turn('head', 'z', -0.02 * math.sin(w))
    return p


def hover(t, T=3.0):
    p = Pose()
    w = 2 * math.pi * t / T
    pecs(p, beat=0.16 * math.sin(4 * w), sweep=0.08)
    wave(p, w, (0.0, 0.02, 0.04))
    fan(p, w, 0.06, 0.12, lag=0.9)
    spread_fan(p, 0.08 * math.sin(w + 1.0))
    dorsal(p, sway=0.06 * math.sin(w - 0.8), raise_=0.1 * math.sin(w))
    ventrals(p, sway=0.1 * math.sin(w - 1.4), spread=0.05 * math.sin(w))
    gills(p, 0.03 * (1 + math.sin(w)))
    return p


def burst(t, T=0.8):
    p = Pose()
    w = 2 * math.pi * t / T
    wave(p, w, (0.04, 0.12, 0.16), lag=0.8)
    fan(p, w, 0.2, 0.22, lag=0.8)
    spread_fan(p, -0.3)
    dorsal(p, raise_=-0.6, sway=0.05 * math.sin(w - 1))
    pecs(p, beat=-0.25, sweep=-0.1)
    ventrals(p, sway=0.08 * math.sin(w - 1.6), spread=-0.15)
    return p


# --- moments -------------------------------------------------------------

def flare(t, T=4.2):
    """The display: gill covers thrown open, every fin spread wide, the body
    arched, a quiver running through it — a betta squaring up."""
    p = Pose()
    a = env(t, 0.0, 0.9, T - 1.1, T)
    quiver = math.sin(2 * math.pi * t / 0.6) * env(t, 0.8, 1.2, T - 1.6, T - 1.1)
    gills(p, 0.5 * a)
    spread_fan(p, 0.55 * a)
    fan(p, 2 * math.pi * t / 1.2, 0.04 * a, 0.06 * a)
    dorsal(p, raise_=0.6 * a, sway=0.03 * quiver)
    ventrals(p, spread=0.35 * a, sway=0.04 * quiver)
    pecs(p, sweep=0.25 * a, beat=0.08 * quiver)
    p.turn('rear', 'z', 0.1 * a)
    p.turn('ped', 'z', 0.12 * a)
    p.turn('head', 'x', -0.1 * a)
    return p


def spin(t, T=4.4):
    """A slow turn about in place, the fins trailing round after it."""
    p = Pose()
    u = ease((t - 0.5) / (T - 1.0))
    p.turn('roll', 'z', 2 * math.pi * u)
    speed = math.sin(math.pi * min(1.0, max(0.0, (t - 0.5) / (T - 1.0))))  # 0 at the ends, 1 at the fastest
    p.turn('ped', 'z', 0.15 * speed)
    for ray in ('cU', 'cM', 'cL'):
        p.turn(f'{ray}1', 'z', 0.15 * speed)
        p.turn(f'{ray}2', 'z', 0.2 * speed)
    ventrals(p, sway=0.2 * speed)
    dorsal(p, sway=-0.12 * speed)
    pecs(p, beat=0.15 * speed)
    return p


def gulp(t, T=3.8):
    """Up to the surface for air: nose up, two gulps, and back down."""
    p = Pose()
    up = env(t, 0.0, 1.0, T - 1.2, T)
    gulps = sum(math.sin(math.pi * (t - a) / 0.6) ** 2 for a in (1.3, 2.0) if a <= t <= a + 0.6)
    p.turn('roll', 'x', -0.55 * up)
    p.turn('head', 'x', 0.08 * gulps)
    gills(p, 0.1 * gulps)
    pecs(p, beat=0.18 * up * math.sin(2 * math.pi * t / 0.76))
    fan(p, 2 * math.pi * t / 1.9, 0.08 * up, 0.1 * up)
    spread_fan(p, -0.15 * up)
    return p


def shimmy(t, T=2.6):
    """A quick side-to-side shimmy, fins flicking."""
    p = Pose()
    on = env(t, 0.0, 0.5, T - 0.6, T)
    s = math.sin(2 * math.pi * (t - 0.2) / 0.75)
    p.turn('roll', 'y', 0.12 * on * s)
    wave(p, 2 * math.pi * (t - 0.2) / 0.75, (0.0, 0.05 * on, 0.08 * on))
    ventrals(p, sway=0.06 * on * s)
    dorsal(p, sway=-0.08 * on * s)
    return p


def rest(t, T=6.0):
    """It settles: fins droop, the body tips, the gills breathe slowly."""
    p = Pose()
    a = env(t, 0.0, 1.6, T - 1.6, T)
    breathe = math.sin(2 * math.pi * t / 2.0)
    dorsal(p, raise_=-0.5 * a)
    spread_fan(p, -0.25 * a)
    for ray in ('cU', 'cM', 'cL'):
        p.turn(f'{ray}2', 'x', -0.2 * a)  # the fan's ends sag
    ventrals(p, spread=-0.1 * a)
    p.turn('ven2R', 'x', -0.2 * a)
    p.turn('ven2L', 'x', -0.2 * a)
    p.turn('roll', 'y', 0.12 * a)
    p.turn('roll', 'x', 0.08 * a)
    gills(p, 0.05 * a * (1 + breathe))
    pecs(p, beat=0.06 * a * breathe)
    return p


def dance(t, T=5.0):
    """An S-curve sway, the fan billowing round it."""
    p = Pose()
    on = env(t, 0.0, 1.0, T - 1.0, T)
    s = math.sin(2 * math.pi * (t - 0.5) / 2.5)
    p.turn('body', 'z', 0.08 * on * s)
    p.turn('rear', 'z', -0.2 * on * s)
    p.turn('ped', 'z', 0.2 * on * s)
    fan(p, 2 * math.pi * (t - 0.5) / 2.5, 0.12 * on, 0.18 * on)
    spread_fan(p, 0.25 * on)
    dorsal(p, sway=0.1 * on * s, raise_=0.3 * on)
    ventrals(p, sway=-0.15 * on * s, spread=0.15 * on)
    p.turn('head', 'z', -0.08 * on * s)
    return p


def flick(t, T=2.4):
    """A sharp tail flick to one side and back, the fan whipping after."""
    p = Pose()
    swing = env(t, 0.3, 0.75, 1.0, 1.7)
    whip = env(t, 0.45, 0.95, 1.15, 1.95)
    p.turn('rear', 'z', 0.15 * swing)
    p.turn('ped', 'z', 0.25 * swing)
    for ray in ('cU', 'cM', 'cL'):
        p.turn(f'{ray}1', 'z', 0.2 * whip)
        p.turn(f'{ray}2', 'z', 0.3 * env(t, 0.6, 1.1, 1.3, 2.1))
    ventrals(p, sway=0.12 * whip)
    return p


def bow(t, T=3.6):
    """A headstand dip: nose down, the fan raised and spread."""
    p = Pose()
    a = env(t, 0.0, 1.1, T - 1.2, T)
    p.turn('roll', 'x', 0.5 * a)
    spread_fan(p, 0.35 * a)
    dorsal(p, raise_=0.3 * a)
    pecs(p, beat=0.2 * a * math.sin(2 * math.pi * t / 0.9))
    ventrals(p, spread=0.2 * a)
    return p


def billow(t, T=4.0):
    """The fins let go and billow like silk — slow waves through all of them."""
    p = Pose()
    on = env(t, 0.0, 1.0, T - 1.0, T)
    w = 2 * math.pi * t / 2.0
    for i, ray in enumerate(('cU', 'cM', 'cL')):
        p.turn(f'{ray}1', 'x', 0.1 * on * math.sin(w - 0.6 * i))
        p.turn(f'{ray}2', 'x', 0.18 * on * math.sin(w - 0.6 * i - 0.8))
    fan(p, w, 0.08 * on, 0.14 * on, lag=0.9)
    dorsal(p, sway=0.15 * on * math.sin(w - 0.5), raise_=0.15 * on)
    ventrals(p, sway=0.2 * on * math.sin(w - 1.0), spread=0.12 * on * math.sin(w))
    pecs(p, beat=0.1 * on * math.sin(2 * w))
    return p


def curl(t, T=4.0):
    """The body curls into a C, fins spread — a betta's sidelong flare."""
    p = Pose()
    a = env(t, 0.0, 1.2, T - 1.2, T)
    p.turn('body', 'z', 0.12 * a)
    p.turn('rear', 'z', 0.28 * a)
    p.turn('ped', 'z', 0.28 * a)
    for ray in ('cU', 'cM', 'cL'):
        p.turn(f'{ray}1', 'z', 0.2 * a)
    p.turn('head', 'z', -0.25 * a)
    spread_fan(p, 0.4 * a)
    dorsal(p, raise_=0.4 * a)
    gills(p, 0.2 * a)
    ventrals(p, spread=0.2 * a)
    return p


# --- dials ---------------------------------------------------------------

def bend(t, T=2.0):
    p = Pose()
    u = t - 1
    # + to its left: a C round the turn, the tail swinging LEFT (about Z, -).
    p.turn('flexR', 'z', -0.25 * u)
    p.turn('flexP', 'z', -0.3 * u)
    return p


def look_yaw(t, T=2.0):
    p = Pose()
    p.turn('lookY', 'z', 0.4 * (t - 1))
    return p


def look_pitch(t, T=2.0):
    p = Pose()
    p.turn('lookP', 'x', -0.25 * (t - 1))
    return p


def spread(t, T=2.0):
    """+: the fan opens, the dorsal stands up, the gills come ajar. -: all laid back."""
    p = Pose()
    u = t - 1
    p.turn('sU', 'x', 0.35 * u)
    p.turn('sL', 'x', -0.3 * u)
    p.turn('sD', 'x', 0.3 * u)
    p.turn('gR', 'z', 0.06 * u)
    p.turn('gL', 'z', -0.06 * u)
    return p


CLIPS = [
    ('swim', swim, 1.6), ('hover', hover, 3.0), ('burst', burst, 0.8),
    ('flare', flare, 4.2), ('spin', spin, 4.4), ('gulp', gulp, 3.8), ('shimmy', shimmy, 2.6), ('rest', rest, 6.0),
    ('dance', dance, 5.0), ('flick', flick, 2.4), ('bow', bow, 3.6), ('billow', billow, 4.0), ('curl', curl, 4.0),
    ('bend', bend, 2.0), ('lookYaw', look_yaw, 2.0), ('lookPitch', look_pitch, 2.0), ('spread', spread, 2.0),
]


def strip(meshes):
    """The authored skin goes (this rig replaces it), and the icosphere hidden
    inside the body (no material; never seen — Blender's stand-in for a bone
    shape). Blender also sets a skinned mesh down at its armature's offset
    (0.03 up): a skin's mesh node does not place it, so that comes back off."""
    arms = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    shift = Matrix.Translation(-arms[0].matrix_world.translation) if arms else Matrix.Identity(4)
    keep = []
    for o in meshes:
        if not o.data.materials:
            bpy.data.objects.remove(o, do_unlink=True)
            continue
        for m in list(o.modifiers):
            o.modifiers.remove(m)
        o.vertex_groups.clear()
        o.data.transform(shift)
        keep.append(o)
    for a in arms:
        bpy.data.objects.remove(a, do_unlink=True)
    return keep


def main():
    scene = bpy.data.scenes.get(BREED) or bpy.data.scenes.new(BREED)
    with in_scene(scene):
        begin(BREED)
        meshes = strip(load_source(BREED))
        turn = Matrix.Rotation(-math.pi / 2, 4, 'Z')
        for o in meshes:
            o.data.transform(turn)
        pitch, phase = lattice(meshes)
        assert pitch == PITCH, (pitch, phase)
        print('LATTICE', phase)
        segment(meshes, bone_of, pitch, phase, by_point=True)
        blended = soften(meshes, weights_at)
        rig = build_armature('Betafish', meshes, bone_table(), nondeform=NONDEFORM)
        keyed = {pb.name: ['rotation_quaternion'] for pb in rig.pose.bones if pb.name != 'root'}
        clips = bake(rig, BREED, CLIPS, apply_pose, ('swim', 'hover', 'burst'), keyed)
        out = export(rig, out_path(BREED), {}, layered=True, uv=True)
        return {'blended_vertices': blended, 'bones': len(rig.data.bones), 'clips': clips, 'out': out,
                'bytes': os.path.getsize(out)}


if __name__ == '__main__':
    result = main()
    print(result)
