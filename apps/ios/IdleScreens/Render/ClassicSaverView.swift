import SwiftUI

// MARK: - Native ports of classic savers
//
// Classic savers ({"id":"warp"}) have no schema layers, so historically the
// TV could only show their thumb stream. The ones live channels actually use
// are ported here as closed-form Canvas renderers: state is a pure function
// of (seed, t), matching the web's renderFrame purity — no accumulation, so
// pause/resume/seek can never drift.

/// Classic savers with a native tvOS renderer. Everything else stays on the
/// thumb stream.
enum ClassicSaverKind: String, CaseIterable, Sendable {
    case warp
    case rainstorm

    static func supported(id: String?) -> ClassicSaverKind? {
        id.flatMap(ClassicSaverKind.init(rawValue:))
    }
}

/// Fullscreen native renderer for a supported classic saver. 60fps Canvas —
/// t3 hardware only; callers gate on tier.
struct ClassicSaverView: View {
    let kind: ClassicSaverKind
    let seed: Int

    var body: some View {
        TimelineView(.animation) { timeline in
            Canvas { ctx, size in
                let t = timeline.date.timeIntervalSinceReferenceDate
                    .truncatingRemainder(dividingBy: 100_000) * 1000 // ms, bounded
                switch kind {
                case .warp:
                    WarpField.shared(seed: UInt32(truncatingIfNeeded: seed))
                        .draw(in: &ctx, size: size, t: t)
                case .rainstorm:
                    RainField.shared(seed: UInt32(truncatingIfNeeded: seed))
                        .draw(in: &ctx, size: size, t: t)
                }
            }
        }
        .ignoresSafeArea()
    }
}

// MARK: - Warp (port of savers-classic/src/warp.ts)

/// The starfield's fixed identity plus its pure closed-form draw. Star i's
/// stream is forked exactly like the web engine (`seed ^ imul(i+1, phi)`),
/// so the same channel seed shows the same field on every platform.
struct WarpField: Sendable {
    struct Star: Sendable, Equatable {
        var x: Double      // -1..1 field direction
        var y: Double
        var phase: Double  // 0..1 travel offset
        var twinklePhase: Double
        var twinklePeriod: Double // ms, >= 800
    }

    let stars: [Star]

    /// Progress per ms at speed 1 — a full traversal takes ~1.4s (web parity).
    static let baseRate = 0.000727
    static let fadeInEnd = 0.15
    static let fadeOutStart = 0.94
    static let density = 520

    init(seed: UInt32, count: Int = WarpField.density) {
        stars = (0..<count).map { i in
            // Web: fork(salt) = mulberry32(seed ^ imul(salt+1, 0x9e3779b9))
            var rng = Mulberry32(seed: seed ^ (UInt32(truncatingIfNeeded: i + 1) &* 0x9E37_79B9))
            let x = rng.next() * 2 - 1
            let y = rng.next() * 2 - 1
            let phase = rng.next()
            let twinklePhase = rng.next() * 2 * .pi
            let twinklePeriod = 800 + rng.next() * 1000
            return Star(x: x, y: y, phase: phase,
                        twinklePhase: twinklePhase, twinklePeriod: twinklePeriod)
        }
    }

    /// Building 520 forked streams is cheap but not per-frame cheap; one
    /// field per seed is plenty (the view outlives the channel).
    private static let cache = Locked<[UInt32: WarpField]>([:])
    static func shared(seed: UInt32) -> WarpField {
        cache.withLock { store in
            if let field = store[seed] { return field }
            let field = WarpField(seed: seed)
            // The saver shows one seed at a time; keep the cache tiny.
            if store.count > 4 { store.removeAll() }
            store[seed] = field
            return field
        }
    }

    static func smoothstep01(_ x: Double) -> Double {
        let c = min(1, max(0, x))
        return c * c * (3 - 2 * c)
    }

