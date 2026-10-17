import SwiftUI

// MARK: - The tank's room and atmosphere (metaquarium 0.10–0.18 params)
//
// What the 2D tank reads beyond `environment` and `fishMix`, mirrored
// draw-for-draw by `lofi.ts` / `lofi-tank.ts` in the metaquarium package:
//
// - Room: `fogColor` (the water) and `floorColor` (the dunes) override the
//   room's palette; `interior: geode` is a cave (its own palette, no shafts);
//   `floraDensity` thins the kelp (0 = none). Absent = the room as drawn.
// - Atmosphere: `marineSnow`, `skyLanterns`, and a `shoal` of `shoalKind`
//   at `shoalSpeed`.
// - Critters: the unminted breeds a `fishMix` names (crab, snail, Dot, the
//   dolphin, …) swim — or, the floor breeds, crawl the dunes — as icons
//   rendered from their own models.
//
// Every new element draws from its OWN seeded stream, forked from the seed
// with a fixed constant, so the original tank's stream — and so every
// existing channel's layout — is untouched.

struct AquariumParams: Equatable, Hashable, Sendable {
    var fogColor: String?
    var floorColor: String?
    var interior: String?
    var floraDensity: Double?
    var marineSnow: Double = 0
    var skyLanterns: Double = 0
    var shoal: Double = 0
    var shoalKind: String = "neon"
    var shoalSpeed: Double = 0.8

    init() {}

    /// From the scene's flattened track params (only what was authored).
    init(_ p: [String: String]) {
        func num(_ k: String) -> Double? { p[k].flatMap(Double.init).map { $0.isFinite ? $0 : 0 } }
        fogColor = p["fogColor"].flatMap(Self.hexRGB) != nil ? p["fogColor"] : nil
        floorColor = p["floorColor"].flatMap(Self.hexRGB) != nil ? p["floorColor"] : nil
        interior = p["interior"]
        floraDensity = num("floraDensity").map { min(1, max(0, $0)) }
        marineSnow = min(1, max(0, num("marineSnow") ?? 0))
        skyLanterns = min(1, max(0, num("skyLanterns") ?? 0))
        shoal = min(1, max(0, num("shoal") ?? 0))
        shoalKind = p["shoalKind"] ?? "neon"
        shoalSpeed = min(2, max(0.3, num("shoalSpeed") ?? 0.8))
    }

    var cacheKey: String {
        "\(fogColor ?? "")|\(floorColor ?? "")|\(interior ?? "")|\(floraDensity.map { String($0) } ?? "")|\(marineSnow)|\(skyLanterns)|\(shoal)|\(shoalKind)|\(shoalSpeed)"
    }

    /// `#rgb` / `#rrggbb` → 0…1 channels.
    static func hexRGB(_ s: String) -> (Double, Double, Double)? {
        var h = s.trimmingCharacters(in: .whitespaces)
        guard h.hasPrefix("#") else { return nil }
        h.removeFirst()
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        guard h.count == 6, let n = Int(h, radix: 16) else { return nil }
        return (Double((n >> 16) & 255) / 255, Double((n >> 8) & 255) / 255, Double(n & 255) / 255)
    }
}

/// Fixed stream constants — the same in lofi.ts.
enum AquariumStreams {
    static let critters: UInt32 = 0x6D71_CA51
    static let snow: UInt32 = 0x51A4_E3B7
    static let lanterns: UInt32 = 0x1A77_E2A5
    static let shoal: UInt32 = 0x5B0A_17C3
}

/// The unminted breeds the tank can draw: icon asset, size relative to a
/// minted fish (breeds.json `size`), tempo, and whether it lives on the floor.
struct CritterBreed: Sendable {
    let id: Int
    let size: Double
    let tempo: Double
    let floor: Bool
    /// Front- or top-view art: never mirrored by heading.
    let facing: Bool

