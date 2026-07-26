import type { BenchmarkIntent } from './types';

/** Five shared benchmark intents — every artist interprets the same set. */
export const BENCHMARK_INTENTS: BenchmarkIntent[] = [
  {
    id: 'calm-horizon',
    title: 'Calm Horizon',
    intent:
      'Quiet ambient field with a readable horizon or ground band; low urgency; atmospheric depth without clutter.',
    checks: {
      minLayers: 2,
      maxCoverage: 0.4,
      minCoverage: 0.005,
    },
  },
  {
    id: 'dense-field',
    title: 'Dense Field',
    intent:
      'High-count mark or particle field that still reads as ambient wallpaper — all-over energy without a single hero.',
    checks: {
      minLayers: 1,
      minCoverage: 0.02,
      maxCoverage: 0.55,
    },
  },
  {
    id: 'single-focal',
    title: 'Single Focal',
    intent:
      'One dominant focal mass with supporting atmosphere; the eye should land somewhere specific.',
    checks: {
      minLayers: 2,
      requireFocalDominance: true,
      minCoverage: 0.008,
    },
  },
  {
    id: 'layered-depth',
    title: 'Layered Depth',
    intent:
      'At least three depth layers with clear speed or scale separation (parallax / planes).',
    checks: {
      minLayers: 3,
      requireSpeedSeparation: true,
      minCoverage: 0.01,
    },
  },
  {
    id: 'pulse-atmosphere',
    title: 'Pulse Atmosphere',
    intent:
      'Soft breathing glow or traveling pulse; luminous atmosphere that stays flash-safe.',
    checks: {
      requirePulse: true,
      minLayers: 2,
      minCoverage: 0.01,
    },
  },
];
