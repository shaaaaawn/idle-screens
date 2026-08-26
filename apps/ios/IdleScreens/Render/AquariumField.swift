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
    struct Fish: Sendable {
        /// Asset index into `AquariumField.cast`.
        var icon: Int
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
    static let cast: [String] = [12, 100, 180, 257, 300, 340, 380, 420, 450, 457, 470, 488, 497, 505, 512]
        .map { "mqfish\($0)" }

    let fish: [Fish]
    let kelp: [Kelp]
    let bubbles: [BubbleColumn]

    static func fishCount(for tier: CapabilityTier) -> Int { tier == .t3 ? 13 : 8 }
    static func kelpCount(for tier: CapabilityTier) -> Int { tier == .t3 ? 5 : 3 }
    static func bubbleColumns(for tier: CapabilityTier) -> Int { tier == .t3 ? 3 : 2 }

    /// Cache keyed like the other fields: one identity per (seed, tier).
    private static let cache = Locked<[String: AquariumField]>([:])

    static func shared(seed: UInt32, tier: CapabilityTier) -> AquariumField {
        let key = "\(seed)-\(tier.rawValue)"
        return cache.withLock { store in
            if let hit = store[key] { return hit }
            let field = AquariumField(seed: seed, tier: tier)
            store[key] = field
            return field
        }
    }

    init(seed: UInt32, tier: CapabilityTier) {
        var rng = Mulberry32(seed: seed)
        let n = Self.fishCount(for: tier)
        var fish: [Fish] = []
        fish.reserveCapacity(n)
        for i in 0..<n {
            // Depth stratified, not random: every third of the tank gets
            // its share of near/mid/far so the parallax always reads.
            let depth = (Double(i % 3) + rng.next()) / 3.0
            fish.append(Fish(
                icon: Int(rng.next() * Double(Self.cast.count)) % Self.cast.count,
                depth: depth,
                lane: 0.12 + rng.next() * 0.68,
                // Near fish cross in ~18s, far in ~55s — After Dark pacing.
                period: (55_000 - depth * 37_000) * (0.85 + rng.next() * 0.3),
                phase: rng.next(),
                dir: rng.next() < 0.5 ? -1 : 1,
                bobAmp: 0.008 + rng.next() * 0.02,
                bobHz: 0.12 + rng.next() * 0.2,
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
        // surface would be. Cheap and calm — the fish are the show.
        let water = Gradient(stops: [
            .init(color: Color(red: 0.02, green: 0.10, blue: 0.16), location: 0),
            .init(color: Color(red: 0.01, green: 0.05, blue: 0.10), location: 0.45),
            .init(color: Color(red: 0.005, green: 0.025, blue: 0.06), location: 1),
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
                    .init(color: .white.opacity(0.05), location: 0),
                    .init(color: .white.opacity(0.0), location: 0.85),
                ]),
                startPoint: CGPoint(x: cx, y: 0), endPoint: CGPoint(x: cx, y: h)))
        }

        // Seabed: two soft dune bands.
        for (i, tone) in [(0, 0.10), (1, 0.16)] {
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
            ctx.fill(dune, with: .color(Color(red: 0.03, green: tone * 0.6, blue: tone)))
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
            ctx.stroke(path, with: .color(Color(red: 0.04, green: 0.22, blue: 0.13).opacity(0.85)),
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
            if f.dir < 0 { fctx.scaleBy(x: -1, y: 1) }
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
