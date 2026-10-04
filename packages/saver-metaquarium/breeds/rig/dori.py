"""
Rig and animate the dori (a blue tang): breeds/source/dori.glb in, breeds/rig/dori.glb out.

    blender -b -P breeds/rig/dori.py        (from packages/saver-metaquarium)

An adult reef fish, and the first breed that does not swim with its tail. A
tang is a labriform swimmer: it flies on its pectoral fins with its body held
rigid, and only kicks its tail to burst (Wave-surge JEB 2019; yellow tangs
switch to the tail at ~3.3 body lengths/s). So its clips beat the fins, not a
wave down the body, and the tail is a clip of its own the tank layers in when
the fish darts.

Its eyes are the point of it, and they are NOT clips: a fish has no eyelids
(it never blinks) and a fixed pupil, so all the life is in where it looks.
src/dori.ts aims each eye every frame — the box of the eye swivels, the pupil
slides across its face — so this rig gives every eye and pupil a bone of its
own and no clip ever moves one.

The delivered model, as authored (Blender axes: it faces -Y, its left is +X,
Z is up; voxel planes on odd x and z, and y = -16.91 + 2k):

    body      the blue box (y -14.9..5.1, z -7..5) and the dark marking
              along its back; rigid
    head      the face in front of y -8.9, the black mouth under it
    dorsal    the dark ridge on top (z 5..9) over the body: it rises in a
              display
    peduncle  the dark band at the tail's root (y 5.1..8.9) — where a tang
              keeps its scalpel
    tail      the yellow fan with its black bar (y 8.9..16.9)
    pec.L/R   the yellow fins hanging on each side (x ±3..5, z -9..-3)
    eye.L/R   the white goggle boxes on the face (x ±1..7, y -16.9..-10.9)
    pupil.L/R the black square on the front of each, both glancing to its
              left: the designer's googly look, kept as the rest pose

The rig never changes a visible voxel. Two things it does to the delivered
data, neither visible at rest:
  - The dark marking arrives as 144 GPU-instanced cubes (36 of them twice in
    one place): they are joined into one mesh and the doubles dropped.
  - Each eye is rebuilt as one white box and its pupil as one black quad
    on its face (common.clean_eyes): the delivered cubes, left as they are,
    showed every seam as the pupil slid — a line through the eye.

Clips (30 fps; the tank sets their times, never update(dt)):

    fly       0.4 s loop. Cruise: both fins beat together, out and back on the
              power stroke, in and forward on the recovery, twisting as they
              go (a wing's stroke, 2.5 Hz); the body rides it, rigid.
    hover     0.8 s loop. Holding station: the fins scull in turn, small.
    back      0.36 s loop. Backing up — tangs would rather reverse than turn
              round: the stroke run backwards, quicker.
    burst     0.3 s loop. The tail at last: three links sweep hard while the
              fins fold flat. Layered in when the fish darts.
    pick      1.0 s. Snapping up plankton: a lean back, a dart and a snap,
              the fins flared to brake.
    flare     2.6 s. A display: the dorsal raised high, the fins spread, the
              body curled into a C, two hard flicks of the tail — the scalpel
              flashed — then it settles.
    headstand 3.0 s. Posing at a cleaning station: nose down, every fin spread,
              perfectly still, then level again.
    flop      3.0 s. Playing dead: it tips onto its side and hangs there,
              fins limp... then snaps upright with a kick of the tail.

The one-shots start and end on the rest pose.
"""
import math
import os
import sys

import bpy
from mathutils import Matrix

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (  # noqa: E402
    Pose, apply_pose, bake, begin, build_armature, clean_eyes, ease, env, export, in_scene, lattice, out_path, segment,
    source_path, track,
)

# The delivered materials by their base colour (the names are Material.00x and
# collide with other breeds' in a shared .blend, so they cannot be trusted).
ROLES = [
    ((1.0, 1.0, 1.0), 'GLOW-Yellow'),        # no base colour authored: the tail and fins
    ((0.8, 0.8, 0.8), 'EYES-White'),
    ((0.0, 0.0, 0.0), 'EYES-Black'),         # the pupils, the mouth, the tail's bar
    ((0.0022, 0.1354, 0.8), 'PrimaryColor'),
    ((0.0, 0.0001, 0.0637), 'SecondaryColor'),
]

def role_of(mat):
    c = mat.diffuse_color
    return min(ROLES, key=lambda r: sum((c[i] - r[0][i]) ** 2 for i in range(3)))[1]


