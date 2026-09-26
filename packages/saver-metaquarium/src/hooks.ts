/**
 * Stacking shader patches on one material. Several subsystems patch fish and
 * scenery materials through `onBeforeCompile` (water, the eye display, the
 * swim wave, glow halos, the floor pools), and three gives a material ONE
 * hook. Assigning over it silently drops whoever patched first.
 *
 * `stackPatch` wraps whatever hook is there and remembers, on the hook
 * function itself, which tags the chain carries. A subsystem that assigns a
 * fresh hook (the eye rig does) produces a function without tags, so the next
 * `stackPatch` with a tag sees it is missing and wraps again — no ping-pong,
 * because a chain that already carries the tag is left alone.
 *
 * The program cache key is extended the same way. Three's default key is
 * `onBeforeCompile.toString()`, read late, which after a wrap would be the
 * wrapper's text for every material — so the key captures the material's own
 * key function, or the original hook's text, at wrap time.
 */

import type { Material } from 'three';

type Hook = Material['onBeforeCompile'] & { mqTags?: ReadonlySet<string> };
/** A key this module installed, and the hook it was installed with. */
type Key = (() => string) & { mqFor?: Hook };
type Shader = Parameters<Material['onBeforeCompile']>[0];

export function hasPatch(material: Material, tag: string): boolean {
  return !!(material.onBeforeCompile as Hook).mqTags?.has(tag);
}

/** Add `patch` to the material's hook chain under `tag`. Returns false when the chain already has it. */
export function stackPatch(material: Material, tag: string, patch: (shader: Shader) => void): boolean {
  if (hasPatch(material, tag)) return false;
  const m = material;
  const before = m.onBeforeCompile as Hook;
  // The material's own key, unless it is a key this module installed for a
  // DIFFERENT hook: then someone assigned a new hook without a key of its own,
  // and the key must come from that hook, not from the chain it replaced.
  const ownKey = Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey') ? (m.customProgramCacheKey as Key) : null;
  const own = ownKey && (!ownKey.mqFor || ownKey.mqFor === before) ? ownKey : null;
  const beforeText = before.toString();
  const hook: Hook = (shader, renderer) => {
    before.call(m, shader, renderer);
    patch(shader);
  };
  hook.mqTags = new Set([...(before.mqTags ?? []), tag]);
  m.onBeforeCompile = hook;
  const key: Key = () => `${own ? own.call(m) : beforeText}|${tag}`;
  key.mqFor = hook;
  m.customProgramCacheKey = key;
  m.needsUpdate = true;
  return true;
}

/**
 * `material.clone()` without losing its patches: three's `Material.copy`
 * leaves `onBeforeCompile` and `customProgramCacheKey` behind, so a clone of
 * an eye or a halo material would render as the plain material.
 */
export function cloneWithHooks<T extends Material>(material: T): T {
  const c = material.clone() as T;
  if (Object.prototype.hasOwnProperty.call(material, 'onBeforeCompile')) {
    const hook = material.onBeforeCompile as Hook;
    // The hook may close over the ORIGINAL material (`before.call(m, …)`); that
    // is harmless, since every patch here edits the shader, not the material.
    c.onBeforeCompile = hook;
  }
  if (Object.prototype.hasOwnProperty.call(material, 'customProgramCacheKey')) c.customProgramCacheKey = material.customProgramCacheKey;
  return c;
}
