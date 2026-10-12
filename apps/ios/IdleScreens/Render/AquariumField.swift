import SwiftUI

// MARK: - Aquarium (native metaquarium port, After Dark lineage)
//
// Metaquarium channels ({"id":"metaquarium"}) render three.js tanks on the
// web; the TV has no WebKit, so until now they fell to the thumb stream.
// This is the scaled-down native answer: the collection's own 2D art — every
// minted fish ships a `_transparent_icon.png`, a flat pixel side view of its
// exact voxel pattern — swimming a layered, closed-form 2D tank in the
// spirit of the classic After Dark aquarium.
//
// Same laws as every native port here: state is a pure function of
// (seed, t) — lanes, speeds, wraps, bubbles and kelp sway all evaluate
// closed-form, so pause/resume/seek can never drift, and the poster tile is
// just draw(t: posterT).
struct AquariumField: Sendable {
    /// Minted breed by token-id range — each swims its own way. The turtle
    /// icons are TOP-DOWN art (head up); translating them sideways like a
    /// side-view fish made them float wrong, which is what breed motion fixes.
    enum Breed: Sendable {
        case beta, angel, seahorse, turtle

        static func of(id: Int) -> Breed {
            switch id {
            case ...256: return .beta
            case ...456: return .angel
            case ...496: return .seahorse
            default: return .turtle
            }
        }
    }

    /// The room, interpreted from the channel's own `environment` track param
    /// — a vent channel reads ember on the TV too. Palettes are the After
    /// Dark translation of the web tank's rooms, not literal copies.
    struct Palette: Sendable {
        var top: Color
        var mid: Color
        var deep: Color
        var kelp: Color
        var dune: Color
        var shaft: Color
        var shaftAlpha: Double

        static let byEnvironment: [String: Palette] = [
            "abyss": Palette(top: Color(red: 0.01, green: 0.02, blue: 0.07), mid: Color(red: 0.005, green: 0.012, blue: 0.045), deep: .black, kelp: Color(red: 0.02, green: 0.10, blue: 0.09), dune: Color(red: 0.02, green: 0.03, blue: 0.07), shaft: Color(red: 0.06, green: 0.29, blue: 0.43), shaftAlpha: 0.04),
            "reef": Palette(top: Color(red: 0.03, green: 0.16, blue: 0.24), mid: Color(red: 0.02, green: 0.09, blue: 0.16), deep: Color(red: 0.01, green: 0.05, blue: 0.10), kelp: Color(red: 0.05, green: 0.26, blue: 0.15), dune: Color(red: 0.06, green: 0.14, blue: 0.16), shaft: .white, shaftAlpha: 0.06),
            "kelp": Palette(top: Color(red: 0.03, green: 0.15, blue: 0.11), mid: Color(red: 0.02, green: 0.10, blue: 0.08), deep: Color(red: 0.01, green: 0.05, blue: 0.04), kelp: Color(red: 0.07, green: 0.30, blue: 0.16), dune: Color(red: 0.04, green: 0.11, blue: 0.08), shaft: Color(red: 0.62, green: 0.96, blue: 0.81), shaftAlpha: 0.05),
            "ice": Palette(top: Color(red: 0.12, green: 0.22, blue: 0.32), mid: Color(red: 0.05, green: 0.12, blue: 0.20), deep: Color(red: 0.02, green: 0.06, blue: 0.12), kelp: Color(red: 0.10, green: 0.22, blue: 0.20), dune: Color(red: 0.10, green: 0.20, blue: 0.28), shaft: .white, shaftAlpha: 0.08),
            "vent": Palette(top: Color(red: 0.11, green: 0.03, blue: 0.02), mid: Color(red: 0.07, green: 0.02, blue: 0.015), deep: Color(red: 0.03, green: 0.008, blue: 0.006), kelp: Color(red: 0.16, green: 0.07, blue: 0.03), dune: Color(red: 0.22, green: 0.09, blue: 0.04), shaft: Color(red: 1.0, green: 0.48, blue: 0.24), shaftAlpha: 0.05),
            "lagoon": Palette(top: Color(red: 0.04, green: 0.24, blue: 0.21), mid: Color(red: 0.03, green: 0.15, blue: 0.14), deep: Color(red: 0.25, green: 0.14, blue: 0.19), kelp: Color(red: 0.07, green: 0.28, blue: 0.16), dune: Color(red: 0.36, green: 0.22, blue: 0.29), shaft: Color(red: 1.0, green: 0.95, blue: 0.69), shaftAlpha: 0.06),
            "universe": Palette(top: Color(red: 0.06, green: 0.03, blue: 0.11), mid: Color(red: 0.04, green: 0.02, blue: 0.08), deep: Color(red: 0.015, green: 0.008, blue: 0.04), kelp: Color(red: 0.10, green: 0.07, blue: 0.20), dune: Color(red: 0.09, green: 0.06, blue: 0.16), shaft: Color(red: 0.76, green: 0.61, blue: 1.0), shaftAlpha: 0.05),
        ]

