import {
  sampleTrack,
  defaultParams,
  type ControlTrack,
  type ParamSpace,
  type ParamValue,
  type SaverContext,
  type SaverInstance,
} from '@idle-screens/core';
import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationMixer,
  CircleGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  Fog,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  DoubleSide,
  Box3,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  MathUtils,
  type AnimationClip,
  type Material,
  type Object3D,
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

const BOUNDS: TankBounds = { radius: 120, yMin: 15, yMax: 72 };
const WATER_Y = 88;
const FISH_LENGTH = 18;
const MAX_FISH = METAQUARIUM_PARAMS.fishCount.max ?? 24;
const GLB_CONCURRENCY = 3;
const BG = 0x020810;
const BLOOM_LAYER = 10;

interface FishTemplate {
  scene: Object3D;
  clip: AnimationClip | null;
  norm: number;
  yaw: number;
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
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly waterGeo: PlaneGeometry;
  private readonly waterBase: Float32Array;
  private readonly fogColor = new Color();
  private readonly abort = new AbortController();
  private readonly templates = new Map<string, Promise<FishTemplate | null>>();
  private bloomComposer: EffectComposer | null = null;
  private finalComposer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private mixPass: ShaderPass | null = null;
  private fish: Fish[] = [];
  private disposed = false;

