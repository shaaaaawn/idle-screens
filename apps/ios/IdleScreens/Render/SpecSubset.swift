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

    enum Sprite: Equatable {
        case circle(radius: (Double, Double), color: String, colors: [String], soft: Bool)
        /// `width` nil = unset; the renderer applies the units-aware default.
        case ring(radius: (Double, Double), color: String, colors: [String], width: Double?)
        case rect(width: (Double, Double), aspect: (Double, Double), color: String, colors: [String])
        case streak(length: (Double, Double), color: String, colors: [String], width: Double?)
        case emoji(glyphs: [String])
        case text(strings: [String], color: String)
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
    func compile(seed: Int) -> [CompiledLayer] {
        var rng = Mulberry32(seed: UInt32(truncatingIfNeeded: seed))
        let resolvedUnits = units ?? .viewport
        return layers.map { $0.compile(rng: &rng, units: resolvedUnits) }
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

    func compile(rng: inout Mulberry32, units: SpecSubset.Units) -> CompiledLayer {
        var entities: [CompiledEntity] = []
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

            entities.append(CompiledEntity(
                x: x, y: y, vx: vx, vy: vy,
                size: size, aspect: aspect,
                color: color, glyph: glyph,
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

    private static func pair(_ arr: [Double]?, default fallback: (Double, Double)) -> (Double, Double) {
        guard let arr, let lo = arr.first else { return fallback }
        return (lo, arr.count > 1 ? arr[1] : lo)
    }
}
