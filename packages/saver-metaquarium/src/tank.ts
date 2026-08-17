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
const FISH_LENGTH = 18;
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
}


/** One decoder per page, created on first Draco model and reused — spinning up
 *  a worker per fish would be absurd. Null until something needs it, so a tank
 *  of uncompressed models never pays for it. */
let DRACO: DRACOLoader | null = null;
function dracoLoader(path: string): DRACOLoader {
  if (!DRACO) {
    DRACO = new DRACOLoader();
    // Default: the copy tsup ships beside this module. Vite and friends
    // rewrite `import.meta.url` asset URLs at build time; hosts that bundle
    // differently override with the dracoPath param.
    // Trailing slash is load-bearing — DRACOLoader concatenates the filename
    // straight onto this, and a missing slash yields `…/dracodraco_decoder.wasm`,
    // which a dev server answers with index.html and the decoder dies on
    // "Unexpected token '<'".
    const base = path || new URL('./draco/', import.meta.url).href;
    DRACO.setDecoderPath(base.endsWith('/') ? base : `${base}/`);
  }
  return DRACO;
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
          if (needsDraco(buf)) loader.setDRACOLoader(dracoLoader(dracoPath));
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
      group,
      plan,
      body: bodyNode,
      baseScale,
      mixer,
      clipDuration,
      tail,
    };
    this.ctxSaver.host.dataset.mqFish = String(this.loadedCount());
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
    this.floorMat.color.set(
      String(this.params.floorColor ?? this.space.floorColor?.default ?? '#0a1d33'),
    );
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

    // Fish. Mix mode: the DSL defines the population absolutely (fishCount
    // is documented as ignored). Single mode: fishCount is the dial;
    // reconcile has already queued any missing slots.
    const visible = this.mixMode
      ? this.wantUrls.length
      : Math.min(Math.round(this.num('fishCount')), this.quality.fishCap);
    for (const f of this.fish) {
      if (!f) continue;
      f.group.visible = f.index < visible;
      if (!f.group.visible) continue;

      const d = this.speedTracked
        ? distanceAt(f.plan, warpSec, 1)
        : distanceAt(f.plan, tSec, speed);
      const pose = swimPoseAtDistance(f.plan, d);
      f.group.position.set(pose.x, pose.y, pose.z);
      f.group.lookAt(pose.x + pose.fx, pose.y + pose.fy, pose.z + pose.fz);
      f.group.rotateZ(pose.roll);

      const breathe = 1 + Math.sin(tSec * 2.1 + f.index) * 0.008;
      f.group.scale.setScalar(f.baseScale * breathe);

      if (f.mixer && f.clipDuration > 0) {
        f.mixer.setTime(
          (((d * 0.045) % f.clipDuration) + f.clipDuration) % f.clipDuration,
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
