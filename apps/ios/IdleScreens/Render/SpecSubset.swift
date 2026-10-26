import CoreGraphics
import Foundation

// MARK: - mulberry32 PRNG (same algorithm as the web engine)

struct Mulberry32: Sendable {
    private var state: UInt32

    init(seed: UInt32) {
        state = seed
    }

    /// Next value in [0, 1).
    mutating func next() -> Double {
        state = state &+ 0x6D2B79F5
        var t = state
        t = (t ^ (t >> 15)) &* (1 | t)
        t = (t &+ ((t ^ (t >> 7)) &* (61 | t))) ^ t
        return Double((t ^ (t >> 14)) & 0xFFFF_FFFF) / 4_294_967_296.0
    }
}

// MARK: - SpecSubset — lenient Codable subset of SaverSpec v1

struct SpecSubset: Decodable, Equatable {
    var schemaVersion: Int?
    var id: String?
    var label: String?
    var seed: Int?
    var units: Units?
    /// The viewport a viewport-unit scene's counts are authored at (default
    /// 1080): counts scale by min(w,h) / referenceViewport.
    var referenceViewport: Double?
    var background: Background?
    var layers: [Layer]
    /// 0…1 frame persistence: each frame paints over a partly-transparent
    /// clear instead of a fresh one, smearing motion into trails.
    var ghosting: Double?
    /// Named paint groups: a multi-layer subject moved/faded as one (3.11).
    var groups: Groups?
    /// The print pass over the finished frame (FinishOverlay).
    var finish: Finish?

    /// `{grain?, dither?, animate?}` — strengths 0…1. Lenient per field: a
    /// bad value is no finish for that field, never a dropped scene.
    struct Finish: Decodable, Equatable, Sendable {
        var grain: Double?
        var dither: Double?
        var animate: Bool?

        init(grain: Double? = nil, dither: Double? = nil, animate: Bool? = nil) {
            self.grain = grain; self.dither = dither; self.animate = animate
        }
        private enum CodingKeys: String, CodingKey { case grain, dither, animate }
        init(from decoder: Decoder) throws {
            guard let c = try? decoder.container(keyedBy: CodingKeys.self) else { return }
            grain = try? c.decodeIfPresent(Double.self, forKey: .grain)
            dither = try? c.decodeIfPresent(Double.self, forKey: .dither)
            animate = try? c.decodeIfPresent(Bool.self, forKey: .animate)
        }

        /// True when it paints anything.
        var isVisible: Bool { (grain ?? 0) > 0 || (dither ?? 0) > 0 }
    }

    /// Dimensional unit system. 'viewport' (default) = sizes/speeds are fractions
    /// of min(w,h); 'px' = raw pixels. The server migrates legacy specs to "px".
    enum Units: String, Decodable, Equatable, Sendable {
        case viewport, px
    }

    struct Background: Decodable, Equatable {
        /// Solid fill color (background.type == 'solid').
        var color: String?
        /// Vertical gradient stops (background.type == 'gradient').
        var stops: [GradientStop]?
        /// Slow oscillation of the gradient's stop positions.
        var drift: Drift?
        /// A flat strip along the bottom edge — a horizon, a floor.
        var band: Band?
        /// `solid` | `gradient` | `field`; absent reads by shape (color / stops).
        var type: String?
        /// `field` backgrounds: seeded noise read through the `bands` ramp
        /// (FieldSampler). The middle band is the scene's key colour where a
        /// single colour is wanted (thumbnails, the visibility gate).
        var bands: [String]?
        /// `field` knobs (FORMAT.md `background`): features across the short
        /// side, octaves 1…4, domain warp 0…1, posterise levels (0 = smooth),
        /// and the field's own seed.
        var scale: Double?
        var octaves: Double?
        var warp: Double?
        var quantize: Double?
        var seed: Double?

        var primaryColor: String? {
            color ?? stops?.first?.color ?? bands.flatMap { $0.isEmpty ? nil : $0[$0.count / 2] }
        }

        struct Drift: Decodable, Equatable, Sendable {
            /// Full cycle in ms.
            var period: Double
            /// Fraction of the 0…1 range each stop travels. Default 0.15.
            var amount: Double?
        }

        struct Band: Decodable, Equatable, Sendable {
            var color: String
            /// Spec units: px, or a fraction of min(w,h).
            var height: Double
        }

        /// Stop positions at time `t` (ms). Each stop rides the same sine a
        /// fraction of a turn apart, so the gradient breathes rather than
        /// sliding as a block (web parity: compile.ts paintBackground).
        func driftedStops(at t: Double) -> [GradientStop] {
            guard let stops, let drift, drift.period > 0 else { return stops ?? [] }
            let amount = drift.amount ?? 0.15
            let n = Double(stops.count)
            return stops.enumerated().map { i, stop in
                let phase = Double(i) / n * 2 * .pi
                let at = stop.at + amount * sin(t * 2 * .pi / drift.period + phase)
                return GradientStop(at: Swift.min(1, Swift.max(0, at)), color: stop.color)
            }
        }
    }

    struct GradientStop: Decodable, Equatable {
        var at: Double
        var color: String
    }

    struct Layer: Decodable, Equatable {
        /// Steering handle, and the anchor a parented orbit layer names.
        var key: String?
        var count: Int
        var sprite: Sprite
        var size: [Double]?
        var motion: Motion
        var wrap: Bool?
        var alpha: [Double]?
        var blend: String?
        var pulse: Pulse?
        var spin: Spin?
        var region: Region?
        /// Exact placement for single-entity layers (HUD text etc.);
        /// fractions of view width/height, like the web engine.
        var position: Position?
        var grow: Grow?
        /// Layer lifecycle envelope in ms (enter/exit/fade) — the whole layer
        /// fades in and out, independent of per-entity alpha.
        var life: Life?
        /// Structural placement: grid cells, or list/table reading order from
        /// an anchor, instead of seeded scatter.
        var layout: Layout?
        /// Relative palette weights, lifted out of `sprite` so the compiler
        /// can pick a colour beside it. Ignored unless it matches `colors`.
        var colorWeights: [Double]?
        /// Afterglow behind moving entities, sampled from past positions.
        var trail: Trail?
        /// Sparse-event window: each entity appears for `life` ms every
        /// `every` ms instead of being permanently on screen.
        var emit: Emit?
        /// Lines drawn between nearby entities of this layer.
        var links: Links?
        /// textBlock presentation lifted out of `sprite`: anchor, font, opacity.
        var textStyle: TextStyle?
        /// Static per-entity rotation in degrees (scalar, or a seeded range),
        /// added to any spin.
        var rotate: Spin?
        /// Phase-locks the layer: every entity pulses/grows in step, from
        /// `phase` (0…1 of a cycle), at `rate`× time.
        var clock: Clock?
        /// Paint-level layer opacity (3.10): multiplies every entity and the
        /// life envelope; 0 skips the layer.
        var opacity: Double?
        /// Paint-level transform of the whole layer (3.10).
        var transform: LayerTransform?
        /// The `groups` entry this layer paints through (3.11).
        var group: String?
        /// `rect.feather`: the fraction of the half-size that fades out on
        /// every side (lifted out of `sprite` like textStyle).
        var rectFeather: Double?
        /// The palette exactly as declared (`sprite.colors`): the web draws a
        /// palette pick only when there is one, so absence must stay visible.
        var spriteColors: [String] = []
        /// A rect's `aspect` was declared (only then does it draw).
        var rectAspectDeclared = false
        /// `spin` / `rotate` came as a [min, max] range (only then do they draw).
        var spinIsRange = false
        var rotateIsRange = false
        /// emoji / text `cycle.period` (ms): the variant advances over time.
        var spriteCycle: Double?
        /// Mirror a glyph to face its heading (drift / wander moving left).
        var flip: Bool?
        /// A `text` sprite's presentation (font, align, baseline, maxWidth).
        var textSprite: TextSpriteStyle?
        /// A stroke sprite's draw-on span (`sprite.draw`).
        var strokeDraw: StrokeDraw?
        /// `rock`: a swing of `amp`° either side of rest, once per `period` ms.
        var rock: Rock?

