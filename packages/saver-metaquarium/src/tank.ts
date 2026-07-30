import type { CapabilityTier } from '@idle-screens/capabilities';
import {
  defaultParams,
  sampleTrack,
  type ControlTrack,
  type ParamSpace,
  type ParamValue,
  type SaverContext,
  type SaverInstance,
  type SaverLayer,
} from '@idle-screens/core';
import {
  AnimationMixer,
  Box3,
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
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type AnimationClip,
  type Material,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { resolveIpfsUrl } from './ipfs';
import { METAQUARIUM_PARAMS, withDefaults } from './manifest';
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
  isSoftwareGL,
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

const TEMPLATE_CACHE = new Map<string, Promise<FishTemplate | null>>();

// ---------------------------------------------------------------------------
// Fish instance — one per visible fish in the scene.
// ---------------------------------------------------------------------------

interface Fish {
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
  private readonly abort = new AbortController();
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
  private readonly thumbnail: boolean;
  private activeFishUrl = '';

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

    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: quality.antialias,
      stencil: false,
      powerPreference: 'high-performance',
    });
    const glInfo = this.renderer.getContext();
    const dbg = glInfo.getExtension('WEBGL_debug_renderer_info');
    const rendererName = String(
      dbg
        ? glInfo.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
        : glInfo.getParameter(glInfo.RENDERER),
    );
    if (isSoftwareGL(rendererName)) this.quality = qualityFor('minimal');
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
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    // Gentle hemisphere so MeshStandardMaterial eyes render their authored detail.
    // MeshBasicMaterial body/glow coats ignore it — zero visual cost for them.
    this.scene.add(new HemisphereLight(0xffffff, 0x4466aa, 1.5));

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
    const poolCap = this.thumbnail ? Math.min(6, MAX_FISH) : MAX_FISH;
    const pool = Math.min(poolCap, this.quality.fishCap);
    const fishUrl = this.activeFishUrl || this.str('fishUrl');
    this.activeFishUrl = fishUrl;

    const jobs = Array.from({ length: pool }, (_, i) => i);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < jobs.length && !this.disposed) {
        const i = jobs[next++]!;
        const tpl = await this.template(fishUrl);
        if (this.disposed || this.activeFishUrl !== fishUrl) return;
        this.spawn(tpl, i);
      }
    };
    await Promise.all(Array.from({ length: GLB_CONCURRENCY }, worker));
    if (this.paused) this.renderStill();
  }

  private swapFish(url: string): void {
    for (const f of this.fish) {
      f.mixer?.stopAllAction();
      this.scene.remove(f.group);
    }
    this.fish = [];
    this.activeFishUrl = url;
    void this.populate();
  }

  private template(url: string): Promise<FishTemplate | null> {
    const key = url;
    let p = TEMPLATE_CACHE.get(key);
    if (!p) {
      p = (async (): Promise<FishTemplate | null> => {
        try {
          const res = await fetch(resolveIpfsUrl(url), {
            signal: this.abort.signal,
          });
          if (!res.ok) throw new Error(`fish glb ${res.status}`);
          const buf = await res.arrayBuffer();
          const gltf = await new GLTFLoader().parseAsync(buf, '');
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
        } catch (err) {
          if ((err as Partial<DOMException>).name === 'AbortError') {
            TEMPLATE_CACHE.delete(key);
          }
          return null;
        }
      })();
      TEMPLATE_CACHE.set(key, p);
    }
    return p;
  }

  private spawn(tpl: FishTemplate | null, index: number): void {
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
      const body = new Mesh(new SphereGeometry(FISH_LENGTH / 2, 12, 8), mat);
      body.scale.set(1, 0.55, 0.4);
      const tailMesh = new Mesh(
        new ConeGeometry(FISH_LENGTH * 0.22, FISH_LENGTH * 0.5, 8),
        mat,
      );
      tailMesh.rotation.z = Math.PI / 2;
      tailMesh.position.x = -FISH_LENGTH * 0.62;
      group.add(body, tailMesh);
      tail = tailMesh;
    }

    const baseScale = plan.cruise > 10 ? 1.1 : 0.8 + (index % 5) * 0.1;
    group.scale.multiplyScalar(baseScale);
    this.scene.add(group);
    this.fish.push({
      group,
      plan,
      body: bodyNode,
      baseScale,
      mixer,
      clipDuration,
      tail,
    });
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
    const speed = this.num('swimSpeed');

    const url = this.str('fishUrl');
    if (url && url !== this.activeFishUrl) this.swapFish(url);

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

    // Fish
    const visible = Math.min(
      Math.round(this.num('fishCount')),
      this.quality.fishCap,
    );
    for (let i = 0; i < this.fish.length; i++) {
      const f = this.fish[i]!;
      f.group.visible = i < visible;
      if (!f.group.visible) continue;

      const d = distanceAt(f.plan, tSec, speed);
      const pose = swimPoseAtDistance(f.plan, d);
      f.group.position.set(pose.x, pose.y, pose.z);
      f.group.lookAt(pose.x + pose.fx, pose.y + pose.fy, pose.z + pose.fz);
      f.group.rotateZ(pose.roll);

      const breathe = 1 + Math.sin(tSec * 2.1 + i) * 0.008;
      f.group.scale.setScalar(f.baseScale * breathe);

      if (f.mixer && f.clipDuration > 0) {
        f.mixer.setTime(
          (((d * 0.045) % f.clipDuration) + f.clipDuration) % f.clipDuration,
        );
      } else if (f.tail) {
        f.tail.rotation.y = Math.sin(tSec * speed * 6 + i) * 0.5;
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
    if (this.paused) this.renderStill();
  }

  renderFrame(t: number, _seed: number): void {
    this.t = t;
    if (typeof performance !== 'undefined') this.governFrame(performance.now());
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
    this.abort.abort();
    for (const f of this.fish) {
      f.mixer?.stopAllAction();
      this.scene.remove(f.group);
    }
    this.fish = [];
    this.scene.traverse((o) => {
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
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    if (this.ownsCanvas) this.canvas.remove();
    delete this.ctxSaver.host.dataset.mqFish;
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
): SaverInstance {
  const resolved = withDefaults(space, ctx.params);
  const inst = new TankInstance(ctx, resolved, qualityFor(tier));
  ctx.host.dataset.mqBackend = 'webgl2';
  return inst;
}
