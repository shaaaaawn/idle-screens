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
    var background: Background?
    var layers: [Layer]

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

    /// Only the drift fields are used; every other motion type is treated as drift.
    struct Motion: Decodable, Equatable {
        var type: String
        var speed: [Double]?
        var angle: Double?
        var bidirectional: Bool?
        var bob: Double?
    }

    enum Sprite: Equatable {
        case circle(radius: (Double, Double), color: String, colors: [String], soft: Bool)
        case ring(radius: (Double, Double), color: String, colors: [String], width: Double)
        case rect(width: (Double, Double), aspect: (Double, Double), color: String, colors: [String])
        case streak(length: (Double, Double), color: String, colors: [String], width: Double)
        case emoji(glyphs: [String])
        case text(strings: [String], color: String)
        case unknown
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
                width: try c.decodeIfPresent(Double.self, forKey: .width) ?? 1
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
                width: try c.decodeIfPresent(Double.self, forKey: .width) ?? 1
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
    var vx, vy: Double      // velocity, fraction of min(view w,h) per second
    var size: Double        // radius / glyph size, fraction of min(view w,h)
    var aspect: Double      // rect height/width
    var color: String
    var glyph: String?
    var alpha: Double
    var phase: Double       // pulse phase offset, radians
    var spinSpeed: Double   // degrees/sec
    var spinAngle: Double   // initial angle, degrees
}

struct CompiledLayer: Equatable, Sendable {
    var entities: [CompiledEntity]
    var sprite: SpecSubset.Sprite
    var blend: String?
    var wrap: Bool
    var pulse: SpecSubset.Pulse?
}

extension SpecSubset {
    /// Deterministic entity placement + velocities. Same seed → same scene.
    func compile(seed: Int) -> [CompiledLayer] {
        var rng = Mulberry32(seed: UInt32(truncatingIfNeeded: seed))
        return layers.map { $0.compile(rng: &rng) }
    }
}

extension SpecSubset.Layer {
    func compile(rng: inout Mulberry32) -> CompiledLayer {
        var entities: [CompiledEntity] = []
        let n = max(0, min(count, 400))
        for _ in 0..<n {
            // Placement (region-constrained scatter).
            let xr = Self.pair(region?.x, default: (0, 1))
            let yr = Self.pair(region?.y, default: (0, 1))
            let x = xr.0 + rng.next() * (xr.1 - xr.0)
            let y = yr.0 + rng.next() * (yr.1 - yr.0)

            // Velocity — drift; every other motion type degrades to drift.
            var vx = 0.0, vy = 0.0
            if motion.type != "static" {
                let sr = Self.pair(motion.speed, default: (0.02, 0.05))
                let speed = sr.0 + rng.next() * (sr.1 - sr.0)
                let angle = (motion.angle ?? rng.next() * 360) * .pi / 180
                vx = cos(angle) * speed
                vy = sin(angle) * speed
                if motion.bidirectional == true, rng.next() < 0.5 { vx = -vx }
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
                let sr = Self.pair(size, default: (0.02, 0.03))
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
            let spinAngle = rng.next() * 360

            entities.append(CompiledEntity(
                x: x, y: y, vx: vx, vy: vy,
                size: size, aspect: aspect,
                color: color, glyph: glyph,
                alpha: alphaValue, phase: phase,
                spinSpeed: spinSpeed, spinAngle: spinAngle
            ))
        }
        return CompiledLayer(
            entities: entities,
            sprite: sprite,
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