        private enum CodingKeys: String, CodingKey {
            case key, count, sprite, size, motion, wrap, alpha, blend, pulse
            case spin, region, position, grow, life, layout, trail, emit, links
            case rotate, clock, opacity, transform, group, flip, rock
        }
        private struct SpriteExtras: Decodable {
            struct Cycle: Decodable { var period: Double? }
            var kind: String?
            var colorWeights: [Double]?
            var feather: Double?
            var anchor: String?
            var font: String?
            var opacity: Double?
            var colors: [String]?
            var aspect: [Double]?
            var cycle: Cycle?
            var align: String?
            var baseline: String?
            var maxWidth: Double?
            var draw: StrokeDraw?
        }
        private enum RangeProbe: Decodable {
            case range, scalar
            init(from decoder: Decoder) throws {
                self = (try? decoder.singleValueContainer().decode([Double].self)) != nil ? .range : .scalar
            }
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            key = try? c.decodeIfPresent(String.self, forKey: .key)
            count = (try? c.decode(Int.self, forKey: .count)) ?? 0
            sprite = (try? c.decode(Sprite.self, forKey: .sprite)) ?? .unknown
            size = try? c.decodeIfPresent([Double].self, forKey: .size)
            motion = (try? c.decode(Motion.self, forKey: .motion)) ?? Motion(type: "drift")
            wrap = try? c.decodeIfPresent(Bool.self, forKey: .wrap)
            alpha = try? c.decodeIfPresent([Double].self, forKey: .alpha)
            blend = try? c.decodeIfPresent(String.self, forKey: .blend)
            pulse = try? c.decodeIfPresent(Pulse.self, forKey: .pulse)
            spin = try? c.decodeIfPresent(Spin.self, forKey: .spin)
            region = try? c.decodeIfPresent(Region.self, forKey: .region)
            position = try? c.decodeIfPresent(Position.self, forKey: .position)
            grow = try? c.decodeIfPresent(Grow.self, forKey: .grow)
            life = try? c.decodeIfPresent(Life.self, forKey: .life)
            layout = try? c.decodeIfPresent(Layout.self, forKey: .layout)
            trail = try? c.decodeIfPresent(Trail.self, forKey: .trail)
            emit = try? c.decodeIfPresent(Emit.self, forKey: .emit)
            links = try? c.decodeIfPresent(Links.self, forKey: .links)
            let extras = (try? c.decodeIfPresent(SpriteExtras.self, forKey: .sprite)) ?? nil
            colorWeights = extras?.colorWeights
            spriteColors = extras?.colors ?? []
            rectAspectDeclared = extras?.aspect != nil
            spinIsRange = (try? c.decodeIfPresent(RangeProbe.self, forKey: .spin)) == .range
            rotateIsRange = (try? c.decodeIfPresent(RangeProbe.self, forKey: .rotate)) == .range
            if extras?.kind == "emoji" || extras?.kind == "text" { spriteCycle = extras?.cycle?.period }
            flip = try? c.decodeIfPresent(Bool.self, forKey: .flip)
            rock = try? c.decodeIfPresent(Rock.self, forKey: .rock)
            if extras?.kind == "stroke" { strokeDraw = extras?.draw }
            if extras?.kind == "text", extras?.font != nil || extras?.align != nil
                || extras?.baseline != nil || extras?.maxWidth != nil {
                textSprite = TextSpriteStyle(font: extras?.font, align: extras?.align,
                                             baseline: extras?.baseline, maxWidth: extras?.maxWidth)
            }
            rectFeather = extras?.feather.map { Swift.min(1, Swift.max(0, $0)) }
            if extras?.anchor != nil || extras?.font != nil || extras?.opacity != nil {
                textStyle = TextStyle(anchor: extras?.anchor, font: extras?.font,
                                      opacity: extras?.opacity)
            }
            rotate = try? c.decodeIfPresent(Spin.self, forKey: .rotate)
            clock = try? c.decodeIfPresent(Clock.self, forKey: .clock)
            opacity = try? c.decodeIfPresent(Double.self, forKey: .opacity)
            transform = try? c.decodeIfPresent(LayerTransform.self, forKey: .transform)
            group = try? c.decodeIfPresent(String.self, forKey: .group)
        }
    }

    /// `{x?, y?, scale?, scaleX?, rotate?, origin?}` — translate in spec
    /// units (min(w,h), or px), rotate in degrees, about the viewport centre
    /// or (`origin: "anchor"`) the layer's own anchor. Lenient per field: a
    /// bad value is identity for that field, never a dropped scene.
    struct LayerTransform: Decodable, Equatable, Sendable {
        var x: Double?
        var y: Double?
        var scale: Double?
        var scaleX: Double?
        var rotate: Double?
        var origin: String?

        init(x: Double? = nil, y: Double? = nil, scale: Double? = nil, scaleX: Double? = nil,
             rotate: Double? = nil, origin: String? = nil) {
            self.x = x; self.y = y; self.scale = scale; self.scaleX = scaleX
            self.rotate = rotate; self.origin = origin
        }