def load_dori():
    """Import the delivered model and bake its transforms, as load_source does
    — but its marking is GPU-instanced (many objects sharing one mesh), and
    its material names are not unique in a shared file."""
    scene = bpy.context.scene
    before = set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=source_path('dori'))
    new = [o for o in scene.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    for o in [o for o in new if o.type == 'EMPTY']:
        mws = [(c, c.matrix_world.copy()) for c in o.children]
        for c, mw in mws:
            c.parent = None
            c.matrix_world = mw
        bpy.data.objects.remove(o, do_unlink=True)
    seen, kept = set(), []
    for o in meshes:
        mw = o.matrix_world.copy()
        key = (o.data.name.split('.')[0], tuple(round(v, 2) for v in mw.translation))
        if o.data.users > 1 and key in seen:  # an instance twice in one place
            bpy.data.objects.remove(o, do_unlink=True)
            continue
        seen.add(key)
        if o.data.users > 1:
            o.data = o.data.copy()
        o.parent = None
        o.data.transform(mw)
        o.matrix_world = Matrix.Identity(4)
        kept.append(o)
    # One object per material: the instanced cubes join their own colour.
    by_role = {}
    for o in kept:
        by_role.setdefault(role_of(o.data.materials[0]), []).append(o)
    out = []
    for role, objs in by_role.items():
        if len(objs) > 1:
            with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, selected_objects=objs):
                bpy.ops.object.join()
        o = objs[0]
        o.name = f'dori-{role}'
        m = o.data.materials[0]
        m.name = role  # a clash in a shared file suffixes it (.001): the intake strips that
        o['rigMaterials'] = [role]
        out.append(o)
    return out


def is_pupil(c):
    """A pupil face: in front, high on the face (not the mouth under it, nor the tail's bar)."""
    return c.y < -14.5 and c.z > -1.5 and abs(c.x) > 0.5


def spine_of(y):
    if y < -8.91:
        return 'head'
    if y < 5.09:
        return 'body'
    if y < 8.91:
        return 'peduncle'
    return 'tail'


def bone_of(x, y, z, mat):
    side = 'L' if x > 0 else 'R'
    if mat == 'EYES-White':
        return f'eye.{side}'
    if mat == 'EYES-Black':
        if y < -14.5 and z > -1.5 and abs(x) > 0.5:
            return f'pupil.{side}'
        return 'tail' if y > 8.91 else 'head'
    if mat == 'GLOW-Yellow':
        return 'tail' if y > 8.91 else f'pec.{side}'
    if mat == 'SecondaryColor' and z > 5 and -8.91 < y < 5.09:
        return 'dorsal'
    return spine_of(y)


# A soft spine, as the shark's and the babyfish's: the vertices on each
# joint's plane blend half and half, so the C of a display and the tail's
# burst bend one body instead of cracking it into blocks. Rigid: the eyes,
# the fins, the dorsal.
SPINE = ['head', 'body', 'peduncle', 'tail']
BENDS = [(-8.91, 1.0), (5.09, 1.0), (8.91, 1.0)]


def spine_weights(y):
    for i, (yj, h) in enumerate(BENDS):
        if abs(y - yj) < h:
            s = ease((y - (yj - h)) / (2 * h))
            return {SPINE[i]: 1 - s, SPINE[i + 1]: s}
    k = sum(1 for yj, _ in BENDS if y >= yj)
    return {SPINE[k]: 1.0}


def soften(meshes):
    blended = 0
    for o in meshes:
        groups = {g.name: g for g in o.vertex_groups}
        idx = {g.index: g.name for g in o.vertex_groups}
        for v in o.data.vertices:
            names = [idx[g.group] for g in v.groups]
            if not names or names[0] not in SPINE:
                continue
            w = spine_weights(v.co.y)
            for n in SPINE:
                if n in groups:
                    groups[n].remove([v.index])
            for n, x in w.items():
                if n not in groups:
                    groups[n] = o.vertex_groups.new(name=n)
                groups[n].add([v.index], x, 'REPLACE')
            blended += len(w) > 1
    return blended