        static let base = Palette(
            top: Color(red: 0.02, green: 0.10, blue: 0.16),
            mid: Color(red: 0.01, green: 0.05, blue: 0.10),
            deep: Color(red: 0.005, green: 0.025, blue: 0.06),
            kelp: Color(red: 0.04, green: 0.22, blue: 0.13),
            dune: Color(red: 0.03, green: 0.06, blue: 0.10),
            shaft: .white, shaftAlpha: 0.05)

        static func of(_ environment: String?) -> Palette {
            environment.flatMap { byEnvironment[$0] } ?? base
        }
    }

    struct Fish: Sendable {
        /// Asset index into `AquariumField.cast`.
        var icon: Int
        var breed: Breed
        /// Depth 0 (far) .. 1 (near) — drives size, speed, dim and lane band.
        var depth: Double
        /// Vertical lane centre, fraction of height.
        var lane: Double
        /// Horizontal traversal period, ms for one full crossing.
        var period: Double
        /// Travel offset 0..1 so the tank starts mid-life, never in a spawn line.
        var phase: Double
        /// +1 swims right, -1 swims left (icons face right at +1).
        var dir: Double
        /// Bob amplitude (fraction of height) and rate (Hz).
        var bobAmp: Double
        var bobHz: Double
        var bobPhase: Double
    }

    struct Kelp: Sendable {
        var x: Double          // fraction of width
        var height: Double     // fraction of height
        var width: Double      // stroke width, px at 1080p
        var swayPhase: Double
        var segments: Int
    }

    struct BubbleColumn: Sendable {
        var x: Double
        var period: Double     // ms between bubbles
        var phase: Double
        var drift: Double      // sideways sway amplitude, fraction of width
    }

    /// The bundled cast — a curated slice of the 512, one imageset each.
    /// Ids chosen for silhouette variety across all four minted breeds.
    static let castIds: [Int] = [12, 100, 180, 257, 300, 340, 380, 420, 450, 457, 470, 488, 497, 505, 512]
    static let cast: [String] = castIds.map { "mqfish\($0)" }

