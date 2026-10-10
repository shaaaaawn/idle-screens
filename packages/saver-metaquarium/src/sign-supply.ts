/**
 * A lit sign's power supply: neon and LED boards on old wiring under the sea.
 *
 * Each sign draws from its own supply (its id), and `amount` (the `signFlicker`
 * param, 0..1) says how bad the wiring is overall; within that, each supply's
 * own quality is hashed, so most signs are steady, some dodgy, a few bad:
 *
 *   hum      brightness sags slowly (a few seconds), a faint shimmer on top
 *   stutter  two short dips, a third of a second together
 *   band     a row driver (or a few columns) drops out for about two seconds
 *   tear     a few rows slip sideways a dot, for a moment
 *   reboot   (bad supplies only) the sign dies for a second, then wakes —
 *            an LED board row by row, a neon tube by tube — not a flash
 *
 * Flash safety is structural: time is cut into 4-second slots and a slot holds
 * at most one event, starting 0.5–1.5 s in and over by 3.5 s, so events never
 * stack. The worst second is one stutter: four ≥10% transitions = two flashes,
 * under WCAG's three (and on a small part of the frame). The hum stays within
 * 10%, so it is never a transition. `supplyLevel` mirrors the shader's
 * whole-sign level in JS for the halo card and the flash-safety test.
 *
 * Closed-form in t: every screen agrees, any frame is addressable. The hash is
 * a Weyl sequence (n·φ⁻¹ mod 1), which float32 GLSL and float64 JS agree on to
 * well under a decision's width for hours of scene time.
 */

export const SUPPLY_SLOT = 4;

const frac = (x: number): number => x - Math.floor(x);
export const supplyHash = (n: number, k: number): number => frac(n * 0.6180339887 + k * 0.7548776662);

export const SUPPLY_NONE = 0, SUPPLY_STUTTER = 1, SUPPLY_BAND = 2, SUPPLY_TEAR = 3, SUPPLY_REBOOT = 4;

/** How poor a supply is, 0 (good) .. 1 (bad). */
export const supplyQuality = (id: number): number => supplyHash(id * 13, 0.5);

export interface SupplyEvent { type: number; start: number; seed: number }

/** This slot's event for supply `id` at scene time `t` (seconds). */
export function supplyEvent(id: number, t: number, amount: number): SupplyEvent {
  const slot = Math.floor(t / SUPPLY_SLOT);
  if (amount <= 0) return { type: SUPPLY_NONE, start: 0, seed: 0 };
  const dodgy = supplyQuality(id);
  const p = amount * (0.12 + 0.88 * dodgy);
  if (supplyHash(slot + id * 37, id) > p * 0.6) return { type: SUPPLY_NONE, start: 0, seed: 0 };
  const h2 = supplyHash(slot * 3 + id * 11, id + 1);
  const type = h2 < 0.45 ? SUPPLY_STUTTER : h2 < 0.75 ? SUPPLY_BAND : h2 < 0.93 ? SUPPLY_TEAR : dodgy > 0.6 ? SUPPLY_REBOOT : SUPPLY_STUTTER;
  return { type, start: slot * SUPPLY_SLOT + 0.5 + supplyHash(slot + id, 2), seed: supplyHash(slot * 7 + id, 3) };
}

/** The whole sign's brightness, 0..1: hum, stutter, and a reboot's dark second and wake. */
export function supplyLevel(id: number, t: number, amount: number): number {
  if (amount <= 0) return 1;
  let level = 1 - amount * 0.045 * (1 + Math.sin((6.2831853 * t) / (3 + 2 * supplyHash(id, 4)) + id))
    - amount * 0.012 * (1 + Math.sin(t * 9 + id * 1.7));
  const e = supplyEvent(id, t, amount), u = t - e.start;
  if (e.type === SUPPLY_STUTTER && ((u >= 0 && u < 0.12) || (u >= 0.26 && u < 0.38))) level *= 0.5;
  if (e.type === SUPPLY_REBOOT && u >= 0 && u < 2.2) level *= u < 1 ? 0 : Math.min(1, (u - 1) / 1.2);
  return level;
}

/** The same model in GLSL. `mqSupplyHum` is hum and stutter; the caller draws a reboot's wake its own way. */
export const SUPPLY_GLSL = /* glsl */ `
float mqSupplyH(float n, float k) { return fract(n * 0.6180339887 + k * 0.7548776662); }
vec3 mqSupplyEvent(float id, float t, float amount) {
  if (amount <= 0.0) return vec3(0.0);
  float slot = floor(t / ${SUPPLY_SLOT}.0);
  float dodgy = mqSupplyH(id * 13.0, 0.5);
  float p = amount * (0.12 + 0.88 * dodgy);
  if (mqSupplyH(slot + id * 37.0, id) > p * 0.6) return vec3(0.0);
  float h2 = mqSupplyH(slot * 3.0 + id * 11.0, id + 1.0);
  float type = h2 < 0.45 ? 1.0 : h2 < 0.75 ? 2.0 : h2 < 0.93 ? 3.0 : (dodgy > 0.6 ? 4.0 : 1.0);
  return vec3(type, slot * ${SUPPLY_SLOT}.0 + 0.5 + mqSupplyH(slot + id, 2.0), mqSupplyH(slot * 7.0 + id, 3.0));
}
float mqSupplyHum(float id, float t, float amount, vec3 e) {
  if (amount <= 0.0) return 1.0;
  float level = 1.0 - amount * 0.045 * (1.0 + sin(6.2831853 * t / (3.0 + 2.0 * mqSupplyH(id, 4.0)) + id))
    - amount * 0.012 * (1.0 + sin(t * 9.0 + id * 1.7));
  float u = t - e.y;
  if (e.x == 1.0 && ((u >= 0.0 && u < 0.12) || (u >= 0.26 && u < 0.38))) level *= 0.5;
  return level;
}
`;
