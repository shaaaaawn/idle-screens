---
'@idle-screens/saver-metaquarium': minor
---

The water's light on the fish. The new `fishAmbient` param (0..1, default 0, lit mode only) lights fish the way a lit tank does:
- their backs take the bright water above;
- their flanks take the water around them;
- their bellies take the floor below;
- metal plates mirror all three, weaker, since they already reflect the studio.

The colours come from the scene each frame: `waterTint`, else the surface or the shafts, the in-scatter, and the floor, with more bounce when caustics are on. They dim with a follow-spot's house lights, so a spotlit stage stays dark outside the spot. It applies only to coats and plates, never eyes or glow parts, and includes the shoal.