        private enum CodingKeys: String, CodingKey { case x, y, scale, scaleX, rotate, origin }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            x = try? c.decodeIfPresent(Double.self, forKey: .x)
            y = try? c.decodeIfPresent(Double.self, forKey: .y)
            scale = try? c.decodeIfPresent(Double.self, forKey: .scale)
            scaleX = try? c.decodeIfPresent(Double.self, forKey: .scaleX)
            rotate = try? c.decodeIfPresent(Double.self, forKey: .rotate)
            origin = try? c.decodeIfPresent(String.self, forKey: .origin)
        }
    }

    struct LayerGroup: Decodable, Equatable, Sendable {
        var transform: LayerTransform?
        var opacity: Double?

        private enum CodingKeys: String, CodingKey { case transform, opacity }
        init(transform: LayerTransform? = nil, opacity: Double? = nil) {
            self.transform = transform; self.opacity = opacity
        }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            transform = try? c.decodeIfPresent(LayerTransform.self, forKey: .transform)
            opacity = try? c.decodeIfPresent(Double.self, forKey: .opacity)
        }
    }

    /// The `groups` map. Never throws: a malformed map paints as no groups,
    /// which is the format's own native fallback, rather than dropping the
    /// whole scene the way a throwing top-level field would.
    struct Groups: Decodable, Equatable, Sendable {
        var byName: [String: LayerGroup]
        init(_ byName: [String: LayerGroup]) { self.byName = byName }
        init(from decoder: Decoder) throws {
            byName = (try? decoder.singleValueContainer().decode([String: LayerGroup].self)) ?? [:]
        }
    }

    struct Rock: Decodable, Equatable, Sendable {
        var amp: Double
        var period: Double
    }

    struct Clock: Decodable, Equatable, Sendable {
        var phase: Double?
        var rate: Double?
    }

    /// How a textBlock is presented: which point of the rendered text
    /// `position` names, a CSS-style font hint, and a paint-level opacity.
    struct TextStyle: Equatable, Sendable {
        var anchor: String?
        var font: String?
        var opacity: Double?

        /// Offset that puts the named anchor of the INK (widest line × lines,
        /// as `align` placed it) on the position. Port of simulate.ts
        /// `textBlockAnchorOffset`.
        func anchorOffset(align: String, maxWidthPx: Double, widestLinePx: Double,
                          totalHeightPx: Double) -> (dx: Double, dy: Double) {
            guard let anchor else { return (0, 0) }
            let ax = anchor.hasSuffix("left") ? 0.0 : anchor.hasSuffix("right") ? 1.0 : 0.5
            let ay = anchor.hasPrefix("top") ? 0.0 : anchor.hasPrefix("bottom") ? 1.0 : 0.5
            let inkX0 = align == "center" ? (maxWidthPx - widestLinePx) / 2
                      : align == "right" ? maxWidthPx - widestLinePx : 0
            return (-(inkX0 + ax * widestLinePx), -(ay * totalHeightPx))
        }

        /// A CSS font shorthand ("italic 600 1px Georgia, serif") read for the
        /// three things a system font can honour: weight, slant and family class.
        var fontTraits: (bold: Bool, italic: Bool, design: String) {
            let f = (font ?? "").lowercased()
            let bold = f.contains("bold") || ["600", "700", "800", "900"].contains { f.contains($0) }
            let italic = f.contains("italic") || f.contains("oblique")
            let design = f.contains("mono") || f.contains("courier") || f.contains("menlo") ? "mono"
                       : (f.contains("serif") && !f.contains("sans-serif")) || f.contains("georgia")
                         || f.contains("times") ? "serif"
                       : f.contains("rounded") ? "rounded" : "default"
            return (bold, italic, design)
        }
    }

    /// `trail`: an afterglow of past positions, `length` ms behind the head,
    /// each dot dimmer and smaller than the last.
    struct Trail: Decodable, Equatable, Sendable {
        var length: Double
        var fade: Double?
    }

    /// `emit`: entity i is on screen for `life` ms out of every `every` ms.
    /// `jitter` blends an even stagger (a metronome) with a scattered one.
    struct Emit: Decodable, Equatable, Sendable {
        var every: Double
        var life: Double
        var jitter: Double?
        var grow: [Double]?
    }

    /// `links`: lines between nearby entities — constellations, webs, graphs.
    /// `k` and `maxDist` are optional because a `chain` reads neither (it needs
    /// `maxDist` only as the `falloff` fade distance); the validator requires
    /// both for `nearest` and `random`.
    struct Links: Decodable, Equatable, Sendable {
        var k: Int?
        var maxDist: Double?
        var color: String?
        var alpha: Double?
        var width: Double?
        var mode: String?
        var falloff: Bool?
        var closed: Bool?
    }

    /// `life`: the layer appears at `enter` ms, leaves at `exit` ms, each over
    /// `fade` ms (default 1000). Port of simulate.ts `lifeAlphaAt`.
    struct Life: Decodable, Equatable, Sendable {
        var enter: Double?
        var exit: Double?
        var fade: Double?
        /// Entity i's whole envelope shifts by i × stagger ms (a row builds).
        var stagger: Double?

        /// 0…1 opacity of the whole layer at time `t` (ms). With a stagger
        /// this is only the layer's gate (0 before the first entity enters);
        /// each entity's envelope is `alpha(at:entity:)`.
        func alpha(at t: Double) -> Double {
            if let stagger, stagger != 0 { return enter.map { t < $0 ? 0 : 1 } ?? 1 }
            return envelope(at: t)
        }

        /// Entity `i`'s share of a staggered life (1 without a stagger).
        func alpha(at t: Double, entity i: Int) -> Double {
            guard let stagger, stagger != 0 else { return 1 }
            return envelope(at: t - Double(i) * stagger)
        }

        private func envelope(at t: Double) -> Double {
            let fade = self.fade ?? 1000
            var a = 1.0
            if let enter {
                if t < enter { return 0 }
                a = fade > 0 ? Swift.min(1, (t - enter) / fade) : 1
            }
            if let exit, t >= exit {
                a *= fade > 0 ? Swift.max(0, 1 - (t - exit) / fade) : 0
            }
            return a
        }
    }

    /// `layout`: grid | list | table. `gap`/`jitter` accept a scalar or {x,y}.
    struct Layout: Decodable, Equatable, Sendable {
        var type: String
        var columns: Double?
        var gapX: Double?
        var gapY: Double?
        var jitterX: Double?
        var jitterY: Double?

        private enum CodingKeys: String, CodingKey { case type, columns, gap, jitter }
        private struct XY: Decodable { var x: Double?; var y: Double? }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            type = (try? c.decode(String.self, forKey: .type)) ?? "grid"
            columns = try? c.decodeIfPresent(Double.self, forKey: .columns)
            if let g = try? c.decodeIfPresent(Double.self, forKey: .gap) {
                gapX = g; gapY = g
            } else if let g = try? c.decodeIfPresent(XY.self, forKey: .gap) {
                gapX = g.x; gapY = g.y
            }
            if let j = try? c.decodeIfPresent(Double.self, forKey: .jitter) {
                jitterX = j; jitterY = j
            } else if let j = try? c.decodeIfPresent(XY.self, forKey: .jitter) {
                jitterX = j.x; jitterY = j.y
            }
        }
    }

    struct Position: Decodable, Equatable {
        var x: Double
        var y: Double
        /// Offset in spec units (min(w,h) fractions, or px) — the aspect-safe
        /// way to place a compound form's parts around one shared point.
        var dx: Double?
        var dy: Double?
    }

    /// `motion.center` is a union: `{x, y}` pins the orbit to a point,
    /// `{layer: "key"}` pins it to another layer's entity so the two move as
    /// one body (a jellyfish's tentacles on its bell).
    struct MotionCenter: Decodable, Equatable, Sendable {
        var x: Double?
        var y: Double?
        var layer: String?
    }

    struct Region: Decodable, Equatable {
        var x: [Double]?
        var y: [Double]?
    }

    struct Pulse: Decodable, Equatable {
        var amp: Double
        /// Period in ms.
        var period: Double
        /// A travelling wave: phase from position along `angle`° per `wavelength`.
        var wave: Wave?
        struct Wave: Decodable, Equatable { var wavelength: Double; var angle: Double? }
    }

    /// A `text` sprite's presentation: CSS font (family/weight, or a full
    /// shorthand with a px size), horizontal `align` and vertical `baseline`
    /// about the point, and a `maxWidth` it squeezes to fit.
    struct TextSpriteStyle: Equatable, Sendable {
        var font: String?
        var align: String?
        var baseline: String?
        var maxWidth: Double?
    }

    /// `spin` may be a scalar or a [min, max] range.
    struct Spin: Decodable, Equatable {
        var min: Double
        var max: Double

        init(min: Double, max: Double) {
            self.min = min
            self.max = max
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.singleValueContainer()
            if let v = try? c.decode(Double.self) {
                min = v
                max = v
            } else {
                let arr = try c.decode([Double].self)
                min = arr.first ?? 0
                max = arr.count > 1 ? arr[1] : (arr.first ?? 0)
            }
        }
    }

    /// Motion params. drift/static/rise/bounce/orbit/wander are simulated with
    /// the web engine's analytic math; unknown types degrade to drift.
    struct Motion: Decodable, Equatable {
        init(type: String) { self.type = type }
        var type: String
        var speed: [Double]?
        var angle: Double?
        var bidirectional: Bool?
        var bob: Double?
        /// rise: horizontal sway amplitude (spec units).
        var sway: Double?
        /// orbit: radius range (spec units) and center (fractions of w/h),
        /// or a parent layer to orbit — compound creatures ride a parent.
        var radius: [Double]?
        var center: MotionCenter?
        /// wander: harmonic drift amplitude (spec units) and 0…1 flock coherence.
        var meander: Double?
        var coherence: Double?
        /// path: waypoints (fractions of w/h), loop duration in ms, whether
        /// the loop closes, `curve: "linear"` for a polyline, and a per-entity
        /// scatter offset so a flock does not ride one line single-file.
        var points: [Position]?
        var duration: Double?
        var closed: Bool?
        var curve: String?
        var scatter: Double?
        /// drift / rise / wander: `settle` decelerates to rest, `buoyant`
        /// accelerates from rest, over `tau` ms.
        var ease: Ease?
        struct Ease: Decodable, Equatable { var type: String; var tau: Double? }
    }

    /// Layer-level size breathing: size *= 1 + amp·sin(2πt/period + phase).
    struct Grow: Decodable, Equatable {
        var amp: Double
        var period: Double?
    }

    struct CaretConfig: Decodable, Equatable, Sendable {
        var blink: Double?
        var color: String?
    }

    struct TextRevealSpec: Equatable, Sendable {
        var progress: Double?
        var mode: String?
        var speed: Double?
        var caret: CaretConfig?
        /// `glyphFade`: each glyph's fade window as a fraction of progress.
        var fade: Double?
        /// `glyphFade`: how far (em) a glyph rises into its line as it fades in.
        var rise: Double?
    }
}

extension SpecSubset.TextRevealSpec: Decodable {
    private enum CodingKeys: String, CodingKey {
        case progress, mode, speed, caret, fade, rise
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        progress = try c.decodeIfPresent(Double.self, forKey: .progress)
        mode = try c.decodeIfPresent(String.self, forKey: .mode)
        speed = try c.decodeIfPresent(Double.self, forKey: .speed)
        fade = try? c.decodeIfPresent(Double.self, forKey: .fade)
        rise = try? c.decodeIfPresent(Double.self, forKey: .rise)
        if let boolValue = try? c.decode(Bool.self, forKey: .caret) {
            caret = boolValue ? SpecSubset.CaretConfig() : nil
        } else {
            caret = try c.decodeIfPresent(SpecSubset.CaretConfig.self, forKey: .caret)
        }
    }
}

extension SpecSubset {

    enum Sprite: Equatable {
        case circle(radius: (Double, Double), color: String, colors: [String], soft: Bool)
        /// `width` nil = unset; the renderer applies the units-aware default.
        case ring(radius: (Double, Double), color: String, colors: [String], width: Double?)
        case rect(width: (Double, Double), aspect: (Double, Double), color: String, colors: [String])
        case streak(length: (Double, Double), color: String, colors: [String], width: Double?)
        case emoji(glyphs: [String])
        case text(strings: [String], color: String)
        case textBlock(text: String, maxWidth: Double, fontSize: Double,
                       lineHeight: Double, align: String, color: String,
                       reveal: SpecSubset.TextRevealSpec?)
        /// Regular n-gon (`sides`, point-up) or an arbitrary facet (`points`
        /// in a −1…1 box scaled by the circumradius).
        case polygon(radius: (Double, Double), color: String, colors: [String],
                     sides: Int?, points: [[Double]]?, soft: Bool, drawing: PathDrawing? = nil)
        /// A freehand mark: a path through `points` stroked `width` wide.
        case stroke(length: (Double, Double), points: [[Double]], color: String,
                    colors: [String], width: Double?, smooth: Bool,
                    taper: Bool, orient: Bool)
        /// A data bar: `values[i] / max` of `length`, `thickness` thick,
        /// growing toward `direction`.
        case bar(values: [Double], length: Double, thickness: Double,
                 color: String, colors: [String], max: Double?, direction: String)
        case unknown

