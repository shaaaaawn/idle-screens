import { DataTexture, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, RGBAFormat, Vector3, type Quaternion } from 'three';

/** The contact shadow's falloff, centre (0) to rim (1): dark under the body and out to the feet, gone just past them. */
export function contactShade(r: number): number {
  const t = Math.max(0, Math.min(1, (r - 0.45) / 0.55));
  return 1 - t * t * (3 - 2 * t);
}

/**
 * A soft dark ellipse under each crab, on the ground it stands on. Without
 * it a crab whose feet are on the sand still reads as hovering: nothing
 * under it says where the floor is. One instanced draw for every crab;
 * fogged like the floor, so a far crab's shadow fades with it.
 */
export class ContactShadows {
  readonly mesh: InstancedMesh;
  private readonly m = new Matrix4();
  private readonly p = new Vector3();
  private readonly s = new Vector3();

  constructor(readonly capacity: number, opacity = 0.55) {
    const n = 32, px = new Uint8Array(n * n * 4);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const r = Math.hypot((i + 0.5) / n * 2 - 1, (j + 0.5) / n * 2 - 1);
      px[(j * n + i) * 4 + 3] = Math.round(255 * contactShade(r));
    }
    const map = new DataTexture(px, n, n, RGBAFormat);
    map.needsUpdate = true;
    map.userData.mqOwned = true;
    const material = new MeshBasicMaterial({ color: 0x000000, map, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    material.userData.mqOwned = true;
    const geometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    geometry.userData.mqOwned = true;
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.name = 'crab-shadows';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.count = 0;
  }

  /** Shadow `i`: on the ground at (x, y, z), turned and tilted with the crab, `width` across and `length` along its body. */
  set(i: number, x: number, y: number, z: number, turn: Quaternion, width: number, length: number): void {
    if (i >= this.capacity) return;
    this.mesh.setMatrixAt(i, this.m.compose(this.p.set(x, y, z), turn, this.s.set(width, 1, length)));
  }

  /** How many were set this frame. */
  commit(n: number): void {
    this.mesh.count = Math.min(n, this.capacity);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** How dark a swimmer's shadow is, 0..1, at `height` above the ground: full on the sand, gone by 110. */
export function swimShade(height: number): number {
  const t = Math.max(0, Math.min(1, height / 110));
  return 1 - t * t * (3 - 2 * t);
}

/** How much wider a swimmer's shadow is than its body at `height`: the penumbra opens as the fish rises. */
export function swimSpread(height: number): number {
  return 1 + Math.max(0, height) / 70;
}

/**
 * The same soft ellipses under the SWIMMERS (`fishShadows`): each its own
 * darkness (aShade), so a fish near the sand drops a dark small shadow and
 * one high up a wide faint one — the cue that puts a fish at a height
 * instead of floating in front of the floor. One instanced draw.
 */
export class SwimShadows extends ContactShadows {
  private readonly shade: InstancedBufferAttribute;

  constructor(capacity: number) {
    super(capacity, 1);
    this.mesh.name = 'swim-shadows';
    this.shade = new InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.mesh.geometry.setAttribute('aShade', this.shade);
    const m = this.mesh.material as MeshBasicMaterial;
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = 'attribute float aShade;\nvarying float vMqShade;\n'
        + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vMqShade = aShade;');
      shader.fragmentShader = 'varying float vMqShade;\n'
        + shader.fragmentShader.replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\n  diffuseColor.a *= vMqShade;');
    };
    m.customProgramCacheKey = () => 'mq-swim-shadow';
  }

  /** Shadow `i` (see `set`), `shade` dark (0..1). */
  setShaded(i: number, x: number, y: number, z: number, turn: Quaternion, width: number, length: number, shade: number): void {
    if (i >= this.capacity) return;
    this.set(i, x, y, z, turn, width, length);
    this.shade.setX(i, shade);
  }

  override commit(n: number): void {
    super.commit(n);
    this.shade.needsUpdate = true;
  }
}
