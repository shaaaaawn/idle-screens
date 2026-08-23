import type { CapabilityTier } from '@idle-screens/capabilities';
import {
  defaultParams,
  integrateParam,
  sampleTrack,
  type ControlTrack,
  type ParamSpace,
  type ParamValue,
  type SaverContext,
  type SaverInstance,
  type SaverLayer,
  type Rng,
} from '@idle-screens/core';
import {
  AdditiveBlending,
  AnimationMixer,
  Box3,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  Fog,
  Group,
  HemisphereLight,
  LinearToneMapping,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  DoubleSide,
  PlaneGeometry,
  CylinderGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type AnimationClip,
  type Material,
  type Object3D,
  type SkinnedMesh,
} from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { needsDraco } from './tank-draco';
import { affordableLayers, environmentOf, FLOOR_KINDS, type EnvironmentPreset, type FloorKind } from './environments';
import {
  bandRange, FISH_LENGTH, fishVariation, formationExtent, formationSlot, swimStyleOf,
} from './swim';
import { expandFishMix, FISH_CATALOG, parseFishMix, resolveIpfsUrls, type FishEntry } from './ipfs';
import { coerceNum, METAQUARIUM_PARAMS, withDefaults } from './manifest';
import {
  applyNpcMaterials,
  eyeNoseSign,
  forceOpaque,
  MIAMI_VICE_COLORS,
} from './materials';
import {
  compileSwimPlan,
  distanceAt,
  swimPoseAtDistance,
  type SwimPlan,
  type TankBounds,
} from './plan';
import {
  effectivePixelRatio,
  probeSoftwareGL,
  qualityFor,
  type TankQuality,
} from './quality';

const BOUNDS: TankBounds = { radius: 120, yMin: 15, yMax: 72 };
const MAX_FISH = METAQUARIUM_PARAMS.fishCount.max ?? 24;
const GLB_CONCURRENCY = 3;

// ---------------------------------------------------------------------------
// Template cache — shared across instances, never disposed by them.
// ---------------------------------------------------------------------------

interface FishTemplate {
  scene: Object3D;
  clip: AnimationClip | null;
  norm: number;
  yaw: number;
  /** True when this template was decoded with Draco (not a fallback blob). */
  draco: boolean;
}


/** One decoder per decoder path, created on first use and kept for the page.
 *  Keyed by path so two tanks with different `dracoPath` values do not share
 *  a loader (setDecoderPath is ignored after the first decode) and so a path
 *  change never disposes a worker another tank is still parsing on. */
const DRACO_BY_PATH = new Map<string, DRACOLoader>();
function dracoDecoderPath(path: string): string {
  const base = path || new URL('./draco/', import.meta.url).href;
  // Trailing slash is load-bearing — DRACOLoader concatenates the filename
  // straight onto this, and a missing slash yields `…/dracodraco_decoder.wasm`,
  // which a dev server answers with index.html and the decoder dies on
  // "Unexpected token '<'".
  return base.endsWith('/') ? base : `${base}/`;
}
function dracoLoader(path: string): DRACOLoader {
  const normalized = dracoDecoderPath(path);
  let loader = DRACO_BY_PATH.get(normalized);
  if (!loader) {
    loader = new DRACOLoader();
    // Default: the copy tsup ships beside this module. Vite and friends
    // rewrite `import.meta.url` asset URLs at build time; hosts that bundle
    // the package into a single chunk must copy dist/draco next to that
    // chunk, or set the dracoPath param to a URL they actually serve.
    loader.setDecoderPath(normalized);
    // ONE decoder worker, not three.js's default pool of four.
    //
    // DRACOLoader spawns workers lazily up to its limit and never releases
    // them, so a saver that decodes a handful of fish would leave four
    // decoder workers alive for the life of the page. On a 2-core CI runner
    // under software GL that starved every OTHER worker-based saver — the
    // symptom was 17 unrelated worker e2e tests failing while everything
    // passed locally on a machine with cores to spare. A tank decodes a few
    // small models once and caches the templates; serial decoding is fine.
    loader.setWorkerLimit(1);
    DRACO_BY_PATH.set(normalized, loader);
  }
  return loader;
}

/** Tanks currently able to decode, per decoder path. The decoder outlives any
 *  single tank (templates are cached page-wide) but must not outlive the LAST
 *  one, or its worker leaks for the life of the page. */
const DRACO_USERS = new Map<string, number>();

function retainDraco(path: string): void {
  const k = dracoDecoderPath(path);
  DRACO_USERS.set(k, (DRACO_USERS.get(k) ?? 0) + 1);
}

/** Release one tank's claim; the last one out disposes the worker. Safe
 *  against mid-parse teardown because a parse always happens between a
 *  retain and its release. */
function releaseDraco(path: string): void {
  const k = dracoDecoderPath(path);
  const n = (DRACO_USERS.get(k) ?? 0) - 1;
  if (n > 0) { DRACO_USERS.set(k, n); return; }
  DRACO_USERS.delete(k);
  DRACO_BY_PATH.get(k)?.dispose();
  DRACO_BY_PATH.delete(k);
}

/**
 * The water ceiling: one translucent plane above the fish, rippling in the
 * vertex shader off a single `uTime` uniform.
 *
 * Closed-form on purpose — the displacement is `sin(ωt + φ)` of the vertex's
 * own position, so the surface is a pure function of t like everything else
 * in this saver, and scrubbing to any frame reproduces it exactly. One draw
 * call, no per-frame CPU work.
 */
function buildWaterCeiling(y: number, color: string, opacity: number): {
  mesh: Mesh; material: ShaderMaterial;
} {
  const geo = new PlaneGeometry(1400, 1400, 48, 48);
  geo.rotateX(-Math.PI / 2);
  geo.userData.mqOwned = true;
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new Color(color) },
      uOpacity: { value: opacity },
    },
    vertexShader: `
      uniform float uTime;
      varying float vRipple;
      void main() {
        vec3 p = position;
        float r = sin(p.x * 0.012 + uTime * 0.5) * cos(p.z * 0.014 - uTime * 0.37);
        p.y += r * 6.0;
        vRipple = r;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vRipple;
      void main() {
        // Caustic-ish banding: the ripple itself modulates brightness, so the
        // surface reads as moving water rather than a tinted sheet of glass.
        float band = 0.65 + 0.35 * vRipple;
        gl_FragColor = vec4(uColor * band, uOpacity * band);
      }`,
  });
  mat.userData.mqOwned = true;
  const mesh = new Mesh(geo, mat);
  mesh.position.y = y;
  mesh.frustumCulled = false;
  return { mesh, material: mat };
}

