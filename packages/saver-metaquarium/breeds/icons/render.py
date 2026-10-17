"""Render a breed GLB to a flat, orthographic icon (rest pose, transparent).

  blender -b --factory-startup -P breeds/icons/render.py -- <breed.glb> <out.png> [side|front|top]

Then crop/square/quantize with breeds/icons/finish.py. The unminted breeds'
icons ship twice, byte-identical: apps/ios/IdleScreens/Assets.xcassets/
mqnpc<id>.imageset (the Apple TV tank) and src/lofi-npc-icons.ts (the lofi
tank). Views: front for the blowfish, top for the starfish and octopus, side
for the rest (heads to the right).
"""
import bpy, sys, math, mathutils
argv = sys.argv[sys.argv.index("--") + 1:]
src, out, view = argv[0], argv[1], argv[2] if len(argv) > 2 else "side"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
# Rest pose: drop animation so the icon is the model as delivered.
for o in bpy.context.scene.objects:
    if o.animation_data: o.animation_data_clear()
bpy.context.view_layer.update()
mn = mathutils.Vector((1e9,)*3); mx = mathutils.Vector((-1e9,)*3)
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(c)
        mn = mathutils.Vector(map(min, mn, w)); mx = mathutils.Vector(map(max, mx, w))
center = (mn + mx) / 2; ext = mx - mn
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
scene.render.film_transparent = True
scene.render.resolution_x = scene.render.resolution_y = 256
scene.view_settings.view_transform = 'Standard'
cam_data = bpy.data.cameras.new("cam"); cam_data.type = 'ORTHO'
cam = bpy.data.objects.new("cam", cam_data); scene.collection.objects.link(cam); scene.camera = cam
# glTF is Y-up → Blender Z-up; models face +X or -Y? look along the axis with the smallest extent (the flank).
# Height is Blender Z. Side = look along the thinner horizontal axis;
# front = the wider; top = straight down.
if view == "top":
    look = 2
elif view == "front":
    look = 0 if ext[0] >= ext[1] else 1
else:
    look = 0 if ext[0] <= ext[1] else 1
d = max(ext) * 3
pos = center.copy(); pos[look] -= d
cam.location = pos
direction = center - pos
cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
others = [i for i in range(3) if i != look]
cam_data.ortho_scale = max(ext[i] for i in others) * 1.08
world = bpy.data.worlds.new("w"); scene.world = world; world.color = (1, 1, 1)
sun = bpy.data.lights.new("sun", 'SUN'); sun.energy = 3.0
sl = bpy.data.objects.new("sun", sun); scene.collection.objects.link(sl); sl.rotation_euler = cam.rotation_euler
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print("EXT", tuple(round(v, 3) for v in ext), "LOOK", look)
