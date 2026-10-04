"""
Ship a hand edit: export the current scene's rig (a scene build.py made, named
after its breed) to breeds/rig/<breed>.glb, then run the intake.

    blender metaquarium-breeds.blend -b -P breeds/rig/export.py -- glowfish
    pnpm --filter @idle-screens/saver-metaquarium breeds glowfish

or, in Blender's Scripting tab with that breed's scene open, run this file.
The clips are the scene's `<breed>:<clip>` actions, as edited; the extras the
tank reads (mqStride…) are already on the armature. Port the edit into
<breed>.py too, or the next build.py overwrites it.
"""
import os
import sys

import bpy

sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import export, in_scene, out_path  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
scene = bpy.data.scenes[argv[0]] if argv else bpy.context.scene
with in_scene(scene):
    rig = next(o for o in scene.objects if o.type == 'ARMATURE')
    rig.animation_data.action = None
    extras = {k: rig[k] for k in rig.keys() if k.startswith('mq') and k not in ('mqRig', 'mqFps')}
    print(export(rig, out_path(scene.name), extras))