    /// A scene's `fishMix` ("id[:count],breed[:count],…") interpreted against
    /// the bundled cast: exact id when bundled, else the nearest bundled fish
    /// of the SAME breed — the scene's species balance survives even when its
    /// exact mints aren't on disk. Returns cast indices, one per fish.
    static func castIndices(fishMix: String?, cap: Int) -> [Int]? {
        guard let mix = fishMix, !mix.isEmpty else { return nil }
        var out: [Int] = []
        for token in mix.split(separator: ",") {
            let parts = token.split(separator: ":")
            guard let head = parts.first?.trimmingCharacters(in: .whitespaces), !head.isEmpty else { continue }
            let count = parts.count > 1 ? min(24, max(1, Int(parts[1]) ?? 1)) : 1
            let wantBreed: Breed?
            let wantId: Int?
            if let id = Int(head), (1...512).contains(id) {
                wantId = id; wantBreed = Breed.of(id: id)
            } else {
                wantId = nil
                switch head.lowercased() {
                case "betafish": wantBreed = .beta
                case "angelfish": wantBreed = .angel
                case "seahorse": wantBreed = .seahorse
                case "seaturtle": wantBreed = .turtle
                default: wantBreed = nil
                }
            }
            guard let breed = wantBreed else { continue }
            // Exact bundled id, else nearest bundled id in the same breed.
            let idx: Int
            if let id = wantId, let exact = castIds.firstIndex(of: id) {
                idx = exact
            } else {
                let sameBreed = castIds.enumerated().filter { Breed.of(id: $0.element) == breed }
                guard !sameBreed.isEmpty else { continue }
                let target = wantId ?? sameBreed[0].element
                idx = sameBreed.min(by: { abs($0.element - target) < abs($1.element - target) })!.offset
            }
            for _ in 0..<count where out.count < cap { out.append(idx) }
        }
        return out.isEmpty ? nil : out
    }

    let fish: [Fish]
    let kelp: [Kelp]
    let bubbles: [BubbleColumn]
    let palette: Palette

    static func fishCount(for tier: CapabilityTier) -> Int { tier == .t3 ? 13 : 8 }
    static func kelpCount(for tier: CapabilityTier) -> Int { tier == .t3 ? 5 : 3 }
    static func bubbleColumns(for tier: CapabilityTier) -> Int { tier == .t3 ? 3 : 2 }

    /// Cache keyed like the other fields: one identity per (seed, tier).
    private static let cache = Locked<[String: AquariumField]>([:])

    static func shared(
        seed: UInt32, tier: CapabilityTier, environment: String? = nil, fishMix: String? = nil,
    ) -> AquariumField {
        let key = "\(seed)-\(tier.rawValue)-\(environment ?? "")-\(fishMix ?? "")"
        return cache.withLock { store in
            if let hit = store[key] { return hit }
            if store.count > 6 { store.removeAll() }
            let field = AquariumField(seed: seed, tier: tier, environment: environment, fishMix: fishMix)
            store[key] = field
            return field
        }
    }

    init(seed: UInt32, tier: CapabilityTier, environment: String? = nil, fishMix: String? = nil) {
        self.palette = Palette.of(environment)
        var rng = Mulberry32(seed: seed)
        let n = Self.fishCount(for: tier)
        var fish: [Fish] = []
        fish.reserveCapacity(n)
        // A scene's fishMix picks the cast; otherwise the seed does.
        let sceneCast = Self.castIndices(fishMix: fishMix, cap: n)
        for i in 0..<n {
            // Depth stratified, not random: every third of the tank gets
            // its share of near/mid/far so the parallax always reads.
            let depth = (Double(i % 3) + rng.next()) / 3.0
            let icon = sceneCast.map { $0[i % $0.count] }
                ?? Int(rng.next() * Double(Self.cast.count)) % Self.cast.count
            let breed = Breed.of(id: Self.castIds[icon])
            // Near fish cross in ~18s, far in ~55s — After Dark pacing —
            // then each breed sets its own tempo and posture.
            var period = (55_000 - depth * 37_000) * (0.85 + rng.next() * 0.3)
            var bobAmp = 0.008 + rng.next() * 0.02
            var bobHz = 0.12 + rng.next() * 0.2
            switch breed {
            case .beta:
                period *= 0.8                       // quick little fish
            case .angel:
                break                               // the baseline
            case .seahorse:
                period *= 1.8                       // barely travels...
                bobAmp = 0.03 + rng.next() * 0.03   // ...mostly rides the water
                bobHz = 0.08 + rng.next() * 0.08
            case .turtle:
                period *= 1.6                       // unhurried glide
                bobAmp *= 0.6                       // steady, not bobbly
            }
            fish.append(Fish(
                icon: icon,
                breed: breed,
                depth: depth,
                lane: 0.12 + rng.next() * 0.68,
                period: period,
                phase: rng.next(),
                dir: rng.next() < 0.5 ? -1 : 1,
                bobAmp: bobAmp,
                bobHz: bobHz,
                bobPhase: rng.next() * .pi * 2
            ))
        }
        // Near fish draw last (on top).
        self.fish = fish.sorted { $0.depth < $1.depth }

        var kelp: [Kelp] = []
        for _ in 0..<Self.kelpCount(for: tier) {
            kelp.append(Kelp(
                x: 0.04 + rng.next() * 0.92,
                height: 0.22 + rng.next() * 0.3,
                width: 10 + rng.next() * 14,
                swayPhase: rng.next() * .pi * 2,
                segments: 5
            ))
        }
        self.kelp = kelp

        var bubbles: [BubbleColumn] = []
        for _ in 0..<Self.bubbleColumns(for: tier) {
            bubbles.append(BubbleColumn(
                x: 0.08 + rng.next() * 0.84,
                period: 2_600 + rng.next() * 2_400,
                phase: rng.next(),
                drift: 0.006 + rng.next() * 0.012
            ))
        }
        self.bubbles = bubbles
    }

