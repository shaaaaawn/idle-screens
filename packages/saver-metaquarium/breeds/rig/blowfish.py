"""
Rig and animate the blowfish: breeds/source/blowfish.glb in, breeds/rig/blowfish.glb out.

    blender -b -P breeds/rig/blowfish.py        (from packages/saver-metaquarium)

A pufferfish, and a flirt. A spiky cube of a fish — orange back, yellow
belly — with two big eyes on its face, a pursed little mouth, stubby teal
fins and spines all over. What a puffer does that no other fish here does is
CHANGE SIZE: it gulps water until it is a ball with its spines up, holds it,
and lets it all go. So the rig is built round that:

    puff        everything hangs off it. The `puff` clip is not a performance
                but a dial: its time is how puffed the fish is (0 relaxed, its
                end fully puffed), so src/puffer.ts can gulp it up in steps,
                hold it, and let it out fast or slow. It scales the fish up
                (rounder: wider and taller more than longer) and slides the
                spines from half tucked (relaxed — a puffer's spines lie flat)
                to standing proud.
    spines.top/bottom/L/R/back
                the spines, by the face of the body they stand on; each slides
                along its face's normal. The back's spines are its tail too.
    body        above `puff`: where every other clip moves, turns and
                squashes the fish, so no clip ever fights the dial.
    fin.L/R     the stubby teal pectorals, a blur of fluttering.
    mouth       the pursed little block on the face: it puckers for a kiss,
                gapes for a yawn, snaps for a crunch.
    eye.L/R, pupil.L/R
                the eyes and their pupils, bones of their own that no clip
                moves: src/puffer.ts aims them, slides the pupils, dilates
                them, and closes them — a wink, batted lashes, a slow
                bedroom blink. Each eye is rebuilt as one white box and its
                pupil as one black quad on its face (common.clean_eyes), so a
                sliding pupil uncovers white, and shows no seam.

Blender axes: it faces -Y, its left is +X, Z is up; voxel centres on odd
coordinates. The core box is x -10..10, y -10..6, z -8..8; the face's layer
(eyes, mouth) is y -12..-10.

Clips (30 fps; the tank sets their times, never update(dt)):

    swim      1.25 s loop. Pectorals a-flutter (3.2 Hz), a bob, a waddle, the
              tail of spines sculling.
    hover     1.6 s loop. Holding station like a little helicopter.
    puff      1.0 s — the dial (above). Not played: looked up.
    gulp      0.35 s. One gulp of water: the mouth opens, the body swallows.
    zip       1.8 s. Let go like a balloon: spinning, wobbling, zigzagging.
    spin      2.2 s. A pirouette, fins out.
    flip      2.0 s. A back flip, tucked.
    kiss      2.4 s. It leans in, puckers up — mwah! — and bobs back.
    shimmy    2.6 s. A little side-to-side dance.
    bounce    2.3 s. Three bounces, squash and stretch.
    spit      1.6 s. Blows a jet of water: the mouth pumps, the body recoils.
    yawn      2.7 s. A big round yawn, a stretch.
    shy       2.6 s. Turns away coyly, tucks its fins... and peeks back.
    wave      2.1 s. Waves a fin: hey there.
    chomp     1.2 s. Crunch, crunch: a beak made for snails.

Every one-shot starts and ends on the rest pose.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (  # noqa: E402
    Pose, apply_pose, bake, begin, build_armature, clean_eyes, ease, env, export, in_scene, lattice, load_source, out_path,
    segment, track,
)

# The spines, by the face they stand on, and which way is out.
SPINES = {'spines.top': (0, 0, 1), 'spines.bottom': (0, 0, -1), 'spines.L': (1, 0, 0), 'spines.R': (-1, 0, 0),
          'spines.back': (0, 1, 0)}
# A relaxed puffer's spines lie flat (half tucked into the body); puffed, they stand proud.
SPINE_RELAXED = -1.0
SPINE_PUFFED = 0.0  # the designer's own spines: further out, they lift off and show the holes under them
# Fully puffed: wider and taller more than longer, so the cube reads rounder.
PUFF_XZ = 0.5
PUFF_Y = 0.32


def bone_of(x, y, z, mat):
    if mat == 'GLOW-FINS':
        return 'fin.L' if x > 0 else 'fin.R'
    if mat == 'EYES-BLACK':
        return 'pupil.L' if x > 0 else 'pupil.R'
    if mat == 'EYES-WHITE':
        return 'eye.L' if x > 0 else 'eye.R'
    if y < -10:
        return 'mouth'
    if y > 6:
        return 'spines.back'
    if z > 8:
        return 'spines.top'
    if z < -8:
        return 'spines.bottom'
    if x > 10:
        return 'spines.L'
    if x < -10:
        return 'spines.R'
    return 'puff'


def bone_table():
    # Every bone points tailward (+Y), its head the part's pivot.
    t = {
        'root': ((0, -2, -14), (0, -2, -12), None),
        'body': ((0, -2, 0), (0, 0, 0), 'root'),
        'puff': ((0, -2, 0), (0, 0, 0), 'body'),
        'fin.L': ((10, -4, 0), (10, -2, 0), 'puff'),
        'fin.R': ((-10, -4, 0), (-10, -2, 0), 'puff'),
        # The mouth pivots on the face, so a pucker pushes it OUT.
        'mouth': ((0, -10, -5), (0, -8, -5), 'puff'),
        # An eye closes about its middle; its pupil slides on its front face.
        'eye.L': ((5, -11, 3), (5, -9, 3), 'puff'),
        'eye.R': ((-5, -11, 3), (-5, -9, 3), 'puff'),
        'pupil.L': ((7, -12, 4), (7, -10, 4), 'eye.L'),
        'pupil.R': ((-3, -12, 4), (-3, -10, 4), 'eye.R'),
    }
    for name, n in SPINES.items():
        base = Vector((0, -2, 0)) + Vector(n) * (6 if name == 'spines.back' else 8 if n[2] else 10)
        t[name] = (tuple(base), tuple(base + Vector((0, 2, 0))), 'puff')
    return t


# ---------------------------------------------------------------------------
# Clips. Signs, in Blender axes: the nose turns to its left (+x) as the body
# turns +z; drops as it turns +x; it rolls onto its right side as it turns +y.
# ---------------------------------------------------------------------------

def flutter(p, t, hz=5.0, amp=0.55, sweep=0.25, k=1.0, phase=0.0, together=False):
    """The pectorals a-blur: a flap about the long axis, a sweep fore and aft.
    A puffer beats them half a stroke apart (Gordon 1996: 180 degrees out of
    phase, 3-6 Hz) — `together` for a flourish."""
    for side, s in (('L', 1), ('R', -1)):
        w = 2 * math.pi * hz * t + phase + (0 if together or side == 'L' else math.pi)
        p.turn(f'fin.{side}', 'y', -s * k * amp * math.sin(w))
        p.turn(f'fin.{side}', 'z', s * k * sweep * math.cos(w))


def scull(p, t, T, amp=0.12):
    """The tail of spines sculling."""
    p.turn('spines.back', 'z', amp * math.sin(2 * math.pi * t / T))


def squash(p, s):
    """Squash (s > 0, flattened) or stretch (s < 0): the volume kept."""
    p.scale['body'] = (1 + 0.5 * s, 1 + 0.25 * s, 1 - s)


def swim(t, T=1.25):
    p = Pose()
    flutter(p, t, hz=3.2, amp=0.45, sweep=0.2)
    w = 2 * math.pi * t / T
    p.move('body', (0, 0, 0.3 * math.sin(w)))
    p.turn('body', 'x', -0.1)                   # it swims a little mouth-up (3-10 degrees)
    p.turn('body', 'z', 0.035 * math.sin(w))   # a waddle
    p.turn('body', 'y', 0.03 * math.sin(w + 1))
    scull(p, t, T, 0.16)
    return p


def hover(t, T=1.6):
    p = Pose()
    flutter(p, t, hz=2.5, amp=0.4, sweep=0.25)
    w = 2 * math.pi * t / T
    p.move('body', (0, 0, 0.35 * math.sin(w)))
    p.turn('body', 'y', 0.04 * math.sin(w))
    scull(p, t, T, 0.08)
    return p


def puff(t, T=1.0):
    """The dial: t / T is how puffed it is."""
    p = Pose()
    k = ease(t / T)
    p.scale['puff'] = (1 + PUFF_XZ * k, 1 + PUFF_Y * k, 1 + PUFF_XZ * k)
    # The spines stand up once it is round enough to need them.
    out = SPINE_RELAXED + (SPINE_PUFFED - SPINE_RELAXED) * ease((t / T - 0.15) / 0.7)
    for name, n in SPINES.items():
        p.move(name, tuple(out * c for c in n))
    return p


def gulp(t, T=0.35):
    p = Pose()
    g = env(t, 0.0, 0.1, 0.15, 0.3)
    p.scale['mouth'] = (1 + 0.5 * g, 1 + 0.3 * g, 1 + 0.6 * g)
    sw = env(t, 0.12, 0.2, 0.24, 0.35)
    squash(p, -0.06 * sw)
    p.turn('body', 'x', -0.08 * g)             # the chin up to gulp
    return p


def zip_(t, T=1.4):
    """Let go like a balloon."""
    p = Pose()
    on = env(t, 0.0, 0.08, 1.15, T)
    spins = track(t, [(0, 0), (0.08, 0), (1.2, 1), (T, 1)])
    p.turn('body', 'z', 2 * math.pi * 3 * spins % (2 * math.pi))
    p.turn('body', 'y', 0.5 * math.sin(2 * math.pi * 4.5 * t) * on)
    p.move('body', (3.0 * math.sin(2 * math.pi * 2.2 * t) * on, 0, 2.0 * math.sin(2 * math.pi * 3.1 * t) * on))
    flutter(p, t, hz=9, amp=0.8, sweep=0.4, k=on)
    p.scale['mouth'] = (1 + 0.4 * on, 1 + 0.6 * on, 1 + 0.4 * on)
    return p


def spin(t, T=1.6):
    p = Pose()
    turn = track(t, [(0, 0), (0.15, 0), (1.35, 1), (T, 1)])
    out = env(t, 0.05, 0.25, 1.3, 1.55)
    p.turn('body', 'z', 2 * math.pi * turn % (2 * math.pi))
    p.move('body', (0, 0, 1.5 * out))
    p.turn('body', 'y', 0.15 * out)
    flutter(p, t, hz=6, amp=0.4 + 0.5 * out)
    return p


def flip(t, T=1.4):
    p = Pose()
    over = track(t, [(0, 0), (0.2, 0), (1.15, 1), (T, 1)])
    tuck = env(t, 0.1, 0.3, 1.05, 1.3)
    p.turn('body', 'x', -(2 * math.pi * over % (2 * math.pi)))
    p.move('body', (0, 0, 4.0 * math.sin(math.pi * over)))
    squash(p, 0.12 * tuck)
    flutter(p, t, hz=7, amp=0.3 + 0.4 * (1 - tuck))
    return p


def kiss(t, T=2.0):
    p = Pose()
    lean = env(t, 0.1, 0.5, 1.1, 1.5)
    pucker = env(t, 0.3, 0.6, 1.0, 1.15)
    mwah = env(t, 1.0, 1.06, 1.12, 1.3)
    p.move('body', (0, -1.5 * lean + 1.2 * mwah, 0.4 * lean))
    p.turn('body', 'x', 0.12 * lean)
    p.turn('body', 'y', 0.12 * lean)          # a coy tilt
    p.scale['mouth'] = (1 - 0.35 * pucker + 0.35 * mwah, 1 + 1.4 * pucker, 1 - 0.35 * pucker + 0.35 * mwah)
    p.move('mouth', (0, -1.2 * pucker, 0))
    flutter(p, t, hz=4, amp=0.3 + 0.5 * mwah)
    return p


def shimmy(t, T=1.8):
    p = Pose()
    on = env(t, 0.0, 0.25, 1.5, T)
    w = 2 * math.pi * 2.2 * t
    p.turn('body', 'y', 0.32 * math.sin(w) * on)
    p.turn('body', 'z', -0.12 * math.sin(w) * on)
    p.move('body', (1.2 * math.sin(w) * on, 0, 0.5 * abs(math.sin(w)) * on))
    flutter(p, t, hz=4.4, amp=0.7 * on + 0.2)
    scull(p, t, 0.45, 0.3 * on)
    return p


def bounce(t, T=1.5):
    p = Pose()
    u = t / T * 3                              # three bounces
    ph = u % 1.0
    hop = math.sin(math.pi * ph) if u < 3 else 0
    land = math.exp(-((ph - 0.0) / 0.08) ** 2) + math.exp(-((ph - 1.0) / 0.08) ** 2)
    fade = env(t, 0.0, 0.05, T - 0.2, T)
    p.move('body', (0, 0, 3.5 * hop * fade))
    squash(p, (0.22 * land - 0.1 * hop) * fade)
    flutter(p, t, hz=5, amp=0.5)
    return p


def spit(t, T=1.2):
    p = Pose()
    aim = env(t, 0.0, 0.25, 0.9, T)
    pump = sum(env(t, a, a + 0.06, a + 0.1, a + 0.2) for a in (0.3, 0.55, 0.8))
    p.turn('body', 'x', 0.3 * aim)
    p.move('body', (0, 1.4 * pump, 0))
    p.scale['mouth'] = (1 + 0.5 * pump, 1 - 0.3 * pump, 1 + 0.5 * pump)
    squash(p, -0.06 * pump)
    flutter(p, t, hz=6, amp=0.6 * aim)
    return p


def yawn(t, T=2.4):
    p = Pose()
    gape = env(t, 0.3, 0.9, 1.4, 1.9)
    stretch = env(t, 0.2, 0.8, 1.5, 2.1)
    p.scale['mouth'] = (1 + 0.7 * gape, 1, 1 + 0.9 * gape)
    p.move('mouth', (0, 0, -0.8 * gape))
    p.turn('body', 'x', -0.22 * stretch)
    p.scale['body'] = (1 - 0.04 * stretch, 1 + 0.1 * stretch, 1 + 0.03 * stretch)
    flutter(p, t, hz=2, amp=0.15 + 0.5 * stretch, sweep=0.1)
    shake = env(t, 1.95, 2.05, 2.2, 2.4)
    p.turn('body', 'y', 0.2 * math.sin(2 * math.pi * 7 * t) * shake)
    return p


def shy(t, T=2.2):
    p = Pose()
    away = env(t, 0.0, 0.4, 1.4, 2.0)
    peek = env(t, 0.9, 1.1, 1.3, 1.5)
    p.turn('body', 'z', 0.9 * away - 0.45 * peek)
    p.turn('body', 'y', -0.18 * away)
    p.move('body', (0, 0, -0.8 * away))
    flutter(p, t, hz=3, amp=0.2 + 0.15 * (1 - away), sweep=0.1)
    return p


def wave(t, T=1.6):
    p = Pose()
    on = env(t, 0.0, 0.25, 1.3, T)
    p.turn('body', 'y', -0.18 * on)
    p.turn('fin.L', 'y', -on * (0.9 + 0.45 * math.sin(2 * math.pi * 3 * t)))
    p.turn('fin.R', 'y', 0.3 * math.sin(2 * math.pi * 4 * t))
    p.move('body', (0, 0, 0.3 * math.sin(2 * math.pi * 1.2 * t)))
    return p


def chomp(t, T=0.9):
    p = Pose()
    bite = env(t, 0.1, 0.18, 0.22, 0.32) + env(t, 0.45, 0.53, 0.57, 0.7)
    open_ = env(t, 0.0, 0.1, 0.12, 0.2) + env(t, 0.35, 0.45, 0.47, 0.55)
    p.scale['mouth'] = (1 + 0.15 * open_, 1, 1 + 0.6 * open_ - 0.4 * bite)
    p.turn('body', 'x', 0.14 * bite)
    p.move('body', (0, -0.6 * bite, 0))
    flutter(p, t, hz=5, amp=0.35)
    return p


def slow(fn, was, now):
    """A clip authored over `was` seconds, played over `now`: everything in
    it — flutters, spins, bounces — that much more leisurely."""
    return lambda t, T=now: fn(t * was / now, was)


# Unhurried: a puffer is a slow, deliberate swimmer, and an ambient screen
# wants a fish you can watch, not one that fidgets.
CLIPS = [('swim', swim, 1.25), ('hover', hover, 1.6), ('puff', puff, 1.0), ('gulp', gulp, 0.35),
         ('zip', slow(zip_, 1.4, 1.8), 1.8), ('spin', slow(spin, 1.6, 2.2), 2.2), ('flip', slow(flip, 1.4, 2.0), 2.0),
         ('kiss', slow(kiss, 2.0, 2.4), 2.4), ('shimmy', slow(shimmy, 1.8, 2.6), 2.6), ('bounce', slow(bounce, 1.5, 2.3), 2.3),
         ('spit', slow(spit, 1.2, 1.6), 1.6), ('yawn', slow(yawn, 2.4, 2.7), 2.7), ('shy', slow(shy, 2.2, 2.6), 2.6),
         ('wave', slow(wave, 1.6, 2.1), 2.1), ('chomp', slow(chomp, 0.9, 1.2), 1.2)]
LOOPS = ('swim', 'hover')


def main():
    scene = bpy.data.scenes.get('blowfish') or bpy.data.scenes.new('blowfish')
    with in_scene(scene):
        begin('blowfish')
        meshes = load_source('blowfish')
        role = {o['rigMaterials'][0]: o for o in meshes}
        boxes = clean_eyes(role['EYES-WHITE'], role['EYES-BLACK'], lambda c: True)
        pitch, phase = lattice(meshes)
        counts = segment(meshes, bone_of, pitch, phase, by_point=True)
        # `body` holds no vertices but must stay a deform bone: the exporter drops the rest, and every clip moves it.
        rig = build_armature('Blowfish', meshes, bone_table(), nondeform=('root',))
        keyed = {
            'body': ['rotation_quaternion', 'location', 'scale'],
            'puff': ['scale'],
            'fin.L': ['rotation_quaternion'], 'fin.R': ['rotation_quaternion'],
            'mouth': ['location', 'scale'],
            'spines.back': ['rotation_quaternion', 'location'],
            **{n: ['location'] for n in SPINES if n != 'spines.back'},
        }
        clips = bake(rig, 'blowfish', CLIPS, apply_pose, LOOPS, keyed)
        out = export(rig, out_path('blowfish'), {})
        return {'faces_per_bone': counts, 'bones': len(rig.data.bones), 'clips': clips, 'out': out,
                'bytes': os.path.getsize(out), 'lattice': (pitch, phase), 'eye_boxes': boxes}


if __name__ == '__main__':
    result = main()
    print(result)