        static func == (lhs: Self, rhs: Self) -> Bool {
            switch (lhs, rhs) {
            case let (.circle(r1, c1, cs1, s1), .circle(r2, c2, cs2, s2)):
                return r1 == r2 && c1 == c2 && cs1 == cs2 && s1 == s2
            case let (.ring(r1, c1, cs1, w1), .ring(r2, c2, cs2, w2)):
                return r1 == r2 && c1 == c2 && cs1 == cs2 && w1 == w2
            case let (.rect(w1, a1, c1, cs1), .rect(w2, a2, c2, cs2)):
                return w1 == w2 && a1 == a2 && c1 == c2 && cs1 == cs2
            case let (.streak(l1, c1, cs1, w1), .streak(l2, c2, cs2, w2)):
                return l1 == l2 && c1 == c2 && cs1 == cs2 && w1 == w2
            case let (.emoji(g1), .emoji(g2)):
                return g1 == g2
            case let (.text(s1, c1), .text(s2, c2)):
                return s1 == s2 && c1 == c2
            case let (.textBlock(t1, mw1, fs1, lh1, a1, c1, r1),
                      .textBlock(t2, mw2, fs2, lh2, a2, c2, r2)):
                return t1 == t2 && mw1 == mw2 && fs1 == fs2 && lh1 == lh2
                    && a1 == a2 && c1 == c2 && r1 == r2
            case let (.polygon(r1, c1, cs1, s1, p1, f1, d1), .polygon(r2, c2, cs2, s2, p2, f2, d2)):
                return r1 == r2 && c1 == c2 && cs1 == cs2 && s1 == s2 && p1 == p2 && f1 == f2 && d1 == d2
            case let (.stroke(l1, p1, c1, cs1, w1, sm1, t1, o1),
                      .stroke(l2, p2, c2, cs2, w2, sm2, t2, o2)):
                return l1 == l2 && p1 == p2 && c1 == c2 && cs1 == cs2 && w1 == w2
                    && sm1 == sm2 && t1 == t2 && o1 == o2
            case let (.bar(v1, l1, th1, c1, cs1, m1, d1), .bar(v2, l2, th2, c2, cs2, m2, d2)):
                return v1 == v2 && l1 == l2 && th1 == th2 && c1 == c2 && cs1 == cs2
                    && m1 == m2 && d1 == d2
            case (.unknown, .unknown):
                return true
            default:
                return false
            }
        }
    }
}

extension SpecSubset.Sprite: Decodable {
    private enum CodingKeys: String, CodingKey {
        case kind, glyphs, strings, color, colors, radius, width, length, aspect, soft
        case text, maxWidth, fontSize, lineHeight, align, reveal
        case sides, points, curve, taper, orient, values, thickness, max, direction
        case path, parts, fillRule, fill, gradient, stroke, span, origin, number
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? ""
        let color = try c.decodeIfPresent(String.self, forKey: .color) ?? "#ffffff"
        let colors = try c.decodeIfPresent([String].self, forKey: .colors) ?? [color]
        switch kind {
        case "circle":
            self = .circle(
                radius: Self.range(try c.decodeIfPresent([Double].self, forKey: .radius), default: (0.002, 0.005)),
                color: color,
                colors: colors,
                soft: try c.decodeIfPresent(Bool.self, forKey: .soft) ?? false
            )
        case "ring":
            self = .ring(
                radius: Self.range(try c.decodeIfPresent([Double].self, forKey: .radius), default: (0.01, 0.02)),
                color: color,
                colors: colors,
                width: try c.decodeIfPresent(Double.self, forKey: .width)
            )
        case "rect":
            self = .rect(
                width: Self.range(try c.decodeIfPresent([Double].self, forKey: .width), default: (0.01, 0.02)),
                aspect: Self.range(try c.decodeIfPresent([Double].self, forKey: .aspect), default: (1, 1)),
                color: color,
                colors: colors
            )
        case "streak":
            self = .streak(
                length: Self.range(try c.decodeIfPresent([Double].self, forKey: .length), default: (0.01, 0.03)),
                color: color,
                colors: colors,
                width: try c.decodeIfPresent(Double.self, forKey: .width)
            )
        case "emoji":
            self = .emoji(glyphs: try c.decodeIfPresent([String].self, forKey: .glyphs) ?? ["✦"])
        case "text":
            self = .text(
                strings: try c.decodeIfPresent([String].self, forKey: .strings) ?? ["idle screens"],
                color: try c.decodeIfPresent(String.self, forKey: .color) ?? "#e6e8ef"
            )
        case "textBlock":
            // `number`: a locale-free counter painted instead of `text`.
            let counter = (try? c.decodeIfPresent(TextNumber.self, forKey: .number)) ?? nil
            let authored = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
            self = .textBlock(
                text: counter?.formatted ?? authored,
                maxWidth: try c.decodeIfPresent(Double.self, forKey: .maxWidth) ?? 0.8,
                fontSize: try c.decodeIfPresent(Double.self, forKey: .fontSize) ?? 0.03,
                lineHeight: try c.decodeIfPresent(Double.self, forKey: .lineHeight) ?? 1.4,
                align: try c.decodeIfPresent(String.self, forKey: .align) ?? "left",
                color: try c.decodeIfPresent(String.self, forKey: .color) ?? "#e6e8ef",
                reveal: try c.decodeIfPresent(SpecSubset.TextRevealSpec.self, forKey: .reveal)
            )
        case "polygon":
            let soft = try c.decodeIfPresent(Bool.self, forKey: .soft) ?? false
            // A path drawing (`path` or `parts`): decoded leniently — a malformed
            // paint field drops that field, never the drawing (or the layer).
            var drawing: PathDrawing? = nil
            let span = try? c.decodeIfPresent(String.self, forKey: .span)
            let origin = try? c.decodeIfPresent([Double].self, forKey: .origin)
            if let parts = try? c.decodeIfPresent([PathDrawing.PartSpec].self, forKey: .parts), !parts.isEmpty {
                drawing = PathDrawing(specs: parts, ownColor: true, span: span ?? nil, origin: origin ?? nil, soft: false)
            } else if let path = try? c.decodeIfPresent(String.self, forKey: .path) {
                let one = PathDrawing.PartSpec(
                    path: path, color: nil,
                    fillRule: (try? c.decodeIfPresent(String.self, forKey: .fillRule)) ?? nil,
                    fill: (try? c.decodeIfPresent(Bool.self, forKey: .fill)) ?? nil,
                    gradient: (try? c.decodeIfPresent(PathDrawing.Gradient.self, forKey: .gradient)) ?? nil,
                    stroke: (try? c.decodeIfPresent(PathDrawing.Stroke.self, forKey: .stroke)) ?? nil,
                    opacity: nil)
                drawing = PathDrawing(specs: [one], ownColor: false, span: span ?? nil, origin: origin ?? nil, soft: soft)
            }
            self = .polygon(
                radius: Self.range(try c.decodeIfPresent([Double].self, forKey: .radius), default: (0.01, 0.02)),
                color: color,
                colors: colors,
                sides: try c.decodeIfPresent(Int.self, forKey: .sides),
                points: try c.decodeIfPresent([[Double]].self, forKey: .points),
                soft: soft,
                drawing: drawing
            )
        case "stroke":
            self = .stroke(
                length: Self.range(try c.decodeIfPresent([Double].self, forKey: .length), default: (0.02, 0.06)),
                points: try c.decodeIfPresent([[Double]].self, forKey: .points) ?? [[-1, 0], [1, 0]],
                color: color,
                colors: colors,
                width: try c.decodeIfPresent(Double.self, forKey: .width),
                // `smooth` is the default; only "linear" opts out.
                smooth: (try c.decodeIfPresent(String.self, forKey: .curve)) != "linear",
                taper: try c.decodeIfPresent(Bool.self, forKey: .taper) ?? false,
                orient: try c.decodeIfPresent(Bool.self, forKey: .orient) ?? false
            )
        case "bar":
            self = .bar(
                values: try c.decodeIfPresent([Double].self, forKey: .values) ?? [],
                length: try c.decodeIfPresent(Double.self, forKey: .length) ?? 0.2,
                thickness: try c.decodeIfPresent(Double.self, forKey: .thickness) ?? 0.02,
                color: color,
                colors: colors,
                max: try c.decodeIfPresent(Double.self, forKey: .max),
                direction: try c.decodeIfPresent(String.self, forKey: .direction) ?? "right"
            )
        default:
            self = .unknown
        }
    }

    private static func range(_ arr: [Double]?, default fallback: (Double, Double)) -> (Double, Double) {
        guard let arr, let lo = arr.first else { return fallback }
        return (lo, arr.count > 1 ? arr[1] : lo)
    }
}

// MARK: - Compilation to deterministic entities