def bone_table():
    # Every bone points tailward (+Y): a bone pointing back exports a rest
    # rotation of q while its keys come out as -q, and the intake would not see
    # that a clip leaves it alone. Each head is the part's pivot.
    return {
        'root': ((0, -2, -14), (0, -2, -12), None),
        'body': ((0, -2, 0), (0, 0, 0), 'root'),
        'head': ((0, -8.91, 0), (0, -6.91, 0), 'body'),
        'dorsal': ((0, -2, 5), (0, 0, 5), 'body'),
        'peduncle': ((0, 5.09, 0), (0, 7.09, 0), 'body'),
        'tail': ((0, 8.91, 2), (0, 10.91, 2), 'peduncle'),
        # A fin hinges on its top edge, against the body's side.
        'pec.L': ((3, -5.91, -3), (3, -3.91, -3), 'body'),
        'pec.R': ((-3, -5.91, -3), (-3, -3.91, -3), 'body'),
        # An eye swivels about its middle; its pupil slides on its front face.
        'eye.L': ((4, -13.91, 0), (4, -11.91, 0), 'head'),
        'eye.R': ((-4, -13.91, 0), (-4, -11.91, 0), 'head'),
        'pupil.L': ((5, -16.91, 1), (5, -14.91, 1), 'eye.L'),
        'pupil.R': ((-3, -16.91, 1), (-3, -14.91, 1), 'eye.R'),
    }


# ---------------------------------------------------------------------------
# Clips. Signs, in Blender axes: a fin swings OUT from the body as
# pec.L turns -y / pec.R +y; its tip sweeps BACK as it turns +x; the nose
# drops as the body turns +x; the tail swings to the fish's left as it turns +z.
# ---------------------------------------------------------------------------

def fins(p, phi, out=0.7, sweep=0.35, twist=0.5, phase_r=0.0, rest_out=0.0):
    """One wing stroke at phase `phi` for each fin: out and back on the power
    stroke, in and forward on the recovery, twisting a quarter turn behind.
    Never in past the body: the abduction only ever opens."""
    for side, sgn, ph in (('L', 1, phi), ('R', -1, phi + phase_r)):
        a = rest_out + out * (0.5 + 0.5 * math.sin(ph))
        b = -sweep * math.cos(ph)
        c = twist * math.cos(ph - math.pi / 2)
        p.turn(f'pec.{side}', 'x', b)
        p.turn(f'pec.{side}', 'z', sgn * c)
        p.turn(f'pec.{side}', 'y', -sgn * a)


def spread(p, k):
    """Every fin opened wide (a display, a pose)."""
    fins(p, math.pi / 2, out=0.9 * k, sweep=0.15 * k, twist=0.0)


def dorsal(p, rise):
    p.scale['dorsal'] = (1, 1, 1 + rise)


def fly(t, T=0.4):
    phi = 2 * math.pi * t / T
    p = Pose()
    fins(p, phi)
    # The body rides the stroke: a lift on each power stroke, a nod behind it.
    p.move('body', (0, 0, 0.18 * math.sin(phi)))
    p.turn('body', 'x', -0.02 * math.cos(phi))
    p.turn('tail', 'z', 0.04 * math.sin(phi - 1.0))
    return p


def hover(t, T=0.8):
    phi = 2 * math.pi * t / T
    p = Pose()
    fins(p, phi, out=0.35, sweep=0.25, twist=0.3, phase_r=math.pi, rest_out=0.1)
    p.move('body', (0, 0, 0.12 * math.sin(phi / 1)))
    p.turn('body', 'y', 0.015 * math.sin(phi))
    p.turn('tail', 'z', 0.05 * math.sin(phi - 0.8))
    return p


def back(t, T=0.36):
    phi = -2 * math.pi * t / T
    p = Pose()
    fins(p, phi, out=0.55, sweep=0.4, twist=0.45)
    p.move('body', (0, 0, 0.12 * math.sin(phi)))
    p.turn('tail', 'z', 0.05 * math.sin(phi))
    return p


def burst(t, T=0.3):
    phi = 2 * math.pi * t / T
    p = Pose()
    p.turn('peduncle', 'z', 0.32 * math.sin(phi))
    p.turn('tail', 'z', 0.5 * math.sin(phi - 0.7))
    p.turn('head', 'z', -0.07 * math.sin(phi))
    p.turn('body', 'z', -0.04 * math.sin(phi))
    # The fins folded back flat along the sides.
    for side in ('L', 'R'):
        p.turn(f'pec.{side}', 'x', 0.55)
    return p


def pick(t, T=1.0):
    p = Pose()
    lean = env(t, 0.0, 0.2, 0.22, 0.3)
    dart = track(t, [(0, 0), (0.25, 0), (0.38, 1), (0.6, 1), (T, 0)])
    snap = env(t, 0.3, 0.38, 0.42, 0.55)
    brake = env(t, 0.38, 0.48, 0.65, 0.9)
    p.move('body', (0, 0.6 * lean - 1.8 * dart, 0))
    p.turn('head', 'x', 0.18 * snap - 0.06 * lean)
    p.turn('body', 'x', 0.06 * snap)
    fins(p, math.pi * 0.0, out=0.9 * brake, sweep=0.45 * brake, twist=0.0)
    p.turn('tail', 'z', 0.25 * math.sin(2 * math.pi * 5 * t) * env(t, 0.25, 0.3, 0.38, 0.45))
    return p


