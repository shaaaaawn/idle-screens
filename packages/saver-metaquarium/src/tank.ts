import {
  sampleTrack,
  defaultParams,
  type ControlTrack,
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
  MeshStandardMaterial,
  DoubleSide,
  Box3,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  MathUtils,
  type AnimationClip,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { METAQUARIUM_PARAMS } from './manifest';
import { makeFishPath, fishPose, type FishPath, type TankBounds } from './swim';

const BOUNDS: TankBounds = { radius: 120, yMin: 15, yMax: 72 };
const WATER_Y = 88;
const FISH_LENGTH = 18; // world units every model is normalized to
const MAX_FISH = METAQUARIUM_PARAMS.fishCount.max ?? 24;
/** Yaw correction if the model's forward axis isn't +Z (tuned per asset). */
const MODEL_YAW_FIX = Math.PI / 2;

interface Fish {
  group: Group;
  path: FishPath;
  mixer: AnimationMixer | null;
  clipDuration: number;
  /** Procedural-fallback tail, wagged analytically when there is no clip. */
  tail: Object3D | null;
}

class TankInstance implements SaverInstance {
  private readonly ctxSaver: SaverContext;
  private readonly canvas: HTMLCanvasElement;
  private readonly ownsCanvas: boolean;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly waterGeo: PlaneGeometry;
  private readonly waterBase: Float32Array;
  private readonly fogColor = new Color();
  private readonly abort = new AbortController();
  private fish: Fish[] = [];
  private disposed = false;

  private w: number;
  private h: number;
  private frameId: number | null = null;
  private paused = false;
  private startT = 0;
  private t = 0;

  private params: Record<string, ParamValue> = defaultParams(METAQUARIUM_PARAMS);
  private track: ControlTrack | null = null;

  constructor(ctx: SaverContext) {
    this.ctxSaver = ctx;
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

    this.camera = new PerspectiveCamera(55, this.w / this.h, 1, 1200);
    this.scene.fog = new Fog(0x04101c, 120, 620);

    this.scene.add(new AmbientLight(0x9fc4e0, 1.6));
    const sun = new DirectionalLight(0xcfe8ff, 2.2);
    sun.position.set(120, 300, 60);
    this.scene.add(sun);

    const floor = new Mesh(
      new CircleGeometry(360, 48),
      new MeshStandardMaterial({ color: 0x0a2233, roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    this.waterGeo = new PlaneGeometry(720, 720, 24, 24);
    this.waterBase = Float32Array.from(this.waterGeo.attributes.position!.array);
    const water = new Mesh(
      this.waterGeo,
      new MeshStandardMaterial({
        color: 0x0d4a6e,
        transparent: true,
        opacity: 0.55,
        roughness: 0.35,
        metalness: 0.15,
        side: DoubleSide,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER_Y;
    this.scene.add(water);

    // Fish stream in as the GLB arrives; failure falls back to procedural fish
    // so the tank never mounts empty.
    void this.loadFish(String(this.params.fishUrl ?? ''));

    this.paused = ctx.reducedMotion;
    if (this.paused) this.renderStill();
    else this.start();
  }

  // ---- fish ----
  private async loadFish(url: string): Promise<void> {
    let template: Object3D | null = null;
    let clip: AnimationClip | null = null;
    try {
      const res = await fetch(url, { signal: this.abort.signal });
      if (!res.ok) throw new Error(`fish glb ${res.status}`);
      const buf = await res.arrayBuffer();
      const gltf = await new GLTFLoader().parseAsync(buf, '');
      template = gltf.scene;
      clip = gltf.animations[0] ?? null;
    } catch {
      if (this.disposed || this.abort.signal.aborted) return;
      template = null; // procedural fallback below
    }
    if (this.disposed) return;

    if (template) {
      const size = new Box3().setFromObject(template).getSize(new Vector3());
      const s = FISH_LENGTH / (Math.max(size.x, size.y, size.z) || 1);
      template.scale.setScalar(s);
    }

    const rng = this.ctxSaver.rng.fork(0x715);
    for (let i = 0; i < MAX_FISH; i++) {
      const path = makeFishPath(rng.fork(i), BOUNDS);
      const group = new Group();
      let mixer: AnimationMixer | null = null;
      let tail: Object3D | null = null;
      let clipDuration = 0;
      if (template) {
        const body = cloneSkinned(template);
        body.rotation.y = MODEL_YAW_FIX;
        group.add(body);
        if (clip) {
          mixer = new AnimationMixer(body);
          mixer.clipAction(clip).play();
          clipDuration = clip.duration;
        }
      } else {
        const mat = new MeshStandardMaterial({ color: 0x3f8fbf, roughness: 0.6 });
        const body = new Mesh(new SphereGeometry(FISH_LENGTH / 2, 12, 8), mat);
        body.scale.set(1, 0.55, 0.4);
        const tailMesh = new Mesh(new ConeGeometry(FISH_LENGTH * 0.22, FISH_LENGTH * 0.5, 8), mat);
        tailMesh.rotation.z = Math.PI / 2;
        tailMesh.position.x = -FISH_LENGTH * 0.62;
        group.add(body, tailMesh);
        group.rotation.y = 0; // procedural fish already faces +X; group yaw applied via lookAt
        tail = tailMesh;
      }
      group.scale.multiplyScalar(path.scale);
      this.scene.add(group);
      this.fish.push({ group, path, mixer, clipDuration, tail });
    }
    if (this.paused) this.renderStill();
  }

  // ---- params / state ----
  private applyParams(t: number): void {
    if (this.track) this.params = sampleTrack(METAQUARIUM_PARAMS, this.track, t);
  }

  private num(key: keyof typeof METAQUARIUM_PARAMS): number {
    const v = this.params[key];
    return typeof v === 'number' ? v : Number(METAQUARIUM_PARAMS[key].default);
  }

  /** Everything on screen is a pure function of logical time `t` (ms). */
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
    this.camera.lookAt(0, 38, 0);

    const fogHex = String(this.params.fogColor ?? METAQUARIUM_PARAMS.fogColor.default);
    this.fogColor.set(fogHex);
    (this.scene.fog as Fog).color.copy(this.fogColor);
    this.scene.background = this.fogColor;

    const pos = this.waterGeo.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      const bx = this.waterBase[i * 3]!;
      const by = this.waterBase[i * 3 + 1]!;
      pos.setZ(i, Math.sin(tSec * 0.9 + bx * 0.02 + by * 0.013) * 2.2);
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
    this.renderer.render(this.scene, this.camera);
  }

  private renderStill(): void {
    this.setState(this.t);
    this.renderer.render(this.scene, this.camera);
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
    if (dpr !== undefined) this.renderer.setPixelRatio(Math.min(dpr, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.paused) this.renderStill();
  }

  applyTrack(track: ControlTrack): void {
    this.track = track;
    if (this.paused) this.renderStill();
  }

  /** Frame-addressable once assets are resolved: same (t, seed, track) → same frame. */
  renderFrame(t: number, _seed: number): void {
    this.t = t;
    this.setState(t);
    this.renderer.render(this.scene, this.camera);
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
    this.renderer.dispose();
    if (this.ownsCanvas) this.canvas.remove();
  }
}

export function mountTank(ctx: SaverContext): SaverInstance {
  return new TankInstance(ctx);
}
