"""
The shared half of every rig script in breeds/rig/: load a delivered model,
find its voxel lattice, cut it into rigid parts, build an armature, pose it,
bake named clips and export the GLB the intake reads.

A breed script (crab.py, glowfish.py) supplies only its anatomy — which bone a
voxel face belongs to, where the bones sit — and its clips as functions of
seconds. The rules every rig keeps are in breeds/README.md ("Rigged breeds").

Each breed builds in its OWN Blender scene, named after it, so build.py can
put every rig in one .blend. Clip actions are named `<breed>:<clip>` (actions
are file-global, and two breeds may both have a `swim`); the intake strips the
prefix.
"""
import contextlib
import math
import os
import re

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

FPS = 30
HERE = os.path.dirname(os.path.abspath(__file__))
BREEDS = os.path.dirname(HERE)


def source_path(breed):
    return os.path.join(BREEDS, 'source', f'{breed}.glb')


def out_path(breed):
    return os.path.join(HERE, f'{breed}.glb')


def base_name(name):
    """A material's name without Blender's duplicate suffix (`.001`)."""
    return re.sub(r'\.\d{3}$', '', name)


# --------------------------------------------------------------------------
# Scene
# --------------------------------------------------------------------------

@contextlib.contextmanager
def in_scene(scene):
    """Run with `scene` as the context's scene. A window can simply show it;
    headless (`blender -b`) there is no window, so the context is overridden."""
    win = bpy.context.window
    if win is not None:
        win.scene = scene
    with bpy.context.temp_override(scene=scene, view_layer=scene.view_layers[0]):
        yield scene


def begin(breed):
    """The breed's own scene, emptied (call inside `in_scene` of it)."""
    scene = bpy.data.scenes.get(breed) or bpy.data.scenes.new(breed)
    for o in list(scene.objects):
        data = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if data is not None and data.users == 0:
            (bpy.data.meshes if isinstance(data, bpy.types.Mesh) else bpy.data.armatures).remove(data)
    for a in list(bpy.data.actions):
        if a.name.startswith(f'{breed}:'):
            bpy.data.actions.remove(a)
    for m in list(bpy.data.materials):
        if m.users == 0:
            bpy.data.materials.remove(m)
    scene.render.fps = FPS
    return scene


def load_source(breed):
    """Import the delivered model into the current scene and bake every node
    transform into its vertices (the intake does the same), so the meshes
    and the armature share one frame."""
    scene = bpy.context.scene
    before = set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=source_path(breed))
    meshes = [o for o in scene.objects if o not in before and o.type == 'MESH']
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.data.transform(mw)
        o.matrix_world = Matrix.Identity(4)
    for o in [o for o in scene.objects if o not in before and o.type == 'EMPTY']:
        bpy.data.objects.remove(o, do_unlink=True)
    return meshes


def lattice(meshes):
    """The voxel pitch and, per axis, the phase of the planes faces lie in.
    Measured, never assumed: the crab's y planes sit on even coordinates and
    its x and z on odd ones; the glowfish differs again."""
    sides, phases = {}, [{}, {}, {}]
    for o in meshes:
        for f in o.data.polygons:
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            if abs(n[ax]) < 0.999:
                continue
            k = round(math.sqrt(f.area * 2), 2)  # a triangle is half its square
            sides[k] = sides.get(k, 0) + 1
    pitch = max(sides, key=sides.get)
    for o in meshes:
        for f in o.data.polygons:
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            if abs(n[ax]) < 0.999:
                continue
            ph = round(f.center[ax] % pitch, 2) % pitch
            phases[ax][ph] = phases[ax].get(ph, 0) + 1
    return pitch, tuple(max(p, key=p.get) for p in phases)


def segment(meshes, bone_of, pitch, phase):
    """A vertex group per part: every face weighted 1.0 to the bone its voxel
    belongs to (`bone_of(ix, iy, iz, material)`). Returns faces per bone."""
    counts = {}
    for o in meshes:
        me = o.data
        mat = base_name(me.materials[0].name)
        bm = bmesh.new()
        bm.from_mesh(me)
        owner = {}
        for f in bm.faces:
            c = f.calc_center_median() - f.normal * (pitch / 2)
            ijk = [math.floor((c[a] - phase[a]) / pitch) for a in range(3)]
            b = bone_of(*ijk, mat)
            counts[b] = counts.get(b, 0) + 1
            for v in f.verts:
                prev = owner.setdefault(v.index, b)
                assert prev == b, f'vertex {v.index} of {o.name} shared by {prev} and {b}'
        bm.free()
        for b in sorted(set(owner.values())):
            g = o.vertex_groups.new(name=b)
            g.add([i for i, ob in owner.items() if ob == b], 1.0, 'REPLACE')
    return counts


def build_armature(name, meshes, table, nondeform=('root',)):
    """`table`: bone -> (head, tail, parent). Rolls are 0; poses are authored
    in world axes (see `to_local`), so a bone's own axes never matter."""
    arm = bpy.data.armatures.new(f'{name}Rig')
    rig = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    for bone, (h, tl, _) in table.items():
        eb = arm.edit_bones.new(bone)
        eb.head, eb.tail = Vector(h), Vector(tl)
        eb.roll = 0
    for bone, (_, _, parent) in table.items():
        if parent:
            arm.edit_bones[bone].parent = arm.edit_bones[parent]
            arm.edit_bones[bone].use_connect = False
    for bone in nondeform:
        arm.edit_bones[bone].use_deform = False
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in meshes:
        o.parent = rig
        mod = o.modifiers.new('Armature', 'ARMATURE')
        mod.object = rig
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return rig


