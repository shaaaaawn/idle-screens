"""
Every rigged breed in one .blend: a scene per breed (crab, glowfish, …), each
with its rig, its clips as muted NLA tracks, a camera and lights, ready to
scrub and to edit by hand.

    blender -b -P breeds/rig/build.py -- /path/to/metaquarium-breeds.blend

Each breed's script also writes its rig GLB (breeds/rig/<breed>.glb), as if
run alone. The scripts are the source of truth: a hand edit in the .blend
reaches the tank only through export.py (or by porting it into the script,
which the next build would otherwise overwrite).
"""
import importlib
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, HERE)
from common import in_scene  # noqa: E402

BREEDS = ['crab', 'glowfish', 'hackerfish', 'shark', 'starfish', 'babyfish', 'dori']


def stage(scene, rig, first_clip):
    """A camera three-quarters on, a key and a rim light, the first clip on the timeline."""
    box = [rig.matrix_world @ Vector(c) for o in rig.children if o.type == 'MESH' for c in o.bound_box]
    lo = Vector([min(v[i] for v in box) for i in range(3)])
    hi = Vector([max(v[i] for v in box) for i in range(3)])
    centre, size = (lo + hi) / 2, max(hi - lo)
    cam = bpy.data.objects.new(f'{scene.name}-camera', bpy.data.cameras.new(f'{scene.name}-camera'))
    scene.collection.objects.link(cam)
    d = Vector((math.sin(0.7), -math.cos(0.7), 0.45)).normalized()
    cam.location = centre + d * size * 2.6
    cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    for name, energy, at in (('key', 3.0, (-0.6, -1, 1.2)), ('rim', 2.0, (0.8, 1, 0.6))):
        light = bpy.data.objects.new(f'{scene.name}-{name}', bpy.data.lights.new(f'{scene.name}-{name}', 'SUN'))
        light.data.energy = energy
        scene.collection.objects.link(light)
        light.rotation_euler = (-Vector(at)).to_track_quat('-Z', 'Y').to_euler()
    act = bpy.data.actions.get(f'{scene.name}:{first_clip}')
    rig.animation_data.action = act
    scene.frame_start, scene.frame_end = 0, int(act.frame_range[1]) if act else 30


def main(path):
    report = {}
    for breed in BREEDS:
        mod = importlib.import_module(breed)
        r = mod.main()
        scene = bpy.data.scenes[breed]
        with in_scene(scene):
            rig = next(o for o in scene.objects if o.type == 'ARMATURE')
            stage(scene, rig, r['clips'][0])
        report[breed] = {'bones': r['bones'], 'clips': r['clips']}
    # The stock scene Blender opens with is noise beside the breeds.
    stock = bpy.data.scenes.get('Scene')
    if stock and len(bpy.data.scenes) > 1:
        bpy.data.scenes.remove(stock)
    if bpy.context.window:
        bpy.context.window.scene = bpy.data.scenes[BREEDS[0]]
    bpy.ops.wm.save_as_mainfile(filepath=path)
    return {'saved': path, 'breeds': report}


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if not argv:
        sys.exit('usage: blender -b -P breeds/rig/build.py -- /path/to/metaquarium-breeds.blend')
    print(main(os.path.abspath(argv[0])))
