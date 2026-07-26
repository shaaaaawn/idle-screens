import type { EvalScreen } from './types';

/**
 * Overlay model-authored evidence onto a catalog slice so nav never collapses.
 * An agent run often covers only one benchmark × N artists — By artist must
 * still show that artist's full body of work, with authored specs swapped in
 * where they exist.
 */
export function overlayAuthoredScreens(
  base: EvalScreen[],
  authored: EvalScreen[] | null | undefined,
): EvalScreen[] {
  if (!authored?.length) return base;
  const byId = new Map(authored.map((s) => [s.id, s]));
  return base.map((s) => byId.get(s.id) ?? s);
}
