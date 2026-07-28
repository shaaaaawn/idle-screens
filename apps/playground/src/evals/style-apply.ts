import type { LayerSpec, MotionSpec, SaverSpec, SpriteSpec } from '@idle-screens/schema';
import type { ArtistStyleProfile, BenchmarkIntent, EvalScreen, MotionKind, SignatureRecipe, SpriteKind } from './types';
import { specLabel } from './public-identity';

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function pickAccent(profile: ArtistStyleProfile, i: number): string {
  const a = profile.palette.accents;
  return a[i % a.length] ?? '#ffffff';
}

function spriteFor(profile: ArtistStyleProfile, kind: SpriteKind, accent: string, scale: number): SpriteSpec {
  const soft = profile.markMaking.softGlow;
  switch (kind) {
    case 'ring':
      return { kind: 'ring', radius: [0.004 * scale, 0.014 * scale], color: accent, width: 0.0015 * scale };
    case 'streak':
      return { kind: 'streak', length: [0.02 * scale, 0.06 * scale], color: accent, width: 0.002 * scale };
    case 'rect':
      return {
        kind: 'rect',
        width: [0.02 * scale, 0.08 * scale],
        aspect: [0.5, 1.4],
        color: accent,
      };
    case 'emoji':
      return {
        kind: 'emoji',
        glyphs: profile.markMaking.emojiGlyphs?.length
          ? profile.markMaking.emojiGlyphs
          : ['✦', '·', '✧'],
      };
    case 'text':
      return {
        kind: 'text',
        strings: [profile.artist.split(' ').pop()?.slice(0, 1) ?? '·'],
        color: accent,
        font: 'bold monospace',
        align: 'center',
        baseline: 'middle',
      };
    default:
      return {
        kind: 'circle',
        radius: [0.002 * scale, 0.012 * scale],
        color: accent,
        soft,
      };
  }
}

function motionFor(
  kind: MotionKind,
  speed: [number, number],
  bob: number,
): MotionSpec {
  switch (kind) {
    case 'rise':
      return { type: 'rise', speed, sway: bob };
    case 'orbit': {
      const deg = clamp(speed[1]! * 800, 6, 90);
      return { type: 'orbit', speed: [deg * 0.5, deg], radius: [0.08, 0.35] };
    }
    case 'wander':
      return { type: 'wander', speed, coherence: 0.55, meander: 0.04 * bob * 20 };
    case 'warp': {
      const w = clamp(speed[1]! * 8, 0.08, 1.2);
      return { type: 'warp', speed: [w * 0.4, w] };
    }
    case 'path':
      return {
        type: 'path',
        points: [
          { x: 0.15, y: 0.7 },
          { x: 0.4, y: 0.35 },
          { x: 0.7, y: 0.55 },
          { x: 0.85, y: 0.25 },
        ],
        duration: 14000,
        scatter: 0.03,
      };
    case 'bounce':
      return { type: 'bounce', speed };
    case 'static':
      return { type: 'static' };
    default:
      return { type: 'drift', speed, bob };
  }
}

function preferredMotion(profile: ArtistStyleProfile, fallback: MotionKind = 'drift'): MotionKind {
  return profile.motionDialect.preferred[0] ?? fallback;
}

function blendOf(profile: ArtistStyleProfile): LayerSpec['blend'] {
  const b = profile.markMaking.blend;
  return b === 'source-over' ? undefined : b;
}

