/**
 * Does this GLB require Draco? Read from the container rather than trying and
 * catching, because a GLTFLoader without a decoder fails deep inside parse
 * with no usable signal — which is exactly how a Draco model became a silent
 * fallback blob on the wall. A GLB is: 12-byte header, then length-prefixed
 * chunks; the first is JSON. Cheap, synchronous, no allocation beyond the
 * chunk itself.
 */
export function needsDraco(buf: ArrayBuffer): boolean {
  try {
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x46546c67) return false; // 'glTF'
    const jsonLen = dv.getUint32(12, true);
    const json = new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen));
    return json.includes('KHR_draco_mesh_compression');
  } catch {
    return false;
  }
}

/** Test seam — the check is pure and three-free on purpose. */
export const __needsDracoForTest = needsDraco;