def flare(t, T=2.6):
    p = Pose()
    up = env(t, 0.0, 0.4, 2.1, 2.6)
    dorsal(p, 0.55 * up)
    spread(p, up)
    p.scale['tail'] = (1, 1, 1 + 0.18 * up)
    # Curled into a C, broadside: head and tail to the same side.
    p.turn('head', 'z', 0.12 * up)
    p.turn('peduncle', 'z', 0.2 * up)
    p.turn('tail', 'z', 0.28 * up)
    p.turn('body', 'y', 0.12 * up)
    # Two hard flicks the other way: the scalpel flashed.
    flick = env(t, 1.15, 1.25, 1.35, 1.5) + env(t, 1.55, 1.65, 1.75, 1.95)
    p.turn('peduncle', 'z', -0.75 * flick)
    p.turn('tail', 'z', -0.55 * flick)
    p.turn('body', 'z', 0.06 * flick)
    return p


def headstand(t, T=3.0):
    p = Pose()
    pose = env(t, 0.0, 0.7, 2.2, 3.0)
    p.turn('body', 'x', 0.85 * pose)
    spread(p, pose)
    dorsal(p, 0.35 * pose)
    p.scale['tail'] = (1, 1, 1 + 0.15 * pose)
    # Perfectly still but for a fin's scull.
    fins(p, 2 * math.pi * t / 0.9, out=0.12 * pose, sweep=0.1 * pose, twist=0.1 * pose)
    return p


def flop(t, T=3.0):
    p = Pose()
    side = track(t, [(0, 0), (0.15, 0), (0.6, 1), (2.25, 1), (2.45, 0), (T, 0)])
    limp = env(t, 0.3, 0.7, 2.1, 2.3)
    p.turn('body', 'y', 1.45 * side + 0.04 * math.sin(2 * math.pi * 0.8 * t) * limp)
    p.move('body', (0, 0, -1.2 * side))
    # Fins limp: they hang with the fall.
    p.turn('pec.L', 'y', 0.3 * limp)
    p.turn('pec.R', 'y', 0.3 * limp)
    p.turn('tail', 'z', 0.08 * limp)
    # Up again in a hurry: a kick of the tail, the fins flared.
    kick = env(t, 2.3, 2.4, 2.75, 2.95)
    p.turn('peduncle', 'z', 0.3 * math.sin(2 * math.pi * 4 * t) * kick)
    p.turn('tail', 'z', 0.45 * math.sin(2 * math.pi * 4 * t - 0.7) * kick)
    spread(p, 0.6 * kick)
    return p


CLIPS = [('fly', fly, 0.4), ('hover', hover, 0.8), ('back', back, 0.36), ('burst', burst, 0.3),
         ('pick', pick, 1.0), ('flare', flare, 2.6), ('headstand', headstand, 3.0), ('flop', flop, 3.0)]
LOOPS = ('fly', 'hover', 'back', 'burst')


def main():
    scene = bpy.data.scenes.get('dori') or bpy.data.scenes.new('dori')
    with in_scene(scene):
        begin('dori')
        meshes = load_dori()
        role = {o['rigMaterials'][0]: o for o in meshes}
        eyes = clean_eyes(role['EYES-White'], role['EYES-Black'], is_pupil)
        pitch, phase = lattice(meshes)
        counts = segment(meshes, bone_of, pitch, phase, by_point=True)
        counts['blended vertices'] = soften(meshes)
        counts['eyes'] = eyes
        rig = build_armature('Dori', meshes, bone_table())
        keyed = {
            'body': ['rotation_quaternion', 'location'],
            'head': ['rotation_quaternion'], 'peduncle': ['rotation_quaternion'],
            'tail': ['rotation_quaternion', 'scale'], 'dorsal': ['scale'],
            'pec.L': ['rotation_quaternion'], 'pec.R': ['rotation_quaternion'],
        }
        clips = bake(rig, 'dori', CLIPS, apply_pose, LOOPS, keyed)
        out = export(rig, out_path('dori'), {})
        return {'faces_per_bone': counts, 'bones': len(rig.data.bones), 'clips': clips, 'out': out,
                'bytes': os.path.getsize(out), 'lattice': (pitch, phase)}


if __name__ == '__main__':
    result = main()
    print(result)