/**
 * Terrain: the floor as a silhouette instead of a disc.
 *
 * Generated from the mount seed — never fetched — so determinism holds, the
 * offline hosts work, and it costs no network. Built ONCE at mount and never
 * touched per frame, which is why the cost model prices it at zero: it is
 * geometry, not animation.
 *
 * The three shapes are the original aquarium's silhouettes read back as
 * height functions: dunes (long soft swells), ridges (sharp parallel ranges,
 * its `spikey`), basin (a bowl that falls away from the camera — what makes
 * an abyss feel deep).
 */
/** Seabed height as a closed-form function of (x, z).
 *
 *  Returned rather than baked straight into vertices so the swim volume can be
 *  clamped against the SAME expression the mesh is built from. A `dunes` or
 *  `ridges` floor reaches +46, well above the bottom of the fish's depth band,
 *  so without this a bottom-hugger swims through the hill it is hugging. */
function terrainHeightFn(kind: FloorKind, rng: Rng): (x: number, z: number) => number {
  const R = 620;
  // Two seeded octaves — enough for a silhouette, cheap enough to build in a
  // frame. Phases come from the rng so two tanks are never the same hill.
  const a = rng.next() * Math.PI * 2;
  const b = rng.next() * Math.PI * 2;
  const c = rng.next() * Math.PI * 2;
  return (x, z) => {
    const d = Math.sqrt(x * x + z * z) / R;
    let h = 0;
    if (kind === 'dunes') {
      h = Math.sin(x * 0.011 + a) * 26 + Math.cos(z * 0.009 + b) * 20;
    } else if (kind === 'ridges') {
      h = Math.abs(Math.sin(x * 0.02 + a)) * 54 - 18 + Math.sin(z * 0.006 + c) * 10;
    } else if (kind === 'basin') {
      h = d * d * 150 - 60 + Math.sin(x * 0.008 + a) * 8;
    }
    // Feather the rim to nothing so the terrain never shows a cut edge.
    return h * Math.max(0, 1 - d * d);
  };
}

function buildTerrain(height: (x: number, z: number) => number, color: string): Mesh {
  const R = 620;
  const geo = new PlaneGeometry(R * 2, R * 2, 72, 72);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, height(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();
  geo.userData.mqOwned = true;
  const mat = new MeshBasicMaterial({ color: new Color(color) });
  mat.userData.mqOwned = true;
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Light shafts: a few additive cones that drift closed-form.
 *
 * `y` may be NEGATIVE. The original's raysLightY swings +/-2000, and that sign
 * is the whole difference between a sunlit surface and an abyssal glow coming
 * up out of the dark — one of the few knobs in that settings file that changes
 * what a place MEANS rather than how it looks.
 *
 * Rays are the only per-frame work in the room, which is why they are the
 * layer the cost model drops first on a weak device.
 */
function buildRays(count: number, color: string, y: number, strength: number, rng: Rng): {
  group: Group; material: ShaderMaterial;
} {
  const group = new Group();
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: { uTime: { value: 0 }, uColor: { value: new Color(color) }, uStrength: { value: strength } },
    vertexShader: `
      varying float vY;
      void main() {
        vY = uv.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uStrength; uniform float uTime;
      varying float vY;
      void main() {
        // Fade along the shaft and breathe slowly, so it reads as light in
        // suspended matter rather than a solid cone.
        float fade = smoothstep(0.0, 1.0, vY);
        float breathe = 0.75 + 0.25 * sin(uTime * 0.4);
        gl_FragColor = vec4(uColor, fade * uStrength * 0.16 * breathe);
      }`,
  });
  mat.userData.mqOwned = true;
  const geo = new CylinderGeometry(6, 92, Math.abs(y) * 0.85, 10, 1, true);
  geo.userData.mqOwned = true;
  for (let i = 0; i < count; i++) {
    const m = new Mesh(geo, mat);
    const a = rng.next() * Math.PI * 2;
    const r = 60 + rng.next() * 190;
    m.position.set(Math.cos(a) * r, y * 0.45, Math.sin(a) * r);
    // Shafts from below are inverted so the wide end still faces the light.
    if (y < 0) m.rotation.z = Math.PI;
    m.rotation.y = rng.next() * Math.PI;
    m.frustumCulled = false;
    group.add(m);
  }
  return { group, material: mat };
}

const TEMPLATE_CACHE_CAP = 8;
const TEMPLATE_CACHE = new Map<string, Promise<FishTemplate | null>>();
// Eviction deliberately does NOT dispose the evicted template's GPU
// resources: another live instance may still hold clones sharing its
// geometry. The leak is bounded (>8 distinct URLs in one session, a few MB
// each) and freed on context loss; refcounted disposal lands with fishMix,
// where multi-URL sessions become normal.

/**
 * Dispose only GPU resources this tank created — coat/glow materials
 * (tagged `mqOwned` by applyNpcMaterials), tank-built geometry (floor,
 * fallback fish), and each clone's Skeleton boneTexture. Template-shared
 * geometry and eyes/textured materials are never touched: SkeletonUtils.clone
 * shares them with the cached template, and disposing them here corrupts
 * every other clone of the same fish.
 */
function disposeOwned(root: Object3D): void {
  root.traverse((o) => {
    const skinned = o as Partial<SkinnedMesh>;
    if (skinned.isSkinnedMesh && skinned.skeleton) skinned.skeleton.dispose();
    const mesh = o as Partial<Mesh>;
    if (mesh.geometry?.userData?.mqOwned) mesh.geometry.dispose();
    const mats: Material[] = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
      ? [mesh.material]
      : [];
    for (const m of mats) {
      if (!m.userData?.mqOwned) continue;
      const tex = (m as Partial<MeshBasicMaterial>).map;
      if (tex) tex.dispose();
      m.dispose();
    }
  });
}

// ---------------------------------------------------------------------------
// Fish instance — one per visible fish in the scene.
// ---------------------------------------------------------------------------