function baseLayer(
  profile: ArtistStyleProfile,
  opts: {
    count: number;
    accentIndex: number;
    spriteKind?: SpriteKind;
    motion?: MotionKind;
    speed: [number, number];
    sizeScale?: number;
    region?: LayerSpec['region'];
    pulse?: boolean;
    key?: string;
    links?: boolean;
    layout?: LayerSpec['layout'];
    position?: LayerSpec['position'];
    spin?: number | [number, number];
  },
): LayerSpec {
  const sk = opts.spriteKind ?? profile.markMaking.primarySprites[0] ?? 'circle';
  const mk = opts.motion ?? preferredMotion(profile);
  const accent = pickAccent(profile, opts.accentIndex);
  const bob = 0.004 * profile.motionDialect.bobScale;
  const speed: [number, number] = [
    opts.speed[0]! * profile.motionDialect.speedScale,
    opts.speed[1]! * profile.motionDialect.speedScale,
  ];
  // position requires count:1 — never density-scale pinned focals.
  const rawCount =
    opts.position || opts.count === 1
      ? opts.count
      : Math.max(1, Math.round(opts.count * profile.composition.densityScale));
  const layer: LayerSpec = {
    count: rawCount,
    sprite: spriteFor(profile, sk, accent, opts.sizeScale ?? 1),
    motion: motionFor(mk, speed, bob),
    alpha: profile.markMaking.typicalAlpha,
    blend: blendOf(profile),
    region: opts.region ?? profile.composition.regionBias,
    key: opts.key,
    layout: opts.layout,
    position: opts.position,
    spin: opts.spin,
  };
  if (sk === 'emoji' || sk === 'text') {
    layer.size = [0.018 * (opts.sizeScale ?? 1), 0.04 * (opts.sizeScale ?? 1)];
  }
  if (opts.pulse && profile.motionDialect.pulse) {
    layer.pulse = {
      amp: profile.motionDialect.pulse.amp,
      period: profile.motionDialect.pulse.period,
      ...(profile.motionDialect.pulse.wave
        ? { wave: { wavelength: 0.35, angle: 15 } }
        : {}),
    };
  }
  if (opts.links && profile.markMaking.linkMode) {
    layer.links = {
      k: 2,
      maxDist: 0.18,
      color: accent,
      alpha: 0.25,
      mode: profile.markMaking.linkMode,
      falloff: true,
    };
  }
  return layer;
}

