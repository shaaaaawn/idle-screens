"""Convert a metaquarium rig GLB to USDZ for the tvOS RealityKit tank (spike).

    blender -b -P apps/ios/scripts/glb2usdz.py -- breeds/rig/<breed>.glb out/<breed>.usdz [clip]

Blender exports one action per file, so `clip` (default swim) is the one baked.
"""
import bpy, sys
argv = sys.argv[sys.argv.index('--') + 1:]
src, dst, clip = argv[0], argv[1], argv[2] if len(argv) > 2 else 'swim'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
acts = [a.name for a in bpy.data.actions]
act = next((a for a in bpy.data.actions if a.name.lower().endswith(clip) or clip in a.name.lower()), None)
print('ACTIONS', acts, 'USING', act.name if act else None)
if rig.animation_data is None: rig.animation_data_create()
rig.animation_data.action = act
# Some glTF imports park clips on NLA tracks; mute them so only `clip` plays.
for t in rig.animation_data.nla_tracks: t.mute = True
fr = act.frame_range
bpy.context.scene.frame_start, bpy.context.scene.frame_end = int(fr[0]), int(fr[1])
print('FRAMES', fr, 'FPS', bpy.context.scene.render.fps)
bpy.ops.wm.usd_export(filepath=dst, export_animation=True, export_armatures=True, export_materials=True)
print('WROTE', dst)
