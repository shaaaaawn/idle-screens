import type { SaverSpec } from "../types";

/**
 * Typed Cue — textBlock.reveal, both moods.
 * Two self-typing captions over near-black. The upper one types at ten
 * graphemes a second with a blinking caret (`mode: 'typewriter'` — the classic
 * terminal reveal; `speed` makes progress a pure function of scene time, so
 * every viewer types the same line on the same clock from its own mount). The
 * lower one arrives as a wave of overlapping fades (`mode: 'glyphFade'`,
 * `fade: 0.4` — each glyph ramps in over 40% of the progress window, which
 * reads as a soft dissolve rather than typing) and carries no caret. Both
 * blocks declare `opacity` so the path is steerable, and layout always runs on
 * the FULL text — reveal only masks glyphs, so lines never reflow mid-type.
 *
 * Trap, documented in the playbook and true here too: at t = 0 a self-typing
 * block has typed nothing, so `previewScene` at the default instant looks
 * empty — preview at t ≥ 10 s to see the words. To swap the line live, glide
 * `reveal.progress` to 0, step the `text`, glide back (one `setTrack` call).
 *
 * The scan band is the one non-text layer, and it is load-bearing twice over:
 * a screensaver of two static text blocks is a document, not a screensaver
 * (`text-heavy`), and the band gives the words something to sit on — a slow
 * refresh sweep passing under the type. Note the units: `perceiveScene` takes
 * `t` in MILLISECONDS while the MCP `previewScene` tool takes seconds (the
 * worker converts); passing seconds to the library reads as a block that
 * never finishes typing.
 */
export const TYPED_CUE_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: "typed-cue",
  label: "Typed Cue",
  seed: 19,
  motionIntensity: "calm",
  background: { type: "solid", color: "#050608" },
  layers: [
    {
      key: "scan",
      count: 1,
      sprite: { kind: "rect", width: [1, 1], aspect: [0.02, 0.02], color: "#16241f", feather: 0.9 },
      motion: { type: "drift", speed: [0.014, 0.014], angle: 90 },
      alpha: [0.5, 0.5],
      blend: "screen",
    },
    {
      key: "headline",
      count: 1,
      sprite: {
        kind: "textBlock",
        text: "THE SCREEN IS AWAKE.\nWORDS ARRIVE ON THEIR OWN CLOCK.",
        maxWidth: 0.84,
        fontSize: 0.03,
        lineHeight: 1.5,
        align: "left",
        anchor: "top-left",
        font: "bold monospace",
        color: "#e6e8ef",
        opacity: 0.94,
        reveal: {
          progress: 1,
          mode: "typewriter",
          speed: 10,
          caret: { blink: 1.1, color: "#e6e8ef" },
        },
      },
      motion: { type: "static" },
      position: { x: 0.08, y: 0.16 },
      alpha: [0.95, 0.95],
    },
    {
      key: "aside",
      count: 1,
      sprite: {
        kind: "textBlock",
        text: "and leaves the same way —\na dissolve, not a delete.",
        maxWidth: 0.5,
        fontSize: 0.022,
        lineHeight: 1.5,
        align: "left",
        anchor: "bottom-right",
        font: "monospace",
        color: "#8f96a3",
        opacity: 0.85,
        reveal: { progress: 1, mode: "glyphFade", speed: 6, fade: 0.4 },
      },
      motion: { type: "static" },
      position: { x: 0.92, y: 0.86 },
      alpha: [0.9, 0.9],
    },
  ],
};