interface Fish {
  /** Spawn slot. Visibility and phase math key off this — never off array
   *  or arrival order, which is GLB-completion order and network-dependent.
   *  (With one URL every load awaits the same cached promise, so the two
   *  coincide; with mixed URLs they will not.) */
  index: number;
  /** Template URL this fish spawned from — reconcile's diff key. */
  url: string;
  group: Group;
  plan: SwimPlan;
  body: Object3D | null;
  baseScale: number;
  /** The model's own forward yaw from its template. Body wiggle oscillates
   *  AROUND it — writing rotation.y absolutely would spin every fish to face
   *  whatever the wiggle happened to be. */
  baseYaw: number;
  mixer: AnimationMixer | null;
  clipDuration: number;
  tail: Object3D | null;
}

// ---------------------------------------------------------------------------
// TankInstance — the studs: renderer, fog, floor, fish on spline plans.
// ---------------------------------------------------------------------------

class TankInstance implements SaverInstance {
  private readonly ctxSaver: SaverContext;
  private readonly space: ParamSpace;
  private readonly canvas: HTMLCanvasElement;
  private readonly ownsCanvas: boolean;
  private readonly renderer: WebGLRenderer;
  private quality: TankQuality;
  private govScale = 1;
  private frameTimes: number[] = [];
  private lastFrameAt = 0;
  private lastGovCheck = 0;

  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly fogColor = new Color();
  private readonly floorMat: MeshBasicMaterial;
  private readonly motes: Points;
  private readonly moteMat: ShaderMaterial;
  /** The room. Rebuilt only when the environment inputs change — never per
   *  frame — so a static tank costs nothing beyond its draw calls. */
  private room: Object3D | null = null;
  private roomKey = '';
  private waterMat: ShaderMaterial | null = null;
  private terrainMat: MeshBasicMaterial | null = null;
  /** World-space seabed height, or null on a flat floor. Set by buildRoom. */
  private floorHeightAt: ((x: number, z: number) => number) | null = null;
  private rayMat: ShaderMaterial | null = null;
  private ceiling: Mesh | null = null;
  private presetWaterY = 0;
  private presetRayStrength = 0;
  private readonly floorDisc: Mesh;
  /** Sparse, indexed by spawn slot — holes are still-loading fish. */
  private fish: Array<Fish | undefined> = [];
  /** Desired per-slot template URLs — the single source of truth for the
   *  population. reconcile() diffs fish against it; spawn workers re-check
   *  wantKey after every await, so a stale load can never seat a fish. */
  private wantUrls: string[] = [];
  private wantKey = '';
  private wantInputKey = '';
  private mixMode = false;
  private disposed = false;

  private w: number;
  private h: number;
  private frameId: number | null = null;
  private paused = false;
  private startT = 0;
  private t = 0;

  private params: Record<string, ParamValue>;
  private track: ControlTrack | null = null;
  /** Does the track steer swimSpeed? Decided once per applyTrack. When it
   *  does, distance comes from the closed-form integral of the speed curve
   *  (speed changes glide); when it does not, the legacy constant-speed
   *  formula is kept bit-for-bit. */
  private speedTracked = false;
  private readonly thumbnail: boolean;
  private readonly catalog: FishEntry[];
  /** One shared route for formation styles, compiled at mount so switching
   *  into `school` never respawns a fish. */
  private readonly carrierPlan: SwimPlan;
  /** Decoder paths this tank retained, released on dispose. */
  private readonly dracoPaths = new Set<string>();

  constructor(
    ctx: SaverContext,
    space: ParamSpace,
    quality: TankQuality,
    catalog: FishEntry[] = FISH_CATALOG,
  ) {
    this.ctxSaver = ctx;
    this.space = space;
    this.quality = quality;
    this.catalog = catalog;
    this.carrierPlan = compileSwimPlan(ctx.rng.fork(0x5c1), BOUNDS);
    this.thumbnail = ctx.dpr < 0.5;
    this.params = defaultParams(space);
    this.w = ctx.width;
    this.h = ctx.height;

    if (ctx.surface instanceof HTMLCanvasElement) {
      this.canvas = ctx.surface;
      this.ownsCanvas = false;
    } else {
      this.canvas = document.createElement('canvas');
      this.canvas.style.cssText = 'display:block;width:100%;height:100%';
      ctx.host.appendChild(this.canvas);
      this.ownsCanvas = true;
    }
    this.canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());

    if (probeSoftwareGL()) this.quality = qualityFor('minimal');

    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: this.quality.antialias,
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(this.pr());
    this.renderer.setSize(this.w, this.h, false);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = LinearToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.camera = new PerspectiveCamera(55, this.w / this.h, 1, 1200);

    const fogHex = String(this.space.fogColor?.default ?? '#030009');
    this.fogColor.set(fogHex);
    this.scene.fog = new Fog(this.fogColor.getHex(), 60, 500);
    this.scene.background = this.fogColor;

    const floor = new Mesh(
      new CircleGeometry(600, 32),
      new MeshBasicMaterial({ color: 0x0a1d33 }),
    );
    floor.geometry.userData.mqOwned = true;
    floor.material.userData.mqOwned = true;
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    this.floorMat = floor.material;
    this.floorDisc = floor;