# --------------------------------------------------------------------------
# Posing: every rotation is authored as a WORLD axis + angle about the bone's
# head, relative to its parent (they compose), and converted to bone space.
# --------------------------------------------------------------------------

AX = {'x': Vector((1, 0, 0)), 'y': Vector((0, 1, 0)), 'z': Vector((0, 0, 1))}


def qa(axis, angle):
    return Quaternion(AX[axis], angle)


def to_local(rig, name, q_world):
    r = rig.data.bones[name].matrix_local.to_quaternion()
    return r.inverted() @ q_world @ r


def ease(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def env(t, a, b, c, d):
    """0 before a, eases to 1 over a..b, holds, eases back to 0 over c..d."""
    return ease((t - a) / max(1e-6, b - a)) * (1 - ease((t - c) / max(1e-6, d - c)))


def track(t, keys):
    """Piecewise eased value through [(time, value), ...]."""
    if t <= keys[0][0]:
        return keys[0][1]
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t <= t1:
            return v0 + (v1 - v0) * ease((t - t0) / max(1e-6, t1 - t0))
    return keys[-1][1]


class Pose:
    """One frame: per bone an extra rotation (world axis, relative to the
    parent), a world-space offset, and a scale in the bone's own frame."""

    def __init__(self):
        self.rot = {}
        self.loc = {}
        self.scale = {}

    def turn(self, bone, axis, angle):
        self.rot[bone] = qa(axis, angle) @ self.rot.get(bone, Quaternion())

    def move(self, bone, offset):
        self.loc[bone] = self.loc.get(bone, Vector()) + Vector(offset)


def reset(rig):
    for pb in rig.pose.bones:
        pb.rotation_quaternion = Quaternion()
        pb.location = Vector()
        pb.scale = Vector((1, 1, 1))


def apply_pose(rig, p):
    """The generic part of posing; a breed with IK (the crab's legs) adds its own."""
    pbs = rig.pose.bones
    for name, q in p.rot.items():
        pbs[name].rotation_quaternion = to_local(rig, name, q)
    for name, off in p.loc.items():
        pbs[name].location = rig.data.bones[name].matrix_local.to_quaternion().inverted() @ off
    for name, s in p.scale.items():
        pbs[name].scale = Vector(s)


def bake(rig, breed, clips, apply, loops, keyed):
    """Bake `clips` [(name, fn(seconds, T) -> pose, T)] into actions named
    `<breed>:<name>`, one NLA track each. `keyed`: bone -> channels it keys
    ('rotation_quaternion', 'location', 'scale'). A loop's last key is its
    first, so the wrap never pops; a one-shot ends where it began."""
    rig.animation_data_create()
    names = []
    for name, fn, T in clips:
        act = bpy.data.actions.new(f'{breed}:{name}')
        act.use_fake_user = True
        rig.animation_data.action = act
        frames = int(round(T * FPS))
        loop = name in loops
        for f in range(frames + 1):
            reset(rig)
            apply(rig, fn((f % frames if loop else f) / FPS, T))
            for bone, channels in keyed.items():
                for ch in channels:
                    rig.pose.bones[bone].keyframe_insert(ch, frame=f)
        for fc in fcurves(act):
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'
        nt = rig.animation_data.nla_tracks.new()
        nt.name = name
        nt.strips.new(act.name, 0, act)
        nt.mute = True
        names.append(name)
        rig.animation_data.action = None
    reset(rig)
    return names


def fcurves(act):
    if hasattr(act, 'fcurves') and len(getattr(act, 'fcurves', [])):
        return list(act.fcurves)
    out = []
    for layer in getattr(act, 'layers', []):
        for strip in layer.strips:
            for bag in strip.channelbags:
                out.extend(bag.fcurves)
    return out


def export(rig, path, extras):
    """The rig GLB: skin, clips as sampled named animations, facts the tank
    needs as extras on the armature node. Draco at its finest position
    precision (30 bits, ~5e-8 units): the delivered vertices come back as
    authored, and the committed file stays small."""
    rig['mqRig'] = 1
    for k, v in extras.items():
        rig[k] = v
    rig['mqFps'] = FPS
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    for o in rig.children:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        # This breed's scene only: by default the exporter writes every scene in the file.
        filepath=path, export_format='GLB', use_selection=True, use_active_scene=True,
        export_yup=True, export_apply=False, export_skins=True,
        # One animation per NLA track — this rig's own clips, named by their
        # tracks. ACTIONS would add every action in the file whose bones match.
        export_animations=True, export_animation_mode='NLA_TRACKS',
        export_force_sampling=True, export_frame_step=1,
        export_optimize_animation_size=True, export_def_bones=True,
        export_extras=True,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
        export_draco_position_quantization=30, export_draco_normal_quantization=10,
        export_draco_generic_quantization=16,
        export_normals=True, export_texcoords=False, export_attributes=False,
        export_materials='EXPORT', export_rest_position_armature=True,
    )
    return path