struct CompiledEntity: Equatable, Sendable {
    var x, y: Double        // origin, fraction of view width/height
    var vx, vy: Double      // velocity in spec units/sec (orbit: deg/sec in vx)
    var size: Double        // radius / glyph size, spec units
    var aspect: Double      // rect height/width
    var color: String
    /// Pre-parsed sRGB components. `Color(hex:)` runs a Scanner over the hex
    /// string; doing that per sprite per frame was thousands of string parses
    /// a second on an ordinary scene. Parse once, at compile time.
    var red: Double = 1
    var green: Double = 1
    var blue: Double = 1
    var glyph: String?
    var alpha: Double
    var phase: Double       // pulse phase offset, radians
    var spinSpeed: Double   // degrees/sec
    var spinAngle: Double   // initial angle, degrees
    // Motion (web-engine analytic parity; see packages/schema/src/simulate.ts).
    var motionType: String = "drift"
    var bob: Double = 0                 // drift bob / rise sway (spec units)
    var orbitR: Double = 0              // spec units
    var orbitCx: Double = 0.5, orbitCy: Double = 0.5  // fractions of w/h
    var growAmp: Double = 0
    var growPeriod: Double = 1000       // ms
    var growPhase: Double = 0
    var wander: WanderParams?
    var warp: WarpParams?
    var path: PathParams?
    /// Static rotation in degrees, added to any spin.
    var rotate: Double = 0
    /// `rock`: swing amplitude (degrees), period (ms) and phase (radians).
    var rockAmp: Double = 0
    var rockPeriod: Double = 1000
    var rockPhase: Double = 0
    /// Layer clock: a shared pulse phase (radians) and a time multiplier.
    var pulsePhase: Double?
    var clockRate: Double = 1
    /// Sparse-event window (see SpecSubset.Emit), or nil for always-present.
    var emit: EmitParams?
    /// True when this entity's orbit is centred on a parent layer's entity
    /// rather than a fixed point: its own position is an offset from (0,0).
    var orbitParented: Bool = false
    /// Index within a `bar` layer — picks this bar's value.
    var barIndex: Int = 0
    /// The web's `e.size` in spec units (a circle's DIAMETER): wrap margins
    /// and bounce bounds use it.
    var extent: Double = 0
    /// Moving left at birth — what `flip` mirrors on.
    var headingLeft = false
    /// Placed in reading order by a data layout (a cycle there is a marquee).
    var ordered = false
    /// Position in the layer before any thinning (`life.stagger` steps by it).
    var order = 0
    /// emoji / text `cycle` period (ms) and, when clocked, the shared phase.
    var cyclePeriod: Double = 0
    var cyclePhase: Double?
    /// drift / rise / wander travel ease.
    var ease: MotionEase?
    /// Second dimension: rect height (already folded into `aspect`) or a
    /// bar's thickness, in spec units.
    var thickness: Double = 0
    /// `position.dx`/`dy`: an offset from (x, y) in spec units (×dim at draw).
    var offDX: Double = 0
    var offDY: Double = 0
    /// Which of a `text` sprite's strings (or emoji glyphs) this entity drew —
    /// a morph's text cross-fade paints the outgoing string at the same index.
    var glyphIndex: Int = 0
}

/// One entity's emit window. Timing is composition, not scatter: it is
/// derived from the index, never from the seeded stream, so declaring `emit`
/// rearranges nothing (web parity: simulate.ts `emitParams`).
struct EmitParams: Equatable, Sendable {
    var every: Double      // ms between appearances
    var life: Double       // ms visible
    var phase: Double      // ms offset
    var growFrom: Double
    var growTo: Double

    private static let attack = 0.25

    /// 0…1 progress through this appearance, or nil while off screen.
    func window(at t: TimeInterval) -> Double? {
        guard every > 0, life > 0 else { return nil }
        let ms = t * 1000
        let local = (((ms - phase).truncatingRemainder(dividingBy: every)) + every)
            .truncatingRemainder(dividingBy: every)
        return local < life ? local / life : nil
    }

    /// Attack/decay envelope across one appearance.
    static func envelope(_ u: Double) -> Double {
        guard u >= 0, u < 1 else { return 0 }
        func smoothstep(_ x: Double) -> Double {
            let c = Swift.min(1, Swift.max(0, x))
            return c * c * (3 - 2 * c)
        }
        return u < attack ? smoothstep(u / attack)
                          : 1 - smoothstep((u - attack) / (1 - attack))
    }

    /// Even stagger blended with a golden-ratio scatter, by index.
    static func make(_ emit: SpecSubset.Emit, index: Int, count: Int) -> EmitParams {
        let golden = 0.618_033_988_749_894_9
        let every = emit.every
        let jitter = Swift.min(1, Swift.max(0, emit.jitter ?? 1))
        let scattered = ((Double(index) + 0.5) * golden).truncatingRemainder(dividingBy: 1) * every
        let even = Double(index) / Double(Swift.max(1, count)) * every
        var phase = (even * (1 - jitter) + scattered * jitter)
            .truncatingRemainder(dividingBy: every)
        if phase < 0 { phase += every }
        return EmitParams(every: every, life: Swift.min(emit.life, every), phase: phase,
                          growFrom: emit.grow?.first ?? 1,
                          growTo: emit.grow?.count ?? 0 > 1 ? emit.grow![1] : 1)
    }
}

/// Warp: an entity flying at the viewer down a depth axis. `z` wraps from the
/// far plane (1) to `near`; screen scale and offset are both 1/z.
struct WarpParams: Equatable, Sendable {
    var ux: Double, uy: Double      // unit offset in the projection plane
    var z0: Double                  // starting depth
    var vz: Double                  // depth units/sec
    var cx: Double, cy: Double      // vanishing point, fractions of w/h
}

/// Path: a closed or ping-ponged loop through waypoints.
struct PathParams: Equatable, Sendable {
    var points: [(x: Double, y: Double)]   // fractions of w/h
    var duration: Double                   // ms for one loop
    var closed: Bool
    var smooth: Bool
    var phase: Double                      // 0…1 offset along the loop
    var offX: Double, offY: Double         // per-entity scatter, spec units

    static func == (a: Self, b: Self) -> Bool {
        a.points.count == b.points.count
            && zip(a.points, b.points).allSatisfy { $0.x == $1.x && $0.y == $1.y }
            && a.duration == b.duration && a.closed == b.closed && a.smooth == b.smooth
            && a.phase == b.phase && a.offX == b.offX && a.offY == b.offY
    }
}

/// Three harmonic octaves per axis, matching the web engine's drawOsc().
/// Amplitudes are spec units; freqs are rad/ms.
struct WanderParams: Equatable, Sendable {
    var ax: [Double], fx: [Double], phx: [Double]
    var ay: [Double], fy: [Double], phy: [Double]
    var sharedAx: [Double], sharedFx: [Double], sharedPhx: [Double]
    var sharedAy: [Double], sharedFy: [Double], sharedPhy: [Double]
    var coherence: Double
    var margin: Double                  // spec units
}

struct CompiledLayer: Equatable, Sendable {
    var entities: [CompiledEntity]
    var sprite: SpecSubset.Sprite
    var units: SpecSubset.Units
    var blend: String?
    var wrap: Bool
    var pulse: SpecSubset.Pulse?
    /// Layer lifecycle envelope; nil = always fully present.
    var life: SpecSubset.Life?
    /// This layer's own key, and the key of the layer its orbit rides.
    var key: String?
    var orbitParentKey: String?
    var trail: SpecSubset.Trail?
    var links: SpecSubset.Links?
    var textStyle: SpecSubset.TextStyle?
    /// Paint opacity: the layer's own × its group's, 0…1.
    var opacity: Double = 1
    /// `rect.feather` 0…1 (0 = hard edges).
    var feather: Double = 0
    /// Paint transform (the layer's own and/or its group's); nil = identity.
    var paint: PaintTransform?
    /// Mid-morph only: this text layer's outgoing words, painted under the
    /// incoming ones (`text: crossfade | dip`).
    var textCrossfade: TextCrossfade?
    /// `flip`: glyphs mirror to face a leftward heading.
    var flip: Bool = false
    /// A `text` sprite's font / align / baseline / maxWidth.
    var textSprite: SpecSubset.TextSpriteStyle?
    /// A stroke sprite's draw-on span.
    var strokeDraw: StrokeDraw?
}

/// simulate.ts `motionSeconds`: `settle` travels τ(1 − e^(−t/τ)), `buoyant`
/// t − τ(1 − e^(−t/τ)); under `emit` t is window-local.
struct MotionEase: Equatable, Sendable {
    var settle: Bool
    var tau: Double
}

/// A morph's second text pass (compile.ts `LayerPaintOverride`): the outgoing
/// sprite in the lerped frame's paint, and each pass's alpha.
struct TextCrossfade: Equatable, Sendable {
    var outgoing: SpecSubset.Sprite
    /// `text` sprites: the outgoing string each entity paints, by glyph index.
    var outGlyphs: [String]?
    var aOut: Double
    var aIn: Double
}

