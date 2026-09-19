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


export { FrontSide };
