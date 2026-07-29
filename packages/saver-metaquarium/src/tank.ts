import {
  sampleTrack,
  defaultParams,
  type ControlTrack,
  type ParamSpace,
  type ParamValue,
  type SaverContext,
  type SaverInstance,
  type SaverLayer,
} from '@idle-screens/core';
import {
  AmbientLight,
  AnimationMixer,
  Box3,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  LinearToneMapping,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type AnimationClip,
  type Object3D,
  type Material,
  type Texture,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { METAQUARIUM_PARAMS, withDefaults } from './manifest';
import { farmMetadata, pickFarmFish, resolveAssetUrl } from './farm';
import { makeFishPath, fishPose, type FishPath, type TankBounds } from './swim';
import {
  applyFarmMaterials,
  applyNpcMaterials,
  hasTexturedMaterial,
  BLOOM_LAYER,
  MIAMI_VICE_COLORS,
} from './materials';
import { qualityFor, type TankQuality } from './quality';
import type { CapabilityTier } from '@idle-screens/capabilities';

const BOUNDS: TankBounds = { radius: 120, yMin: 15, yMax: 72 };
/** Hero mode: the singular fish wanders a tight volume around center stage so
 *  the orbiting camera always frames it. */
const HERO_BOUNDS: TankBounds = { radius: 46, yMin: 26, yMax: 54 };
const HERO_SCALE = 1.8;
const WATER_Y = 88;
const FISH_LENGTH = 18;
const MAX_FISH = METAQUARIUM_PARAMS.fishCount.max ?? 24;
const GLB_CONCURRENCY = 3;

/**
 * The rendering recipe follows the shipped Metaquarium exhibits, not the code
 * defaults: LinearToneMapping (the original overrides its ACES default at
 * runtime), exposure 1, sRGB out, dark fog, and selective bloom over a
 * `GLOW-*` layer. Fish bodies are unlit (authored atlases for farm fish,
 * seeded palette for the bundled breed — see materials.ts), so scene lighting
 * shapes only the floor and PBR parts and can never wash the fish to white.
 */
interface FishTemplate {
  scene: Object3D;
  clip: AnimationClip | null;
  norm: number;
  yaw: number;
  /** Bundled/NPC breed → per-clone seeded palette materials. */
  npc: boolean;
  /** Carries a texture atlas — its look IS the texture; never recoat. */
  textured: boolean;
}

interface Fish {
  group: Group;
  path: FishPath;
  mixer: AnimationMixer | null;
  clipDuration: number;
  tail: Object3D | null;
}

class TankInstance implements SaverInstance {
  private readonly ctxSaver: SaverContext;
  private readonly space: ParamSpace;
  private readonly canvas: HTMLCanvasElement;
  private readonly ownsCanvas: boolean;
  private readonly renderer: WebGLRenderer;
  private readonly quality: TankQuality;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly waterGeo: PlaneGeometry;
  private readonly waterBase: Float32Array;
  private readonly waterTexture: Texture | null;
  private readonly fogColor = new Color();
  private readonly abort = new AbortController();
  private readonly templates = new Map<string, Promise<FishTemplate | null>>();
  private bloomComposer: EffectComposer | null = null;
  private finalComposer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private mixPass: ShaderPass | null = null;
  private fish: Fish[] = [];
  private disposed = false;
  /** Bundled-fish mode state (grow-on-steer); null when a farm populated us. */
  private bundled: { url: string; poolCap: number } | null = null;
  private heroMode = false;
  private growing = false;

  private w: number;
  private h: number;
  private frameId: number | null = null;
  private paused = false;
  private startT = 0;
  private t = 0;

  private params: Record<string, ParamValue>;
  private track: ControlTrack | null = null;
  /** dpr < 0.5 = thumbnail-scale mount (gallery tile): small school, no bloom
   *  composers — UnrealBloom's shader compile is a main-thread spike a wall of
   *  tiles must not pay, and a 320px card shows no meaningful halo anyway. */
  private readonly thumbnail: boolean;

  constructor(ctx: SaverContext, space: ParamSpace, quality: TankQuality) {
    this.ctxSaver = ctx;
    this.space = space;
    this.quality = quality;
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

    // preserveDrawingBuffer: three consumers read this canvas back — channel
    // thumb capture, the playground flash-gate sampler, and the determinism
    // e2e's toDataURL. Without it they all read black.
    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: quality.antialias,
      stencil: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(ctx.dpr, quality.maxPixelRatio));
    this.renderer.setSize(this.w, this.h, false);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = LinearToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.camera = new PerspectiveCamera(55, this.w / this.h, 1, 1200);

    const fogHex = String(this.space.fogColor?.default ?? '#030009');
    this.fogColor.set(fogHex);
    this.scene.fog = new Fog(this.fogColor.getHex(), 60, 500);
    this.scene.background = this.fogColor;

    // Exhibit lighting (ambient #ade5ff, rays #daf3ff). Fish bodies are unlit;
    // these shape the floor, water and PBR parts only.
    this.scene.add(new AmbientLight(0xade5ff, 2.6));
    const sun = new DirectionalLight(0xdaf3ff, 1.1);
    sun.position.set(300, 600, 0);
    this.scene.add(sun);

    const floor = new Mesh(
      new CircleGeometry(360, 48),
      new MeshStandardMaterial({ color: 0x081828, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    this.waterGeo = new PlaneGeometry(720, 720, 32, 32);
    this.waterBase = Float32Array.from(this.waterGeo.attributes.position!.array);
    this.waterTexture = makeWaterTexture();
    const waterMat = new MeshBasicMaterial({
      color: 0x0044ff,
      map: this.waterTexture,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: DoubleSide,
    });
    const water = new Mesh(this.waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER_Y;
    water.renderOrder = 1;
    water.layers.enable(BLOOM_LAYER);
    this.scene.add(water);

    void this.populate();

    this.paused = ctx.reducedMotion;
    if (this.paused) this.renderStill();
    else this.start();
  }

  // ---- fish sourcing ----
  private str(key: string): string {
    const v = this.params[key];
    return typeof v === 'string' ? v : String(this.space[key]?.default ?? '');
  }

  private async populate(): Promise<void> {
    // Thumbnail-scale mounts keep the school small so a wall of tiles
    // doesn't pay for 24 skinned clones per tile.
    const poolCap = this.thumbnail ? Math.min(6, MAX_FISH) : MAX_FISH;
    const farmUrl = this.str('farmUrl');
    let urls: string[] = [];
    let npc = false;
    if (farmUrl) urls = await this.farmFishUrls(farmUrl).catch(() => []);
    if (urls.length === 0) {
      // Bundled mode spawns only what the tank needs NOW (hero mode = one
      // fish); setState grows the pool on demand when fishCount is steered up.
      const want = Math.max(1, Math.round(Number(this.space.fishCount?.default ?? 1)));
      const pool = Math.min(want, poolCap);
      urls = new Array<string>(pool).fill(this.str('fishUrl'));
      npc = true; // untextured bundled breeds get the seeded-palette coat
      this.bundled = { url: this.str('fishUrl'), poolCap };
      this.heroMode = pool === 1;
    }
    if (this.disposed) return;

    const jobs = urls.slice(0, poolCap).map((url, i) => ({ url, i, path: this.pathAt(i) }));

    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < jobs.length && !this.disposed) {
        const job = jobs[next++]!;
        const tpl = await this.template(job.url, npc);
        if (this.disposed) return;
        this.spawn(tpl, job.path, job.i);
      }
    };
    await Promise.all(Array.from({ length: GLB_CONCURRENCY }, worker));
    if (this.paused) this.renderStill();
  }

  /** Deterministic swim path for fish index `i` — independent of spawn order
   *  (each index forks its own stream). The hero (index 0 in hero mode) stays
   *  center stage in a tighter, larger-scaled orbit. */
  private pathAt(i: number): FishPath {
    const rng = this.ctxSaver.rng.fork(0x715);
    if (i === 0 && this.heroMode) {
      const p = makeFishPath(rng.fork(0), HERO_BOUNDS);
      return { ...p, scale: p.scale * HERO_SCALE };
    }
    return makeFishPath(rng.fork(i), BOUNDS);
  }

  /** Grow the bundled pool to `n` fish (steered fishCount above pool size). */
  private async growTo(n: number): Promise<void> {
    if (!this.bundled || this.growing) return;
    this.growing = true;
    try {
      const target = Math.min(n, this.bundled.poolCap, MAX_FISH);
      const tpl = await this.template(this.bundled.url, true);
      for (let i = this.fish.length; i < target && !this.disposed; i++) {
        this.spawn(tpl, this.pathAt(i), i);
      }
    } finally {
      this.growing = false;
    }
  }

  private async farmFishUrls(farmUrl: string): Promise<string[]> {
    const res = await fetch(farmUrl, { signal: this.abort.signal });
    if (!res.ok) throw new Error(`farm ${res.status}`);
    const meta = farmMetadata(await res.json());
    const tokens = this.str('tankTokens')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const picked = pickFarmFish(meta, tokens, this.ctxSaver.rng.fork(0xfa12), MAX_FISH);
    const gateway = this.str('ipfsGateway');
    return picked.map((f) => resolveAssetUrl(f['3d']!, gateway));
  }

  private template(url: string, npc: boolean): Promise<FishTemplate | null> {
    let p = this.templates.get(url);
    if (!p) {
      p = (async (): Promise<FishTemplate | null> => {
        try {
          const res = await fetch(url, { signal: this.abort.signal });
          if (!res.ok) throw new Error(`fish glb ${res.status}`);
          const buf = await res.arrayBuffer();
          const gltf = await new GLTFLoader().parseAsync(buf, '');
          const scene = gltf.scene;
          const textured = hasTexturedMaterial(scene);
          // Textured fish always keep their authored look, whichever lane
          // loaded them. Fork keyed on the URL: any rescue coat / emissive
          // retune is stable across mounts and independent of load order.
          if (!npc || textured) {
            applyFarmMaterials(scene, this.ctxSaver.rng.fork(hashCode(url)));
          }
          const size = new Box3().setFromObject(scene).getSize(new Vector3());
          return {
            scene,
            clip: gltf.animations[0] ?? null,
            norm: FISH_LENGTH / (Math.max(size.x, size.y, size.z) || 1),
            yaw: size.x > size.z ? Math.PI / 2 : 0,
            npc,
            textured,
          };
        } catch {
          return null;
        }
      })();
      this.templates.set(url, p);
    }
    return p;
  }

  private spawn(tpl: FishTemplate | null, path: FishPath, index: number): void {
    const group = new Group();
    let mixer: AnimationMixer | null = null;
    let tail: Object3D | null = null;
    let clipDuration = 0;
    if (tpl) {
      const body = cloneSkinned(tpl.scene);
      if (tpl.npc && !tpl.textured) {
        applyNpcMaterials(body, this.ctxSaver.rng.fork(0xc0a7 + index));
      }
      body.scale.setScalar(tpl.norm);
      body.rotation.y = tpl.yaw;
      group.add(body);
      if (tpl.clip) {
        mixer = new AnimationMixer(body);
        mixer.clipAction(tpl.clip).play();
        clipDuration = tpl.clip.duration;
      }
    } else {
      // Never-blank: a procedural palette fish stands in when a GLB fails.
      const coat = this.ctxSaver.rng.fork(0xc0a7 + index).pick(MIAMI_VICE_COLORS);
      const mat = new MeshBasicMaterial({ color: new Color(coat) });
      const body = new Mesh(new SphereGeometry(FISH_LENGTH / 2, 12, 8), mat);
      body.scale.set(1, 0.55, 0.4);
      const tailMesh = new Mesh(new ConeGeometry(FISH_LENGTH * 0.22, FISH_LENGTH * 0.5, 8), mat);
      tailMesh.rotation.z = Math.PI / 2;
      tailMesh.position.x = -FISH_LENGTH * 0.62;
      group.add(body, tailMesh);
      tail = tailMesh;
    }
    group.scale.multiplyScalar(path.scale);
    this.scene.add(group);
    this.fish.push({ group, path, mixer, clipDuration, tail });
    this.ctxSaver.host.dataset.mqFish = String(this.fish.length);
  }

  // ---- params / state ----
  private applyParams(t: number): void {
    if (this.track) this.params = sampleTrack(this.space, this.track, t);
  }

  private num(key: string): number {
    const v = this.params[key];
    return typeof v === 'number' ? v : Number(this.space[key]?.default ?? 0);
  }

  private setState(t: number): void {
    const tSec = t / 1000;
    this.applyParams(t);

    const az = MathUtils.degToRad(this.num('cameraAzimuth') + this.num('autoRotate') * tSec);
    const el = MathUtils.degToRad(this.num('cameraElevation'));
    const dist = this.num('cameraDistance');
    this.camera.position.set(
      Math.cos(el) * Math.sin(az) * dist,
      Math.sin(el) * dist + 40,
      Math.cos(el) * Math.cos(az) * dist,
    );
    this.camera.lookAt(0, 35, 0);

    const fogHex = String(this.params.fogColor ?? this.space.fogColor?.default ?? '#030009');
    this.fogColor.set(fogHex);
    (this.scene.fog as Fog).color.copy(this.fogColor);

    const pos = this.waterGeo.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      const bx = this.waterBase[i * 3]!;
      const by = this.waterBase[i * 3 + 1]!;
      pos.setZ(i, Math.sin(tSec * 1.2 + bx * 0.025 + by * 0.018) * 3.5);
    }
    pos.needsUpdate = true;
    if (this.waterTexture) this.waterTexture.offset.set(tSec * 0.008, tSec * 0.005);

    const speed = this.num('swimSpeed');
    const visible = Math.min(Math.round(this.num('fishCount')), this.quality.fishCap);
    if (this.bundled && visible > this.fish.length && !this.growing) {
      void this.growTo(visible);
    }
    for (let i = 0; i < this.fish.length; i++) {
      const f = this.fish[i]!;
      f.group.visible = i < visible;
      if (!f.group.visible) continue;
      const pose = fishPose(f.path, tSec, speed);
      f.group.position.set(pose.x, pose.y, pose.z);
      f.group.lookAt(pose.x + pose.hx, pose.y + pose.hy, pose.z + pose.hz);
      if (f.mixer && f.clipDuration > 0) {
        f.mixer.setTime((tSec * speed + f.path.clipOffset) % f.clipDuration);
      } else if (f.tail) {
        f.tail.rotation.y = Math.sin((tSec * speed + f.path.clipOffset) * 6) * 0.5;
      }
    }
  }

  // ---- selective bloom (two-composer approach; original recipe:
  //      strength 0.25–0.35, radius 0.12, threshold 0.65) ----
  private initComposers(): void {
    const pr = Math.min(this.ctxSaver.dpr, this.quality.maxPixelRatio);

    this.bloomComposer = new EffectComposer(this.renderer);
    this.bloomComposer.renderToScreen = false;
    this.bloomComposer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new Vector2(this.w, this.h),
      this.num('bloomStrength'),
      0.12,
      0.65,
    );
    this.bloomComposer.addPass(this.bloomPass);
    this.bloomComposer.setPixelRatio(pr * this.quality.bloomScale);
    this.bloomComposer.setSize(this.w, this.h);

    this.finalComposer = new EffectComposer(this.renderer);
    this.finalComposer.addPass(new RenderPass(this.scene, this.camera));
    this.mixPass = new ShaderPass(
      new ShaderMaterial({
        uniforms: {
          baseTexture: { value: null },
          bloomTexture: { value: null },
        },
        vertexShader: MIX_VERT,
        fragmentShader: MIX_FRAG,
      }),
      'baseTexture',
    );
    this.finalComposer.addPass(this.mixPass);
    this.finalComposer.addPass(new OutputPass());
    this.finalComposer.setPixelRatio(pr);
    this.finalComposer.setSize(this.w, this.h);
  }

  // ---- render ----
  private renderScene(): void {
    const strength = this.num('bloomStrength');
    if (strength <= 0 || this.thumbnail) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (!this.bloomComposer) this.initComposers();
    this.bloomPass!.strength = strength;

    // Pass 1: only BLOOM_LAYER meshes render → bloom target
    this.scene.background = null;
    this.camera.layers.set(BLOOM_LAYER);
    this.bloomComposer!.render();

    // Pass 2: full scene + additive bloom composite
    this.scene.background = this.fogColor;
    this.camera.layers.enableAll();
    this.mixPass!.uniforms.bloomTexture!.value = this.bloomComposer!.readBuffer.texture;
    this.finalComposer!.render();
  }

  // ---- loop ----
  private start(): void {
    if (this.frameId !== null || typeof requestAnimationFrame === 'undefined') return;
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
    this.t = now - this.startT;
    this.setState(this.t);
    this.renderScene();
  }

  private renderStill(): void {
    this.setState(this.t);
    this.renderScene();
  }

  // ---- SaverInstance ----
  setPaused(paused: boolean): void {
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
    const pr = dpr !== undefined ? Math.min(dpr, this.quality.maxPixelRatio) : undefined;
    if (pr !== undefined) this.renderer.setPixelRatio(pr);
    this.renderer.setSize(width, height, false);
    if (pr !== undefined) {
      this.bloomComposer?.setPixelRatio(pr * this.quality.bloomScale);
      this.finalComposer?.setPixelRatio(pr);
    }
    this.bloomComposer?.setSize(width, height);
    this.finalComposer?.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.paused) this.renderStill();
  }

  applyTrack(track: ControlTrack): void {
    this.track = track;
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
        description: 'WebGL2 aquarium: floor, water, fog',
      },
      { id: 'fish', label: 'Fish', kind: 'pass', description: 'GLB fish on seeded swim paths' },
      { id: 'bloom', label: 'Bloom', kind: 'pass', description: 'Selective glow (GLOW-* layer)' },
    ];
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.abort.abort();
    const disposeObject = (obj: Object3D): void => {
      obj.traverse((o) => {
        const mesh = o as Partial<Mesh>;
        if (mesh.geometry) mesh.geometry.dispose();
        const mats: Material[] = Array.isArray(mesh.material)
          ? mesh.material
          : mesh.material
            ? [mesh.material]
            : [];
        for (const m of mats) {
          const tex = (m as Partial<MeshBasicMaterial>).map;
          if (tex) tex.dispose();
          m.dispose();
        }
      });
    };
    disposeObject(this.scene);
    for (const p of this.templates.values()) {
      void p.then((tpl) => tpl && disposeObject(tpl.scene));
    }
    this.bloomComposer?.dispose();
    this.finalComposer?.dispose();
    this.renderer.dispose();
    if (this.ownsCanvas) this.canvas.remove();
    delete this.ctxSaver.host.dataset.mqFish;
    delete this.ctxSaver.host.dataset.mqBackend;
  }
}

