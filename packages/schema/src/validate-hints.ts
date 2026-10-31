/**
 * Reading the validator's own messages for the shape hint (validate.ts shapeHint): internal, not re-exported by the
 * package index.
 */

/**
 * A message for a field that takes one number: the scalar-only messages
 * ("…, not a [min,max] range"), and plain bounds ("must be > 0", "must be
 * 0..1", "must be a number of ms") with no bracket notation in them, which
 * would mean the field takes a pair or a range.
 */
export const SCALAR_ONLY = /not a \[min,max\] range/;
// Each number is unambiguous (digits, then at most one fraction), so the `..` between two bounds cannot be
// shared with either side: linear on any input, where `[\d.]*\.\.` backtracked quadratically on '0......'.
export const SCALAR_BOUND = /^must be (?:>|an? (?:positive |single |finite |whole )?(?:number|integer)\b|between -?\d|-?\d+(?:\.\d+)?\.\.-?\d+(?:\.\d+)?(?: \(|$))/;
export const scalarWanted = (m: string): boolean => SCALAR_ONLY.test(m) || (!m.includes('[') && SCALAR_BOUND.test(m));