    /// Opacity envelope over travel progress: fade in over the first 15%,
    /// out over the last 6%, so spawning and recycling are invisible.
    static func fadeEnvelope(_ p: Double) -> Double {
        var e = 1.0
        if p < fadeInEnd { e *= smoothstep01(p / fadeInEnd) }
        if p > fadeOutStart { e *= smoothstep01((1 - p) / (1 - fadeOutStart)) }
        return e
    }

    /// A star's travel progress at time t (ms) — pure, no accumulation.
    static func progress(phase: Double, t: Double, rate: Double) -> Double {
        let v = phase + t * rate
        return v - v.rounded(.down)
    }

    func draw(in ctx: inout GraphicsContext, size: CGSize, t: Double,
              speed: Double = 1, streak: Double = 0.4, twinkle: Double = 0.3) {
        let w = size.width, h = size.height
        let cx = w / 2, cy = h / 2
        let focal = min(w, h) * 0.9
        let rate = Self.baseRate * speed
        let streakDt = 16 * (1 + streak * 5)

        ctx.fill(Path(CGRect(origin: .zero, size: size)),
                 with: .color(Color(.sRGB, red: 17 / 255, green: 17 / 255, blue: 17 / 255)))

        for s in stars {
            let prog = Self.progress(phase: s.phase, t: t, rate: rate)
            let z = 1 - prog * 0.99
            let sx = cx + (s.x / z) * focal
            let sy = cy + (s.y / z) * focal

            var progPrev = Self.progress(phase: s.phase, t: t - streakDt, rate: rate)
            if progPrev > prog { progPrev = prog } // wrapped mid-interval
            let zPrev = 1 - progPrev * 0.99
            let px = cx + (s.x / zPrev) * focal
            let py = cy + (s.y / zPrev) * focal

            // Cull only when BOTH streak ends are off-screen — a long streak
            // can have its head out while the tail is still visible.
            let headOut = sx < -50 || sx > w + 50 || sy < -50 || sy > h + 50
            let tailOut = px < -50 || px > w + 50 || py < -50 || py > h + 50
            if headOut && tailOut { continue }

            let envelope = Self.fadeEnvelope(prog)
            let shimmer = 1 + twinkle * 0.4 * sin(2 * .pi * t / s.twinklePeriod + s.twinklePhase)
            let alpha = min(1, max(0, (0.15 + prog * 1.1) * envelope * shimmer))
            if alpha <= 0.002 { continue }
            let lineWidth = max(0.4, prog * 2.6)

            var path = Path()
            path.move(to: CGPoint(x: px, y: py))
            path.addLine(to: CGPoint(x: sx, y: sy))
            ctx.stroke(path, with: .color(.white.opacity(alpha)),
                       style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
        }
    }
}

// MARK: - Rainstorm (port of savers-classic/src/rainstorm.ts)

/// Three parallax depths of angled rain over a near-black sky with a gentle
/// 8s lightning pulse. The web version accumulates positions per frame; this
/// port is closed-form — each drop's position is a pure function of t — so
/// it can never drift from a dropped frame.
struct RainField: Sendable {
    struct Drop: Sendable {
        var x0: Double
        var y0: Double
        var len: Double
        var speed: Double  // px/s vertical
        var width: Double
        var alpha: Double
    }

    struct Layer: Sendable {
        var drops: [Drop]
        var slant: Double
    }

    let layers: [Layer]

    static let flashPeriod = 8000.0 // ms

