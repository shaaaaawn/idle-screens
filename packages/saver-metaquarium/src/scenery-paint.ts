/** Shared painters for the mineral world: bake shading into vertex colours,
 *  merge a layer into one draw. Unlit on purpose — works in flat and lit tanks. */
import {
  BufferAttribute, type BufferGeometry, Color, DoubleSide, FrontSide, type Group, Matrix4, Mesh, MeshBasicMaterial,
  Quaternion, type Side, type Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Bake faceted directional shading into vertex colours: works in flat and lit tanks. */
export function painted(geometry: BufferGeometry, color: string, position: Vector3, scale: Vector3,
  rotation = new Quaternion(), shade = true): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  geometry.dispose();
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  g.applyMatrix4(new Matrix4().compose(position, rotation, scale));
  const normals = g.getAttribute('normal');
  const colors = new Float32Array(g.getAttribute('position').count * 3);
  const base = new Color(color);
  for (let i = 0; i < normals.count; i++) {
    const k = shade ? 0.34 + 0.66 * Math.max(0, normals.getX(i) * -0.45 + normals.getY(i) * 0.78 + normals.getZ(i) * -0.43) : 1;
    colors.set([base.r * k, base.g * k, base.b * k], i * 3);
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
  return g;
}
export function batch(group: Group, parts: BufferGeometry[], name: string, side: Side = DoubleSide): Mesh | null {
  if (!parts.length) return null;
  const geometry = mergeGeometries(parts)!;
  parts.forEach(g => g.dispose());
  geometry.userData.mqOwned = true;
  const material = new MeshBasicMaterial({ vertexColors: true, side });
  material.userData.mqOwned = true;
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  group.add(mesh);
  return mesh;
}


/**
 * Cubes written straight into arrays, with voxel-art face values (top
 * brightest, side pairs apart, underside dark). A furnished room is hundreds of
 * boxes; cloning, transforming and merging a BoxGeometry for each was the slow
 * way. `yaw` turns a piece about Y (furniture facing the middle of a room).
 */
const CUBE_FACES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 1, 0, 1], [0, -1, 0, 0.42], [1, 0, 0, 0.8], [-1, 0, 0, 0.62], [0, 0, 1, 0.72], [0, 0, -1, 0.55],
];
export class CubeWriter {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  count = 0;
  cube(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: Color, yaw = 0, flat = false): void {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2, cs = Math.cos(yaw), sn = Math.sin(yaw);
    for (const [nx, ny, nz, shade] of CUBE_FACES) {
      const a = ny !== 0 ? [1, 0, 0] : nx !== 0 ? [0, 0, 1] : [1, 0, 0];
      const b = ny !== 0 ? [0, 0, 1] : [0, 1, 0];
      const flip = (nx + ny + nz) * (ny !== 0 || nx !== 0 ? -1 : 1) < 0;
      const corner = (u: number, v: number): [number, number, number] => {
        const lx = nx * hx + a[0]! * u * hx + b[0]! * v * hx;
        const ly = ny * hy + a[1]! * u * hy + b[1]! * v * hy;
        const lz = nz * hz + a[2]! * u * hz + b[2]! * v * hz;
        return [cx + lx * cs + lz * sn, cy + ly, cz - lx * sn + lz * cs];
      };
      const q = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
      const k = flat ? 1 : shade;
      for (const i of flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]) {
        this.pos.push(...q[i]!);
        this.col.push(color.r * k, color.g * k, color.b * k);
      }
    }
    this.count += 1;
  }
}

export { FrontSide };
