/** Seeded mineral scenery. Minerals are faceted; living/inhabited details are voxels.
 * Geometry is batched at build time, owns its resources, and uses the tank clock. */
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group,
  Matrix4, Points, PointsMaterial, Vector4,
  DoubleSide, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, TorusGeometry, Vector3,
} from 'three';
import { emittersOf, type Cluster, type CrystalRng, type Emitter } from './crystals';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { batch, FrontSide } from './scenery-paint';
import { buildFlora, FLORA_COLOR, FLORA_LAMP_EMISSIVE, FLORA_SWAY, FLORA_VERTEX, SPORE_VERTEX } from './flora';
import { buildGeode, GEODE_HABITS } from './geode';
import { buildGeodeInterior, ROOM_MIN_SCALE } from './interior';
import { buildGlowCards, type GlowCards } from './crystal-mesh';
import { buildCastle } from './castle';
import { buildHorizon, HORIZON_FRAGMENT, HORIZON_VERTEX } from './horizon';
import { buildPaths, pathClearance, type PathMaterial, type PathSegment } from './paths';
import { buildSky, LANTERN_COLOR, LANTERN_FRAGMENT, LANTERN_PARS, LANTERN_VERTEX, lanternAt, lanternBeat, lanternEmitters, lanternLight } from './sky';
import { buildRock, FISSURE_FLOW, fissures, glowGeometry, paintStone, type Tri } from './rocks';
import { buildBubbles, pearlSites, type BubbleLayer } from './bubbles';

export interface SceneryOptions {
  rocks: number;
  /** 0..1 — how fractured the stone is: fissure width, forks, crystals in the crack. */
  veins: number;
  homes: number;
  flora: number;
  bubbles: number;
  /** `live`: the vents emit on the slot-cycle lifecycle (bubbles.ts) instead of the classic puffs. */
  bubbleStyle?: 'classic' | 'live';
  /** 0..1 — oxygen pearls on the flora (needs flora). */
  pearling?: number;
  /** 0..1 — a CO₂ mist from the vents. */
  mist?: number;
  snow: number;
  /** 0..1 — jellyfish lanterns in the water overhead. */
  lanterns?: number;
  lanternHeight?: number;
  /** 0..1 — silhouettes standing past the fog line. */
  horizon?: number;
  /** The landmark: a voxel castle with crystal spires round a grand geode keep. */
  castle?: 0 | 1 | 2;
  /** 0..1 — walks from every door to the village hub, a road to the landmark, trails to the crystals. */
  paths?: number;
  pathMaterial?: PathMaterial | 'auto';
  /** Build the scene INSIDE a geode home instead of out on the floor. */
  interior?: boolean;
  cap: number;
  scale: number;
}
export interface SceneryAnchor { x: number; y: number; z: number; color: string }
export interface Scenery {
  group: Group;
  counts: Record<string, number>;
  vents: SceneryAnchor[];
  /** Light the scenery adds to the field: home windows and doors. */
  emitters: Emitter[];
  /** Light that MOVES (the lanterns) — rewritten in place by `setFrame`. */
  moving: Emitter[];
  /** Named places in this world a vignette can send a fish (gate, plaza, home doors). */
  marks: Record<string, { x: number; y: number; z: number }>;
  /** What the floor should paint: the path network, as segments. */
  paths: PathSegment[];
  drawCalls: number;
  triangles: number;
  clearance(x: number, z: number): number;
  /** `glow` and `pulse` are the crystals' (`crystalGlow`, `crystalPulse`): the room's cards breathe with them. */
  setFrame(t: number, fog?: { color: Color; near: number; far: number }, glow?: number, pulse?: number): void;
  /** The water surface over the live bubbles (null: open water). Cheap; call per frame. */
  setSurface(y: number | null): void;
}

/** Each feature gets its own fork, so adding flora never rearranges a village. */
export function sceneryAnchors(clusters: readonly Cluster[], rng: CrystalRng,
  terrain: (x: number, z: number) => number): SceneryAnchor[] {
  if (clusters.length) return clusters.map(c => ({ x: c.x, y: terrain(c.x, c.z), z: c.z, color: c.color }));
  return Array.from({ length: 6 }, (_, i) => {
    const a = i * Math.PI / 3 + 0.2;
    const r = rng.range(55, 95);
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    return { x, y: terrain(x, z), z, color: ['#49cfff', '#a17bff', '#ff67bc'][i % 3]! };
  });
}