    static let all: [String: CritterBreed] = [
        "blowfish": .init(id: 601, size: 0.8, tempo: 1.2, floor: false, facing: false),
        "hackerfish": .init(id: 602, size: 0.85, tempo: 1.0, floor: false, facing: false),
        "glowfish": .init(id: 603, size: 0.8, tempo: 1.3, floor: false, facing: false),
        "babyfish": .init(id: 604, size: 0.45, tempo: 0.8, floor: false, facing: false),
        "shark": .init(id: 605, size: 2.2, tempo: 1.4, floor: false, facing: false),
        "crab": .init(id: 606, size: 0.9, tempo: 1.0, floor: true, facing: true),
        "dori": .init(id: 608, size: 0.9, tempo: 0.9, floor: false, facing: false),
        "starfish": .init(id: 609, size: 1.0, tempo: 2.0, floor: true, facing: true),
        "octopus": .init(id: 610, size: 1.2, tempo: 1.2, floor: true, facing: true),
        "snail": .init(id: 611, size: 0.8, tempo: 2.0, floor: true, facing: false),
        "dot": .init(id: 612, size: 1.2, tempo: 1.0, floor: false, facing: false),
        "dolphin": .init(id: 613, size: 1.8, tempo: 0.7, floor: false, facing: false),
    ]

    var asset: String { "mqnpc\(id)" }
}

struct Critter: Equatable, Sendable {
    var breed: String
    var depth: Double
    var lane: Double
    var period: Double
    var phase: Double
    var dir: Double
    var bobAmp: Double
    var bobHz: Double
    var bobPhase: Double
}

struct Mote: Equatable, Sendable {
    var x: Double, y: Double, fall: Double, sway: Double, r: Double
}

struct Lantern: Equatable, Sendable {
    var x: Double, y: Double, drift: Double, pulse: Double, r: Double
}

struct ShoalFish: Equatable, Sendable {
    var dx: Double, dy: Double, wiggle: Double
}

struct AquariumExtras: Equatable, Sendable {
    var critters: [Critter] = []
    var snow: [Mote] = []
    var lanterns: [Lantern] = []
    var shoal: [ShoalFish] = []
    var shoalLane: Double = 0.45

    static func critterCap(rich: Bool) -> Int { rich ? 6 : 4 }

    /// The tank's extras, a pure function of (seed, rich, mix, params).
    static func build(seed: UInt32, rich: Bool, fishMix: String?, params: AquariumParams) -> AquariumExtras {
        var out = AquariumExtras()

        var rc = Mulberry32(seed: seed ^ AquariumStreams.critters)
        var names: [String] = []
        for e in FishMix.parse(fishMix ?? "") where CritterBreed.all[e.breed] != nil {
            for _ in 0..<e.count where names.count < critterCap(rich: rich) { names.append(e.breed) }
        }
        for name in names {
            let b = CritterBreed.all[name]!
            let depth = 0.35 + rc.next() * 0.65
            let base = b.floor ? 90_000 : 55_000 - depth * 37_000
            let period = base * (0.85 + rc.next() * 0.3) * b.tempo
            let phase = rc.next()
            let dir: Double = rc.next() < 0.5 ? -1 : 1
            let lane = 0.15 + rc.next() * 0.6
            let bobAmp = b.floor ? 0 : 0.006 + rc.next() * 0.014
            let bobHz = 0.1 + rc.next() * 0.15
            let bobPhase = rc.next() * .pi * 2
            out.critters.append(Critter(breed: name, depth: depth, lane: lane, period: period, phase: phase,
                                        dir: dir, bobAmp: bobAmp, bobHz: bobHz, bobPhase: bobPhase))
        }

        var rs = Mulberry32(seed: seed ^ AquariumStreams.snow)
        for _ in 0..<Int((params.marineSnow * (rich ? 60 : 30)).rounded()) {
            out.snow.append(Mote(x: rs.next(), y: rs.next(), fall: 0.012 + rs.next() * 0.02,
                                 sway: rs.next() * .pi * 2, r: 0.8 + rs.next() * 1.6))
        }

        var rl = Mulberry32(seed: seed ^ AquariumStreams.lanterns)
        for _ in 0..<Int((params.skyLanterns * (rich ? 6 : 4)).rounded()) {
            out.lanterns.append(Lantern(x: rl.next(), y: 0.04 + rl.next() * 0.22,
                                        drift: (rl.next() * 2 - 1) * 0.004,
                                        pulse: rl.next() * .pi * 2, r: 14 + rl.next() * 10))
        }

        var rh = Mulberry32(seed: seed ^ AquariumStreams.shoal)
        out.shoalLane = 0.3 + rh.next() * 0.3
        for _ in 0..<Int((params.shoal * (rich ? 24 : 12)).rounded()) {
            out.shoal.append(ShoalFish(dx: (rh.next() * 2 - 1) * 0.07, dy: (rh.next() * 2 - 1) * 0.045,
                                       wiggle: rh.next() * .pi * 2))
        }
        return out
    }