    // MARK: draw

    func draw(in ctx: inout GraphicsContext, size: CGSize, t: Double, tier: CapabilityTier) {
        let w = size.width, h = size.height

        // Water: a deep vertical gradient, lighter band up top where the
        // surface would be. Cheap and calm — the fish are the show. The
        // palette is the channel's environment, interpreted.
        let water = Gradient(stops: [
            .init(color: palette.top, location: 0),
            .init(color: palette.mid, location: 0.45),
            .init(color: palette.deep, location: 1),
        ])
        ctx.fill(Path(CGRect(origin: .zero, size: size)),
                 with: .linearGradient(water, startPoint: .zero, endPoint: CGPoint(x: 0, y: h)))

        // Light shafts: two slow additive wedges. Faint — light through
        // water, not stage spots (the tank learned this the hard way).
        for i in 0..<2 {
            let phase = t * 0.000021 + Double(i) * 2.4
            let cx = w * (0.3 + 0.4 * Double(i)) + sin(phase) * w * 0.05
            var shaft = Path()
            shaft.move(to: CGPoint(x: cx - w * 0.02, y: -8))
            shaft.addLine(to: CGPoint(x: cx + w * 0.02, y: -8))
            shaft.addLine(to: CGPoint(x: cx + w * 0.16, y: h))
            shaft.addLine(to: CGPoint(x: cx - w * 0.16, y: h))
            shaft.closeSubpath()
            ctx.fill(shaft, with: .linearGradient(
                Gradient(stops: [
                    .init(color: palette.shaft.opacity(palette.shaftAlpha), location: 0),
                    .init(color: palette.shaft.opacity(0.0), location: 0.85),
                ]),
                startPoint: CGPoint(x: cx, y: 0), endPoint: CGPoint(x: cx, y: h)))
        }

        // Seabed: two soft dune bands in the room's own ground color.
        for (i, tone) in [(0, 0.55), (1, 1.0)] {
            let baseY = h * (0.88 + 0.05 * Double(i))
            var dune = Path()
            dune.move(to: CGPoint(x: 0, y: h))
            dune.addLine(to: CGPoint(x: 0, y: baseY))
            var x = 0.0
            while x <= Double(w) {
                let y = Double(baseY) + sin(x * 0.004 + Double(i) * 2.1) * Double(h) * 0.018
                dune.addLine(to: CGPoint(x: x, y: y))
                x += 24
            }
            dune.addLine(to: CGPoint(x: w, y: h))
            dune.closeSubpath()
            ctx.fill(dune, with: .color(palette.dune.opacity(tone)))
        }

        // Kelp: swaying closed-form strands rooted in the seabed.
        for strand in kelp {
            let rootX = strand.x * w
            let rootY = h * 0.94
            let top = rootY - strand.height * h
            var path = Path()
            path.move(to: CGPoint(x: rootX, y: rootY))
            let segs = strand.segments
            for s in 1...segs {
                let f = Double(s) / Double(segs)
                let sway = sin(t * 0.00045 + strand.swayPhase + f * 1.8)
                    * strand.height * h * 0.12 * f
                path.addLine(to: CGPoint(x: rootX + sway, y: rootY - f * (rootY - top)))
            }
            ctx.stroke(path, with: .color(palette.kelp.opacity(0.85)),
                       style: StrokeStyle(lineWidth: strand.width * (h / 1080), lineCap: .round, lineJoin: .round))
        }

        // Fish: the cast, far to near. Icons face right; leftward swimmers
        // mirror. Position is pure f(t): wrap of phase + t/period.
        for f in fish {
            guard let img = UIImage(named: Self.cast[f.icon]) else { continue }
            let travel = (f.phase + t / f.period).truncatingRemainder(dividingBy: 1)
            // 14% off-screen margin each side so entries/exits are complete.
            let span = Double(w) * 1.28
            let rawX = travel * span - Double(w) * 0.14
            let x = f.dir > 0 ? rawX : Double(w) - rawX
            let bob = sin(t * 0.001 * f.bobHz * 2 * .pi + f.bobPhase) * f.bobAmp
            let y = (f.lane + bob) * Double(h)
            // Near fish ~15% of height, far ~5%.
            let side = (0.05 + f.depth * 0.10) * Double(h)
            let dim = 0.55 + f.depth * 0.45
            let resolved = ctx.resolve(Image(uiImage: img))
            var fctx = ctx
            fctx.opacity = dim
            fctx.translateBy(x: x, y: y)
            switch f.breed {
            case .turtle:
                // Turtle icons are TOP-DOWN art, head up. Rotate the shell to
                // face travel and add a slow paddle rock — translating the
                // head-up art sideways read as a turtle floating wrong.
                let rock = sin(t * 0.0012 + f.bobPhase) * 0.10
                fctx.rotate(by: .radians((f.dir > 0 ? .pi / 2 : -.pi / 2) + rock))
            case .seahorse:
                // Upright drifters: never mirrored sideways momentum — just a
                // gentle current sway around vertical.
                if f.dir < 0 { fctx.scaleBy(x: -1, y: 1) }
                fctx.rotate(by: .radians(sin(t * 0.0009 + f.bobPhase) * 0.14))
            case .angel:
                if f.dir < 0 { fctx.scaleBy(x: -1, y: 1) }
                fctx.rotate(by: .radians(sin(t * 0.0011 + f.bobPhase) * 0.05))
            case .beta:
                if f.dir < 0 { fctx.scaleBy(x: -1, y: 1) }
            }
            fctx.draw(resolved, in: CGRect(x: -side / 2, y: -side / 2, width: side, height: side))
        }

        // Bubbles: columns of rising circles, spawn cadence and rise both
        // closed-form; each bubble is addressed by its emission index.
        for col in bubbles {
            let baseX = col.x * w
            let riseMs = 6_000.0
            let count = tier == .t3 ? 5 : 3
            for b in 0..<count {
                let cycle = t / col.period + col.phase + Double(b) * (riseMs / col.period / Double(count))
                let f = cycle.truncatingRemainder(dividingBy: riseMs / col.period)
                    / (riseMs / col.period)
                guard f > 0 else { continue }
                let y = Double(h) * 0.92 * (1 - f)
                let x = baseX + CGFloat(sin(f * 9 + col.phase * 6) * col.drift * w)
                let r = 2.5 + f * 5.5
                ctx.stroke(Path(ellipseIn: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2)),
                           with: .color(.white.opacity(0.28 * (1 - f * 0.6))),
                           style: StrokeStyle(lineWidth: 1.4))
            }
        }
    }
}
