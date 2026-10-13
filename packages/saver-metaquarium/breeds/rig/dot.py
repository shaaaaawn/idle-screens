"""
Rig and animate Dot, Geode Hollow's courier: breeds/source/dot.glb in,
breeds/rig/dot.glb out. EXPERIMENTAL — the first character, a full one: legs,
arms, a torso that bends at the hips, a cap and antenna that follow through.

    blender -b -P breeds/rig/dot.py        (from packages/saver-metaquarium)

The model is drawn by rig/dot-model.mjs and, like every breed, never edited:
every face weighted 1.0 to one rigid part. It stands on z = 0, faces -Y, its
left +X; voxel centres sit at (2i, 2j, 2k + 1). Its face is not animated here:
the screen is a display the tank draws (src/screen.ts, src/dot.ts).

    pelvis        the hips (no faces of its own): it bobs, sways and turns; the
                  legs hang from it, so the torso can bow without the legs
    body          the box — screen, bezel, shorts — hinged at the hips
    cap           hinged at the crown's back edge: it lifts and tips
    antenna.1/2   the stalk and its glowing bulb, following through
    arm.X.1/2     shoulder (the sleeve) and elbow, each arm a column
    hand.X        the glove, at the wrist
    leg.X.1/2     hip to knee, knee to ankle, posed by two-bone IK
    foot.X        the sneaker, kept flat on the floor (or toeing off)
    bag           the mailbag on its back, hung from its top: it bounces
    tail          the little fish tail, wagging

Every bone points up (+Z). The legs are posed by IK (`legs`): a clip says
where each ankle is, and the thigh, shin and foot angles that put it there
are solved, so a planted foot stays planted while the hips move over it.

Clips, 30 fps. The names that match a vignette gesture (src/vignette.ts) are
what Dot plays when a script asks for it, so a scene uses Dot's own moves.

    idle     4 s loop    weight shifting, breathing, the antenna swaying
    walk     1 s loop    two steps, feet planted, arms swinging; `mqStride`
    run      0.6 s loop  a run, a flight phase, arms pumping; `mqRunStride`
    talk     1 s loop    talking with its hands
    nod      1 s loop    yes, from the hips
    shake    1.2 s loop  no, the whole box turning
    hop      0.8 s loop  a jump on the spot: crouch, up, land
    wiggle   1 s loop    a dance shimmy, hips and arms
    wave     1.2 s loop  its left arm up, the hand waving
    cheer    1 s loop    both arms up, pumping, bouncing on its knees
    rest     3 s loop    sat on the floor, legs out, breathing slow
    spin     1.6 s       a full turn, arms out, the cap lifting with joy
    peek     3 s         a think: hand to chin, head tilted — then the idea:
                         a finger up and a little hop
    bow      2 s         the cap tipped with its left hand, a bow from the hips
    deliver  2.8 s       a hand over its shoulder into the bag, and a letter held out
    point    2 s         its left arm points ahead
    glitch   0.8 s       a shiver (its screen tears, src/dot.ts)
    skid     1.2 s       a braking stop: sliding, leaning back, arms windmilling
    clap     0.5 s loop  clapping, bouncing on its knees
    shrug    1.6 s       arms out, palms up
    facepalm 2.4 s       a glove to its screen, a slow shake
    laugh    1 s loop    holding its belly, rocking back
    salute   2 s         a hand snapped to the cap's brim
    search   3 s         a hand shading its screen, peering left and right
    stretch  3 s         up on its toes, arms high
    jump     1.4 s       jump for joy: heels kicked up behind, arms flung high
    trip     2.4 s       a stumble, arms windmilling, a hop to catch itself, a sheepish hand to its head
    sneak    1.4 s loop  tiptoeing, crouched, hands up; `mqSneakStride`
    dance    2 s loop    the twist

Nothing goes under the floor: the leg IK lifts an ankle so no sole dips
below z = 0 whatever the foot's pitch, and the build checks every clip's
every frame (`floor_check`).

The one-shots start and end on the rest pose; the loops start where they end.
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
)

ORANGE, NAVY, BLUE, YELLOW, TAN, WHITE, RED = (
    'PAINT-#ff8a2a', 'PAINT-#20243a', 'PAINT-#2f6bff', 'PAINT-#ffc94a', 'PAINT-#b07a3a', 'PAINT-#f4f1e8', 'PAINT-#e0373b')
BULB = 'GLOW-Antenna'

HIP_Z = 12.0      # the top of the thighs, the bottom of the box
KNEE_Z = 8.0
ANKLE_Z = 2.0
TOE = 5.0         # ankle to the sneaker's toe, along the floor
HEEL = 1.0        # ankle to its heel
SOLE = 2.0        # ankle above its sole
THIGH = HIP_Z - KNEE_Z
SHIN = KNEE_Z - ANKLE_Z
LEG_X = 4.0
WALK_STRIDE = 11.0   # model units per walk cycle (two steps)
RUN_STRIDE = 18.0
SNEAK_STRIDE = 8.0
TAU = 2 * math.pi


def bone_of(x, y, z, mat):
    side = 'L' if x > 0 else 'R'
    if mat == BULB:
        return 'antenna.2'
    if mat == NAVY and z > 31:
        return 'antenna.1'
    if z > 27:
        return 'cap'
    if abs(x) > 6.5:
        return f'arm.{side}.1' if z > 22 else f'arm.{side}.2' if z > 18 else f'hand.{side}'
    if y > 4.5:
        return 'tail' if mat == YELLOW else 'bag'
    if z < HIP_Z:
        return f'leg.{side}.1' if z > KNEE_Z else f'leg.{side}.2' if z > ANKLE_Z else f'foot.{side}'
    return 'body'


def bone_table():
    t = {
        'root': ((0, 0, -3), (0, 0, -1), None),
        'pelvis': ((0, 0, HIP_Z), (0, 0, HIP_Z + 2), 'root'),
        'body': ((0, 0, HIP_Z), (0, 0, HIP_Z + 4), 'pelvis'),
        'cap': ((0, 5, 28), (0, 5, 30), 'body'),
        'antenna.1': ((2, 2, 32), (2, 2, 34), 'cap'),
        'antenna.2': ((2, 2, 36), (2, 2, 38), 'antenna.1'),
        'bag': ((0, 5, 24), (0, 5, 26), 'body'),
        'tail': ((0, 5, 13), (0, 5, 15), 'body'),
    }
    for side, s in (('L', 1), ('R', -1)):
        t[f'arm.{side}.1'] = ((8 * s, 0, 28), (8 * s, 0, 30), 'body')
        t[f'arm.{side}.2'] = ((8 * s, 0, 22), (8 * s, 0, 24), f'arm.{side}.1')
        t[f'hand.{side}'] = ((8 * s, 0, 18), (8 * s, 0, 20), f'arm.{side}.2')
        t[f'leg.{side}.1'] = ((LEG_X * s, 0, HIP_Z), (LEG_X * s, 0, HIP_Z + 2), 'pelvis')
        t[f'leg.{side}.2'] = ((LEG_X * s, 0, KNEE_Z), (LEG_X * s, 0, KNEE_Z + 2), f'leg.{side}.1')
        t[f'foot.{side}'] = ((LEG_X * s, 0, ANKLE_Z), (LEG_X * s, 0, ANKLE_Z + 2), f'leg.{side}.2')
    return t


SIDES = (('L', 1), ('R', -1))


def bell(u):
    return math.sin(math.pi * min(1.0, max(0.0, u)))


def ease(u):
    u = min(1.0, max(0.0, u))
    return u * u * (3 - 2 * u)


# --------------------------------------------------------------------------
# Posing helpers, in the character's own terms
# --------------------------------------------------------------------------

def arm(p, side, out=0.0, fwd=0.0, twist=0.0, elbow=0.0, wrist=0.0):
    """An arm from the shoulder: `out` raises it sideways, `fwd` raises it
    forward (radians; 1.57 is level), `twist` turns it about its own length;
    `elbow` bends the forearm forward and up, `wrist` cocks the hand."""
    s = 1 if side == 'L' else -1
    q = Quaternion((0, 0, 1), s * twist) if twist else Quaternion()
    q = Quaternion((1, 0, 0), -fwd) @ q if fwd else q
    q = Quaternion((0, 1, 0), -s * out) @ q if out else q
    p.rot[f'arm.{side}.1'] = q @ p.rot.get(f'arm.{side}.1', Quaternion())
    if elbow:
        p.turn(f'arm.{side}.2', 'x', -elbow)
    if wrist:
        p.turn(f'hand.{side}', 'x', -wrist)


def body(p, bow=0.0, lean=0.0, turn=0.0):
    """The torso at the hips: `bow` forward (+), `lean` to its left (+), `turn` to its left (+)."""
    if turn:
        p.turn('body', 'z', turn)
    if bow:
        p.turn('body', 'x', bow)
    if lean:
        p.turn('body', 'y', -lean)


def antenna(p, a1, a2, side=0.0):
    p.turn('antenna.1', 'x', a1)
    p.turn('antenna.2', 'x', a2)
    if side:
        p.turn('antenna.1', 'y', side)
        p.turn('antenna.2', 'y', 1.4 * side)


def legs(p, hip=(0.0, 0.0, 0.0), feet=None, toe=None):
    """Pose both legs by two-bone IK. `hip`: the pelvis's offset (x, y, z) from
    rest; `feet`: per side the ankle's target (y, z) in the rest frame (a
    planted foot at rest is (0, ANKLE_Z)); `toe`: per side the foot's pitch
    (+ toes up, a heel strike; - toes down, the heel lifting to push off).
    The legs swing in their own plane (the y-z plane at their x), the knees
    bending forward; no sole ever goes under the floor (the ankle rises)."""
    feet = feet or {}
    toe = toe or {}
    p.move('pelvis', hip)
    for side, _ in SIDES:
        ay, az = feet.get(side, (0.0, ANKLE_Z))
        # The floor: whatever the foot's pitch, its sole never goes under z = 0 —
        # a heel lifted for a push-off rolls over the toe, it does not sink it.
        psi = -toe.get(side, 0.0)
        low = min(y * math.sin(psi) - SOLE * math.cos(psi) for y in (-TOE, HEEL))
        az = max(az, -low)
        hy, hz = hip[1], HIP_Z + hip[2]
        dy, dz = ay - hy, az - hz
        d = math.hypot(dy, dz)
        d = min(d, THIGH + SHIN - 1e-3)
        # The direction to the ankle, as a rotation of a leg hanging straight down (+ swings it back).
        phi = math.atan2(dy, -dz)
        # The thigh turns forward of that line by the knee's half of the triangle.
        alpha = math.acos(max(-1.0, min(1.0, (THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d))))
        a1 = phi - alpha
        ky, kz = hy + THIGH * math.sin(a1), hz - THIGH * math.cos(a1)
        a_shin = math.atan2(ay - ky, -(az - kz))
        a2 = a_shin - a1
        p.turn(f'leg.{side}.1', 'x', a1)
        p.turn(f'leg.{side}.2', 'x', a2)
        # The foot level with the floor, then its own pitch.
        p.turn(f'foot.{side}', 'x', -(a1 + a2) - toe.get(side, 0.0))


def stand(p, dip=0.4):
    """Both feet planted under the hips, the knees soft."""
    legs(p, (0, 0, -dip))


# --------------------------------------------------------------------------
# Clips
# --------------------------------------------------------------------------

def idle(t, T=4.0):
    p = Pose()
    w = TAU * t / T
    shift = 0.35 * math.sin(w)
    legs(p, (shift, 0, -0.45 + 0.12 * math.sin(2 * w)))
    body(p, lean=-0.03 * math.sin(w), bow=0.02 * math.sin(2 * w))
    for side, s in SIDES:
        arm(p, side, out=0.08 + 0.03 * math.sin(2 * w + s), elbow=0.15)
    antenna(p, 0.06 * math.sin(2 * w - 0.6), 0.1 * math.sin(2 * w - 1.2), 0.08 * math.sin(w))
    p.turn('tail', 'z', 0.25 * math.sin(2 * w))
    return p


def gait(t, T, stride, lift, bob, swing, lean, flight=0.0):
    """A walk (flight 0) or a run (flight > 0): each ankle on its stance-swing
    cycle, the hips over them, the arms against the legs."""
    p = Pose()
    u0 = t / T
    feet, toe = {}, {}
    stance = 0.5 - flight / 2
    for side, ph in (('L', 0.0), ('R', 0.5)):
        u = (u0 + ph) % 1.0
        half = stride / 4
        if u < stance:
            # Heel strike (toes up), flat, then the heel lifting to push off.
            s = u / stance
            feet[side] = (-half + s * 2 * half, ANKLE_Z)
            toe[side] = 0.15 * (1 - ease(s / 0.2)) - 0.45 * ease((s - 0.6) / 0.4)
        else:
            # Toes still down as it leaves the floor, up through the swing, ready to strike.
            s = (u - stance) / (1 - stance)
            feet[side] = (half - ease(s) * 2 * half, ANKLE_Z + lift * math.sin(math.pi * s))
            toe[side] = -0.45 * (1 - ease(s / 0.3)) + 0.15 * ease((s - 0.4) / 0.6)
    legs(p, (0.25 * math.sin(TAU * u0), 0, -0.6 + bob * math.cos(2 * TAU * u0)), feet, toe)
    body(p, bow=lean, turn=-0.06 * math.cos(TAU * u0))
    for side, s in SIDES:
        # Each arm against its leg: the left foot leads at the start, so the left arm is back.
        arm(p, side, out=0.1, fwd=-s * swing * math.cos(TAU * u0), elbow=0.35 + 0.6 * (swing > 0.6))
    antenna(p, -0.15 - 0.12 * math.cos(2 * TAU * u0), -0.2 - 0.2 * math.cos(2 * TAU * u0 - 0.6))
    p.turn('bag', 'x', 0.08 * math.cos(2 * TAU * u0))
    p.turn('tail', 'z', 0.3 * math.sin(TAU * u0))
    return p


def walk(t, T=1.0):
    return gait(t, T, WALK_STRIDE, lift=2.2, bob=0.3, swing=0.45, lean=0.05)


def run(t, T=0.6):
    return gait(t, T, RUN_STRIDE, lift=3.6, bob=0.6, swing=0.9, lean=0.18, flight=0.2)


def talk(t, T=1.0):
    p = Pose()
    w = TAU * t / T
    stand(p, 0.4 + 0.25 * (1 - math.cos(2 * w)) / 2)
    body(p, bow=0.04 * math.sin(2 * w), lean=0.03 * math.sin(w))
    arm(p, 'L', out=0.25, fwd=0.5 + 0.25 * math.sin(w), elbow=1.1 + 0.3 * math.sin(w), wrist=0.3)
    arm(p, 'R', out=0.25, fwd=0.5 + 0.25 * math.sin(w + math.pi), elbow=1.1 + 0.3 * math.sin(w + math.pi), wrist=0.3)
    antenna(p, 0.1 * math.sin(2 * w - 0.6), 0.15 * math.sin(2 * w - 1.2))
    return p


def nod(t, T=1.0):
    p = Pose()
    w = TAU * t / T
    stand(p, 0.4)
    body(p, bow=0.16 * math.sin(w))
    for side, _ in SIDES:
        arm(p, side, out=0.08, elbow=0.2)
    antenna(p, 0.25 * math.sin(w - 0.6), 0.3 * math.sin(w - 1.2))
    return p


def shake(t, T=1.2):
    p = Pose()
    w = TAU * t / T
    stand(p, 0.4)
    body(p, turn=0.28 * math.sin(w))
    for side, _ in SIDES:
        arm(p, side, out=0.1, elbow=0.2)
    antenna(p, 0, 0, 0.25 * math.sin(w - 0.8))
    return p


def hop(t, T=0.8):
    p = Pose()
    u = t / T
    # Crouch, spring up, land back into the crouch, settle: the hips' height through the jump.
    if u < 0.2:
        h = -1.8 * ease(u / 0.2)
    elif u < 0.7:
        h = -1.8 + 6.3 * math.sin(math.pi * (u - 0.2) / 0.5)
    else:
        h = -1.8 * (1 - ease((u - 0.7) / 0.3))
    air = max(0.0, h - 0.3)
    legs(p, (0, 0, h), {side: (0.0, ANKLE_Z + 0.75 * air) for side, _ in SIDES}, {side: -0.3 * min(1.0, air / 2) for side, _ in SIDES})
    up = min(1.0, max(0.0, h / 4.5))
    for side, _ in SIDES:
        arm(p, side, out=0.3 + 1.6 * up, elbow=0.4 - 0.3 * up)
    body(p, bow=0.12 * max(0.0, -h) / 1.8)
    antenna(p, -0.4 * up + 0.3 * max(0.0, -h) / 1.8, -0.5 * up + 0.4 * max(0.0, -h) / 1.8)
    return p


def wiggle(t, T=1.0):
    p = Pose()
    w = TAU * t / T
    legs(p, (0.9 * math.sin(w), 0, -0.9 + 0.3 * math.cos(2 * w)))
    body(p, lean=0.12 * math.sin(w), turn=0.15 * math.sin(2 * w))
    for side, s in SIDES:
        arm(p, side, out=0.5 + 0.35 * math.sin(w + (0 if s > 0 else math.pi)), fwd=0.4, elbow=1.3, wrist=0.4)
    antenna(p, 0, 0, 0.3 * math.sin(w - 0.7))
    p.turn('tail', 'z', 0.5 * math.sin(2 * w))
    return p


def wave(t, T=1.2):
    p = Pose()
    w = TAU * t / T
    stand(p, 0.45)
    body(p, lean=-0.06)
    arm(p, 'L', out=2.5, elbow=0.6 + 0.45 * math.sin(w), twist=0.2)
    arm(p, 'R', out=0.1, elbow=0.2)
    antenna(p, 0.1 * math.sin(w - 0.6), 0.15 * math.sin(w - 1.2))
    return p


def cheer(t, T=1.0):
    p = Pose()
    w = TAU * t / T
    stand(p, 0.6 + 0.6 * (1 - math.cos(2 * w)) / 2)
    for side, s in SIDES:
        arm(p, side, out=2.6 + 0.25 * math.sin(2 * w), elbow=0.25 + 0.3 * (1 - math.cos(2 * w)) / 2)
    antenna(p, -0.2 * math.sin(2 * w), -0.3 * math.sin(2 * w - 0.5))
    p.turn('tail', 'z', 0.5 * math.sin(2 * w))
    return p


def rest(t, T=3.0):
    """Sat on the floor, legs out in front, breathing slow."""
    p = Pose()
    w = TAU * t / T
    sit = 8.2
    legs(p, (0, 0.6, -sit), {side: (-5.2, ANKLE_Z) for side, _ in SIDES}, {side: 0.5 for side, _ in SIDES})
    body(p, bow=-0.12 + 0.03 * math.sin(w))
    for side, _ in SIDES:
        arm(p, side, out=0.15, fwd=0.6, elbow=0.4)
    antenna(p, 0.45 + 0.05 * math.sin(w), 0.6 + 0.08 * math.sin(w - 0.6))
    return p


def spin(t, T=1.6):
    p = Pose()
    u = t / T
    b = bell(u)
    legs(p, (0, 0, -0.4 + 1.6 * b), {side: (0.0, ANKLE_Z + 1.2 * b) for side, _ in SIDES})
    p.turn('pelvis', 'z', TAU * ease(u))
    p.move('cap', (0, 0, 1.8 * b))
    p.turn('cap', 'x', -0.3 * b)
    for side, _ in SIDES:
        arm(p, side, out=1.4 * b, elbow=0.2 * b)
    antenna(p, -0.3 * b, -0.45 * b)
    return p


def peek(t, T=3.0):
    """A think: hand to chin, head tilted — then the idea: a finger up and a hop."""
    p = Pose()
    hm = env(t, 0.1, 0.5, 1.9, 2.3)
    idea = env(t, 2.0, 2.15, 2.6, T)
    hopz = 1.6 * bell((t - 2.05) / 0.45)
    stand(p, 0.45 - hopz)
    body(p, lean=0.12 * hm, bow=-0.04 * hm)
    arm(p, 'R', out=0.15, fwd=0.9 * hm, elbow=1.9 * hm, twist=0.4 * hm)
    arm(p, 'L', out=0.1 + 0.2 * hm - 0.1 * idea, fwd=2.6 * idea, elbow=0.3 * hm + 0.1 * idea)
    antenna(p, 0.6 * hm - 0.35 * idea, 0.5 * hm - 0.5 * idea, 0.2 * hm)
    return p


def bow(t, T=2.0):
    p = Pose()
    b = env(t, 0.1, 0.7, 1.3, 1.9)
    tip = env(t, 0.25, 0.6, 1.2, 1.6)
    stand(p, 0.45)
    body(p, bow=0.5 * b)
    arm(p, 'L', out=0.5 * tip, fwd=2.1 * tip, elbow=1.3 * tip)
    arm(p, 'R', out=0.1, fwd=0.4 * b, elbow=0.9 * b)
    p.move('cap', (0, -0.6 * tip, 1.6 * tip))
    p.turn('cap', 'x', -0.35 * tip)
    antenna(p, 0.25 * b, 0.35 * b)
    return p


def deliver(t, T=2.8):
    p = Pose()
    reach = env(t, 0.1, 0.55, 0.8, 1.15)       # over its shoulder, into the bag
    offer = env(t, 0.95, 1.4, 2.2, 2.7)        # and the letter held out
    stand(p, 0.45 + 0.4 * offer)
    body(p, bow=-0.08 * reach + 0.18 * offer, turn=0.15 * reach)
    arm(p, 'R', out=0.5 * reach + 0.15 * offer, fwd=2.6 * reach + 1.35 * offer, elbow=1.3 * reach + 0.25 * offer, twist=-0.4 * reach)
    arm(p, 'L', out=0.1, fwd=0.35 * offer, elbow=0.5 * offer)
    p.turn('bag', 'x', -0.3 * reach)
    antenna(p, 0.15 * offer, 0.25 * offer)
    return p


def point(t, T=2.0):
    p = Pose()
    e = env(t, 0.1, 0.4, 1.5, 1.9)
    stand(p, 0.45)
    body(p, bow=0.06 * e, turn=0.12 * e)
    arm(p, 'L', fwd=1.5 * e, out=0.15 * e)
    arm(p, 'R', out=0.15, elbow=0.6 * e)
    antenna(p, 0.3 * e, 0.4 * e)
    return p


def glitch(t, T=0.8):
    p = Pose()
    e = env(t, 0.0, 0.1, 0.6, T)
    # A deterministic shiver, ~5 Hz against ~2 Hz: fast enough to read as a glitch, slow enough to read as a body.
    j = lambda k: math.sin(t * 31.0 + k * 13.1) * math.sin(t * 13.0 + k)  # noqa: E731
    stand(p, 0.4 + 0.3 * e * abs(j(9)))
    body(p, turn=0.12 * e * j(1), lean=0.1 * e * j(2))
    for side, s in SIDES:
        arm(p, side, out=0.3 * e * abs(j(3 + s)), elbow=0.6 * e * abs(j(5 + s)))
    antenna(p, 0.3 * e * j(7), 0.5 * e * j(8))
    p.turn('cap', 'x', -0.12 * e * abs(j(6)))
    return p


def skid(t, T=1.2):
    """A braking stop: sliding, leaning back, arms windmilling, then upright."""
    p = Pose()
    b = env(t, 0.0, 0.25, 0.6, 1.1)
    whip = env(t, 0.05, 0.25, 0.45, 0.85)
    legs(p, (0, 1.2 * b, -1.0 * b), {'L': (-3.0 * b, ANKLE_Z), 'R': (-1.0 * b, ANKLE_Z)}, {'L': 0.45 * b, 'R': 0.25 * b})
    body(p, bow=-0.35 * b)
    for side, s in SIDES:
        arm(p, side, out=1.2 * b, fwd=1.2 * b * math.sin(TAU * 1.6 * t + (0 if s > 0 else math.pi)), elbow=0.3 * b)
    antenna(p, 0.7 * whip, 0.8 * whip)
    p.turn('cap', 'x', 0.18 * whip)
    p.turn('bag', 'x', 0.5 * whip)
    return p


def clap(t, T=0.5):
    """Clapping, bouncing on its knees."""
    p = Pose()
    w = TAU * t / T
    stand(p, 0.5 + 0.25 * (1 - math.cos(w)) / 2)
    for side, _ in SIDES:
        arm(p, side, fwd=1.25, out=0.12 + 0.22 * (1 + math.cos(w)) / 2, elbow=0.75, twist=-0.5)
    antenna(p, 0.1 * math.sin(w - 0.5), 0.15 * math.sin(w - 1.0))
    return p


def shrug(t, T=1.6):
    p = Pose()
    e = env(t, 0.1, 0.45, 1.05, 1.5)
    stand(p, 0.45 + 0.35 * e)
    body(p, lean=0.06 * e, bow=-0.05 * e)
    for side, _ in SIDES:
        arm(p, side, out=0.55 * e, fwd=0.35 * e, elbow=1.45 * e, twist=-0.9 * e)
    p.move('cap', (0, 0, 0.6 * e))
    antenna(p, 0.35 * e, 0.5 * e)
    return p


def facepalm(t, T=2.4):
    """A gloved hand to its screen, a slow shake of the box."""
    p = Pose()
    e = env(t, 0.1, 0.5, 1.8, 2.3)
    stand(p, 0.5 + 0.3 * e)
    body(p, bow=0.22 * e, turn=0.12 * e * math.sin(TAU * 0.9 * (t - 0.5)))
    arm(p, 'R', out=-0.22 * e, fwd=0.8 * e, elbow=1.2 * e, twist=0.5 * e)
    arm(p, 'L', out=0.05, elbow=0.2)
    antenna(p, 0.55 * e, 0.75 * e)
    return p


def laugh(t, T=1.0):
    """Holding its belly, rocking back, shaking with it."""
    p = Pose()
    w = TAU * t / T
    stand(p, 0.6 + 0.3 * abs(math.sin(3 * w)))
    body(p, bow=-0.12 + 0.05 * math.sin(3 * w), lean=0.04 * math.sin(w))
    for side, _ in SIDES:
        arm(p, side, out=-0.05, fwd=0.55, elbow=1.6, twist=0.3)
    antenna(p, -0.2 + 0.2 * math.sin(3 * w), -0.3 + 0.3 * math.sin(3 * w - 0.6))
    p.turn('tail', 'z', 0.4 * math.sin(3 * w))
    return p


def salute(t, T=2.0):
    p = Pose()
    up = env(t, 0.1, 0.35, 1.4, 1.65)
    stand(p, 0.3)
    body(p, bow=-0.04 * up)
    arm(p, 'R', out=0.95 * up, fwd=0.85 * up, elbow=2.15 * up, twist=0.4 * up)
    arm(p, 'L', out=0.02, elbow=0.05)
    antenna(p, -0.12 * up, -0.18 * up)
    return p


def search(t, T=3.0):
    """A hand shading its screen, peering left, then right."""
    p = Pose()
    e = env(t, 0.1, 0.45, 2.5, 2.9)
    look = math.sin(TAU * 0.5 * (t - 0.45)) * env(t, 0.45, 0.8, 2.2, 2.6)
    stand(p, 0.5 + 0.2 * e)
    body(p, bow=0.12 * e, turn=0.45 * look)
    arm(p, 'L', out=0.45 * e, fwd=1.5 * e, elbow=1.95 * e, twist=-0.3 * e)
    arm(p, 'R', out=0.1, elbow=0.3 * e)
    antenna(p, 0.2 * e, 0.25 * e, -0.25 * look)
    return p


def stretch(t, T=3.0):
    """A big stretch, up on its toes, arms high — and down again."""
    p = Pose()
    e = env(t, 0.2, 1.1, 1.9, 2.8)
    toe = -0.55 * e
    legs(p, (0, 0, 0.2 * e - 0.3), {side: (0.0, ANKLE_Z) for side, _ in SIDES}, {side: toe for side, _ in SIDES})
    body(p, bow=-0.18 * e)
    for side, _ in SIDES:
        arm(p, side, out=2.85 * e, elbow=0.15 * e)
    antenna(p, -0.3 * e, -0.4 * e)
    return p


def jump(t, T=1.4):
    """Jump for joy: a crouch, a leap with both heels kicked up behind, arms flung high."""
    p = Pose()
    u = t / T
    if u < 0.2:
        h = -2.0 * ease(u / 0.2)
    elif u < 0.75:
        h = -2.0 + 9.0 * math.sin(math.pi * (u - 0.2) / 0.55)
    else:
        h = -2.0 * (1 - ease((u - 0.75) / 0.25))
    air = max(0.0, h)
    kick = min(1.0, air / 5.0)
    legs(p, (0, 0, h), {side: (4.5 * kick, ANKLE_Z + 0.6 * air + 3.0 * kick) for side, _ in SIDES},
         {side: -0.6 * kick for side, _ in SIDES})
    for side, _ in SIDES:
        arm(p, side, out=0.3 + 2.4 * kick, elbow=0.4 - 0.3 * kick)
    body(p, bow=-0.15 * kick + 0.12 * max(0.0, -h) / 2)
    p.move('cap', (0, 0, 1.2 * kick))
    antenna(p, -0.5 * kick + 0.3 * max(0.0, -h) / 2, -0.6 * kick + 0.4 * max(0.0, -h) / 2)
    return p


def trip(t, T=2.4):
    """A stumble: a toe catches, it pitches forward, arms windmilling, hops to catch itself — and straightens up, embarrassed."""
    p = Pose()
    fall = env(t, 0.05, 0.4, 0.9, 1.5)
    catch = bell((t - 0.5) / 0.6)
    legs(p, (0, -1.5 * fall, -1.2 * fall + 1.0 * catch),
         {'L': (-2.5 * fall - 3.0 * catch, ANKLE_Z + 2.5 * catch), 'R': (1.5 * fall, ANKLE_Z)},
         {'L': 0.2 * catch, 'R': -0.4 * fall})
    body(p, bow=0.5 * fall)
    for side, s in SIDES:
        arm(p, side, out=0.9 * fall, fwd=1.4 * fall * (0.5 + 0.5 * math.sin(TAU * 2.2 * t + (0 if s > 0 else math.pi))), elbow=0.3 * fall)
    # After: a hand to the back of its head (sheepish).
    sheep = env(t, 1.5, 1.8, 2.1, 2.35)
    arm(p, 'R', out=0.6 * sheep, fwd=2.0 * sheep, elbow=2.1 * sheep)
    antenna(p, 0.8 * fall, 0.9 * fall)
    p.turn('cap', 'x', 0.2 * fall)
    p.turn('bag', 'x', 0.5 * fall)
    return p


def sneak(t, T=1.4):
    """Tiptoeing: crouched, long slow steps, hands up in front."""
    p = Pose()
    u0 = t / T
    feet, toe = {}, {}
    for side, ph in (('L', 0.0), ('R', 0.5)):
        u = (u0 + ph) % 1.0
        half = SNEAK_STRIDE / 4
        if u < 0.5:
            s = u / 0.5
            feet[side] = (-half + s * 2 * half, ANKLE_Z)
            toe[side] = -0.35   # on its toes
        else:
            s = (u - 0.5) / 0.5
            feet[side] = (half - ease(s) * 2 * half, ANKLE_Z + 3.0 * math.sin(math.pi * s))
            toe[side] = -0.35 - 0.2 * bell(s)
    legs(p, (0, 0, -1.8 + 0.35 * math.cos(2 * TAU * u0)), feet, toe)
    body(p, bow=0.2, turn=-0.08 * math.cos(TAU * u0))
    for side, s in SIDES:
        arm(p, side, out=0.25, fwd=0.9 + 0.12 * s * math.sin(TAU * u0), elbow=1.3, wrist=-0.5)
    antenna(p, 0.35, 0.45)
    return p


def dance(t, T=2.0):
    """The twist: hips swivelling, knees dipping, arms swinging against them."""
    p = Pose()
    w = TAU * t / T
    dip = (1 - math.cos(2 * w)) / 2
    legs(p, (0, 0, -0.6 - 1.8 * dip), {side: (0.0, ANKLE_Z) for side, _ in SIDES}, {side: -0.25 * dip for side, _ in SIDES})
    p.turn('pelvis', 'z', 0.45 * math.sin(2 * w))
    body(p, turn=-0.7 * math.sin(2 * w), lean=0.05 * math.sin(w))
    for side, s in SIDES:
        arm(p, side, out=0.55, fwd=0.6 + 0.4 * s * math.sin(2 * w), elbow=1.3, twist=0.6 * math.sin(2 * w))
    antenna(p, 0, 0, 0.35 * math.sin(2 * w - 0.7))
    p.turn('tail', 'z', 0.5 * math.sin(2 * w))
    return p


CLIPS = [('idle', idle, 4.0), ('walk', walk, 1.0), ('run', run, 0.6), ('talk', talk, 1.0), ('nod', nod, 1.0),
         ('shake', shake, 1.2), ('hop', hop, 0.8), ('wiggle', wiggle, 1.0), ('wave', wave, 1.2), ('cheer', cheer, 1.0),
         ('rest', rest, 3.0), ('spin', spin, 1.6), ('peek', peek, 3.0), ('bow', bow, 2.0), ('deliver', deliver, 2.8),
         ('point', point, 2.0), ('glitch', glitch, 0.8), ('skid', skid, 1.2),
         ('clap', clap, 0.5), ('shrug', shrug, 1.6), ('facepalm', facepalm, 2.4), ('laugh', laugh, 1.0),
         ('salute', salute, 2.0), ('search', search, 3.0), ('stretch', stretch, 3.0), ('jump', jump, 1.4),
         ('trip', trip, 2.4), ('sneak', sneak, 1.4), ('dance', dance, 2.0)]
LOOPS = ('idle', 'walk', 'run', 'talk', 'nod', 'shake', 'hop', 'wiggle', 'wave', 'cheer', 'rest', 'clap', 'laugh',
         'sneak', 'dance')


def floor_check(rig, clips):
    """The floor rule, checked: every clip, every frame, Dot's lowest vertex
    (deformed) is on or above z = 0. Returns the worst (depth, clip, frame)."""
    worst = (0.0, None, None)
    meshes = [o for o in rig.children if o.type == 'MESH']
    scene = bpy.context.scene
    for name in clips:
        act = bpy.data.actions[f'dot:{name}']
        rig.animation_data.action = act
        for f in range(int(act.frame_range[0]), int(act.frame_range[1]) + 1):
            scene.frame_set(f)
            dg = bpy.context.evaluated_depsgraph_get()
            for o in meshes:
                ev = o.evaluated_get(dg)
                me = ev.to_mesh()
                low = min((ev.matrix_world @ v.co).z for v in me.vertices)
                ev.to_mesh_clear()
                if low < worst[0]:
                    worst = (low, name, f)
    rig.animation_data.action = None
    scene.frame_set(0)
    return worst


def main():
    scene = bpy.data.scenes.get('dot') or bpy.data.scenes.new('dot')
    with in_scene(scene):
        begin('dot')
        meshes = load_source('dot')
        pitch, phase = lattice(meshes)
        assert (pitch, phase) == (2.0, (1.0, 1.0, 0.0)), (pitch, phase)
        counts = segment(meshes, bone_of, pitch, phase, by_point=True)
        rig = build_armature('Dot', meshes, bone_table())
        keyed = {b: ['rotation_quaternion'] for b in bone_table() if b != 'root'}
        for b in ('pelvis', 'cap'):
            keyed[b].append('location')
        clips = bake(rig, 'dot', CLIPS, apply_pose, LOOPS, keyed)
        depth, clip, frame = floor_check(rig, clips)
        assert depth > -0.05, f'{clip} frame {frame}: a sole {-depth:.2f} under the floor'
        out = export(rig, out_path('dot'), {'mqStride': WALK_STRIDE, 'mqRunStride': RUN_STRIDE, 'mqSneakStride': SNEAK_STRIDE})
        return {'faces_per_bone': counts, 'bones': len(rig.data.bones), 'clips': clips, 'out': out,
                'bytes': os.path.getsize(out), 'floor': round(depth, 3)}


if __name__ == '__main__':
    result = main()
    print(result)