    // MARK: Poses (pure; lofi.ts mirrors each)

    /// Height of the front dune at x (the ground floor critters stand on).
    static func duneY(_ x: Double, h: Double) -> Double {
        h * 0.93 + sin(x * 0.004 + 2.1) * h * 0.018
    }

    /// Critter `c` at `t` ms: centre, side length (px) and opacity.
    static func pose(_ c: Critter, t: Double, w: Double, h: Double) -> (x: Double, y: Double, side: Double, alpha: Double) {
        let b = CritterBreed.all[c.breed]!
        let travel = (c.phase + t / c.period).truncatingRemainder(dividingBy: 1)
        let rawX = travel * w * 1.28 - w * 0.14
        let x = c.dir > 0 ? rawX : w - rawX
        let side = (0.05 + c.depth * 0.10) * h * b.size
        let y: Double
        if b.floor {
            y = duneY(x, h: h) - side * 0.42
        } else {
            y = (c.lane + sin(t * 0.001 * c.bobHz * 2 * .pi + c.bobPhase) * c.bobAmp) * h
        }
        return (x, y, side, 0.55 + c.depth * 0.45)
    }

    static func motePos(_ m: Mote, t: Double, w: Double, h: Double) -> (x: Double, y: Double) {
        let y = (m.y + t / 1000 * m.fall).truncatingRemainder(dividingBy: 1) * h * 0.92
        let x = (m.x + sin(t * 0.0004 + m.sway) * 0.01) * w
        return (x, y)
    }

    static func lanternPos(_ l: Lantern, t: Double, w: Double, h: Double) -> (x: Double, y: Double, glow: Double) {
        let raw = (l.x + t / 1000 * l.drift).truncatingRemainder(dividingBy: 1)
        let x = (raw < 0 ? raw + 1 : raw) * w
        return (x, l.y * h, 0.8 + 0.2 * sin(t * 0.0015 + l.pulse))
    }

    /// The shoal's centre at `t`: it crosses left to right on a slow wave.
    static func shoalCentre(lane: Double, speed: Double, t: Double, w: Double, h: Double) -> (x: Double, y: Double) {
        let travel = (t / (40_000 / speed)).truncatingRemainder(dividingBy: 1)
        return (travel * w * 1.4 - w * 0.2, (lane + 0.08 * sin(t * 0.00021)) * h)
    }

    static func shoalColors(_ kind: String) -> (body: (Double, Double, Double), mark: (Double, Double, Double)) {
        switch kind {
        case "rummynose": return ((0.85, 0.86, 0.80), (0.95, 0.20, 0.18))
        case "ember": return ((1.0, 0.45, 0.20), (1.0, 0.75, 0.40))
        default: return ((0.25, 0.75, 1.0), (0.95, 0.22, 0.25))   // neon
        }
    }
}

extension AquariumField.Palette {
    /// The room with the scene's authored overrides applied: geode interior,
    /// then the water (`fogColor`), then the floor (`floorColor`).
    func applying(_ p: AquariumParams) -> AquariumField.Palette {
        var out = self
        if p.interior == "geode" { out = .geode }
        if let fog = p.fogColor.flatMap(AquariumParams.hexRGB) {
            out.top = Color(red: fog.0 + (1 - fog.0) * 0.06, green: fog.1 + (1 - fog.1) * 0.06, blue: fog.2 + (1 - fog.2) * 0.06)
            out.mid = Color(red: fog.0, green: fog.1, blue: fog.2)
            out.deep = Color(red: fog.0 * 0.45, green: fog.1 * 0.45, blue: fog.2 * 0.45)
        }
        if let floor = p.floorColor.flatMap(AquariumParams.hexRGB) {
            out.dune = Color(red: floor.0, green: floor.1, blue: floor.2)
        }
        return out
    }

    /// A geode's cave: amethyst walls, no light from above.
    static let geode = AquariumField.Palette(
        top: Color(red: 0.10, green: 0.05, blue: 0.14), mid: Color(red: 0.06, green: 0.03, blue: 0.10),
        deep: Color(red: 0.02, green: 0.01, blue: 0.04), kelp: Color(red: 0.18, green: 0.10, blue: 0.26),
        dune: Color(red: 0.16, green: 0.10, blue: 0.20), shaft: Color(red: 0.76, green: 0.61, blue: 1.0), shaftAlpha: 0)
}
