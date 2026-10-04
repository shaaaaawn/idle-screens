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


def gltf_material_names(path):
    """The material names the GLB itself carries."""
    import json
    import struct
    with open(path, 'rb') as f:
        f.read(12)
        length, _ = struct.unpack('<II', f.read(8))
        return {m.get('name', '') for m in json.loads(f.read(length)).get('materials', [])}


def base_name(name, authored=()):
    """A material's name as the model authored it. A shared .blend renames a
    second `PrimaryColor` to `PrimaryColor.001`; but `Material.002` may be the
    authored name itself (the hackerfish's are), so only strip what the model
    did not write."""
    if name in authored:
        return name
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
        if len(o.users_scene) > 1:  # shared with another scene (a camera, a floor): only let go of it here
            for coll in [scene.collection, *scene.collection.children_recursive]:
                if o.name in coll.objects:
                    coll.objects.unlink(o)
            continue
        data = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if isinstance(data, bpy.types.Mesh) and data.users == 0:
            bpy.data.meshes.remove(data)
        elif isinstance(data, bpy.types.Armature) and data.users == 0:
            bpy.data.armatures.remove(data)
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
        o.data = o.data.copy()  # instanced nodes share one datablock: bake each its own
        o.data.transform(mw)
        o.matrix_world = Matrix.Identity(4)
    for o in [o for o in scene.objects if o not in before and o.type == 'EMPTY']:
        bpy.data.objects.remove(o, do_unlink=True)
    authored = gltf_material_names(source_path(breed))
    for o in meshes:  # a mesh may carry several materials (the shark's one mesh carries five)
        o['rigMaterials'] = [base_name(m.name, authored) for m in o.data.materials]
    names = [n for o in meshes for n in o['rigMaterials']]
    # A clash in a shared file can also INCREMENT a name (Material.006 →
    # Material.007): every part must resolve to its own authored material.
    assert len(set(names)) == len(names) and set(names) <= authored, (names, authored)
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


def segment(meshes, bone_of, pitch, phase, by_point=False):
    """A vertex group per part: every face weighted 1.0 to the bone its voxel
    belongs to (`bone_of(ix, iy, iz, material)`). Returns faces per bone.

    `by_point`: a model whose parts are not all on one lattice (the shark's
    fins sit off it) is cut by position instead — `bone_of(x, y, z, material)`
    gets the centre of the voxel behind the face."""
    counts = {}
    for o in meshes:
        me = o.data
        mats = list(o.get('rigMaterials') or [base_name(m.name) for m in me.materials])
        bm = bmesh.new()
        bm.from_mesh(me)
        owner = {}
        for f in bm.faces:
            if by_point:
                # The face's square, not the triangle's centroid, then half a voxel in.
                lo = [min(v.co[a] for v in f.verts) for a in range(3)]
                hi = [max(v.co[a] for v in f.verts) for a in range(3)]
                c = Vector([(lo[a] + hi[a]) / 2 for a in range(3)]) - f.normal * (pitch / 2)
                b = bone_of(c.x, c.y, c.z, mats[f.material_index])
            else:
                c = f.calc_center_median() - f.normal * (pitch / 2)
                ijk = [math.floor((c[a] - phase[a]) / pitch) for a in range(3)]
                b = bone_of(*ijk, mats[f.material_index])
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


# --------------------------------------------------------------------------
# Eyes that look about: a clean white box and a flat pupil on its face
# --------------------------------------------------------------------------

def clean_eyes(white, black, is_pupil):
    """Rebuild each eye (one per side of x = 0) for a pupil that SLIDES.

    A delivered eye is voxels: a white box with the pupil's cubes set into
    it, every cube a box of its own. Leave it so and a sliding pupil shows
    every seam — a hairline between two pupil cubes, an inner face's edge
    poking through the white where the pupil's draw-on-top offset lets it
    (the dori's line through the eye, the blowfish's at the pupil's edge).
    So each eye becomes ONE white box (six quads, the eye's full extent,
    pupil included — the white under the pupil is what a slide uncovers)
    and its pupil ONE quad on the box's front face (-y), its own footprint
    there. Nothing visible changes at rest. `is_pupil(centre)` picks the
    black faces that are pupil (not a mouth, not a tail's bar).
    Returns, per side, the white box and the pupil's rectangle."""
    out = {}
    for side in (1, -1):
        wf = [f for f in white.data.polygons if f.center.x * side > 0]
        bf = [f for f in black.data.polygons if f.center.x * side > 0 and is_pupil(f.center)]
        if not wf or not bf:
            continue
        pts = [white.data.vertices[i].co for f in wf for i in f.vertices] + [black.data.vertices[i].co for f in bf for i in f.vertices]
        lo = Vector([min(p[i] for p in pts) for i in range(3)])
        hi = Vector([max(p[i] for p in pts) for i in range(3)])
        front = [f for f in bf if f.normal.y < -0.9 and abs(f.center.y - lo.y) < 0.01]
        if not front:
            continue
        fp = [black.data.vertices[i].co for f in front for i in f.vertices]
        x0, x1 = min(p.x for p in fp), max(p.x for p in fp)
        z0, z1 = min(p.z for p in fp), max(p.z for p in fp)
        _replace(white, {f.index for f in wf}, _box_quads(lo, hi))
        _replace(black, {f.index for f in bf}, [([Vector((x0, lo.y, z0)), Vector((x1, lo.y, z0)), Vector((x1, lo.y, z1)), Vector((x0, lo.y, z1))], Vector((0, -1, 0)))])
        out[side] = ((tuple(lo), tuple(hi)), (x0, x1, z0, z1))
    return out


def _box_quads(lo, hi):
    """Six outward quads of the box lo..hi."""
    c = [Vector((hi.x if i & 1 else lo.x, hi.y if i & 2 else lo.y, hi.z if i & 4 else lo.z)) for i in range(8)]
    faces = [((0, 2, 6, 4), (-1, 0, 0)), ((1, 5, 7, 3), (1, 0, 0)), ((0, 4, 5, 1), (0, -1, 0)),
             ((2, 3, 7, 6), (0, 1, 0)), ((0, 1, 3, 2), (0, 0, -1)), ((4, 6, 7, 5), (0, 0, 1))]
    return [([c[i] for i in q], Vector(n)) for q, n in faces]


def _replace(obj, drop, quads):
    """Drop faces `drop` (and verts left loose) from `obj`; add `quads` [(corners, outward normal)]."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in drop], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    for corners, n in quads:
        f = bm.faces.new([bm.verts.new(v) for v in corners])
        f.normal_update()
        if f.normal.dot(n) < 0:
            f.normal_flip()
    bm.to_mesh(obj.data)
    bm.free()