function recipeToLayers(profile: ArtistStyleProfile, recipe: SignatureRecipe): LayerSpec[] {
  const n = clamp(profile.composition.layerCountHint, 2, 6);
  switch (recipe) {
    case 'horizon-band':
      return [
        baseLayer(profile, {
          count: 40,
          accentIndex: 0,
          speed: [0.0008, 0.002],
          region: { y: [0, 0.55] },
          sizeScale: 0.5,
          key: 'sky',
        }),
        baseLayer(profile, {
          count: 18,
          accentIndex: 1,
          speed: [0.002, 0.006],
          region: { y: [0.45, 0.75] },
          key: 'mid',
        }),
        baseLayer(profile, {
          count: 8,
          accentIndex: 2,
          motion: preferredMotion(profile, 'drift'),
          speed: [0.004, 0.01],
          region: { y: [0.72, 1] },
          sizeScale: 1.4,
          key: 'ground',
        }),
      ];
    case 'field-of-marks':
      return [
        baseLayer(profile, {
          count: 120,
          accentIndex: 0,
          speed: [0.001, 0.004],
          sizeScale: 0.45,
          key: 'dust',
        }),
        baseLayer(profile, {
          count: 50,
          accentIndex: 1,
          speed: [0.003, 0.008],
          sizeScale: 0.9,
          pulse: true,
          key: 'marks',
        }),
      ];
    case 'focal-orb':
      return [
        baseLayer(profile, {
          count: 60,
          accentIndex: 0,
          speed: [0.0006, 0.002],
          sizeScale: 0.4,
          key: 'haze',
        }),
        {
          ...baseLayer(profile, {
            count: 1,
            accentIndex: 2,
            motion: 'static',
            speed: [0, 0],
            sizeScale: 4,
            position: { x: 0.5, y: 0.48 },
            pulse: true,
            key: 'focal',
          }),
          sprite: spriteFor(profile, 'circle', pickAccent(profile, 2), 5),
        },
        baseLayer(profile, {
          count: 12,
          accentIndex: 1,
          motion: preferredMotion(profile, 'orbit'),
          speed: [0.01, 0.02],
          sizeScale: 0.7,
          key: 'satellites',
        }),
      ];
    case 'geometric-planes':
    case 'hard-edge-blocks':
      return Array.from({ length: Math.min(n, 4) }, (_, i) =>
        baseLayer(profile, {
          count: 6 + i * 2,
          accentIndex: i,
          spriteKind: 'rect',
          motion: i === 0 ? 'static' : 'drift',
          speed: [0.0004 * (i + 1), 0.0015 * (i + 1)],
          sizeScale: 1.2 + i * 0.2,
          region: { y: [i * 0.2, 0.35 + i * 0.2] },
          key: `plane-${i}`,
        }),
      );
    case 'linked-web':
      return [
        baseLayer(profile, {
          count: 36,
          accentIndex: 0,
          speed: [0.002, 0.006],
          links: true,
          pulse: true,
          key: 'web',
        }),
        baseLayer(profile, {
          count: 16,
          accentIndex: 1,
          spriteKind: profile.markMaking.primarySprites.includes('ring') ? 'ring' : 'circle',
          speed: [0.004, 0.01],
          sizeScale: 1.2,
          key: 'nodes',
        }),
      ];
    case 'rising-forms':
      return [
        baseLayer(profile, {
          count: 24,
          accentIndex: 0,
          motion: 'rise',
          speed: [0.006, 0.014],
          sizeScale: 0.8,
          key: 'far',
        }),
        baseLayer(profile, {
          count: 12,
          accentIndex: 1,
          motion: 'rise',
          speed: [0.016, 0.03],
          sizeScale: 1.4,
          pulse: true,
          key: 'near',
        }),
        baseLayer(profile, {
          count: 30,
          accentIndex: 2,
          motion: 'drift',
          speed: [0.001, 0.003],
          region: { y: [0, 0.5] },
          sizeScale: 0.35,
          key: 'sky',
        }),
      ];
    case 'pulsing-atmosphere':
      return [
        baseLayer(profile, {
          count: 20,
          accentIndex: 0,
          speed: [0.0005, 0.0015],
          sizeScale: 2.2,
          pulse: true,
          key: 'bloom',
        }),
        baseLayer(profile, {
          count: 40,
          accentIndex: 1,
          speed: [0.001, 0.004],
          sizeScale: 0.6,
          pulse: true,
          key: 'embers',
        }),
      ];
    case 'grid-lattice':
      return [
        baseLayer(profile, {
          count: 48,
          accentIndex: 0,
          spriteKind: profile.markMaking.primarySprites.includes('rect') ? 'rect' : 'circle',
          motion: 'drift',
          speed: [0.0008, 0.0025],
          layout: { type: 'grid', columns: 8, jitter: 0.15 },
          links: !!profile.markMaking.linkMode,
          key: 'lattice',
        }),
      ];
    case 'spiral-orbit':
      return [
        baseLayer(profile, {
          count: 1,
          accentIndex: 2,
          motion: 'static',
          speed: [0, 0],
          sizeScale: 2.5,
          position: { x: 0.5, y: 0.5 },
          pulse: true,
          key: 'core',
        }),
        baseLayer(profile, {
          count: 28,
          accentIndex: 0,
          motion: 'orbit',
          speed: [0.02, 0.04],
          sizeScale: 0.7,
          key: 'ring-a',
        }),
        baseLayer(profile, {
          count: 16,
          accentIndex: 1,
          motion: 'orbit',
          speed: [0.01, 0.02],
          sizeScale: 1.1,
          key: 'ring-b',
        }),
      ];
    case 'gesture-streaks':
      return [
        baseLayer(profile, {
          count: 40,
          accentIndex: 0,
          spriteKind: 'streak',
          motion: preferredMotion(profile, 'wander'),
          speed: [0.01, 0.03],
          spin: [-40, 40],
          key: 'strokes',
        }),
        baseLayer(profile, {
          count: 20,
          accentIndex: 1,
          spriteKind: 'circle',
          speed: [0.002, 0.006],
          sizeScale: 0.5,
          key: 'sparks',
        }),
      ];
    case 'all-over-infinity':
      return [
        baseLayer(profile, {
          count: 160,
          accentIndex: 0,
          speed: [0.002, 0.008],
          sizeScale: 0.35,
          pulse: true,
          key: 'dots-a',
        }),
        baseLayer(profile, {
          count: 80,
          accentIndex: 1,
          motion: preferredMotion(profile, 'orbit'),
          speed: [0.008, 0.02],
          sizeScale: 0.55,
          key: 'dots-b',
        }),
      ];
    default:
      return [
        baseLayer(profile, {
          count: 40,
          accentIndex: 0,
          speed: [0.002, 0.006],
          key: 'main',
        }),
      ];
  }
}