  private w: number;
  private h: number;
  private frameId: number | null = null;
  private paused = false;
  private startT = 0;
  private t = 0;

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
    this.canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());

    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(ctx.dpr, 2));
    this.renderer.setSize(this.w, this.h, false);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.camera = new PerspectiveCamera(55, this.w / this.h, 1, 1200);

    this.fogColor.setHex(BG);
    this.scene.fog = new Fog(BG, 60, 500);
    this.scene.background = this.fogColor;

    this.scene.add(new AmbientLight(0xb8d4e8, 0.8));
    const sun = new DirectionalLight(0xffffff, 0.6);
    sun.position.set(200, 600, 40);
    this.scene.add(sun);
    const fill = new DirectionalLight(0x1a4060, 0.3);
    fill.position.set(-50, -200, 30);
    this.scene.add(fill);

    const floor = new Mesh(
      new CircleGeometry(360, 48),
      new MeshStandardMaterial({ color: 0x081828, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    this.waterGeo = new PlaneGeometry(720, 720, 32, 32);
    this.waterBase = Float32Array.from(this.waterGeo.attributes.position!.array);
    const waterMat = new MeshStandardMaterial({
      color: 0x0d4a6e,
      transparent: true,
      opacity: 0.35,
      roughness: 0.4,
      metalness: 0.3,
      emissive: 0x041828,
      emissiveIntensity: 0.3,
      side: DoubleSide,
    });
    const water = new Mesh(this.waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER_Y;
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
    const farmUrl = this.str('farmUrl');
    let urls: string[] = [];
    if (farmUrl) urls = await this.farmFishUrls(farmUrl).catch(() => []);
    if (urls.length === 0) urls = new Array<string>(MAX_FISH).fill(this.str('fishUrl'));
    if (this.disposed) return;

    const rng = this.ctxSaver.rng.fork(0x715);
    const jobs = urls.slice(0, MAX_FISH).map((url, i) => ({ url, path: makeFishPath(rng.fork(i), BOUNDS) }));

    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < jobs.length && !this.disposed) {
        const job = jobs[next++]!;
        const tpl = await this.template(job.url);
        if (this.disposed) return;
        this.spawn(tpl, job.path);
      }
    };
    await Promise.all(Array.from({ length: GLB_CONCURRENCY }, worker));
    if (this.paused) this.renderStill();
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

  private template(url: string): Promise<FishTemplate | null> {
    let p = this.templates.get(url);
    if (!p) {
      p = (async (): Promise<FishTemplate | null> => {
        try {
          const res = await fetch(url, { signal: this.abort.signal });
          if (!res.ok) throw new Error(`fish glb ${res.status}`);
          const buf = await res.arrayBuffer();
          const gltf = await new GLTFLoader().parseAsync(buf, '');
          const scene = gltf.scene;
          // DEBUG: log scene structure
          console.log('[MQ-DEBUG] GLB children:', scene.children.length, scene.children.map(c => `${c.type}:${c.name}`));
          scene.traverse((o) => {
            const mesh = o as Mesh;
            if (!mesh.isMesh) return;
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            console.log('[MQ-DEBUG] mesh:', mesh.name, 'parent:', mesh.parent?.name, 'materials:', mats.map(m => `${m.constructor.name}:${m.name}:0x${(m as MeshBasicMaterial).color?.getHexString?.()}`));
            debugEmissiveRed(mesh);
            let hasGlow = false;
            for (const m of mats) {
              if (applyGlow(m)) hasGlow = true;
            }
            if (hasGlow) mesh.layers.enable(BLOOM_LAYER);
          });
          const size = new Box3().setFromObject(scene).getSize(new Vector3());
          return {
            scene,
            clip: gltf.animations[0] ?? null,
            norm: FISH_LENGTH / (Math.max(size.x, size.y, size.z) || 1),
            yaw: size.x > size.z ? Math.PI / 2 : 0,
          };
        } catch {
          return null;
        }
      })();
      this.templates.set(url, p);
    }
    return p;
  }

  private spawn(tpl: FishTemplate | null, path: FishPath): void {
    const group = new Group();
    let mixer: AnimationMixer | null = null;
    let tail: Object3D | null = null;
    let clipDuration = 0;
    if (tpl) {
      const body = cloneSkinned(tpl.scene);
      body.scale.setScalar(tpl.norm);
      body.rotation.y = tpl.yaw;
      propagateBloomLayer(body);
      group.add(body);
      if (tpl.clip) {
        mixer = new AnimationMixer(body);
        mixer.clipAction(tpl.clip).play();
        clipDuration = tpl.clip.duration;
      }
    } else {
      const mat = new MeshStandardMaterial({ color: 0x3f8fbf, roughness: 0.6 });
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

    const fogHex = String(this.params.fogColor ?? this.space.fogColor?.default ?? '#020810');
    this.fogColor.set(fogHex);
    (this.scene.fog as Fog).color.copy(this.fogColor);

    const pos = this.waterGeo.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      const bx = this.waterBase[i * 3]!;
      const by = this.waterBase[i * 3 + 1]!;
      pos.setZ(i, Math.sin(tSec * 1.2 + bx * 0.025 + by * 0.018) * 3.5);
    }
    pos.needsUpdate = true;

    const speed = this.num('swimSpeed');
    const visible = Math.round(this.num('fishCount'));
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

  // ---- selective bloom (two-composer approach) ----
  private initComposers(): void {
    const pr = Math.min(this.ctxSaver.dpr, 2);

    this.bloomComposer = new EffectComposer(this.renderer);
    this.bloomComposer.renderToScreen = false;
    this.bloomComposer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new Vector2(this.w, this.h),
      this.num('bloomStrength'),
      0.12,
      0.1,
    );
    this.bloomComposer.addPass(this.bloomPass);
    this.bloomComposer.setPixelRatio(pr);
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
    if (strength <= 0) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (!this.bloomComposer) this.initComposers();
    this.bloomPass!.strength = strength;

    // Pass 1: render only GLOW-layer meshes → bloom
    this.scene.background = null;
    this.camera.layers.set(BLOOM_LAYER);
    this.bloomComposer!.render();

    // Pass 2: render full scene + composite bloom overlay
    this.scene.background = this.fogColor;
    this.camera.layers.enableAll();
    this.mixPass!.uniforms.bloomTexture.value =
      this.bloomComposer!.readBuffer.texture;
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
    const pr = dpr !== undefined ? Math.min(dpr, 2) : undefined;
    if (pr !== undefined) this.renderer.setPixelRatio(pr);
    this.renderer.setSize(width, height, false);
    if (pr !== undefined) {
      this.bloomComposer?.setPixelRatio(pr);
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

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.abort.abort();
    this.scene.traverse((obj) => {
      const mesh = obj as Partial<Mesh>;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
    this.bloomComposer?.dispose();
    this.finalComposer?.dispose();
    this.renderer.dispose();
    if (this.ownsCanvas) this.canvas.remove();
  }
}

// ---- material handling ----

const NAME_COLORS: Record<string, number> = {
  black: 0x2a3050,
  purple: 0x9040cc,
  'metal-chrome': 0xb0c0d0,
  'metal-blue': 0x4080cc,
  orange: 0xee8030,
  'light blue': 0x60b0e0,
  white: 0xe0e0f0,
};

function colorizeUnlit(mesh: Mesh): void {
  const fix = (m: Material): void => {
    if (!(m instanceof MeshBasicMaterial)) return;
    const key = m.name.replace(/\.\d+$/, '').trim().toLowerCase();
    const named = NAME_COLORS[key];
    if (named !== undefined) {
      (m as MeshBasicMaterial).color.setHex(named);
    }
    if ((m as MeshBasicMaterial).map) {
      (m as MeshBasicMaterial).map!.dispose();
      (m as MeshBasicMaterial).map = null;
      m.needsUpdate = true;
    }
  };
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) fix(m);
}

function debugEmissiveRed(mesh: Mesh): void {
  const flag = (m: Material): void => {
    if (!(m instanceof MeshBasicMaterial)) return;
    (m as MeshBasicMaterial).color.setHex(0xff0000);
    if ((m as MeshBasicMaterial).map) {
      (m as MeshBasicMaterial).map = null;
      m.needsUpdate = true;
    }
  };
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) flag(m);
}

function applyGlow(m: Material): boolean {
  const mat = m as Partial<MeshStandardMaterial> & Material;
  if (!/glow/i.test(mat.name)) return false;
  if (mat.emissive && mat.color) {
    if (mat.emissive.getHex() === 0x000000) {
      mat.emissive.copy(mat.color);
      mat.emissiveIntensity = 3.0;
    }
    mat.color.setHex(0x000000);
  }
  return true;
}

function propagateBloomLayer(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.isMesh && mesh.layers.isEnabled(BLOOM_LAYER)) {
      let parent = mesh.parent;
      while (parent) {
        parent.layers.enable(BLOOM_LAYER);
        parent = parent.parent;
      }
    }
  });
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

export function mountTank(ctx: SaverContext, space: ParamSpace = METAQUARIUM_PARAMS): SaverInstance {
  return new TankInstance(ctx, withDefaults(space, ctx.params));
}
