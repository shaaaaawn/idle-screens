/**
 * The tank's studio — what a fish is lit BY, and what its metal reflects.
 *
 * The original Metaquarium renders are Blender: a key light, a dark room, and
 * emissive fins throwing colour on the body next to them. Unlit materials
 * cannot say any of that, so `fishLighting: lit` gives the fish a real (small)
 * lighting rig:
 *
 *   - a hemisphere fill and one key, fixed in the world and matched to the
 *     direction the terrain and crystals already bake their shading from;
 *   - a generated environment map — a dark room with a soft top box and two
 *     coloured side panels — prefiltered once at mount, so PBR metal plates
 *     reflect something and never render black (the old "metal trap");
 *   - a FIXED pool of point lights that ride the brightest glow parts nearest
 *     the camera. Fixed, because three.js recompiles every lit program when
 *     the light count changes; an unused light just sits at intensity 0.
 *
 * Everything here is a pure function of the frame's state, so determinism and
 * frame-addressability hold exactly as before. Nothing is fetched.
 */

import {
  BackSide,
  BoxGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  PointLight,
  Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';

export interface Studio {
  environment: Texture;
  lights: PointLight[];
  /** Everything to add to the scene. */
  objects: Array<HemisphereLight | DirectionalLight | PointLight>;
  dispose(): void;
}

function panel(w: number, h: number, color: number, gain: number): Mesh {
  const mat = new MeshBasicMaterial({ color: new Color(color).multiplyScalar(gain) });
  return new Mesh(new BoxGeometry(w, h, 0.2), mat);
}

export function buildStudio(renderer: WebGLRenderer, pointLights: number): Studio {
  // The room the metal sees. Values over 1 are fine: PMREM works in half-float.
  const room = new Scene();
  const shell = new Mesh(
    new BoxGeometry(40, 40, 40),
    new MeshBasicMaterial({ color: 0x1b2150, side: BackSide }),
  );
  room.add(shell);
  const top = panel(22, 22, 0xdfe9ff, 5);
  top.rotation.x = Math.PI / 2;
  top.position.y = 19;
  const left = panel(14, 22, 0xff3fb4, 3.2);
  left.rotation.y = Math.PI / 2;
  left.position.set(-19, 2, 0);
  const right = panel(14, 22, 0x2fd8ff, 3.2);
  right.rotation.y = -Math.PI / 2;
  right.position.set(19, 2, 0);
  const back = panel(10, 6, 0xffb060, 4);
  back.position.set(4, -6, -19);
  const floor = panel(30, 30, 0x3a1fa8, 0.9);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -19;
  room.add(top, left, right, back, floor);

  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromScene(room, 0.035);
  pmrem.dispose();
  room.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as MeshBasicMaterial).dispose();
    }
  });

  const hemi = new HemisphereLight(0xcfdcff, 0x241446, 1.15);
  const key = new DirectionalLight(0xffffff, 2.1);
  // The same up-left key the terrain and the crystals bake from.
  key.position.set(-0.45, 0.78, 0.43).multiplyScalar(100);
  const lights = Array.from({ length: pointLights }, () => {
    const l = new PointLight(0xffffff, 0, 60, 2);
    return l;
  });
  return {
    environment: target.texture,
    lights,
    objects: [hemi, key, ...lights],
    dispose: () => target.dispose(),
  };
}