    /// Depth specs mirror the web's r1/r2, r3/r4, r5/r6 tiers, built for a
    /// 1920×1080 canvas (the TV never resizes mid-flight).
    init(seed: UInt32, width w: Double = 1920, height h: Double = 1080) {
        var rng = Mulberry32(seed: seed)
        let area = (w * h) / (1280 * 800)
        let specs: [(count: Double, minLen: Double, maxLen: Double,
                     minSpd: Double, maxSpd: Double, width: Double,
                     alpha: Double, slant: Double)] = [
            (220, 26, 46, 900, 1150, 1.6, 0.5, 0.19),
            (160, 16, 30, 520, 700, 1.2, 0.34, 0.19),
            (120, 10, 20, 300, 420, 0.9, 0.22, 0.19),
        ]
        layers = specs.map { s in
            // Cap the area scale: the web grows counts unbounded with canvas
            // size; ~1000 strokes/frame is past the TV Canvas budget.
            let n = max(8, Int((s.count * min(area, 1.35)).rounded()))
            let drops = (0..<n).map { _ -> Drop in
                Drop(x0: rng.next() * (w + 80) - 40,
                     y0: rng.next() * (2 * h) - h,
                     len: s.minLen + rng.next() * (s.maxLen - s.minLen),
                     speed: s.minSpd + rng.next() * (s.maxSpd - s.minSpd),
                     width: s.width,
                     alpha: s.alpha * (0.7 + rng.next() * 0.3))
            }
            return Layer(drops: drops, slant: s.slant)
        }
    }

    private static let cache = Locked<[UInt32: RainField]>([:])
    static func shared(seed: UInt32) -> RainField {
        cache.withLock { store in
            if let field = store[seed] { return field }
            let field = RainField(seed: seed)
            if store.count > 4 { store.removeAll() }
            store[seed] = field
            return field
        }
    }

    /// 0..1 lightning intensity at time t — a ~140ms pulse at the top of each
    /// 8s period (fast ramp, slower decay). Web parity, pure.
    static func flashLevel(at t: Double) -> Double {
        let p = t.truncatingRemainder(dividingBy: flashPeriod)
        let start = flashPeriod - 140
        guard p >= start else { return 0 }
        let k = (p - start) / 140
        return k < 0.4 ? k / 0.4 : max(0, 1 - (k - 0.4) / 0.6)
    }

    /// Drop position at t (ms) — closed-form wrap over the fall span.
    static func position(of d: Drop, slant: Double, t: Double,
                         width w: Double, height h: Double) -> CGPoint {
        let tSec = t / 1000
        let span = h + d.len * 2 + h * 0.2
        var y = (d.y0 + d.speed * tSec).truncatingRemainder(dividingBy: span)
        if y < 0 { y += span }
        y -= d.len // enter above the top edge
        let xSpan = w + 80
        var x = (d.x0 + d.speed * slant * tSec).truncatingRemainder(dividingBy: xSpan)
        if x < 0 { x += xSpan }
        x -= 40
        return CGPoint(x: x, y: y)
    }

    func draw(in ctx: inout GraphicsContext, size: CGSize, t: Double) {
        let w = size.width, h = size.height
        let flash = Self.flashLevel(at: t)
        let base = (8 + flash * 235) / 255
        ctx.fill(Path(CGRect(origin: .zero, size: size)),
                 with: .color(Color(.sRGB, red: base, green: base + 2 / 255,
                                    blue: base + 8 / 255)))

        let rain = Color(.sRGB, red: 200 / 255, green: 215 / 255, blue: 235 / 255)
        for layer in layers {
            let dx = -layer.slant
            for d in layer.drops {
                let p = Self.position(of: d, slant: layer.slant, t: t, width: w, height: h)
                var path = Path()
                path.move(to: p)
                path.addLine(to: CGPoint(x: p.x + dx * d.len, y: p.y - d.len))
                ctx.stroke(path, with: .color(rain.opacity(d.alpha)),
                           style: StrokeStyle(lineWidth: d.width, lineCap: .round))
            }
        }
    }
}

// MARK: - Small lock (fields are built off the main render path)

/// Minimal Sendable lock box — `os_unfair_lock` semantics via NSLock, enough
/// for the tiny per-seed field caches above.
final class Locked<Value>: @unchecked Sendable {
    private var value: Value
    private let lock = NSLock()

    init(_ value: Value) { self.value = value }

    func withLock<R>(_ body: (inout Value) -> R) -> R {
        lock.lock()
        defer { lock.unlock() }
        return body(&value)
    }
}
