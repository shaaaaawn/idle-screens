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
    var background: Background?
    var layers: [Layer]

    /// Dimensional unit system. 'viewport' (default) = sizes/speeds are fractions
    /// of min(w,h); 'px' = raw pixels. The server migrates legacy specs to "px".
    enum Units: String, Decodable, Equatable, Sendable {
        case viewport, px
    }

    struct Background: Decodable, Equatable {
        /// Solid fill color (background.type == 'solid').
        var color: String?
        /// Vertical gradient stops (background.type == 'gradient'). Band/drift ignored.
        var stops: [GradientStop]?

        var primaryColor: String? { color ?? stops?.first?.color }
    }

    struct GradientStop: Decodable, Equatable {
        var at: Double
        var color: String
    }

    struct Layer: Decodable, Equatable {
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
    }

    struct Position: Decodable, Equatable {
        var x: Double
        var y: Double
    }

    struct Region: Decodable, Equatable {
        var x: [Double]?
        var y: [Double]?
    }

    struct Pulse: Decodable, Equatable {
        var amp: Double
        /// Period in ms.
        var period: Double
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
        var type: String
        var speed: [Double]?
        var angle: Double?
        var bidirectional: Bool?
        var bob: Double?
        /// rise: horizontal sway amplitude (spec units).
        var sway: Double?
        /// orbit: radius range (spec units) and center (fractions of w/h).
        var radius: [Double]?
        var center: Position?
        /// wander: harmonic drift amplitude (spec units) and 0…1 flock coherence.
        var meander: Double?
        var coherence: Double?
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
    }
}