/// A layer's paint-level transform, resolved at draw time for a view size.
/// Mirrors the web's draw-time canvas transform (compile.ts
/// `applyLayerTransform`): a member of a group is drawn through G·L — its own
/// transform L about its origin, wrapped by the group's G about the viewport
/// centre — so a point p lands at G(L(p)).
struct PaintTransform: Equatable, Sendable {
    var layer: SpecSubset.LayerTransform?
    var group: SpecSubset.LayerTransform?
    /// The layer's anchor: fractions of w/h plus an offset in spec units.
    var anchorX: Double = 0.5
    var anchorY: Double = 0.5
    var anchorDX: Double = 0
    var anchorDY: Double = 0

    /// The affine that takes layer space to view space, applied first-to-last
    /// (`p.applying(m)`), in a y-down space of `size` with `unit` = min(w,h)
    /// for viewport specs or 1 for px specs.
    func affine(in size: CGSize, unit: CGFloat) -> CGAffineTransform {
        let centre = CGPoint(x: size.width / 2, y: size.height / 2)
        var m = CGAffineTransform.identity
        if let layer {
            let o = layer.origin == "anchor"
                ? CGPoint(x: anchorX * size.width + anchorDX * unit, y: anchorY * size.height + anchorDY * unit)
                : centre
            m = m.concatenating(Self.step(layer, about: o, unit: unit))
        }
        if let group { m = m.concatenating(Self.step(group, about: centre, unit: unit)) }
        return m
    }

    /// Total rotation in degrees and axis scales — what a sprite node that
    /// can't take a full affine (SpriteKit) applies to itself.
    var rotationDegrees: Double { (layer?.rotate ?? 0) + (group?.rotate ?? 0) }
    var scaleXY: (x: Double, y: Double) {
        func s(_ tf: SpecSubset.LayerTransform?) -> (Double, Double) {
            let k = tf?.scale ?? 1
            return (k * (tf?.scaleX ?? 1), k)
        }
        let a = s(layer), b = s(group)
        return (a.0 * b.0, a.1 * b.1)
    }

    /// translate(-o) → scale(s·sx, s) → rotate → translate(o + offset), the
    /// web's canvas call sequence read as one point map.
    private static func step(_ tf: SpecSubset.LayerTransform, about o: CGPoint, unit: CGFloat) -> CGAffineTransform {
        let s = tf.scale ?? 1
        return CGAffineTransform(translationX: -o.x, y: -o.y)
            .concatenating(CGAffineTransform(scaleX: s * (tf.scaleX ?? 1), y: s))
            .concatenating(CGAffineTransform(rotationAngle: (tf.rotate ?? 0) * .pi / 180))
            .concatenating(CGAffineTransform(translationX: o.x + (tf.x ?? 0) * unit,
                                             y: o.y + (tf.y ?? 0) * unit))
    }
}

extension SpecSubset {
    /// Deterministic entity placement + velocities. Same seed → same scene.
    /// Sizes/speeds stay in the spec's own units — scaling happens at draw time.
    /// Hard ceilings so a hostile or accidentally-huge spec can't take the
    /// device down. A published scene is untrusted input: nothing stops a
    /// channel from carrying 200 layers of 400 sprites, and every gallery
    /// tile compiles one. Without a budget that is a memory/CPU kill
    /// (jetsam), which reads to the user as "the app crashes on that channel".
    enum Budget {
        /// Fullscreen viewer — generous, still bounded.
        static let fullscreen = (layers: 60, entities: 4_000)
        /// Gallery/preview tiles — many render at once, so each gets far less.
        static let preview = (layers: 24, entities: 700)
    }

    /// The viewport a scene is composed for: the TV's 1920×1080 points
    /// (every preview tile draws in that reference space too). A grid's
    /// automatic column count and a `pulse.wave`'s phase read its aspect.
    static let composeViewport = CGSize(width: 1920, height: 1080)

    /// - Parameter budget: layer and total-entity ceilings. Layers are kept in
    ///   order (background first) and thinned proportionally rather than
    ///   truncated, so a capped scene still looks like itself.
    func compile(seed: Int, budget: (layers: Int, entities: Int) = Budget.fullscreen,
                 viewport: CGSize = SpecSubset.composeViewport) -> [CompiledLayer] {
        // The web's own stream (core createRng), seeded as SpecInstance seeds
        // it (`(seed >>> 0) || 1`), so a seed places every entity where the
        // web places it.
        var rng = SpecRng(seed: normalizedRenderSeed(seed))
        let resolvedUnits = units ?? .viewport
        let kept = layers.prefix(max(1, budget.layers))
        // simulate.ts `entityScales`: viewport specs scale their counts by
        // min(w,h) / referenceViewport (1 on a 1080-point TV by default).
        let minDim = Double(min(viewport.width, viewport.height))
        var countScale = resolvedUnits == .px ? 1 : minDim / (referenceViewport ?? 1080)
        if countScale > 1 {
            let raw = layers.reduce(0) { $0 + Int(FieldSampler.jsRound(Double($1.count) * countScale)) }
            if raw > 4000 { countScale *= 4000 / Double(raw) }
        }
        let requested = kept.reduce(0) { $0 + max(0, min($1.count, 400)) }
        // Uniform stride keeps every layer represented; dropping trailing
        // layers would cut the foreground accents first.
        let stride = requested > budget.entities
            ? max(1, Int((Double(requested) / Double(budget.entities)).rounded(.up)))
            : 1
        return kept.map { layer in
            var compiled = layer.compile(rng: &rng, units: resolvedUnits, stride: stride,
                                         viewport: viewport, countScale: countScale)
            // A member paints through its group: opacity multiplies, and the
            // group's transform (always about the viewport centre) wraps the
            // layer's own. A group name that matches nothing is no group.
            if let name = layer.group, let g = groups?.byName[name] {
                if let o = g.opacity { compiled.opacity *= Swift.min(1, Swift.max(0, o)) }
                if let gtf = g.transform {
                    var paint = compiled.paint ?? PaintTransform()
                    paint.group = gtf
                    compiled.paint = paint
                }
            }
            return compiled
        }
    }
}

/// The web engine's seeded stream (packages/core `createRng`): a splitmix32
/// step mixed twice. JS int32 arithmetic is mod 2³², so it runs in wrapping
/// `UInt32` and gives the same doubles bit for bit.
struct SpecRng: Sendable {
    private var a: UInt32

    init(seed: UInt32) { a = seed }

    mutating func next() -> Double {
        a = a &+ 0x9E37_79B9
        var t = a ^ (a >> 16)
        t = t &* 0x21F0_AAAD
        t ^= t >> 15
        t = t &* 0x735A_2D97
        t ^= t >> 15
        return Double(t) / 4_294_967_296
    }

    /// `range(min, max)`: `min + (max − min) · next()`.
    mutating func range(_ lo: Double, _ hi: Double) -> Double { lo + (hi - lo) * next() }

    /// `int(min, max)`: inclusive.
    mutating func int(_ lo: Int, _ hi: Int) -> Int { lo + Int((next() * Double(hi - lo + 1)).rounded(.down)) }
}

extension SpecSubset.Layer {
    /// One axis-pair of 3 harmonic octaves (18 draws), matching the web
    /// engine's drawOsc(). Amplitudes in spec units, freqs rad/ms.
    struct Osc {
        var ax: [Double] = [], fx: [Double] = [], phx: [Double] = []
        var ay: [Double] = [], fy: [Double] = [], phy: [Double] = []
    }

    static let octAmp = [1.0, 0.5, 0.25]
    static let octPeriod: [(Double, Double)] = [(6000, 14000), (3000, 7000), (1500, 4000)]

    static func drawOsc(rng: inout SpecRng, amp: Double) -> Osc {
        var o = Osc()
        for i in 0..<3 {
            o.ax.append(amp * octAmp[i] * rng.range(0.6, 1.4))
            o.fx.append(2 * .pi / rng.range(octPeriod[i].0, octPeriod[i].1))
            o.phx.append(rng.range(0, 2 * .pi))
        }
        for i in 0..<3 {
            o.ay.append(amp * octAmp[i] * rng.range(0.6, 1.4))
            o.fy.append(2 * .pi / rng.range(octPeriod[i].0, octPeriod[i].1))
            o.phy.append(rng.range(0, 2 * .pi))
        }
        return o
    }

