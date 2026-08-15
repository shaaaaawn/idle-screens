#!/usr/bin/env node
/**
 * preset-recipe-v1 scorer — pure arithmetic over manifest.paramSpace.
 *
 * Usage:
 *   node score.mjs --list            # print the steerable fixture set
 *   node score.mjs <presets.json>    # { saver, presets: [{name, params}] }
 *
 * Runs against built packages (pnpm build first): manifests are imported from
 * dist so the scorer sees exactly what a consumer sees. Scores are mechanical
 * on purpose — validity/diversity/coverage, never aesthetics (see README.md).
 */
import { readFileSync } from 'node:fs';

/** Steerable savers and where their plugin modules live. */
const SOURCES = [
  ['@idle-screens/savers-classic', null], // exports many; filtered below
  ['@idle-screens/saver-black-hole', null],
  ['@idle-screens/saver-tide', null],
  ['@idle-screens/saver-limelight', null],
  ['@idle-screens/saver-slipstream', null],
  ['@idle-screens/saver-catwalk', null],
  ['@idle-screens/saver-metaquarium', null],
];

async function steerable() {
  const out = new Map(); // id -> paramSpace
  for (const [pkg] of SOURCES) {
    let mod;
    try { mod = await import(pkg); } catch { continue; } // package not built/present
    for (const v of Object.values(mod)) {
      const man = v?.manifest ?? (v?.id && v?.paramSpace ? v : null);
      if (man?.id && man?.paramSpace && Object.keys(man.paramSpace).length) {
        out.set(man.id, man.paramSpace);
      }
    }
  }
  return out;
}

function validPreset(space, params) {
  for (const [k, v] of Object.entries(params ?? {})) {
    const p = space[k];
    if (!p) return false;
    if (p.type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) return false;
      if (p.min !== undefined && v < p.min) return false;
      if (p.max !== undefined && v > p.max) return false;
    } else if (p.type === 'color') {
      if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) return false;
    } else if (p.type === 'bool') {
      if (typeof v !== 'boolean') return false;
    } else if (p.type === 'enum') {
      if (!p.values?.includes(v)) return false;
    }
  }
  return true;
}

const hex = (c, i) => parseInt(c.slice(i, i + 2), 16) / 255;

/** Distance between two presets over the union of touched params, each
 *  dimension normalized to [0,1]; untouched params read as their default. */
function distance(space, a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  if (!keys.size) return 0;
  let sum = 0;
  for (const k of keys) {
    const p = space[k];
    if (!p) continue;
    const av = a[k] ?? p.default;
    const bv = b[k] ?? p.default;
    if (p.type === 'number') {
      const span = (p.max ?? 1) - (p.min ?? 0) || 1;
      // Clamped so an out-of-bounds value (already punished by validity)
      // cannot also buy free diversity.
      sum += Math.min(1, Math.abs((av - bv) / span));
    } else if (p.type === 'color' && typeof av === 'string' && typeof bv === 'string') {
      sum += (Math.abs(hex(av, 1) - hex(bv, 1)) + Math.abs(hex(av, 3) - hex(bv, 3)) + Math.abs(hex(av, 5) - hex(bv, 5))) / 3;
    } else {
      sum += av === bv ? 0 : 1;
    }
  }
  return sum / keys.size;
}

function score(space, presets) {
  const n = presets.length;
  const validity = n ? presets.filter((p) => validPreset(space, p.params)).length / n : 0;
  let pairs = 0, dsum = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    dsum += distance(space, presets[i].params ?? {}, presets[j].params ?? {});
    pairs++;
  }
  const diversity = pairs ? Math.min(1, (dsum / pairs) * 2) : 0; // 0.5 mean distance saturates
  const touched = new Set();
  for (const p of presets) {
    for (const [k, v] of Object.entries(p.params ?? {})) {
      if (space[k] && v !== space[k].default) touched.add(k);
    }
  }
  const coverage = Object.keys(space).length ? touched.size / Object.keys(space).length : 0;
  const total = (2 * validity + 2 * diversity + coverage) / 5;
  return {
    validity: +validity.toFixed(4), diversity: +diversity.toFixed(4),
    coverage: +coverage.toFixed(4), total: +total.toFixed(4),
    pass: validity === 1 && diversity >= 0.25,
  };
}

const arg = process.argv[2];
const spaces = await steerable();
if (!arg || arg === '--list') {
  console.log(JSON.stringify({ fixturesTotal: spaces.size, savers: [...spaces.keys()].sort() }, null, 2));
  process.exit(0);
}
const input = JSON.parse(readFileSync(arg, 'utf8'));
const space = spaces.get(input.saver);
if (!space) {
  console.error(`unknown or non-steerable saver: ${input.saver} (see --list)`);
  process.exit(1);
}
const result = { saver: input.saver, presetCount: input.presets?.length ?? 0, ...score(space, input.presets ?? []) };
console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 2);