/** Deterministic 32-bit string hash (FNV-1a) for rng fork salts. */
function hashCode(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Seeded-free procedural caustic-ish tile for the water plane (the original
 *  ships water.jpg; we synthesize to stay self-contained). Pure function of
 *  nothing — same texture every run. */
function makeWaterTexture(): Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#0a2a4a';
  g.fillRect(0, 0, 128, 128);
  g.globalAlpha = 0.5;
  for (let i = 0; i < 40; i++) {
    // Fixed constants, not rng: this is a static tile, identical every mount.
    const x = (i * 37) % 128;
    const y = (i * 53) % 128;
    const r = 6 + ((i * 29) % 18);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(120,200,255,0.35)');
    grad.addColorStop(1, 'rgba(120,200,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(5, 5);
  return tex;
}

// ---- 2D fallback (no WebGL2: headless CI, ancient GPUs) ----
// The lowest rung of the fidelity ladder: same seeded fish paths, same palette,
// drawn as canvas-2d silhouettes against the fog gradient. Never blank.
class Tank2DFallback implements SaverInstance {
  private readonly ctxSaver: SaverContext;
  private readonly space: ParamSpace;
  private readonly canvas: HTMLCanvasElement;
  private readonly ownsCanvas: boolean;
  private readonly g: CanvasRenderingContext2D | null;
  private readonly paths: { path: FishPath; coat: string }[];
  private frameId: number | null = null;
  private paused = false;
  private startT = 0;
  private t = 0;
  private w: number;
  private h: number;
  private params: Record<string, ParamValue>;
  private track: ControlTrack | null = null;

  constructor(ctx: SaverContext, space: ParamSpace) {
    this.ctxSaver = ctx;
    this.space = space;
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
    this.sizeCanvas();
    this.g = this.canvas.getContext('2d');
    const rng = ctx.rng.fork(0x715);
    this.paths = Array.from({ length: MAX_FISH }, (_, i) => ({
      path: makeFishPath(rng.fork(i), BOUNDS),
      coat: rng.fork(0xc0a7 + i).pick(MIAMI_VICE_COLORS),
    }));
    ctx.host.dataset.mqFish = String(this.paths.length);
    this.paused = ctx.reducedMotion;
    if (this.paused) this.renderStill();
    else this.start();
  }

  private sizeCanvas(): void {
    const pr = Math.min(this.ctxSaver.dpr, 2);
    this.canvas.width = Math.round(this.w * pr);
    this.canvas.height = Math.round(this.h * pr);
  }

  private num(key: string): number {
    const v = this.params[key];
    return typeof v === 'number' ? v : Number(this.space[key]?.default ?? 0);
  }

  private draw(t: number): void {
    if (!this.g) return;
    if (this.track) this.params = sampleTrack(this.space, this.track, t);
    const g = this.g;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const tSec = t / 1000;
    const fogHex = String(this.params.fogColor ?? this.space.fogColor?.default ?? '#030009');
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0a2a4a');
    grad.addColorStop(1, fogHex);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    const speed = this.num('swimSpeed');
    const visible = Math.round(this.num('fishCount'));
    const sx = W / (BOUNDS.radius * 2.4);
    for (let i = 0; i < Math.min(visible, this.paths.length); i++) {
      const { path, coat } = this.paths[i]!;
      const pose = fishPose(path, tSec, speed);
      const x = W / 2 + pose.x * sx;
      const y = H - ((pose.y - BOUNDS.yMin) / (BOUNDS.yMax - BOUNDS.yMin)) * H * 0.7 - H * 0.15;
      const len = FISH_LENGTH * path.scale * sx * 0.8;
      const dir = pose.hx >= 0 ? 1 : -1;
      g.fillStyle = coat;
      g.beginPath();
      g.ellipse(x, y, len / 2, len / 4, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(x - dir * (len / 2), y);
      g.lineTo(x - dir * (len * 0.85), y - len / 5);
      g.lineTo(x - dir * (len * 0.85), y + len / 5);
      g.closePath();
      g.fill();
    }
  }

  private start(): void {
    if (this.frameId !== null || typeof requestAnimationFrame === 'undefined') return;
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
    this.t = now - this.startT;
    this.draw(this.t);
  }

  private renderStill(): void {
    this.draw(this.t);
  }

  setPaused(paused: boolean): void {
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
    this.sizeCanvas();
    if (this.paused) this.renderStill();
  }

  applyTrack(track: ControlTrack): void {
    this.track = track;
    if (this.paused) this.renderStill();
  }

  renderFrame(t: number, _seed: number): void {
    this.t = t;
    this.draw(t);
  }

  composition(): SaverLayer[] {
    return [
      {
        id: 'tank-2d',
        label: 'Tank (2D fallback)',
        kind: 'surface',
        el: this.canvas,
        description: 'Canvas-2D silhouette tank (no WebGL2)',
      },
    ];
  }

  dispose(): void {
    this.stop();
    if (this.ownsCanvas) this.canvas.remove();
    delete this.ctxSaver.host.dataset.mqFish;
    delete this.ctxSaver.host.dataset.mqBackend;
  }
}

export function mountTank(
  ctx: SaverContext,
  space: ParamSpace = METAQUARIUM_PARAMS,
  tier: CapabilityTier = 'standard',
): SaverInstance {
  const resolved = withDefaults(space, ctx.params);
  try {
    const inst = new TankInstance(ctx, resolved, qualityFor(tier));
    ctx.host.dataset.mqBackend = 'webgl2';
    return inst;
  } catch {
    // No WebGL2 (headless CI, blocked GPU): never blank — 2D silhouette tank.
    const inst = new Tank2DFallback(ctx, resolved);
    ctx.host.dataset.mqBackend = 'canvas2d';
    return inst;
  }
}

// ---- mix shader (additive bloom over base scene) ----

const MIX_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const MIX_FRAG = /* glsl */ `
  uniform sampler2D baseTexture;
  uniform sampler2D bloomTexture;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv);
  }
`;