extension SpecSubset.TextRevealSpec: Decodable {
    private enum CodingKeys: String, CodingKey {
        case progress, mode, speed, caret
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        progress = try c.decodeIfPresent(Double.self, forKey: .progress)
        mode = try c.decodeIfPresent(String.self, forKey: .mode)
        speed = try c.decodeIfPresent(Double.self, forKey: .speed)
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
                color: color
            )
        case "textBlock":
            self = .textBlock(
                text: try c.decodeIfPresent(String.self, forKey: .text) ?? "",
                maxWidth: try c.decodeIfPresent(Double.self, forKey: .maxWidth) ?? 0.8,
                fontSize: try c.decodeIfPresent(Double.self, forKey: .fontSize) ?? 0.03,
                lineHeight: try c.decodeIfPresent(Double.self, forKey: .lineHeight) ?? 1.4,
                align: try c.decodeIfPresent(String.self, forKey: .align) ?? "left",
                color: try c.decodeIfPresent(String.self, forKey: .color) ?? "#e6e8ef",
                reveal: try c.decodeIfPresent(SpecSubset.TextRevealSpec.self, forKey: .reveal)
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

    /// - Parameter budget: layer and total-entity ceilings. Layers are kept in
    ///   order (background first) and thinned proportionally rather than
    ///   truncated, so a capped scene still looks like itself.
    func compile(seed: Int, budget: (layers: Int, entities: Int) = Budget.fullscreen) -> [CompiledLayer] {
        var rng = Mulberry32(seed: UInt32(truncatingIfNeeded: seed))
        let resolvedUnits = units ?? .viewport
        let kept = layers.prefix(max(1, budget.layers))
        let requested = kept.reduce(0) { $0 + max(0, min($1.count, 400)) }
        // Uniform stride keeps every layer represented; dropping trailing
        // layers would cut the foreground accents first.
        let stride = requested > budget.entities
            ? max(1, Int((Double(requested) / Double(budget.entities)).rounded(.up)))
            : 1
        return kept.map { $0.compile(rng: &rng, units: resolvedUnits, stride: stride) }
    }
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

    static func drawOsc(rng: inout Mulberry32, amp: Double) -> Osc {
        var o = Osc()
        for i in 0..<3 {
            o.ax.append(amp * octAmp[i] * (0.6 + rng.next() * 0.8))
            o.fx.append(2 * .pi / (octPeriod[i].0 + rng.next() * (octPeriod[i].1 - octPeriod[i].0)))
            o.phx.append(rng.next() * 2 * .pi)
        }
        for i in 0..<3 {
            o.ay.append(amp * octAmp[i] * (0.6 + rng.next() * 0.8))
            o.fy.append(2 * .pi / (octPeriod[i].0 + rng.next() * (octPeriod[i].1 - octPeriod[i].0)))
            o.phy.append(rng.next() * 2 * .pi)
        }
        return o
    }

    func compile(rng: inout Mulberry32, units: SpecSubset.Units, stride: Int = 1) -> CompiledLayer {
        var entities: [CompiledEntity] = []
        var index = 0
        // Draw the full count so the RNG stream (and therefore the scene's
        // identity) is unchanged; keep every `stride`-th entity.
        let n = max(0, min(count, 400))
        // Wander: one shared oscillator set per layer (flock coherence), like
        // the web engine. Default meander: 60 for px specs, 0.05 viewport.
        let meander = motion.type == "wander"
            ? (motion.meander ?? (units == .px ? 60 : 0.05))
            : 0
        let sharedOsc = motion.type == "wander" ? Self.drawOsc(rng: &rng, amp: meander) : nil
        for _ in 0..<n {
            // Placement: explicit position wins for single-entity layers
            // (web parity: `layer.position && layer.count === 1`), otherwise
            // region-constrained scatter.
            let x: Double
            let y: Double
            if let position, count == 1 {
                x = position.x
                y = position.y
            } else {
                let xr = Self.pair(region?.x, default: (0, 1))
                let yr = Self.pair(region?.y, default: (0, 1))
                x = xr.0 + rng.next() * (xr.1 - xr.0)
                y = yr.0 + rng.next() * (yr.1 - yr.0)
            }

            // Velocity, per motion type (web engine parity; unknown → drift).
            var vx = 0.0, vy = 0.0
            var bob = 0.0
            var orbitR = 0.0
            let motionType: String
            switch motion.type {
            case "static":
                motionType = "static"
            case "rise":
                motionType = "rise"
                let sr = Self.pair(motion.speed, default: (0.02, 0.05))
                vy = -(sr.0 + rng.next() * (sr.1 - sr.0))  // upward
                bob = motion.sway ?? 0
            case "bounce":
                motionType = "bounce"
                let sr = Self.pair(motion.speed, default: (0.02, 0.05))
                let speed = sr.0 + rng.next() * (sr.1 - sr.0)
                let a = rng.next() * 2 * .pi
                vx = cos(a) * speed
                vy = sin(a) * speed
            case "orbit":
                motionType = "orbit"
                // Angular speed in deg/sec rides in vx, like the web engine.
                let sr = Self.pair(motion.speed, default: (5, 20))
                vx = sr.0 + rng.next() * (sr.1 - sr.0)
                let rr = Self.pair(motion.radius, default: (0.1, 0.25))
                orbitR = rr.0 + rng.next() * (rr.1 - rr.0)
            case "wander":
                motionType = "wander"
                let sr = Self.pair(motion.speed, default: (0.02, 0.05))
                let speed = sr.0 + rng.next() * (sr.1 - sr.0)
                let angle = (motion.angle ?? rng.next() * 360) * .pi / 180
                vx = cos(angle) * speed
                vy = sin(angle) * speed
            default:  // drift + unknown types
                motionType = "drift"
                let sr = Self.pair(motion.speed, default: (0.02, 0.05))
                let speed = sr.0 + rng.next() * (sr.1 - sr.0)
                let angle = (motion.angle ?? rng.next() * 360) * .pi / 180
                vx = cos(angle) * speed
                vy = sin(angle) * speed
                if motion.bidirectional == true, rng.next() < 0.5 { vx = -vx }
                bob = motion.bob ?? 0
            }

            // Size.
            let size: Double
            switch sprite {
            case .circle(let r, _, _, _), .ring(let r, _, _, _):
                size = r.0 + rng.next() * (r.1 - r.0)
            case .rect(let w, _, _, _):
                size = w.0 + rng.next() * (w.1 - w.0)
            case .streak(let l, _, _, _):
                size = l.0 + rng.next() * (l.1 - l.0)
            case .emoji, .text:
                // Web parity: glyph sizes are ALWAYS raw pixels — the engine
                // draws `${sz}px` with no unit scaling and defaults to [20,40]
                // (schema simulate.ts `layer.size ?? [20, 40]`), in both unit
                // modes. The old viewport-fraction default (0.02) rendered
                // sub-pixel text in px specs.
                let sr = Self.pair(self.size, default: (20, 40))
                size = sr.0 + rng.next() * (sr.1 - sr.0)
            case .textBlock(_, _, let fs, _, _, _, _):
                // Web parity: textBlock size = fontSize (viewport fraction),
                // NO rng draw. The fixed value keeps the stream stable.
                size = fs
            case .unknown:
                size = 0.01
            }

            let aspect: Double
            if case .rect(_, let a, _, _) = sprite {
                aspect = a.0 + rng.next() * (a.1 - a.0)
            } else {
                aspect = 1
            }

            // Color.
            let palette: [String]
            switch sprite {
            case .circle(_, let c, let cs, _): palette = cs.isEmpty ? [c] : cs
            case .ring(_, let c, let cs, _): palette = cs.isEmpty ? [c] : cs
            case .rect(_, _, let c, let cs): palette = cs.isEmpty ? [c] : cs
            case .streak(_, let c, let cs, _): palette = cs.isEmpty ? [c] : cs
            case .text(_, let c): palette = [c]
            case .textBlock(_, _, _, _, _, let c, _): palette = [c]
            default: palette = ["#ffffff"]
            }
            let color = palette[min(palette.count - 1, Int(rng.next() * Double(palette.count)))]

            // Glyph.
            let glyph: String?
            switch sprite {
            case .emoji(let glyphs):
                glyph = glyphs[min(glyphs.count - 1, Int(rng.next() * Double(glyphs.count)))]
            case .text(let strings, _):
                glyph = strings[min(strings.count - 1, Int(rng.next() * Double(strings.count)))]
            default:
                glyph = nil
            }

            let ar = Self.pair(alpha, default: (1, 1))
            let alphaValue = ar.0 + rng.next() * (ar.1 - ar.0)
            let phase = rng.next() * 2 * .pi
            let spinSpeed: Double
            if let spin {
                spinSpeed = spin.min + rng.next() * (spin.max - spin.min)
            } else {
                spinSpeed = 0
            }
            // Web parity: rotationAt() returns 0 when spinSpeed is 0 — a random
            // initial angle only applies to entities that actually spin. (The
            // rng draw stays unconditional to keep the seeded stream stable.)
            let spinDraw = rng.next() * 360
            let spinAngle = spinSpeed == 0 ? 0 : spinDraw

            var wanderParams: WanderParams?
            if motionType == "wander", let shared = sharedOsc {
                let own = Self.drawOsc(rng: &rng, amp: meander)
                wanderParams = WanderParams(
                    ax: own.ax, fx: own.fx, phx: own.phx,
                    ay: own.ay, fy: own.fy, phy: own.phy,
                    sharedAx: shared.ax, sharedFx: shared.fx, sharedPhx: shared.phx,
                    sharedAy: shared.ay, sharedFy: shared.fy, sharedPhy: shared.phy,
                    coherence: min(1, max(0, motion.coherence ?? 0)),
                    margin: meander * 1.75 * 1.4  // Σ octave amps (1+0.5+0.25) × 1.4
                )
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
            entities.append(CompiledEntity(
                x: x, y: y, vx: vx, vy: vy,
                size: size, aspect: aspect,
                color: color, red: rgb.0, green: rgb.1, blue: rgb.2, glyph: glyph,
                alpha: alphaValue, phase: phase,
                spinSpeed: spinSpeed, spinAngle: spinAngle,
                motionType: motionType, bob: bob,
                orbitR: orbitR,
                orbitCx: motion.center?.x ?? 0.5, orbitCy: motion.center?.y ?? 0.5,
                growAmp: grow?.amp ?? 0,
                growPeriod: grow?.period ?? 1000,
                growPhase: grow != nil ? rng.next() * 2 * .pi : 0,
                wander: wanderParams
            ))
        }
        return CompiledLayer(
            entities: entities,
            sprite: sprite,
            units: units,
            blend: blend,
            wrap: wrap ?? true,
            pulse: pulse
        )
    }

    /// Hex → sRGB, once per entity at compile time (never per frame).
    static func rgb(from hex: String) -> (Double, Double, Double) {
        let cleaned = hex.trimmingCharacters(in: .alphanumerics.inverted)
        var value: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&value)
        return (Double((value >> 16) & 0xFF) / 255,
                Double((value >> 8) & 0xFF) / 255,
                Double(value & 0xFF) / 255)
    }

    private static func pair(_ arr: [Double]?, default fallback: (Double, Double)) -> (Double, Double) {
        guard let arr, let lo = arr.first else { return fallback }
        return (lo, arr.count > 1 ? arr[1] : lo)
    }
}