    // Plankton motes: seeded base positions, closed-form drift in the vertex
    // shader (one uTime uniform — zero CPU per frame, pure in t). Draw range
    // scales with moteDensity; the default 0 renders nothing.
    const moteCap = this.quality.moteCap;
    const moteRng = ctx.rng.fork(0x407e);
    const pos = new Float32Array(moteCap * 3);
    const ph = new Float32Array(moteCap * 3);
    for (let i = 0; i < moteCap; i++) {
      const a = moteRng.next() * Math.PI * 2;
      const r = Math.sqrt(moteRng.next()) * BOUNDS.radius * 1.15;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = BOUNDS.yMin + moteRng.next() * (BOUNDS.yMax - BOUNDS.yMin + 20);
      pos[i * 3 + 2] = Math.sin(a) * r;
      ph[i * 3] = moteRng.next() * Math.PI * 2;
      ph[i * 3 + 1] = moteRng.next() * Math.PI * 2;
      ph[i * 3 + 2] = moteRng.next() * Math.PI * 2;
    }
    const moteGeo = new BufferGeometry();
    moteGeo.setAttribute('position', new BufferAttribute(pos, 3));
    moteGeo.setAttribute('aPhase', new BufferAttribute(ph, 3));
    moteGeo.userData.mqOwned = true;
    this.moteMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uColor: { value: new Color('#7fd6ff') } },
      vertexShader: `
        attribute vec3 aPhase;
        uniform float uTime;
        varying float vFade;
        void main() {
          vec3 p = position + vec3(
            sin(uTime * 0.11 + aPhase.x) * 6.0,
            sin(uTime * 0.07 + aPhase.y) * 4.0,
            sin(uTime * 0.13 + aPhase.z) * 6.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(180.0 / max(1.0, -mv.z), 1.0, 4.0);
          vFade = 0.35 + 0.3 * sin(uTime * 0.9 + aPhase.x * 7.0);
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vFade;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          gl_FragColor = vec4(uColor, (1.0 - d * 2.0) * vFade * 0.5);
        }`,
    });
    this.moteMat.userData.mqOwned = true;
    this.motes = new Points(moteGeo, this.moteMat);
    this.motes.frustumCulled = false;
    this.motes.visible = false;
    this.scene.add(this.motes);

    // Gentle hemisphere so MeshStandardMaterial eyes render their authored detail.
    // MeshBasicMaterial body/glow coats ignore it — zero visual cost for them.
    this.scene.add(new HemisphereLight(0xffffff, 0x4466aa, 1.5));

    this.reconcile();

    this.paused = ctx.reducedMotion;
    if (this.paused) this.renderStill();
    else this.start();
  }

  // ---- fish sourcing ----

  private str(key: string): string {
    const v = this.params[key];
    return typeof v === 'string' ? v : String(this.space[key]?.default ?? '');
  }

  /** Cheap per-frame room params: move the ceiling, set the shaft strength.
   *  No allocation, no teardown — this is what the structure key protects. */
  private applyRoomParams(waterY: number, rayStrength: number): void {
    if (this.ceiling) this.ceiling.position.y = waterY >= 0 ? waterY : this.presetWaterY;
    if (this.rayMat) {
      const s = rayStrength >= 0 ? rayStrength : this.presetRayStrength;
      this.rayMat.uniforms.uStrength!.value = s;
      this.rayMat.visible = s > 0;
    }
  }

  /**
   * Build (or rebuild) the room for the current environment params.
   *
   * Keyed like reconcile(): one string compare per frame, real work only when
   * the author actually changes something.
   */
  private buildRoom(): void {
    const envName = this.str('environment');
    const floorOverride = this.str('floorKind');
    const waterY = this.num('waterY');
    const rayStrength = this.num('rayStrength');
    // STRUCTURE key only. waterY and rayStrength move a mesh and set a
    // uniform — rebuilding a 5,000-vertex terrain because someone nudged the
    // ceiling would throw away the whole point of building it once.
    const key = `${envName}|${floorOverride}|${this.quality.envBudget}`;
    if (key === this.roomKey) {
      this.applyRoomParams(waterY, rayStrength);
      return;
    }
    this.roomKey = key;

    if (this.room) {
      this.scene.remove(this.room);
      disposeOwned(this.room);
      this.room = null;
      this.waterMat = null;
      this.terrainMat = null;
      this.rayMat = null;
      this.ceiling = null;
    }
    const preset: EnvironmentPreset = environmentOf(envName);
    const can = affordableLayers(this.quality.envBudget, preset);
    // The environment decides WHETHER there is a ceiling; waterY (-1 = auto)
    // only moves it. Turning it off is what `void` and `abyss` are for.

    const group = new Group();
    // Terrain replaces the disc rather than sitting on it, so `flat` stays
    // byte-for-byte the original floor and every published scene is safe.
    // The classic steering lane validates nothing, so an unknown floorKind
    // must fall back rather than cast — otherwise a typo hides the disc AND
    // builds a zero-height plane, i.e. an invisible floor.
    const kind: FloorKind = FLOOR_KINDS.includes(floorOverride as FloorKind)
      ? (floorOverride as FloorKind)
      : preset.floor;
    if (kind !== 'flat') {
      const floorHex = String(this.params.floorColor ?? this.space.floorColor?.default ?? '#0a1d33');
      const height = terrainHeightFn(kind, this.ctxSaver.rng.fork(0x7e88));
      const terrain = buildTerrain(height, floorHex);
      terrain.position.y = -2;
      // World-space seabed, for the swim clamp. Same expression, same seed.
      this.floorHeightAt = (x, z) => height(x, z) + terrain.position.y;
      group.add(terrain);
      this.terrainMat = terrain.material as MeshBasicMaterial;
    }
    // A flat floor has no hills to avoid; clear any the previous room left.
    if (kind === 'flat') this.floorHeightAt = null;
    this.floorDisc.visible = kind === 'flat';
    if (can.water && preset.water) {
      const y = waterY >= 0 ? waterY : preset.water.y;
      const { mesh, material } = buildWaterCeiling(y, preset.water.color, preset.water.opacity);
      group.add(mesh);
      this.waterMat = material;
      this.ceiling = mesh;
      this.presetWaterY = preset.water.y;
    }
    if (can.rayCount > 0 && preset.rays) {
      // -1 = follow the environment; 0 is a real author choice for "off".
      const strength = rayStrength >= 0 ? rayStrength : preset.rays.strength;
      if (strength > 0) {
        const { group: rg, material } = buildRays(
          can.rayCount, preset.rays.color, preset.rays.y, strength, this.ctxSaver.rng.fork(0x8a1),
        );
        group.add(rg);
        this.rayMat = material;
        this.presetRayStrength = preset.rays.strength;
      }
    }
    this.room = group;
    this.scene.add(group);
    this.applyRoomParams(waterY, rayStrength);
    this.ctxSaver.host.dataset.mqEnv = preset.name;
  }

  /** Ceiling the pool may ever reach on this device. */
  private poolCapNow(): number {
    const poolCap = this.thumbnail ? Math.min(6, MAX_FISH) : MAX_FISH;
    return Math.min(poolCap, this.quality.fishCap);
  }

  /**
   * One mechanism for every population change — initial mount, fishCount
   * growth, fishUrl swap, and fishMix (mixed breeds in one tank): compute the
   * desired per-slot URL list, tear down slots whose fish no longer match,
   * and queue spawns for the holes. Cheap when nothing changed (one string
   * compare per frame). Non-empty fishMix wins over fishUrl/fishCount; an
   * unparseable mix degrades to single-breed mode rather than a blank tank.
   */
  private reconcile(): void {
    const cap = this.poolCapNow();
    const mixStr = this.str('fishMix').trim();
    const url = this.str('fishUrl');
    const n = Math.min(Math.max(1, Math.round(this.num('fishCount'))), cap);
    const inputKey = `${mixStr}\u0000${url}\u0000${n}\u0000${cap}`;
    if (inputKey === this.wantInputKey) return;
    this.wantInputKey = inputKey;

    let want: string[] = [];
    this.mixMode = false;
    if (mixStr !== '') {
      want = expandFishMix(parseFishMix(mixStr, this.catalog).entries, cap);
      this.mixMode = want.length > 0;
    }
    if (!this.mixMode) {
      // Single-breed: the pool never shrinks while the url is stable
      // (steering fishCount down just hides); a url change — or leaving mix
      // mode, however the mix happened to start — rebuilds at n. Without the
      // mode check, a mix whose first breed equals fishUrl would keep its
      // slots on clear while any other mix would not (review, PR #72).
      const wasSingle = this.wantKey === '' || this.wantKey.startsWith('one:');
      const stable = wasSingle && this.wantUrls.length > 0 && this.wantUrls[0] === url;
      const len = stable ? Math.max(n, Math.min(this.wantUrls.length, cap)) : n;
      want = Array.from({ length: len }, () => url);
    }
    this.wantUrls = want;
    this.wantKey = (this.mixMode ? 'mix:' : 'one:') + want.join('|');
    if (this.mixMode) this.ctxSaver.host.dataset.mqMix = mixStr;
    else delete this.ctxSaver.host.dataset.mqMix;

    const missing: number[] = [];
    for (let i = 0; i < Math.max(this.fish.length, want.length); i++) {
      const f = this.fish[i];
      const wantUrl = want[i];
      if (f && (wantUrl === undefined || f.url !== wantUrl)) {
        f.mixer?.stopAllAction();
        this.scene.remove(f.group);
        disposeOwned(f.group);
        this.fish[i] = undefined;
      }
      if (wantUrl !== undefined && !this.fish[i]) missing.push(i);
    }
    this.fish.length = Math.min(this.fish.length, want.length);
    if (missing.length) void this.spawnMissing(missing);
    this.ctxSaver.host.dataset.mqFish = String(this.loadedCount());
  }

  /** Bounded-concurrency spawn of the queued slots. Guarded by wantKey: any
   *  reconcile that changes the population invalidates in-flight loads. */
  private async spawnMissing(slots: number[]): Promise<void> {
    const key = this.wantKey;
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < slots.length && !this.disposed && this.wantKey === key) {
        const i = slots[next++]!;
        const slotUrl = this.wantUrls[i]!;
        const tpl = await this.template(slotUrl, this.str('dracoPath'));
        if (this.disposed || this.wantKey !== key) return;
        if (!this.fish[i]) {
          this.spawn(tpl, i, slotUrl);
          if (!tpl) this.healLater(i, slotUrl, key);
        }
      }
    };
    await Promise.all(Array.from({ length: GLB_CONCURRENCY }, worker));
    if (this.paused) this.renderStill();
  }

  private template(url: string, dracoPath = ''): Promise<FishTemplate | null> {
    const key = url;
    let p = TEMPLATE_CACHE.get(key);
    if (!p) {
      p = (async (): Promise<FishTemplate | null> => {
        try {
          // Gateway ladder (MQ21): try each candidate with its own timeout so
          // one flaky gateway degrades to the next instead of to a fallback
          // blob. Non-ipfs URLs have a single candidate.
          const buf = await (async (): Promise<ArrayBuffer> => {
            let lastErr: unknown = new Error('no gateway candidates');
            for (const candidate of resolveIpfsUrls(url)) {
              const ctl = new AbortController();
              const timer = setTimeout(() => ctl.abort(), 12_000);
              try {
                const res = await fetch(candidate, { signal: ctl.signal });
                if (!res.ok) throw new Error(`fish glb ${res.status}`);
                return await res.arrayBuffer();
              } catch (e) {
                lastErr = e;
              } finally {
                clearTimeout(timer);
              }
            }
            throw lastErr;
          })();
          const loader = new GLTFLoader();
          const draco = needsDraco(buf);
          if (draco) {
            // Retain ONCE per path per tank — the release side is one call per
            // unique path at dispose, so retaining per model would leak the
            // refcount and the worker would never be freed.
            const key = dracoDecoderPath(dracoPath);
            if (!this.dracoPaths.has(key)) {
              this.dracoPaths.add(key);
              retainDraco(dracoPath);
            }
            loader.setDRACOLoader(dracoLoader(dracoPath));
          }
          const gltf = await loader.parseAsync(buf, '');
          const scene = gltf.scene;
          forceOpaque(scene);
          const size = new Box3().setFromObject(scene).getSize(new Vector3());
          const longX = size.x > size.z;
          const nose = eyeNoseSign(scene, longX ? 'x' : 'z') || 1;
          const yaw = longX
            ? nose > 0
              ? -Math.PI / 2
              : Math.PI / 2
            : nose > 0
            ? 0
            : Math.PI;
          return {
            scene,
            clip: gltf.animations[0] ?? null,
            norm: FISH_LENGTH / (Math.max(size.x, size.y, size.z) || 1),
            yaw,
            draco,
          };
        } catch {
          TEMPLATE_CACHE.delete(key);
          return null;
        }
      })();
      if (TEMPLATE_CACHE.size >= TEMPLATE_CACHE_CAP) {
        const oldest = TEMPLATE_CACHE.keys().next().value;
        if (oldest !== undefined) TEMPLATE_CACHE.delete(oldest);
      }
      TEMPLATE_CACHE.set(key, p);
    }
    return p;
  }

  private spawn(tpl: FishTemplate | null, index: number, url: string): void {
    const rng = this.ctxSaver.rng.fork(0x715);
    const plan = compileSwimPlan(rng.fork(index), BOUNDS);
    const group = new Group();
    let mixer: AnimationMixer | null = null;
    let tail: Object3D | null = null;
    let bodyNode: Object3D | null = null;
    let clipDuration = 0;

    if (tpl) {
      const body = cloneSkinned(tpl.scene);
      applyNpcMaterials(body, this.ctxSaver.rng.fork(0xc0a7 + index));
      body.scale.setScalar(tpl.norm);
      body.rotation.y = tpl.yaw;
      group.add(body);
      bodyNode = body;
      if (tpl.clip) {
        mixer = new AnimationMixer(body);
        mixer.clipAction(tpl.clip).play();
        clipDuration = tpl.clip.duration;
      }
    } else {
      const coat = this.ctxSaver.rng
        .fork(0xc0a7 + index)
        .pick(MIAMI_VICE_COLORS);
      const mat = new MeshBasicMaterial({ color: new Color(coat) });
      mat.userData.mqOwned = true;
      const body = new Mesh(new SphereGeometry(FISH_LENGTH / 2, 12, 8), mat);
      body.geometry.userData.mqOwned = true;
      body.scale.set(1, 0.55, 0.4);
      const tailMesh = new Mesh(
        new ConeGeometry(FISH_LENGTH * 0.22, FISH_LENGTH * 0.5, 8),
        mat,
      );
      tailMesh.geometry.userData.mqOwned = true;
      tailMesh.rotation.z = Math.PI / 2;
      tailMesh.position.x = -FISH_LENGTH * 0.62;
      group.add(body, tailMesh);
      tail = tailMesh;
    }

    const baseScale = plan.cruise > 10 ? 1.1 : 0.8 + (index % 5) * 0.1;
    group.scale.multiplyScalar(baseScale);
    this.scene.add(group);
    this.fish[index] = {
      index,
      url,
      baseYaw: tpl ? tpl.yaw : 0,
      group,
      plan,
      body: bodyNode,
      baseScale,
      mixer,
      clipDuration,
      tail,
    };
    this.ctxSaver.host.dataset.mqFish = String(this.loadedCount());
    if (tpl?.draco) this.ctxSaver.host.dataset.mqDraco = '1';
  }

  /** One delayed second chance for a slot that spawned as a fallback blob:
   *  the failed template self-evicted from the cache, so a later fetch can
   *  succeed (gateway flakes are transient). Bounded to a single retry per
   *  spawn, guarded by wantKey, and skipped after dispose. Population loading
   *  was never pure in t (it is network), so the timer breaks nothing. */
  private healLater(index: number, url: string, key: string): void {
    setTimeout(() => {
      void (async (): Promise<void> => {
        if (this.disposed || this.wantKey !== key) return;
        const tpl = await this.template(url, this.str('dracoPath'));
        if (!tpl || this.disposed || this.wantKey !== key) return;
        const blob = this.fish[index];
        if (!blob || blob.body) return; // real fish arrived meanwhile
        blob.mixer?.stopAllAction();
        this.scene.remove(blob.group);
        disposeOwned(blob.group);
        this.fish[index] = undefined;
        this.spawn(tpl, index, url);
        if (this.paused) this.renderStill();
      })();
    }, 15_000);
  }

  /** Fish actually spawned — the sparse array's holes are loads in flight. */
  private loadedCount(): number {
    let n = 0;
    for (const f of this.fish) if (f) n++;
    return n;
  }

  // ---- params / state ----

  private applyParams(t: number): void {
    if (this.track) this.params = sampleTrack(this.space, this.track, t);
  }

  private num(key: string): number {
    // Clamped, string-coercing read — the classic steering lane is
    // unvalidated server-side (MQ17), so hostile or stringified values reach
    // us as-is. Note the swimSpeed distance integral (integrateParam) does
    // not clamp; range enforcement at intake is MQ17's half of this fix.
    return coerceNum(this.space[key], this.params[key]);
  }

  private setState(t: number): void {
    const tSec = t / 1000;
    this.applyParams(t);
    const speed = this.num('swimSpeed');
    // Warped swim time: ∫ speed dτ. With a steered speed this makes changes
    // glide (MQ11 — multiplying the whole elapsed integral teleported every
    // fish proportionally to elapsed time). Only UNSTEERED tracks keep the
    // legacy closed form bit-for-bit; a steered track uses warped-time
    // semantics throughout, where the speed-wobble cycle scales with speed
    // (deliberate — the same way tail beat and clip phase already do, since
    // both are distance-driven). Both paths are pure functions of (t, track).
    // Bounds clamp the integrated curve to the declared range, matching the
    // clamped num() reads — the classic lane is intake-unvalidated (MQ17).
    const speedDef = this.space.swimSpeed;
    const warpSec = this.speedTracked && this.track
      ? integrateParam(this.space, this.track, 'swimSpeed', t, {
          ...(speedDef?.min !== undefined ? { min: speedDef.min } : {}),
          ...(speedDef?.max !== undefined ? { max: speedDef.max } : {}),
        }) / 1000
      : tSec * speed;

    this.reconcile();

    // Camera orbit
    const az = MathUtils.degToRad(
      this.num('cameraAzimuth') + this.num('autoRotate') * tSec,
    );
    const el = MathUtils.degToRad(this.num('cameraElevation'));
    const dist = this.num('cameraDistance');
    this.camera.position.set(
      Math.cos(el) * Math.sin(az) * dist,
      Math.max(10, 15 + Math.sin(el) * dist),
      Math.cos(el) * Math.cos(az) * dist,
    );
    this.camera.lookAt(0, 35, 0);

    // Fog color
    const fogHex = String(
      this.params.fogColor ?? this.space.fogColor?.default ?? '#030009',
    );
    this.fogColor.set(fogHex);
    (this.scene.fog as Fog).color.copy(this.fogColor);

    // Atmosphere — every default reproduces the pre-atmosphere constants, so
    // this block is provably invisible until steered.
    const fog = this.scene.fog as Fog;
    fog.near = this.num('fogNear');
    fog.far = Math.max(this.num('fogFar'), fog.near + 20);
    const floorHex = String(this.params.floorColor ?? this.space.floorColor?.default ?? '#0a1d33');
    this.floorMat.color.set(floorHex);
    // Terrain follows floorColor as well — the environment supplies the SHAPE,
    // the author keeps the palette.
    this.terrainMat?.color.set(floorHex);
    const density = this.num('moteDensity');
    const active = Math.round(density * this.quality.moteCap);
    this.motes.visible = active > 0;
    if (active > 0) {
      this.motes.geometry.setDrawRange(0, active);
      this.moteMat.uniforms.uTime!.value = tSec;
      (this.moteMat.uniforms.uColor!.value as Color).set(
        String(this.params.moteColor ?? this.space.moteColor?.default ?? '#7fd6ff'),
      );
    }
    this.ctxSaver.host.dataset.mqMotes = String(active);

    // The room: rebuilt only on change, then driven by the same clock as
    // everything else so it stays pure in t.
    this.buildRoom();
    if (this.waterMat) this.waterMat.uniforms.uTime!.value = tSec;
    if (this.rayMat) this.rayMat.uniforms.uTime!.value = tSec;

    const style = swimStyleOf(this.str('swimStyle'));
    const variance = this.num('swimVariance');
    const wiggle = this.num('bodyWiggle');

    // Fish. Mix mode: the DSL defines the population absolutely (fishCount
    // is documented as ignored). Single mode: fishCount is the dial;
    // reconcile has already queued any missing slots.
    const visible = this.mixMode
      ? this.wantUrls.length
      : Math.min(Math.round(this.num('fishCount')), this.quality.fishCap);
    // Once per frame, not once per fish: the extent walks every slot, so
    // computing it inside the loop made the formation O(n^2) every frame for
    // a value that is identical across the shoal.
    const extent = style.formation ? formationExtent(visible, variance) : null;
    for (const f of this.fish) {
      if (!f) continue;
      f.group.visible = f.index < visible;
      if (!f.group.visible) continue;

      // Style + per-fish variation. Both are pure functions of (index, t), so
      // a scene stays frame-addressable no matter how varied it looks.
      const varn = fishVariation(f.index, variance);
      const styleSpeed = style.speedMul * varn.speedMul;
      // `effort` is how hard the fish is working; `d` is where that puts it.
      // They differ for styles that hold station: a hovering fish still beats
      // its tail, so animation must not scale with travel or it looks stuffed.
      //
      // Speed goes in distanceAt's THIRD argument, never folded into time.
      // distanceAt scales the whole integral (cruise + wobble) by that
      // argument; multiplying TIME instead compresses the wobble's phase, so a
      // scene with swimSpeed != 1 and no speed track would have silently
      // changed trajectory — breaking `loop`'s no-op promise for exactly the
      // scenes least likely to be looking.
      const effort = this.speedTracked
        ? distanceAt(f.plan, warpSec, styleSpeed)
        : distanceAt(f.plan, tSec, speed * styleSpeed);
      const anchor = style.travel < 1 ? varn.anchor * f.plan.totalLength : 0;
      const d = anchor + effort * style.travel;

      // What drives the animation. For a free fish that is its own effort; for
      // a fish in formation it is the carrier's, because the carrier is what
      // is actually moving it. Beating to its own unused loop made a shoal
      // whose tails were out of step with its travel — fish moonwalking.
      let beat = effort;
      let pose;
      if (style.formation) {
        // Carrier school: ONE route, fish held in slots in its local frame, so
        // the shoal turns as a body.
        //
        // Measured over 4 seeds x 600 frames at 8 fish, variance 0.6
        // (src/swim.test.ts holds the spacing half of this as a gate):
        //
        //   loop    27.8% of fish-frames with a neighbour inside a body
        //           length, closest approach 1.3u, polarisation 0.38
        //   school  0.0%, closest approach 27.3u, polarisation 1.00
        //
        // The earlier 0.85-vs-boids'-0.87 figure in this comment described the
        // spike's boids prototype, not this port, and the port's first draft
        // measured WORSE than loop at 27.3%. Rigid offsets from one arc sample
        // are what actually fixed it.
        const slot = formationSlot(f.index, visible, variance);
        // The carrier moves at the STYLE's speed, deliberately without the
        // per-fish multiplier: a formation whose members each chose their own
        // pace is not a formation. Per-fish speed still varies the tail beat
        // through `effort`, which is where it reads anyway.
        const lead = this.speedTracked
          ? distanceAt(this.carrierPlan, warpSec, style.speedMul)
          : distanceAt(this.carrierPlan, tSec, speed * style.speedMul);
        beat = lead;
        // ONE arc sample for the whole shoal, offset rigidly. Sampling each
        // row at `lead - back` instead put the rows at different points on a
        // curving spline, so they converged on the inside of every turn: a
        // lattice with a body length of clearance measured 27% of fish-frames
        // with a neighbour inside one, exactly as if there were no lattice.
        const c = swimPoseAtDistance(this.carrierPlan, lead);
        const ext = extent ?? formationExtent(visible, variance);
        // Keep the shoal in the tank by moving its CENTRE, never by pulling
        // individual fish toward the middle — that squashing was the other
        // half of the pile.
        const maxR = Math.max(0, BOUNDS.radius - Math.hypot(ext.side, ext.back));
        const cr = Math.hypot(c.x, c.z);
        const cs = cr > maxR && cr > 0 ? maxR / cr : 1;
        const hl = Math.hypot(c.fx, c.fz) || 1;
        const fwdX = c.fx / hl, fwdZ = c.fz / hl;
        // Right-hand normal in the ground plane.
        const rx = fwdZ, rz = -fwdX;
        const cy = Math.min(
          BOUNDS.yMax - ext.up,
          Math.max(BOUNDS.yMin + ext.up, c.y),
        );
        // A rigid body means every fish points EXACTLY the same way, which
        // measures as polarisation 1.00 and looks like a formation flight.
        // A few degrees of per-fish yaw, scaled by variance, buys back the
        // look of animals without touching the spacing guarantee.
        const yaw = Math.sin(varn.phase) * 0.12 * variance;
        const cy2 = Math.cos(yaw), sy2 = Math.sin(yaw);
        pose = {
          ...c,
          x: c.x * cs + rx * slot.side - fwdX * slot.back,
          y: cy + slot.up,
          z: c.z * cs + rz * slot.side - fwdZ * slot.back,
          fx: fwdX * cy2 - fwdZ * sy2,
          fz: fwdX * sy2 + fwdZ * cy2,
        };
      } else {
        pose = swimPoseAtDistance(f.plan, d);
      }

      // Depth band, then bob. Clamping BEFORE the bob keeps a bottom-hugger
      // from being lifted out of its band by its own motion.
      let y = pose.y;
      if (style.bobAmp > 0) {
        y += Math.sin(tSec * style.bobHz * Math.PI * 2 + varn.phase) * style.bobAmp;
      }
      // Clamp AFTER the bob. Clamping first let a fish bob straight back out
      // of the band it was just put in — a bottom-hugger that leaves the floor
      // is not band-limited, it is just a fish.
      const band = bandRange(style.band);
      if (band) {
        const lo = BOUNDS.yMin + (BOUNDS.yMax - BOUNDS.yMin) * band.lo;
        const hi = BOUNDS.yMin + (BOUNDS.yMax - BOUNDS.yMin) * band.hi;
        y = Math.min(hi, Math.max(lo, y));
      }
      // Then the seabed, which outranks the band: `dunes` and `ridges` rise to
      // +46 while the floor band tops out at 23, so a bottom-hugger over a
      // hill was inside it. Half a body length of clearance, and never above
      // the tank's own ceiling.
      if (this.floorHeightAt) {
        const clear = this.floorHeightAt(pose.x, pose.z) + FISH_LENGTH * 0.5;
        if (y < clear) y = Math.min(BOUNDS.yMax, clear);
      }

      // Inside a depth band a fish swims LEVEL. Without this its heading still
      // points along the unclamped spline, so a bottom-hugger noses down into
      // a floor it can never reach and a skimmer climbs at an invisible lid.
      // Level, not merely flatter: a fraction of the spline's climb still reads
      // as a fish nosing into a floor it cannot reach.
      const fy = band ? 0 : pose.fy;
      f.group.position.set(pose.x, y, pose.z);
      f.group.lookAt(pose.x + pose.fx, y + fy, pose.z + pose.fz);
      f.group.rotateZ(pose.roll);

      const breathe = 1 + Math.sin(tSec * 2.1 + f.index) * 0.008;
      f.group.scale.setScalar(f.baseScale * breathe * varn.scaleMul);

      // Most of the breed library carries NO animation clip, so those fish
      // translated along their spline completely rigidly — gliding cardboard.
      // A distance-driven yaw on the body fixes the whole library at once and
      // costs one sin per fish. Clipped models skip it: their clip is better.
      if (f.body && !f.mixer) {
        // Write every frame, scaled by wiggle. Skipping the write at 0 left the
        // last offset latched, so turning the dial down stopped the motion but
        // never returned the fish to its own heading.
        f.body.rotation.y = f.baseYaw + Math.sin(beat * 0.06 + varn.phase) * 0.55 * wiggle;
      }

      if (f.mixer && f.clipDuration > 0) {
        f.mixer.setTime(
          (((beat * 0.045) % f.clipDuration) + f.clipDuration) % f.clipDuration,
        );
      } else if (f.tail) {
        // warpSec === tSec·speed when speed is constant — same phase as before.
        f.tail.rotation.y = Math.sin(warpSec * 6 + f.index) * 0.5;
      }
    }
  }

  // ---- render ----

  private renderScene(): void {
    if (this.renderer.getContext()?.isContextLost?.()) return;
    this.renderer.render(this.scene, this.camera);
  }

  private start(): void {
    if (this.frameId !== null || typeof requestAnimationFrame === 'undefined')
      return;
    this.startT = 0;
    this.frameId = requestAnimationFrame((now) => this.loop(now));
  }

  private stop(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  private loop(now: number): void {
    this.frameId = requestAnimationFrame((n) => this.loop(n));
    if (this.startT === 0) this.startT = now;
    this.governFrame(now);
    this.t = now - this.startT;
    this.setState(this.t);
    this.renderScene();
  }

  private pr(): number {
    return Math.max(
      0.5,
      effectivePixelRatio(this.w, this.h, this.ctxSaver.dpr, this.quality) *
        this.govScale,
    );
  }

  private applyPr(): void {
    const pr = this.pr();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.w, this.h, false);
  }

  private governFrame(now: number): void {
    if (this.lastFrameAt > 0) {
      const dt = now - this.lastFrameAt;
      if (dt < 250) this.frameTimes.push(dt);
    }
    this.lastFrameAt = now;
    if (now - this.lastGovCheck < 2000 || this.frameTimes.length < 30) return;
    this.lastGovCheck = now;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1]!;
    this.frameTimes = [];
    if (median > 21 && this.govScale > 0.56) {
      this.govScale *= 0.8;
      this.applyPr();
    } else if (median < 14 && this.govScale < 1) {
      this.govScale = Math.min(1, this.govScale * 1.15);
      this.applyPr();
    }
  }

  private renderStill(): void {
    this.setState(this.t);
    this.renderScene();
  }

  // ---- SaverInstance ----

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      this.stop();
      this.renderStill();
    } else {
      this.start();
    }
  }

  resize(width: number, height: number, dpr?: number): void {
    this.w = width;
    this.h = height;
    if (dpr !== undefined) this.ctxSaver.dpr = dpr;
    this.applyPr();
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.paused) this.renderStill();
  }

  applyTrack(track: ControlTrack): void {
    this.track = track;
    this.speedTracked = track.deltas.some((d) => d.path === 'swimSpeed');
    if (this.paused) this.renderStill();
  }

  renderFrame(t: number, _seed: number): void {
    this.t = t;
    this.setState(t);
    this.renderScene();
  }

  composition(): SaverLayer[] {
    return [
      {
        id: 'tank',
        label: 'Tank',
        kind: 'surface',
        el: this.canvas,
        description:
          'WebGL2 aquarium: floor, fog, fish on Catmull-Rom spline paths',
      },
    ];
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    for (const p of this.dracoPaths) releaseDraco(p);
    this.dracoPaths.clear();
    for (const f of this.fish) {
      if (!f) continue;
      f.mixer?.stopAllAction();
    }
    // One ownership-aware pass over the whole scene (fish, floor): frees what
    // this instance created, leaves template-shared resources for the cache.
    // The context loss below reclaims this context's GPU side regardless.
    disposeOwned(this.scene);
    for (const f of this.fish) {
      if (!f) continue;
      this.scene.remove(f.group);
    }
    this.fish = [];
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    if (this.ownsCanvas) this.canvas.remove();
    delete this.ctxSaver.host.dataset.mqFish;
    delete this.ctxSaver.host.dataset.mqMix;
    delete this.ctxSaver.host.dataset.mqMotes;
    delete this.ctxSaver.host.dataset.mqEnv;
    delete this.ctxSaver.host.dataset.mqDraco;
    delete this.ctxSaver.host.dataset.mqBackend;
  }
}

// ---------------------------------------------------------------------------
// Factory — single entry point for mounting a tank.
// ---------------------------------------------------------------------------

export function mountTank(
  ctx: SaverContext,
  space: ParamSpace = METAQUARIUM_PARAMS,
  tier: CapabilityTier = 'standard',
  catalog?: FishEntry[],
): SaverInstance {
  const resolved = withDefaults(space, ctx.params);
  const inst = new TankInstance(ctx, resolved, qualityFor(tier), catalog);
  ctx.host.dataset.mqBackend = 'webgl2';
  return inst;
}