function intentToRecipe(intent: BenchmarkIntent): SignatureRecipe {
  switch (intent.id) {
    case 'calm-horizon':
      return 'horizon-band';
    case 'dense-field':
      return 'field-of-marks';
    case 'single-focal':
      return 'focal-orb';
    case 'layered-depth':
      return 'rising-forms';
    case 'pulse-atmosphere':
      return 'pulsing-atmosphere';
    default:
      return 'field-of-marks';
  }
}

function finalizeSpec(
  profile: ArtistStyleProfile,
  id: string,
  label: string,
  layers: LayerSpec[],
  seed: number,
): SaverSpec {
  // Horizon benchmarks prefer a band if background is gradient without one.
  let background = profile.palette.background;
  if (background.type === 'gradient' && !background.band && id.includes('calm-horizon')) {
    const ground = pickAccent(profile, profile.palette.accents.length - 1);
    background = {
      ...background,
      band: { color: ground, height: 0.1 },
    };
  }
  return {
    schemaVersion: 1,
    id,
    label,
    seed,
    motionIntensity: profile.research.tempo,
    ghosting: profile.markMaking.ghosting,
    background,
    layers,
  };
}

/** Apply StyleDNA to a shared benchmark intent. */
export function applyStyle(intent: BenchmarkIntent, profile: ArtistStyleProfile): EvalScreen {
  const recipe = intentToRecipe(intent);
  const layers = recipeToLayers(profile, recipe);
  // Ensure layered-depth has ≥3 layers
  if (intent.checks.minLayers && layers.length < intent.checks.minLayers) {
    while (layers.length < intent.checks.minLayers) {
      layers.push(
        baseLayer(profile, {
          count: 20,
          accentIndex: layers.length,
          speed: [0.001 * (layers.length + 1), 0.004 * (layers.length + 1)],
          key: `pad-${layers.length}`,
        }),
      );
    }
  }
  if (intent.checks.requirePulse) {
    for (const layer of layers) {
      if (!layer.pulse && profile.motionDialect.pulse) {
        layer.pulse = {
          amp: profile.motionDialect.pulse.amp,
          period: profile.motionDialect.pulse.period,
        };
      }
    }
  }
  const screenId = intent.id;
  const id = `${profile.id}--benchmark--${screenId}`;
  const seed = hashSeed(profile.id, screenId);
  return {
    id,
    artistId: profile.id,
    kind: 'benchmark',
    screenId,
    title: intent.title,
    intent: intent.intent,
    recipe: 'benchmark',
    spec: finalizeSpec(profile, id, specLabel(profile, intent.title), layers, seed),
  };
}

/** Build a signature screen from DNA + recipe prompt. */
export function applySignature(
  profile: ArtistStyleProfile,
  prompt: ArtistStyleProfile['signaturePrompts'][number],
): EvalScreen {
  const layers = recipeToLayers(profile, prompt.recipe);
  const id = `${profile.id}--signature--${prompt.id}`;
  const seed = hashSeed(profile.id, prompt.id);
  return {
    id,
    artistId: profile.id,
    kind: 'signature',
    screenId: prompt.id,
    title: prompt.title,
    intent: prompt.intent,
    recipe: prompt.recipe,
    spec: finalizeSpec(profile, id, specLabel(profile, prompt.title), layers, seed),
  };
}

export function buildArtistScreens(
  profile: ArtistStyleProfile,
  benchmarks: BenchmarkIntent[],
): EvalScreen[] {
  return [
    ...benchmarks.map((b) => applyStyle(b, profile)),
    ...profile.signaturePrompts.map((p) => applySignature(profile, p)),
  ];
}

function hashSeed(a: string, b: string): number {
  let h = 2166136261;
  const s = `${a}:${b}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 1_000_000 || 42;
}