    /// A port of simulate.ts `buildEntities`, draw for draw: size → aspect →
    /// motion → placement → variant → phase → then only what the layer
    /// declares (alpha, pulse, spin, grow, orbit radius, palette, wander,
    /// rotate range), so the same seed seats the same scene as the web.
    /// Positions stay fractions of w/h with offsets in spec units, so the
    /// placement holds at any size; `viewport` is consulted only where the
    /// web reads the frame's aspect (a grid's automatic columns, a pulse wave).
    func compile(rng: inout SpecRng, units: SpecSubset.Units, stride: Int = 1,
                 viewport: CGSize = SpecSubset.composeViewport, countScale: Double = 1) -> CompiledLayer {
        var entities: [CompiledEntity] = []
        var index = 0
        let vw = Double(viewport.width), vh = Double(viewport.height)
        let unit = units == .px ? 1 : Swift.min(vw, vh)
        // Grid layers are exempt from count scaling (they would truncate).
        let scaled = countScale == 1 || layout != nil
            ? count
            : Swift.max(1, Swift.min(Int(FieldSampler.jsRound(Double(count) * countScale)), links != nil ? 200 : 400))
        let n = max(0, min(scaled, 400))

        let palette: [String]
        let declaredColors = spriteColors.count
        switch sprite {
        case .circle(_, let c, _, _), .ring(_, let c, _, _), .rect(_, _, let c, _), .streak(_, let c, _, _),
             .polygon(_, let c, _, _, _, _, _), .stroke(_, _, let c, _, _, _, _, _), .bar(_, _, _, let c, _, _, _):
            palette = declaredColors > 0 ? spriteColors : [c]
        case .text(_, let c): palette = [c]
        case .textBlock(_, _, _, _, _, let c, _): palette = [c]
        default: palette = ["#ffffff"]
        }
        let variants: Int
        switch sprite {
        case .emoji(let glyphs): variants = glyphs.count
        case .text(let strings, _): variants = strings.count
        default: variants = 1
        }

        // Layer-level draws before the entity loop (wander's shared octaves).
        let meander = motion.type == "wander" ? (motion.meander ?? (units == .px ? 60 : 0.05)) : 0
        let sharedOsc = motion.type == "wander" ? Self.drawOsc(rng: &rng, amp: meander) : nil
        let orbitParentKey = motion.type == "orbit" ? motion.center?.layer : nil
        let pathPoints: [(x: Double, y: Double)]? = motion.type == "path"
            ? (motion.points?.map { (x: $0.x, y: $0.y) }).flatMap { $0.count >= 2 ? $0 : nil }
            : nil
        let ease = ["drift", "rise", "wander"].contains(motion.type) ? motion.ease : nil
        let clockPhase = clock.map { (($0.phase ?? 0).truncatingRemainder(dividingBy: 1)) * 2 * .pi } ?? 0

        // Structural layout geometry — pure, no draws. List/table cells step
        // in spec units (×min(w,h) at draw), from an anchor fraction.
        let ordered = layout?.type == "list" || layout?.type == "table"
        let xr = Self.pair(region?.x, default: (0, 1))
        let yr = Self.pair(region?.y, default: (0, 1))
        var gapX = 0.0, gapY = 0.0, listCols = 1
        var anchorX = 0.0, anchorY = 0.0, anchorDX = 0.0, anchorDY = 0.0
        if ordered, let layout {
            let dflt = units == .px ? 40.0 : 0.06
            gapX = layout.gapX ?? dflt
            gapY = layout.gapY ?? dflt
            listCols = layout.type == "list" ? 1 : Swift.max(1, Int(FieldSampler.jsRound(layout.columns ?? 1)))
            let rows = Swift.max(1, Int((Double(n) / Double(listCols)).rounded(.up)))
            if let position {
                anchorX = position.x; anchorY = position.y
                anchorDX = position.dx ?? 0; anchorDY = position.dy ?? 0
            } else {
                anchorX = (xr.0 + xr.1) / 2; anchorY = (yr.0 + yr.1) / 2
                anchorDX = -Double(listCols - 1) * gapX / 2
                anchorDY = -Double(rows - 1) * gapY / 2
            }
        }
        var gridCols = 1, cellW = 0.0, cellH = 0.0
        if layout?.type == "grid" {
            // The web sizes the lattice in pixels: auto columns follow the
            // frame's aspect, capped at 100.
            let gw = Swift.max(1, (xr.1 - xr.0) * vw)
            let gh = Swift.max(1, (yr.1 - yr.0) * vh)
            let auto = Swift.max(1, Int(FieldSampler.jsRound((Double(n) * (gw / gh)).squareRoot())))
            gridCols = Swift.max(1, Swift.min(layout?.columns.map { Int($0) } ?? auto, 100))
            let gridRows = Swift.max(1, Int((Double(n) / Double(gridCols)).rounded(.up)))
            cellW = (xr.1 - xr.0) / Double(gridCols)
            cellH = (yr.1 - yr.0) / Double(gridRows)
        }

        for i in 0..<n {
            // 1. Size, in spec units (the web's e.size / scale). Circles,
            //    rings and polygons keep their radius here; `extent` is the
            //    web's diameter, which wrap margins and bounce bounds use.
            var size: Double
            var extent: Double
            switch sprite {
            case .circle(let r, _, _, _), .ring(let r, _, _, _), .polygon(let r, _, _, _, _, _, _):
                size = rng.range(r.0, r.1); extent = size * 2
            case .streak(let l, _, _, _), .stroke(let l, _, _, _, _, _, _, _):
                size = rng.range(l.0, l.1); extent = size
            case .rect(let w, _, _, _):
                size = rng.range(w.0, w.1); extent = size
            case .bar(_, let length, _, _, _, _, _):
                size = length; extent = size
            case .textBlock(_, _, let fs, _, _, _, _):
                size = fs; extent = size
            case .emoji, .text, .unknown:
                // Glyph sizes: px specs default 20…40 px, viewport specs the
                // same at 1080p (20/1080…40/1080 of min(w,h)).
                let dflt = units == .px ? (20.0, 40.0) : (20.0 / 1080, 40.0 / 1080)
                let sr = Self.pair(self.size, default: dflt)
                size = rng.range(sr.0, sr.1); extent = size
            }
            // 2. A rect's aspect draw, only when it declares one.
            var aspect = 1.0
            if case .rect(_, let a, _, _) = sprite, rectAspectDeclared { aspect = rng.range(a.0, a.1) }

            // 3. Motion.
            var vx = 0.0, vy = 0.0, bob = 0.0
            var warp: WarpParams?
            var pathPhase = 0.0, pathOffX = 0.0, pathOffY = 0.0
            let motionType: String
            switch motion.type {
            case "static":
                motionType = "static"
            case "rise":
                motionType = "rise"
                let sr = Self.pair(motion.speed, default: (0.02, 0.05))
                vy = -rng.range(sr.0, sr.1)
                bob = motion.sway ?? 0
            case "bounce":
                motionType = "bounce"
                let sr = Self.pair(motion.speed, default: (0.02, 0.05))
                let s = rng.range(sr.0, sr.1)
                let a = rng.range(0, 2 * .pi)
                vx = s * cos(a); vy = s * sin(a)
            case "orbit":
                motionType = "orbit"
                let sr = Self.pair(motion.speed, default: (5, 20))
                vx = rng.range(sr.0, sr.1)   // deg/sec, unscaled
            case "wander":
                motionType = "wander"
                let sr = Self.pair(motion.speed, default: (0.02, 0.05))
                let s = rng.range(sr.0, sr.1)
                let heading = motion.angle.map { $0 * .pi / 180 } ?? rng.range(0, 2 * .pi)
                vx = s * cos(heading); vy = s * sin(heading)
            case "warp":
                motionType = "warp"
                let sr = Self.pair(motion.speed, default: (0.1, 0.4))
                let vz = rng.range(sr.0, sr.1)
                let theta = rng.range(0, 2 * .pi)
                let r = rng.range(0.15, 1)
                warp = WarpParams(ux: cos(theta) * r, uy: sin(theta) * r,
                                  z0: rng.range(SceneMotion.warpNear, 1), vz: vz,
                                  cx: motion.center?.x ?? 0.5, cy: motion.center?.y ?? 0.5)
            case "path" where pathPoints != nil:
                motionType = "path"
                pathPhase = rng.next()
                if let scatter = motion.scatter, scatter != 0 {
                    pathOffX = rng.range(-1, 1) * scatter
                    pathOffY = rng.range(-1, 1) * scatter
                }
            default:  // drift (and anything unknown)
                motionType = "drift"
                let sr = Self.pair(motion.speed, default: (0.02, 0.05))
                let s = rng.range(sr.0, sr.1)
                var angle = (motion.angle ?? 0) * .pi / 180
                if motion.bidirectional == true, rng.next() < 0.5 { angle = .pi - angle }
                vx = s * cos(angle); vy = s * sin(angle)
                bob = motion.bob ?? 0
            }

            // 4. Placement (two draws, or none for a pinned single entity).
            let x: Double, y: Double
            var offDX = 0.0, offDY = 0.0
            if let position, count == 1 {
                x = position.x; y = position.y
                offDX = position.dx ?? 0; offDY = position.dy ?? 0
            } else if ordered {
                _ = rng.next(); _ = rng.next()   // burned: a layout is placement only
                x = anchorX; y = anchorY
                offDX = anchorDX + Double(i % listCols) * gapX
                offDY = anchorDY + Double(i / listCols) * gapY
            } else if layout?.type == "grid" {
                let col = i % gridCols, row = i / gridCols
                let jx = layout?.jitterX ?? 0, jy = layout?.jitterY ?? 0
                x = xr.0 + (Double(col) + 0.5) * cellW + rng.range(-0.5, 0.5) * jx * cellW
                y = yr.0 + (Double(row) + 0.5) * cellH + rng.range(-0.5, 0.5) * jy * cellH
            } else {
                x = rng.range(xr.0, xr.1)
                y = rng.range(yr.0, yr.1)
            }

            // 5. The variant (strings / glyphs), in reading order under a data layout.
            var glyphIndex = 0
            if variants > 1 {
                let drawn = rng.int(0, variants - 1)
                glyphIndex = ordered ? i % variants : drawn
            }
            let glyph: String?
            switch sprite {
            case .emoji(let glyphs): glyph = glyphs.isEmpty ? nil : glyphs[min(glyphIndex, glyphs.count - 1)]
            case .text(let strings, _): glyph = strings.isEmpty ? nil : strings[min(glyphIndex, strings.count - 1)]
            default: glyph = nil
            }

            // 6. Phase, then the guarded draws in the web's order.
            let phase = rng.range(0, 2 * .pi)
            let alphaValue = alpha.map { a in rng.range(a.first ?? 1, a.count > 1 ? a[1] : (a.first ?? 1)) } ?? 1
            var pulsePhase: Double? = pulse != nil ? rng.range(0, 2 * .pi) : nil
            var spinSpeed = 0.0
            if let spin { spinSpeed = spinIsRange ? rng.range(spin.min, spin.max) : spin.min }
            let spinPhase = spin != nil ? rng.range(0, 2 * .pi) : 0
            let growPhase = grow != nil ? rng.range(0, 2 * .pi) : 0
            var orbitR = 0.0
            if motionType == "orbit" {
                let rr = Self.pair(motion.radius, default: (0.1, 0.25))
                orbitR = rng.range(rr.0, rr.1)
            }
            var color = palette[0]
            if declaredColors > 0 {
                if let weights = colorWeights, weights.count == declaredColors, weights.contains(where: { $0 > 0 }) {
                    color = palette[Self.weightedIndex(rng.next(), weights)]
                } else {
                    let drawn = rng.int(0, declaredColors - 1)
                    color = palette[min(declaredColors - 1, ordered ? i % declaredColors : drawn)]
                }
            }
            var wanderParams: WanderParams?
            if motionType == "wander", let shared = sharedOsc {
                let own = Self.drawOsc(rng: &rng, amp: meander)
                wanderParams = WanderParams(
                    ax: own.ax, fx: own.fx, phx: own.phx,
                    ay: own.ay, fy: own.fy, phy: own.phy,
                    sharedAx: shared.ax, sharedFx: shared.fx, sharedPhx: shared.phx,
                    sharedAy: shared.ay, sharedFy: shared.fy, sharedPhy: shared.phy,
                    coherence: min(1, max(0, motion.coherence ?? 0)),
                    margin: meander * 1.75 * 1.4)  // Σ octave amps (1+0.5+0.25) × 1.4
            }
            var rotateDeg = 0.0
            if let rotate { rotateDeg = rotateIsRange ? rng.range(rotate.min, rotate.max) : rotate.min }

            // Clock and pulse wave replace the seeded phases after the draws.
            if clock != nil { pulsePhase = clockPhase }
            if let wave = pulse?.wave, pulse != nil {
                let wl = Swift.max(1e-6, wave.wavelength * unit)
                let ang = (wave.angle ?? 0) * .pi / 180
                let px = x * vw + offDX * unit, py = y * vh + offDY * unit
                pulsePhase = clockPhase - (px * cos(ang) + py * sin(ang)) / wl * 2 * .pi
            }

            // Thinning (budget) and geometry sanitation happen at the append:
            // a NaN/∞ coordinate from a malformed spec would propagate into
            // CoreGraphics and can hard-crash the render.
            index += 1
            if stride > 1, index % stride != 0 { continue }
            guard x.isFinite, y.isFinite, vx.isFinite, vy.isFinite,
                  size.isFinite, size >= 0, aspect.isFinite, alphaValue.isFinite
            else { continue }

            let rgb = Self.rgb(from: color)
            let barThickness: Double
            if case .bar(_, _, let th, _, _, _, _) = sprite { barThickness = th } else { barThickness = 0 }
            var e = CompiledEntity(
                x: x, y: y, vx: vx, vy: vy,
                size: size, aspect: aspect,
                color: color, red: rgb.0, green: rgb.1, blue: rgb.2, glyph: glyph,
                alpha: alphaValue, phase: phase,
                spinSpeed: spinSpeed, spinAngle: spinPhase * 180 / .pi,
                motionType: motionType, bob: bob,
                orbitR: orbitR,
                orbitCx: orbitParentKey != nil ? 0 : (motion.center?.x ?? 0.5),
                orbitCy: orbitParentKey != nil ? 0 : (motion.center?.y ?? 0.5),
                growAmp: grow?.amp ?? 0,
                growPeriod: grow?.period ?? 1000,
                growPhase: clock != nil ? clockPhase : growPhase,
                wander: wanderParams,
                warp: warp,
                path: pathPoints.map { pts in
                    PathParams(points: pts, duration: Swift.max(1, motion.duration ?? 8000),
                               closed: motion.closed != false, smooth: motion.curve != "linear",
                               phase: pathPhase, offX: pathOffX, offY: pathOffY)
                },
                rotate: rotateDeg,
                orbitParented: orbitParentKey != nil,
                barIndex: i,
                thickness: barThickness,
                offDX: offDX,
                offDY: offDY,
                glyphIndex: glyphIndex)
            if motionType != "path" { e.path = nil }
            e.pulsePhase = pulsePhase
            e.clockRate = clock?.rate ?? 1
            e.extent = extent
            e.headingLeft = vx < 0
            e.ordered = ordered
            e.order = i
            if let cycle = spriteCycle, cycle > 0 { e.cyclePeriod = cycle; if clock != nil { e.cyclePhase = clockPhase } }
            if let ease, let tau = ease.tau, tau > 0 { e.ease = MotionEase(settle: ease.type == "settle", tau: tau) }
            entities.append(e)
        }
        if let rock {
            // One seeded phase per entity in a pass AFTER the loop, drawn only
            // when declared, so `rock` re-seats nothing else (a clock's shared
            // phase replaces it; the draw still happens, for stream parity).
            let phases = (0..<n).map { _ in rng.range(0, 2 * .pi) }
            for i in entities.indices {
                entities[i].rockAmp = rock.amp
                entities[i].rockPeriod = rock.period
                entities[i].rockPhase = clock != nil ? clockPhase : phases[entities[i].order]
            }
        }
        if let emit, !entities.isEmpty {
            // By the entity's place in the whole layer, so budget thinning
            // keeps every survivor's window.
            for i in entities.indices {
                entities[i].emit = EmitParams.make(emit, index: entities[i].order, count: n)
            }
        }
        return CompiledLayer(
            entities: entities,
            sprite: sprite,
            units: units,
            blend: blend,
            wrap: wrap ?? true,
            pulse: pulse,
            life: life,
            key: key,
            orbitParentKey: orbitParentKey,
            trail: trail,
            links: links,
            textStyle: textStyle,
            opacity: opacity.map { Swift.min(1, Swift.max(0, $0)) } ?? 1,
            feather: rectFeather ?? 0,
            paint: transform.map { tf in
                // The layer's anchor: its position (+dx/dy), else its region's centre.
                let rx = Self.pair(region?.x, default: (0, 1))
                let ry = Self.pair(region?.y, default: (0, 1))
                return PaintTransform(
                    layer: tf,
                    anchorX: position?.x ?? (rx.0 + rx.1) / 2,
                    anchorY: position?.y ?? (ry.0 + ry.1) / 2,
                    anchorDX: position?.dx ?? 0,
                    anchorDY: position?.dy ?? 0)
            },
            flip: flip == true,
            textSprite: textSprite,
            strokeDraw: strokeDraw
        )
    }

    /// Hex → sRGB, once per entity at compile time (never per frame).
    static func rgb(from hex: String) -> (Double, Double, Double) { parseHexRGB(hex) }

    /// Weighted pick from one uniform draw (web parity: `weightedIndex`).
    static func weightedIndex(_ u: Double, _ weights: [Double]) -> Int {
        let total = weights.reduce(0, +)
        guard total > 0 else { return 0 }
        var acc = 0.0
        for (i, w) in weights.enumerated() {
            acc += w / total
            if u < acc { return i }
        }
        return weights.count - 1
    }

    private static func pair(_ arr: [Double]?, default fallback: (Double, Double)) -> (Double, Double) {
        guard let arr, let lo = arr.first else { return fallback }
        return (lo, arr.count > 1 ? arr[1] : lo)
    }
}