export function buildScenery(clusters: readonly Cluster[], rng: CrystalRng,
  terrain: (x: number, z: number) => number, opts: SceneryOptions): Scenery {
  const group = new Group();
  group.name = 'mineral-world';
  const anchors = sceneryAnchors(clusters, rng.fork(1), terrain);
  const stones: BufferGeometry[] = [], veins: BufferGeometry[] = [];
  const obstacles: { x: number; y: number; z: number; r: number; h: number }[] = [];
  const clocks: { value: number }[] = [];
  const vents: SceneryAnchor[] = [];
  const counts: Record<string, number> = { rocks: 0, arches: 0, homes: 0 };
  const rockRng = rng.fork(2);
  const s = opts.scale;
  let rockIndex = 0;
  const seeps: SceneryAnchor[] = [];
  const rock = (x: number, y: number, z: number, rx: number, ry: number, rz: number, color: string): void => {
    const built = buildRock({ x, y, z, rx, ry, rz, tint: color, veins: opts.veins }, rockRng.fork(100 + rockIndex++));
    stones.push(built.stone);
    if (built.glow) veins.push(built.glow);
    // The widest part of a big rock's fissure seeps bubbles.
    if (built.seep && rx > 15 * s) seeps.push({ x: built.seep.x, y: built.seep.y, z: built.seep.z, color });
    obstacles.push({ x, y, z, r: Math.max(rx, rz), h: ry * 1.3 });
    counts.rocks!++;
  };
  if (opts.rocks > 0) {
    const n = Math.min(anchors.length, opts.cap);
    for (const a of anchors.slice(0, n)) {
      rock(a.x, a.y, a.z, 18 * s, 8 * s, 15 * s, a.color);
      for (let j = 0; j < Math.ceil(opts.rocks * 2); j++) {
        const x = a.x + rockRng.range(-23, 23) * s, z = a.z + rockRng.range(-20, 20) * s;
        rock(x, terrain(x, z), z, rockRng.range(8, 14) * s, rockRng.range(5, 11) * s, 10 * s, a.color);
      }
    }
    // A real open arch: its opening remains empty depth space for passing fish.
    const x = -48 * s, z = -65 * s, y = terrain(x, z);
    // The arch is the same stone: displaced, painted and fissured like a boulder.
    const torus = new TorusGeometry(1, 0.26, 6, 14, Math.PI).toNonIndexed();
    const tp = torus.getAttribute('position');
    const archRng = rockRng.fork(900);
    const archTris: Tri[] = [];
    const wobble = new Map<string, number>();
    const av = (i: number): Vector3 => {
      const k = `${tp.getX(i).toFixed(3)},${tp.getY(i).toFixed(3)},${tp.getZ(i).toFixed(3)}`;
      let v = wobble.get(k);
      if (v === undefined) { v = archRng.range(0.9, 1.12); wobble.set(k, v); }
      return new Vector3(tp.getX(i) * v, tp.getY(i) * v, tp.getZ(i) * v);
    };
    for (let i = 0; i < tp.count; i += 3) archTris.push([av(i), av(i + 1), av(i + 2)]);
    torus.dispose();
    const archPlace = new Matrix4().compose(new Vector3(x, y, z), new Quaternion(), new Vector3(24 * s, 35 * s, 24 * s));
    stones.push(paintStone(archTris, archPlace, archRng.fork(1), '#384960'));
    const archCut = fissures(archTris, archRng.fork(2), '#947cff', opts.veins, 28 * s);
    const archGlow = glowGeometry(archCut.positions, archCut.colors, archPlace, archCut.flow);
    if (archGlow) veins.push(archGlow);
    counts.arches = 1;
    for (const dx of [-24, 24]) rock(x + dx * s, y, z, 10 * s, 8 * s, 12 * s, '#947cff');
    // Low back ridge frames the settlement without sealing off its centre.
    for (let i = 0; i < (opts.castle ? 0 : 4); i++) {
      const rx = (i - 1.5) * 30 * s, rz = -115 * s;
      rock(rx, terrain(rx, rz), rz, 25 * s, (12 + rockRng.next() * 12) * s, 19 * s, '#567fae');
    }
  }
  // Homes: a loose crescent opening toward the default camera, habits cycled
  // so a village of three is a cottage, a hall and a tower.
  const interiors: BufferGeometry[] = [], details: BufferGeometry[] = [];
  const homeLights: Emitter[] = [];
  const marks: Record<string, { x: number; y: number; z: number }> = {};
  const doorsteps: { x: number; z: number }[] = [];
  const homeRng = rng.fork(3);
  const homeCount = Math.min(Math.round(opts.homes), opts.cap >= 8 ? 3 : 2);
  for (let i = 0; i < homeCount; i++) {
    const t = homeCount === 1 ? 0 : i / (homeCount - 1) - 0.5;
    const habit = GEODE_HABITS[(i + (homeCount === 1 ? 0 : 1)) % GEODE_HABITS.length]!;
    let x = t * 132 * s + homeRng.range(-5, 5) * s;
    let z = (-38 + Math.abs(t) * 30) * s + homeRng.range(-4, 4) * s;
    // With a castle the village stands ASIDE: its road runs down the middle,
    // so homes take slots either side of it and turn to face it.
    const flank = opts.castle ? ([[-96, -34], [92, -46], [-66, 44]] as const)[i % 3]! : null;
    if (flank) { x = flank[0] * s + homeRng.range(-5, 5) * s; z = flank[1] * s + homeRng.range(-4, 4) * s; }
    // A home never grows through a crystal: step it back from any cluster
    // whose footprint it would share.
    for (let pass = 0; pass < 3; pass++) {
      for (const c of clusters) {
        const d = Math.hypot(x - c.x, z - c.z), need = 40 * s + c.radius;
        if (d < need) {
          const k = (need - d) / Math.max(1, d);
          x += (x - c.x) * k; z += (z - c.z) * k;
        }
      }
    }
    const home = buildGeode({
      x, y: terrain(x, z), z, habit, scale: s,
      // Turned in toward the middle of the crescent, never square-on.
      facing: (flank ? Math.atan2(-x, 46 * s) : -t * 0.75) + homeRng.range(-0.12, 0.12),
      tint: anchors[i % anchors.length]!.color,
    }, homeRng.fork(20 + i));
    stones.push(...home.stone);
    details.push(...home.voxels);
    interiors.push(...home.glow);
    vents.push(home.vent);
    homeLights.push(home.emitter);
    // Somewhere to come home TO: `homeN` hovers outside the door, `homeNin`
    // is in the throat, behind the rind — a fish sent there has gone indoors.
    {
      const m = home.emitter, dx = m.x - x, dz = m.z - z, dl = Math.hypot(dx, dz) || 1;
      marks[`home${i + 1}`] = { x: m.x + (dx / dl) * 20 * s, y: m.y + 2 * s, z: m.z + (dz / dl) * 20 * s };
      // Where the walk to this door begins: the real foot of its steps.
      doorsteps.push(home.doorstep);
      marks[`home${i + 1}in`] = { x: m.x - (dx / dl) * 5 * s, y: m.y, z: m.z - (dz / dl) * 5 * s };
    }
    obstacles.push(home.obstacle);
    counts.homes!++;
  }
  // The landmark. It stands behind the village, gate toward the camera, and
  // its keep is the same geode home everyone else lives in — only grand.
  if (opts.castle && !opts.interior) {
    const cz = (homeCount ? -150 : -110) * s;
    const castle = buildCastle({ x: 0, y: terrain(0, cz), z: cz, facing: 0, scale: s, palette: clusters.map(c => c.color), tiers: opts.castle === 2 ? 2 : 1 }, rng.fork(11));
    for (const [g, name, side] of [[castle.masonry, 'castle-masonry', FrontSide], [castle.crystal, 'castle-spires', DoubleSide]] as const) {
      g.userData.mqOwned = true;
      const material = new MeshBasicMaterial({ vertexColors: true, side });
      material.userData.mqOwned = true;
      const mesh = new Mesh(g, material);
      mesh.name = name;
      group.add(mesh);
    }
    const keep = buildGeode({ ...castle.keep, habit: 'tower', facing: 0, tint: anchors[0]!.color }, rng.fork(12));
    stones.push(...keep.stone); details.push(...keep.voxels); interiors.push(...keep.glow);
    vents.push(keep.vent);
    homeLights.push(keep.emitter, ...castle.emitters);
    obstacles.push(...castle.obstacles);
    Object.assign(marks, castle.marks);
    counts.castle = 1;
  }
  // Paths: every door to the hub, the hub to the landmark's plaza, trails to
  // the big crystals. Painted by the floor shader, so they cost no geometry.
  const network = opts.interior ? null : buildPaths([
    ...doorsteps.map(d => ({ ...d, kind: 'home' as const })),
    ...(marks.plaza ? [{ x: marks.plaza.x, z: marks.plaza.z, kind: 'landmark' as const }] : []),
    ...clusters.map(c => ({ x: c.x, z: c.z, kind: 'crystal' as const })),
  ], rng.fork(13), {
    amount: opts.paths ?? 0, material: opts.pathMaterial ?? 'auto', scale: s,
    // A castle's paved road is the spine of the place: doors walk to IT.
    spine: marks.gate && marks.plaza ? { x0: marks.gate.x, z0: marks.gate.z + 8 * s, x1: marks.plaza.x, z1: marks.plaza.z, width: 12 * s } : undefined,
    obstacles: [...obstacles.map(o => ({ x: o.x, z: o.z, r: o.r })), ...clusters.map(c => ({ x: c.x, z: c.z, r: c.radius * 0.7 }))],
  });
  if (network?.hub) marks.hub = { x: network.hub.x, y: terrain(network.hub.x, network.hub.z) + 30 * s, z: network.hub.z };
  counts.paths = network?.edges ?? 0;
  const keepClear: PathSegment[] = [...(network?.segments ?? [])];
  if (marks.gate && marks.plaza) {
    keepClear.push({ x0: marks.gate.x, z0: marks.gate.z, x1: marks.plaza.x, z1: marks.plaza.z, width: 12 * s, material: 'pebble' });
    keepClear.push({ x0: marks.plaza.x, z0: marks.plaza.z, x1: marks.plaza.x, z1: marks.plaza.z + 0.01, width: 30 * s, material: 'pebble' });
  }
  // Indoors: the whole scene is the room behind a geode's round door.
  const shellParts: BufferGeometry[] = [];
  let cards: GlowCards | null = null;
  if (opts.interior) {
    // The room must hold the swim volume whatever `crystalScale` says.
    const room = buildGeodeInterior(rng.fork(7), { tint: clusters.length ? anchors[0]!.color : '#8a4dff', scale: Math.max(s, ROOM_MIN_SCALE), floorY: terrain(0, 0), detail: opts.cap >= 8 ? 1 : 0.5 });
    shellParts.push(...room.room);
    vents.push(...room.vents);
    homeLights.push(...room.emitters);
    obstacles.push(...room.obstacles);
    counts.interior = 1;
    counts.furniture = room.obstacles.length;
    cards = buildGlowCards(room.lights.length);
    const c = new Color();
    room.lights.forEach((l, i) => {
      c.set(l.color);
      cards!.set(i, l.x, l.y, l.z, l.size, c.r, c.g, c.b, i * 1.3);
    });
    cards.mesh.userData.mqLights = room.lights.length;
    group.add(cards.mesh);
  }
  const field = buildFlora(anchors, terrain, rng.fork(4), {
    density: opts.flora, cap: opts.cap, scale: s,
    // Nothing grows on a walk, a road or a plaza: that is what makes them read as kept.
    blocked: (x, z) => obstacles.some(o => Math.hypot(x - o.x, z - o.z) < o.r + 3 * s) || pathClearance(keepClear, x, z) < 3 * s,
  });
  // Read before the batch merges (and disposes) the parts.
  const pearls = (opts.pearling ?? 0) > 0 ? pearlSites(field.parts, s) : [];
  const plants = batch(group, field.parts, 'voxel-light-flora', FrontSide);
  // The light sweep is written in scale-1 units; this is the world's scale.
  const floraScale = { value: s };
  if (plants) {
    const clock = { value: 0 }; clocks.push(clock);
    (plants.material as MeshBasicMaterial).onBeforeCompile = shader => {
      shader.uniforms.uSwayTime = clock;
      shader.uniforms.uFloraScale = floraScale;
      shader.vertexShader = 'uniform float uSwayTime; uniform float uFloraScale; attribute vec3 aSway; attribute float aGlow;\n' + FLORA_SWAY + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', FLORA_VERTEX)
        .replace('#include <color_vertex>', FLORA_COLOR);
    };
    (plants.material as MeshBasicMaterial).customProgramCacheKey = () => 'mineral-flora-v3';
    plants.frustumCulled = false;
  }
  // The lights on the flora are polished metal: they take the studio
  // environment and the key like the fish's plates do, and emit their colour
  // on top, so a bead is a bright bead in a flat tank and a gleaming one in a
  // lit tank. Same sway, same clock, one more draw call.
  if (field.lamps.length) {
    const geometry = mergeGeometries(field.lamps)!;
    field.lamps.forEach(g => g.dispose());
    geometry.userData.mqOwned = true;
    const metal = new MeshStandardMaterial({ vertexColors: true, metalness: 1, roughness: 0.2, envMapIntensity: 1.7 });
    metal.userData.mqOwned = true;
    const clock = { value: 0 }; clocks.push(clock);
    metal.onBeforeCompile = shader => {
      shader.uniforms.uSwayTime = clock;
      shader.uniforms.uFloraScale = floraScale;
      shader.vertexShader = 'uniform float uSwayTime; uniform float uFloraScale; attribute vec3 aSway; attribute float aGlow;\n' + FLORA_SWAY + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', FLORA_VERTEX)
        .replace('#include <color_vertex>', FLORA_COLOR);
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', FLORA_LAMP_EMISSIVE);
    };
    metal.customProgramCacheKey = () => 'mineral-flora-lamps-v2';
    const lampMesh = new Mesh(geometry, metal);
    lampMesh.name = 'flora-lamps';
    lampMesh.frustumCulled = false;
    group.add(lampMesh);
  }
  // The sky: jellyfish lanterns. One mesh, moved entirely in its shader.
  const sky = opts.interior ? null : buildSky(rng.fork(7), {
    density: opts.lanterns ?? 0, cap: opts.cap, scale: s, palette: clusters.map(c => c.color), height: opts.lanternHeight ?? 1,
  });
  const moving: Emitter[] = [];
  let skyCards: GlowCards | null = null;
  if (sky?.geometry) {
    sky.geometry.userData.mqOwned = true;
    // Three draws of one geometry (see LANTERN_VERTEX): the lit cores, opaque;
    // the shells into depth only; the shells' colour, blended. The depth draw
    // goes LAST among the opaque things, so a fish behind a bell is already
    // on screen for the bell to be see-through to.
    const clock = { value: 0 }; clocks.push(clock);
    const draws: Array<[string, number, Partial<MeshBasicMaterial>, number]> = [
      ['sky-lantern-cores', 0, {}, 48],
      // Pushed back a hair: two programs never agree on depth to the last bit, and
      // without the offset the blended draw loses the test on stray triangles.
      ['sky-lantern-depth', 1, { colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 3 }, 49],
      ['sky-lanterns', 2, { transparent: true, depthWrite: false }, 3],
    ];
    for (const [name, pass, extra, order] of draws) {
      const material = new MeshBasicMaterial({ vertexColors: true, ...extra });
      material.userData.mqOwned = true;
      const uSkyPass = { value: pass };
      material.onBeforeCompile = shader => {
        shader.uniforms.uSkyTime = clock;
        shader.uniforms.uSkyPass = uSkyPass;
        shader.vertexShader = 'uniform float uSkyTime; uniform float uSkyPass; attribute vec4 aHome; attribute vec3 aJelly; attribute float aGlow; attribute vec2 aBell;\n' + LANTERN_PARS + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', LANTERN_VERTEX)
          .replace('#include <color_vertex>', LANTERN_COLOR);
        shader.fragmentShader = 'uniform float uSkyPass; varying vec4 vSky; varying float vSkyBeat;\n'
          + shader.fragmentShader.replace('#include <color_fragment>', LANTERN_FRAGMENT);
      };
      material.customProgramCacheKey = () => 'sky-lanterns-v4';
      const mesh = new Mesh(sky.geometry, material);
      mesh.name = name;
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      group.add(mesh);
    }
    skyCards = buildGlowCards(sky.lanterns.length);
    group.add(skyCards.mesh);
    counts.lanterns = sky.lanterns.length;
  }
  // The far distance: hazed rings of spires, castle crystals and a grand geode.
  const horizonFog = { value: new Color() };
  const far = opts.interior ? null : buildHorizon(rng.fork(8), { amount: opts.horizon ?? 0, palette: clusters.map(c => c.color), geode: !opts.castle, scale: s });
  if (far?.geometry) {
    far.geometry.userData.mqOwned = true;
    const material = new MeshBasicMaterial({ vertexColors: true, fog: false, side: DoubleSide });
    material.userData.mqOwned = true;
    material.onBeforeCompile = shader => {
      shader.uniforms.uHorizonFog = horizonFog;
      shader.vertexShader = 'attribute vec2 aHaze; varying float vHorizon;\n' + shader.vertexShader.replace('#include <begin_vertex>', HORIZON_VERTEX);
      shader.fragmentShader = 'uniform vec3 uHorizonFog; varying float vHorizon;\n' + shader.fragmentShader.replace('#include <color_fragment>', HORIZON_FRAGMENT);
    };
    material.customProgramCacheKey = () => 'horizon-v1';
    const mesh = new Mesh(far.geometry, material);
    mesh.name = 'horizon';
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    group.add(mesh);
    counts.horizon = far.counts.spires + far.counts.crystals + far.counts.geodes;
  }
  // Spores: three motes a lamp, rising off the swaying tip and going out.
  if (field.lights.length) {
    const sporeRng = rng.fork(9);
    const per = 3, n = field.lights.length * per;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), sway = new Float32Array(n * 3), spore = new Float32Array(n * 3);
    const c = new Color();
    field.lights.forEach((l, i) => {
      c.set(l.color).lerp(new Color('#ffffff'), 0.3);
      for (let k = 0; k < per; k++) {
        const j = (i * per + k) * 3;
        pos.set([l.x, l.y, l.z], j); col.set([c.r, c.g, c.b], j); sway.set([l.root, l.phase, l.gust], j);
        spore.set([sporeRng.next(), sporeRng.range(0.05, 0.11), sporeRng.next()], j);
      }
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(pos, 3));
    geometry.setAttribute('color', new BufferAttribute(col, 3));
    geometry.setAttribute('aSway', new BufferAttribute(sway, 3));
    geometry.setAttribute('aSpore', new BufferAttribute(spore, 3));
    geometry.userData.mqOwned = true;
    const material = new PointsMaterial({ vertexColors: true, size: 1.5 * s, transparent: true, depthWrite: false, blending: AdditiveBlending });
    material.userData.mqOwned = true;
    const clock = { value: 0 }; clocks.push(clock);
    material.onBeforeCompile = shader => {
      shader.uniforms.uSwayTime = clock;
      shader.vertexShader = 'uniform float uSwayTime; attribute vec3 aSway; attribute vec3 aSpore; varying float vSpore;\n' + FLORA_SWAY
        + shader.vertexShader.replace('#include <begin_vertex>', SPORE_VERTEX);
      shader.fragmentShader = 'varying float vSpore;\n' + shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        float sr = length(gl_PointCoord - 0.5) * 2.0;
        diffuseColor.a *= (1.0 - smoothstep(0.15, 1.0, sr)) * vSpore;`);
    };
    material.customProgramCacheKey = () => 'flora-spores-v1';
    const points = new Points(geometry, material);
    points.name = 'flora-spores';
    points.frustumCulled = false;
    group.add(points);
    counts.spores = n;
  }
  counts.flora = field.plants;
  // Both particle layers are one draw each; positions are pure in t, including
  // wraps. Bubble fade at either end hides the reset back to its vent.
  const particleRng = rng.fork(6);
  // Indoors only the kettle and the teapot bubble; with no crystals the
  // fallback anchors are placement hints, not things that vent.
  const sources = opts.interior ? [...vents] : [...vents, ...seeps, ...anchors.map(a => ({ ...a, y: a.y + 6 * s }))];
  const emitters = emittersOf(clusters);
  const lightPositions = Array.from({ length: 12 }, (_, i) => {
    const e = emitters[i]; return e ? new Vector4(e.x, e.y, e.z, e.reach) : new Vector4(0, 0, 0, 1);
  });
  const lightColors = Array.from({ length: 12 }, (_, i) => {
    const e = emitters[i]; return e ? new Vector3(e.r, e.g, e.b) : new Vector3();
  });
  const particles = (bubble: boolean, n: number): void => {
    if (!n) return;
    const positions = new Float32Array(n * 3), colors = new Float32Array(n * 3), phases = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const source = sources[i % sources.length]!;
      // A vent is a mouth, not a point: bubbles leave from anywhere across it.
      const ja = particleRng.next() * Math.PI * 2, jr = Math.sqrt(particleRng.next()) * 2.6 * s;
      positions.set(bubble
        ? [source.x + Math.cos(ja) * jr, source.y + particleRng.range(-0.6, 0.6) * s, source.z + Math.sin(ja) * jr]
        : [particleRng.range(-170, 170) * s, 0, particleRng.range(-150, 150) * s], i * 3);
      const color = new Color(bubble ? source.color : '#abc9dc');
      colors.set([color.r, color.g, color.b], i * 3);
      // Bubbles leave in PUFFS: every bubble of a vent belongs to one of three
      // bursts, so a chimney coughs a little cloud, rests, coughs again —
      // where a uniform phase gave a dripping tap. Snow stays uniform.
      const src = i % sources.length;
      const burst = bubble ? ((i / sources.length | 0) % 3) / 3 + src * 0.137 + particleRng.range(0, 0.07) : particleRng.next();
      // Sizes are heavy-tailed: a fizz of small ones, the odd fat one. Small
      // bubbles are slow, big ones fast — which also spreads a puff out as it
      // climbs instead of letting it rise as a fixed constellation.
      const size = bubble ? 0.35 + 2.4 * particleRng.next() ** 3.2 : 1;
      phases.set([burst % 1, bubble ? particleRng.range(0.7, 1.05) * (0.75 + size * 0.22) : particleRng.range(0.75, 1.25), size], i * 3);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geometry.setAttribute('aParticle', new BufferAttribute(phases, 3));
    geometry.userData.mqOwned = true;
    const material = new PointsMaterial({ vertexColors: true, size: bubble ? 4.2 * s : 0.65 * s,
      transparent: true, opacity: bubble ? 1 : 0.5, depthWrite: false });
    material.userData.mqOwned = true;
    const clock = { value: 0 }; clocks.push(clock);
    material.onBeforeCompile = shader => {
      shader.uniforms.uParticleTime = clock;
      shader.uniforms.uMineralPosition = { value: lightPositions };
      shader.uniforms.uMineralColor = { value: lightColors };
      shader.vertexShader = `uniform float uParticleTime;
        attribute vec3 aParticle; varying float vLife; varying vec2 vShape; varying float vSize;
        uniform vec4 uMineralPosition[12]; uniform vec3 uMineralColor[12];
      ` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        float life = fract(aParticle.x + uParticleTime * aParticle.y * ${bubble ? '0.045' : '0.007'});
        ${bubble ? `
        // Buoyancy: slow off the vent, quicker as it grows. The wobble widens
        // with height into a loose helix, and small bubbles wander more.
        float rise = life * (0.55 + 0.45 * life);
        transformed.y += rise * 118.0;
        float wob = (0.6 + rise * 5.5) / (0.6 + aParticle.z);
        transformed.x += sin(life * 17.0 + aParticle.x * 40.0) * wob + rise * 9.0;
        transformed.z += cos(life * 13.0 + aParticle.x * 31.0) * wob;` : `
        transformed.y += (1.0 - life) * 150.0;
        transformed.x += sin(life * 9.0 + aParticle.x * 30.0) * 7.0;
        transformed.z += cos(life * 6.0 + aParticle.x * 20.0) * 2.0;`}
        vLife = smoothstep(0.0, 0.05, life) * (1.0 - smoothstep(0.8, 1.0, life));
        // Each bubble wobbles out of round on its own clock; big ones more.
        vShape = vec2(sin(uParticleTime * (2.2 + aParticle.x * 3.0) + aParticle.x * 50.0) * 0.1 * min(1.5, aParticle.z), aParticle.x);
        vec3 light = vec3(0.22);
        for (int i = 0; i < 12; i++) {
          vec3 delta = transformed - uMineralPosition[i].xyz;
          float reach = uMineralPosition[i].w;
          light += uMineralColor[i] / (1.0 + dot(delta, delta) / (reach * reach));
        }
        vColor.rgb *= min(vec3(1.8), light);
      `);
      // Per-bubble size, and they swell as the pressure drops.
      if (bubble) shader.vertexShader = shader.vertexShader.replace('gl_PointSize = size;',
        'gl_PointSize = size * aParticle.z * (0.7 + 0.8 * fract(aParticle.x + uParticleTime * aParticle.y * 0.045));');
      // The fragment stage needs the sprite's real size in pixels, after
      // attenuation — and nothing under 3 px, where a bubble is only noise.
      shader.vertexShader = shader.vertexShader.replace('#include <fog_vertex>',
        `#include <fog_vertex>\n ${bubble ? 'gl_PointSize = max(gl_PointSize, 3.0);' : ''} vSize = gl_PointSize;`);
      shader.fragmentShader = 'uniform float uParticleTime; varying float vLife; varying vec2 vShape; varying float vSize;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        float r = length(gl_PointCoord - 0.5) * 2.0;
        ${bubble ? `
        // A bubble, not a ring — and never a square. The disc sits INSIDE the
        // sprite with a margin, so its out-of-round wobble cannot reach the
        // quad's edge (that clipped flat side was the "frame"). Everything is
        // sized in pixels: the outer edge is antialiased over ~1.5 px, and a
        // small bubble gets a fatter rim and glint so it reads as a bead of
        // light instead of a hairline "o".
        vec2 uv = (gl_PointCoord - 0.5) * 2.0 * 1.24;
        uv *= vec2(1.0 + vShape.x, 1.0 - vShape.x);
        r = length(uv);
        float px = 2.48 / max(vSize, 1.0);
        float big = smoothstep(7.0, 42.0, vSize);
        float edge = 1.0 - smoothstep(1.0 - px * 1.5, 1.0, r);
        float under = 0.5 + 0.5 * uv.y;
        // Glass falls off like fresnel — a power of the radius, not a band.
        float rim = pow(clamp(r, 0.0, 1.0), mix(2.6, 7.5, big)) * edge;
        // The crescent of light gathered low inside, opposite the highlight.
        float cres = smoothstep(0.62, 0.9, length(uv - vec2(-0.2, -0.24)))
          * (1.0 - smoothstep(0.78, 0.97, r)) * 0.4 * big;
        float fill = edge * 0.07;
        float glint = max(0.16, px * 1.7);
        // The highlight is a reflection, so it is not pinned: each bubble
        // carries it at its own bearing and depth, it slides as the bubble
        // wobbles and turns, and it smears along the rim into a short arc.
        float hb = -2.35 + (fract(vShape.y * 7.31) - 0.5) * 1.3
          + sin(uParticleTime * (0.9 + fract(vShape.y * 3.7)) + vShape.y * 60.0) * 0.35 + vShape.x * 2.2;
        float hr = 0.44 + fract(vShape.y * 5.13) * 0.18 + vShape.x * 0.6;
        vec2 hc = vec2(cos(hb), sin(hb)) * hr;
        vec2 hd = uv - hc;
        vec2 tang = vec2(-sin(hb), cos(hb));
        float along = dot(hd, tang), across = dot(hd, vec2(cos(hb), sin(hb)));
        float spec = 1.0 - smoothstep(glint * 0.35, glint, length(vec2(along * mix(1.0, 0.55, big), across * 1.25)));
        float echo = (1.0 - smoothstep(0.0, 0.09, length(uv + hc * 1.05))) * 0.5 * big;
        float ang = atan(uv.y, uv.x);
        vec3 film = 0.5 + 0.5 * cos(ang * 2.0 + r * 3.0 + vShape.y * 40.0 + uParticleTime * 0.35 + vec3(0.0, 2.1, 4.2));
        diffuseColor.rgb = mix(diffuseColor.rgb, film, 0.42 * rim) * (0.85 + 0.7 * under * rim);
        diffuseColor.rgb += film * cres * 0.5;
        float mask = clamp(rim * (0.8 + 0.5 * under) + cres + fill + spec + echo, 0.0, 1.0) * edge;
        spec = max(spec, echo);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), spec * 0.85);` : `
        float mask = 1.0 - smoothstep(0.0, 1.0, r);`}
        diffuseColor.a *= mask * vLife;
      `);
    };
    material.customProgramCacheKey = () => bubble ? 'mineral-bubbles-v5' : 'mineral-snow-v4';
    const points = new Points(geometry, material);
    points.name = bubble ? 'bubble-vents' : 'illuminated-marine-snow';
    points.frustumCulled = false;
    group.add(points);
  };
  const live = opts.bubbleStyle === 'live';
  counts.bubbles = live ? 0 : Math.round(opts.bubbles * opts.cap * 12);
  counts.snow = Math.round(opts.snow * opts.cap * 25);
  particles(true, counts.bubbles);
  let bubbleLayer: BubbleLayer | null = null;
  if ((live && opts.bubbles > 0) || (opts.pearling ?? 0) > 0 || (opts.mist ?? 0) > 0) {
    bubbleLayer = buildBubbles(sources, pearls, rng.fork(21), {
      streams: live ? opts.bubbles : 0, pearling: opts.pearling ?? 0, mist: opts.mist ?? 0,
      cap: opts.cap, scale: s, riseCap: opts.interior ? 55 : undefined,
    }, { positions: lightPositions, colors: lightColors });
    if (bubbleLayer.points) group.add(bubbleLayer.points);
    counts.bubbleStreams = bubbleLayer.counts.streams;
    counts.pearls = bubbleLayer.counts.pearls;
    counts.mist = bubbleLayer.counts.mist;
  }
  particles(false, counts.snow);
  // Closed solids draw front faces only — half the fragment work of the
  // DoubleSide everything used to wear; only the open geode throat needs both.
  batch(group, shellParts, 'geode-room', FrontSide);
  batch(group, interiors, 'geode-interiors');
  batch(group, details, 'voxel-furnishings', FrontSide);
  batch(group, stones, 'rock-formations', FrontSide);
  const lava = batch(group, veins, 'crystal-veins');
  if (lava) {
    const clock = { value: 0 }; clocks.push(clock);
    (lava.material as MeshBasicMaterial).onBeforeCompile = shader => {
      shader.uniforms.uFlowTime = clock;
      shader.vertexShader = 'uniform float uFlowTime; attribute float aFlow;\n' + shader.vertexShader.replace('#include <color_vertex>', FISSURE_FLOW);
    };
    (lava.material as MeshBasicMaterial).customProgramCacheKey = () => 'mineral-fissures-v3';
  }
  let bubbleSurface: number | null = null;
  return {
    setSurface(y) { bubbleSurface = y; },
    group, counts, vents, emitters: homeLights, moving, marks, paths: network?.segments ?? [],
    drawCalls: group.children.length,
    triangles: group.children.reduce((n, o) => o instanceof Mesh
      ? n + o.geometry.getAttribute('position').count / 3 : n, 0),
    clearance(x, z) {
      let h = -Infinity;
      for (const o of obstacles) {
        const q = Math.hypot(x - o.x, z - o.z) / (o.r + 6);
        if (q < 1) h = Math.max(h, o.y + o.h * Math.sqrt(1 - q * q));
      }
      return h;
    },
    setFrame(t, fog, glow = 1, pulse = 0.35) {
      for (const clock of clocks) clock.value = t;
      bubbleLayer?.setFrame(t, bubbleSurface);
      if (fog) horizonFog.value.copy(fog.color);
      if (cards && fog) cards.commit(Number(cards.mesh.userData.mqLights), t, glow, pulse, fog);
      // The light field is kept current whether or not there is a card pass
      // to draw (fog is the card pass's business): a caller that only asks
      // for time still gets the lanterns where they are.
      if (sky) lanternEmitters(sky.lanterns, t, moving);
      if (sky && skyCards && fog) {
        const p = { x: 0, y: 0, z: 0 }, c = new Color();
        sky.lanterns.forEach((l, i) => {
          lanternAt(l, t, p);
          c.set(l.color);
          // The bloom flares on the bell's own beat, with the core it haloes.
          const k = (l.far ? 0.2 : 0.5) * lanternLight(lanternBeat(t, l.phase, l.rate));
          skyCards!.set(i, p.x, p.y + 4 * l.size, p.z, (l.far ? 28 : 32) * l.size, c.r * k, c.g * k, c.b * k, l.phase);
        });
        skyCards.commit(sky.lanterns.length, t, glow, 0.5, fog);
      }
    },
  };
}
