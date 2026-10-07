"""
Rig and animate the angelfish: breeds/source/angelfish.glb in,
breeds/rig/angelfish.glb out.

    blender -b -P breeds/rig/angelfish.py        (from packages/saver-metaquarium)

The source is the MINTED breed's one model (breeds/minted.mjs), its triangles
cut into paint regions MINT-R<n> / MINT-EYE-R<n>: every one of the 200
angelfish tokens is this model in its own paint, so this one rig swims them
all. The model is never edited; the rig says which bones each vertex follows.
Its regions are materials, and a face keeps its material through the rig and
the intake, so each token's paint still lands where it should.

Facing. The delivered fish swims along +X (its eyes sit at that end); every
rig faces -Y (glTF +Z, which the tank assumes of a rig). So the baked meshes
are turned a quarter turn about Z first — rigid, the whole model.

An angelfish is fluid: its body curves in a travelling wave that grows toward
the tail, and its long dorsal and anal fins — arcs that sweep up (down) off
the body and run back over the tail as streamers — ripple, a wave running
back along them. So nothing here is a rigid part. Every vertex's weights
come from where it lies (the shark's way), so two faces that meet always
move together. Rigged by eye in Blender against the side view:

    spine    the snout (it tips on its own: a sniff, a pucker, a nuzzle),
             the head (rigid, with both eyes: they sit in its pure zone,
             y -9..-1), the body and the back three (s2, s3, the tail
             through the caudal bar); each vertex blends between the two
             nearest knots by y, so the body bends as one curve, never at
             a joint
    fins     three bones laid ALONG each arc (DORSAL_ARC, ANAL_ARC); a vertex
             is fin by how far it stands off the body, and blends along its
             arc by arc length. Each segment rides the spine bone beside it,
             so an arc curves and waves with the body, then ripples on top —
             sideways about its own axis, the streamers widest
    roll     above the body: the pirouette turns the whole fish about its
             long axis
    flex2..4, lookY, lookP
             non-deforming. flex2..4 each parent a spine bone and only the
             `bend` dial moves them: a turn curves the whole fish, under any
             stroke. lookY and lookP carry the head (yaw, pitch) for the
             look dials: it turns about the water, into turns, to the viewer

Clips (30 fps; the tank sets their times and weights, never update(dt)):

    swim     1.6 s loop: a travelling wave down the body, growing to the
             tail; the fins ripple behind it; the streamers whip after
    hover    3.2 s loop: holding station — the body all but still, the fins
             rippling (the angelfish's own way of hanging in the water)
    burst    0.9 s: fins laid back, three hard strokes of the whole body
    moments  one-shots from rest to rest, each a fish's own gesture (src/
             angel.ts gives every fish a temperament and a favourite):
             display 3, nibble 2.4, curious 3, kiss 2, soar 4, pirouette
             2.4, bow 2.6, flutter 1.6, sway 4, stretch 2.6 s. Nothing in
             them faster than ~2 Hz: at 30 fps quicker reads as a jitter
    bend, lookYaw, lookPitch
             DIALS, 2 s each: the time is the setting — 0 hard one way, 1
             at rest, 2 hard the other (bend + and lookYaw + to its left,
             lookPitch + nose up)
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (  # noqa: E402
    Pose, apply_pose, bake, begin, in_scene, build_armature, ease, env, export, lattice, load_source, out_path, segment,
)

BREED = 'angelfish'
PITCH = 2.0

# Read off the side occupancy in rig space (nose -Y, up +Z; one cell is 2):
# a long diamond body from the nose (y -15) to the peduncle (y ~15), the eyes
# at y -7..-1 just under the midline; the caudal fin a bar at y 17..19,
# z -14..10; the DORSAL arc rising off the diamond's top at y ~1 to z ~16,
# then running back along z 18..20 to y 23, over the tail; the ANAL arc
# dropping off its bottom the same way to y ~15.
# The spine, nose to tail, as knots (y, bone): weights hand over smoothly
# between neighbouring knots, and two knots of one bone make a plateau. The
# head is pure from y -9 to -1 — both eyes (y -7.3..-1.3) ride it rigidly —
# the snout ahead of it, the body behind; the back three bend.
SPINE_KNOTS = ((-12.0, 'snout'), (-9.0, 'head'), (-1.0, 'head'), (2.0, 'body'), (6.5, 's2'), (11.0, 's3'), (15.5, 'tail'))
SPINE = ('snout', 'head', 'body', 's2', 's3', 'tail')
MID_Z = -1.0
DORSAL = ('d1', 'd2', 'd3')
ANAL = ('a1', 'a2', 'a3')
DORSAL_ARC = ((1.0, 9.0), (5.0, 15.0), (11.0, 19.0), (23.0, 20.0))
ANAL_ARC = ((1.0, -10.0), (5.0, -15.0), (10.0, -18.0), (15.5, -20.0))
# A vertex is fin by how far it stands off the body: eased in over these z.
DORSAL_IN, ANAL_IN = (9.0, 13.0), (-10.0, -14.0)
TAIL_FROM = 15.5  # the caudal bar: never fin, however tall


def hat(x, centres, names):
    """Linear hand-over between neighbouring centres: two bones at most."""
    if x <= centres[0]:
        return {names[0]: 1.0}
    for i in range(len(centres) - 1):
        a, b = centres[i], centres[i + 1]
        if x <= b:
            u = ease((x - a) / (b - a))
            return {names[i]: 1 - u, names[i + 1]: u}
    return {names[-1]: 1.0}


def knots(y, ks):
    """Weights along a list of (position, bone) knots, eased between neighbours."""
    if y <= ks[0][0]:
        return {ks[0][1]: 1.0}
    for (a, na), (b, nb) in zip(ks, ks[1:]):
        if y <= b:
            if na == nb:
                return {na: 1.0}
            u = ease((y - a) / (b - a))
            return {na: 1 - u, nb: u}
    return {ks[-1][1]: 1.0}


def along(arc, y, z):
    """How far along an arc (polyline in y, z) a point lies, by its nearest point."""
    best, run, at = 1e9, 0.0, 0.0
    for (y0, z0), (y1, z1) in zip(arc, arc[1:]):
        dy, dz = y1 - y0, z1 - z0
        L2 = dy * dy + dz * dz
        u = max(0.0, min(1.0, ((y - y0) * dy + (z - z0) * dz) / L2))
        d = (y - (y0 + u * dy)) ** 2 + (z - (z0 + u * dz)) ** 2
        if d < best:
            best, at = d, run + u * math.sqrt(L2)
        run += math.sqrt(L2)
    return at


def arc_centres(arc):
    """Each fin bone's weight peaks at its segment's middle, by arc length."""
    out, run = [], 0.0
    for (y0, z0), (y1, z1) in zip(arc, arc[1:]):
        L = math.hypot(y1 - y0, z1 - z0)
        out.append(run + L / 2)
        run += L
    return out


def weights_at(co, eye):
    if eye:
        return {'head': 1.0}
    spine = knots(co.y, SPINE_KNOTS)
    if co.y >= TAIL_FROM:
        return spine
    if co.z > 0:
        lo, hi = DORSAL_IN
        f = ease((co.z - lo) / (hi - lo))
        arc, names = DORSAL_ARC, DORSAL
    else:
        lo, hi = ANAL_IN
        f = ease((lo - co.z) / (lo - hi))
        arc, names = ANAL_ARC, ANAL
    if f <= 0:
        return spine
    fin = hat(along(arc, co.y, co.z), arc_centres(arc), names)
    out = {}
    for k, v in spine.items():
        out[k] = out.get(k, 0) + v * (1 - f)
    for k, v in fin.items():
        out[k] = out.get(k, 0) + v * f
    return {k: v for k, v in out.items() if v > 1e-4}


def bone_of(x, y, z, mat):
    """Only to start the vertex groups (weights_at decides): eyes or not."""
    return '_eye' if 'EYE' in mat else '_part'


def soften(meshes):
    blended, most = 0, 0
    for o in meshes:
        groups = {g.name: g for g in o.vertex_groups}
        idx = {g.index: g.name for g in o.vertex_groups}
        for v in o.data.vertices:
            names = [idx[g.group] for g in v.groups]
            if not names:
                continue
            w = weights_at(v.co, names[0] == '_eye')
            total = sum(w.values())
            for g in list(groups.values()):
                g.remove([v.index])
            for n, x in w.items():
                if n not in groups:
                    groups[n] = o.vertex_groups.new(name=n)
                groups[n].add([v.index], x / total, 'REPLACE')
            blended += len(w) > 1
            most = max(most, len(w))
        # The placeholders only (a real bone is named 'body': it must keep its group).
        for stale in ('_eye', '_part'):
            if stale in groups:
                o.vertex_groups.remove(groups[stale])
    assert most <= 4, most  # glTF skins carry four influences a vertex
    return blended


def bone_table():
    t = {'root': ((0, 0, -26), (0, 0, -23), None)}
    # roll: the whole fish about its long axis (a pirouette). body: the core.
    t['roll'] = ((0, 2, MID_Z), (0, 2.5, MID_Z), 'root')
    t['body'] = ((0, 2, MID_Z), (0, 6.5, MID_Z), 'roll')
    # Forward: two look dials (yaw, then pitch) at the neck, then the head
    # and the snout — the nose leads, turns to look, nuzzles and sniffs.
    t['lookY'] = ((0, -1, MID_Z), (0, -1.5, MID_Z), 'body')
    t['lookP'] = ((0, -1, MID_Z), (0, -1.5, MID_Z), 'lookY')
    t['head'] = ((0, -1, MID_Z), (0, -9, MID_Z), 'lookP')
    t['snout'] = ((0, -9, MID_Z), (0, -15.5, MID_Z), 'head')
    # Back: a flex bone above each body bone for the bend dial.
    for name, parent, y0, y1, flex in (('s2', 'body', 6.5, 11.0, 'flex2'), ('s3', 's2', 11.0, 15.5, 'flex3'), ('tail', 's3', 15.5, 20.0, 'flex4')):
        t[flex] = ((0, y0, MID_Z), (0, y0 + 0.5, MID_Z), parent)
        t[name] = ((0, y0, MID_Z), (0, y1, MID_Z), flex)
    # The fin segments along their arcs, each riding the spine bone beside
    # it: the arcs run back alongside the body (the dorsal's streamers over the
    # tail), so they curve and wave with it, then ripple on top.
    for names, arc in ((DORSAL, DORSAL_ARC), (ANAL, ANAL_ARC)):
        for name, ride, (y0, z0), (y1, z1) in zip(names, ('body', 's2', 's3'), arc, arc[1:]):
            t[name] = ((0, y0, z0), (0, y1, z1), ride)
    return t


def sway_axis(arc, i):
    """The axis a fin segment swings its tip sideways about: in the body's
    plane, square to the segment (rotating about it carries the tip to ±X)."""
    (y0, z0), (y1, z1) = arc[i], arc[i + 1]
    L = math.hypot(y1 - y0, z1 - z0)
    return Vector((0.0, -(z1 - z0) / L, (y1 - y0) / L))


def turn_about(p, bone, axis, angle):
    p.rot[bone] = Quaternion(axis, angle) @ p.rot.get(bone, Quaternion())


BACK = ('body', 's2', 's3', 'tail')


def wave(p, w, amps, lag=0.7):
    """A travelling wave down the body: each bone turns (relative to its
    parent, so the curve accumulates) a little later than the one before."""
    for i, (name, a) in enumerate(zip(BACK, amps)):
        p.turn(name, 'z', a * math.sin(w - lag * i))


def ripple(p, w, amps, lag=0.8, spread=0.0, fold=0.0):
    """The fins ripple sideways — a wave running back along each arc, the
    tips (the streamers) swinging widest; spread opens the arcs away from the
    body, fold lays them back toward it (about X: + carries a tip forward)."""
    for names, arc, sign in ((DORSAL, DORSAL_ARC, 1), (ANAL, ANAL_ARC, -1)):
        for i, (name, a) in enumerate(zip(names, amps)):
            turn_about(p, name, sway_axis(arc, i), a * math.sin(w - 0.9 - lag * i))
            p.turn(name, 'x', sign * (0.05 * spread - 0.08 * fold))


def nose(p, nod=0.0, yaw=0.0, sniff=0.0):
    """The head nods (+ dips the nose) and turns (+ to its left); the snout
    tips on its own — a sniff, a nuzzle. About X, + carries the nose DOWN."""
    p.turn('head', 'x', 0.6 * nod)
    p.turn('head', 'z', yaw)
    p.turn('snout', 'x', 0.4 * nod + sniff)


def swim(t, T=1.6):
    p = Pose()
    w = 2 * math.pi * t / T
    nose(p, yaw=-0.03 * math.sin(w + 0.6), sniff=0.04 * math.sin(2 * w))
    wave(p, w, (0.02, 0.05, 0.08, 0.2))
    ripple(p, w, (0.05, 0.08, 0.16))
    return p


def hover(t, T=3.2):
    p = Pose()
    w = 2 * math.pi * t / T
    nose(p, nod=0.04 * math.sin(w), sniff=0.05 * math.sin(3 * w))
    wave(p, w, (0.005, 0.015, 0.02, 0.05))
    ripple(p, 2 * w, (0.08, 0.12, 0.18), lag=0.9, spread=0.5)
    return p


def burst(t, T=0.9):
    p = Pose()
    strokes = env(t, 0.04, 0.12, 0.6, 0.85)
    w = 2 * math.pi * t / 0.3
    nose(p, nod=-0.06 * strokes)
    wave(p, w, tuple(a * strokes for a in (0.05, 0.12, 0.16, 0.32)), lag=0.8)
    ripple(p, w, tuple(a * strokes for a in (0.03, 0.06, 0.14)), fold=env(t, 0.0, 0.1, 0.65, T))
    return p


def display(t, T=3.0):
    p = Pose()
    on = env(t, 0.0, 0.8, T - 0.8, T)
    w = 2 * math.pi * t / 1.0
    p.turn('body', 'y', 0.1 * on)  # leans to show its side
    nose(p, nod=-0.08 * on)
    wave(p, w, tuple(a * on for a in (0.01, 0.02, 0.03, 0.06)))
    ripple(p, w, tuple(a * on for a in (0.06, 0.1, 0.16)), spread=on)
    return p


# The moments: each its own small act, starting and ending at rest.

def nibble(t, T=2.4):
    """Pecks at something in front of it: the nose dips and lifts, dips and
    lifts. Each peck a sin² — a half-wave rectified sine kinks at every zero."""
    p = Pose()
    on = env(t, 0.0, 0.35, T - 0.35, T)
    peck = math.sin(math.pi * (t - 0.4) / 0.65) ** 2 * env(t, 0.35, 0.7, T - 0.9, T - 0.3)
    nose(p, nod=0.18 * on + 0.2 * peck, sniff=0.18 * peck)
    p.turn('body', 'x', 0.08 * on)  # tips nose-down to it
    ripple(p, 2 * math.pi * t / 0.8, (0.06, 0.08, 0.12), spread=0.6 * on)
    return p


def curious(t, T=3.0):
    """Turns its head to look aside, holds, snout twitching — then back."""
    p = Pose()
    look = env(t, 0.0, 0.5, T - 0.6, T)
    twitch = 0.08 * math.sin(2 * math.pi * t / 0.6) * env(t, 0.6, 0.9, T - 1.0, T - 0.6)
    nose(p, nod=-0.05 * look, yaw=0.35 * look, sniff=twitch)
    p.turn('body', 'z', 0.08 * look)
    wave(p, 2 * math.pi * t / 2.0, (0.0, 0.02, 0.03, 0.06))
    ripple(p, 2 * math.pi * t / 1.2, (0.05, 0.08, 0.12), spread=0.8 * look)
    return p


def kiss(t, T=2.0):
    """Two little pecks forward of the lips — a kiss blown at the glass. Each
    rises over 0.28 s: any quicker and the snout snaps rather than puckers."""
    p = Pose()
    on = env(t, 0.0, 0.3, T - 0.3, T)
    pucker = sum(env(t, a, a + 0.28, a + 0.36, a + 0.64) for a in (0.3, 1.0))
    nose(p, nod=-0.1 * on, sniff=-0.3 * pucker)
    p.turn('body', 'x', -0.05 * on)
    ripple(p, 2 * math.pi * t / 0.5, tuple(a * on for a in (0.04, 0.06, 0.1)))
    return p


def soar(t, T=4.0):
    """Fins spread like wings, the body arching as it lifts — an angel."""
    p = Pose()
    on = env(t, 0.0, 1.0, T - 1.0, T)
    w = 2 * math.pi * t / 2.0
    p.turn('body', 'x', -0.14 * on)  # nose up
    nose(p, nod=-0.1 * on)
    p.turn('tail', 'x', 0.12 * on)
    wave(p, w, tuple(a * on for a in (0.0, 0.02, 0.03, 0.08)))
    ripple(p, w, tuple(a * on for a in (0.1, 0.14, 0.22)), lag=1.0, spread=1.6 * on)
    return p


def pirouette(t, T=2.4):
    """A full roll about its long axis, fins flared, then still again."""
    p = Pose()
    spin = 2 * math.pi * ease(t / T)
    p.turn('roll', 'y', spin)
    flare = env(t, 0.0, 0.4, T - 0.4, T)
    ripple(p, 2 * math.pi * t / 0.6, tuple(a * flare for a in (0.05, 0.08, 0.14)), spread=1.2 * flare)
    nose(p, nod=-0.06 * flare)
    return p


def bow(t, T=2.6):
    """A curtsy: the nose dips low and the fins sweep forward, then it rises."""
    p = Pose()
    dip = env(t, 0.0, 0.8, T - 1.0, T)
    p.turn('body', 'x', 0.12 * dip)
    nose(p, nod=0.3 * dip)
    p.turn('tail', 'x', -0.1 * dip)
    ripple(p, 2 * math.pi * t / 1.3, tuple(a * dip for a in (0.03, 0.05, 0.08)), spread=-0.8 * dip, fold=-0.6 * dip)
    return p


def flutter(t, T=1.6):
    """Excited: a quick shimmer down every fin, the tail wagging. Two a second:
    any faster reads as a vibration, not a fish (and a 30 fps clip aliases it)."""
    p = Pose()
    on = env(t, 0.0, 0.4, T - 0.6, T)
    w = 2 * math.pi * t / 0.5
    ripple(p, w, tuple(a * on for a in (0.06, 0.08, 0.12)), lag=0.6, spread=0.8 * on)
    wave(p, w * 0.5, tuple(a * on for a in (0.02, 0.04, 0.06, 0.14)))
    nose(p, sniff=0.1 * math.sin(w) * on)
    return p


def sway(t, T=4.0):
    """A slow dance: head and tail swing against each other, fins drifting."""
    p = Pose()
    on = env(t, 0.0, 0.8, T - 0.8, T)
    w = 2 * math.pi * t / 2.0
    nose(p, yaw=0.2 * math.sin(w) * on, nod=0.05 * math.sin(2 * w) * on)
    wave(p, w + math.pi, tuple(a * on for a in (0.03, 0.06, 0.08, 0.12)), lag=0.3)
    ripple(p, w, tuple(a * on for a in (0.08, 0.12, 0.18)), lag=1.0, spread=0.4 * on)
    return p


def stretch(t, T=2.6):
    """It stretches: arching back, every fin spread wide, held, then released."""
    p = Pose()
    arch = env(t, 0.0, 0.9, T - 0.8, T)
    p.turn('body', 'x', -0.08 * arch)
    nose(p, nod=-0.18 * arch)
    p.turn('s3', 'x', -0.08 * arch)
    p.turn('tail', 'x', -0.1 * arch)
    ripple(p, 2 * math.pi * t / 0.9, tuple(a * arch for a in (0.03, 0.04, 0.06)), spread=2.0 * arch)
    return p


def bend(t, T=2.0):
    """The dial: time 0 curved hard to its right, 1 straight, 2 hard to its left."""
    p = Pose()
    b = t - 1.0
    for name in ('flex2', 'flex3', 'flex4'):
        p.turn(name, 'z', 0.13 * b)
    return p


def look_yaw(t, T=2.0):
    """The dial: time 0 the head turned hard to its right, 1 ahead, 2 to its left."""
    p = Pose()
    p.turn('lookY', 'z', 0.5 * (t - 1.0))
    return p


def look_pitch(t, T=2.0):
    """The dial: time 0 the nose down, 1 level, 2 up (about X, + is down)."""
    p = Pose()
    p.turn('lookP', 'x', -0.32 * (t - 1.0))
    return p


CLIPS = [
    ('swim', swim, 1.6), ('hover', hover, 3.2), ('burst', burst, 0.9), ('display', display, 3.0),
    ('nibble', nibble, 2.4), ('curious', curious, 3.0), ('kiss', kiss, 2.0), ('soar', soar, 4.0),
    ('pirouette', pirouette, 2.4), ('bow', bow, 2.6), ('flutter', flutter, 1.6), ('sway', sway, 4.0),
    ('stretch', stretch, 2.6),
    ('bend', bend, 2.0), ('lookYaw', look_yaw, 2.0), ('lookPitch', look_pitch, 2.0),
]


def main():
    scene = bpy.data.scenes.get(BREED) or bpy.data.scenes.new(BREED)
    with in_scene(scene):
        begin(BREED)
        meshes = load_source(BREED)
        # Face the rig convention: nose +X -> -Y. Rigid, the whole model at once.
        turn = Matrix.Rotation(-math.pi / 2, 4, 'Z')
        for o in meshes:
            o.data.transform(turn)
        pitch, phase = lattice(meshes)
        assert pitch == PITCH, (pitch, phase)
        segment(meshes, bone_of, pitch, phase, by_point=True)
        blended = soften(meshes)
        nondeform = ('root', 'roll', 'lookY', 'lookP', 'flex2', 'flex3', 'flex4')
        rig = build_armature('Angelfish', meshes, bone_table(), nondeform=nondeform)
        keyed = {pb.name: ['rotation_quaternion'] for pb in rig.pose.bones if pb.name != 'root'}
        clips = bake(rig, BREED, CLIPS, apply_pose, ('swim', 'hover'), keyed)
        out = export(rig, out_path(BREED), {}, layered=True)
        return {'blended_vertices': blended, 'bones': len(rig.data.bones), 'clips': clips, 'out': out,
                'bytes': os.path.getsize(out)}


if __name__ == '__main__':
    result = main()
    print(result)
