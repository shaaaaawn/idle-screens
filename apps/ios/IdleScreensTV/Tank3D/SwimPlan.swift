import Foundation

/// packages/core `createRng` with its `fork`: the splitmix32 stream SpecRng
/// runs, plus the seed it was created from — `fork(salt)` derives a fresh
/// stream from that seed, not from the current state, exactly as the web does.
struct TankRng: Sendable {
    let seed: UInt32
    private var a: UInt32

    init(seed: UInt32) { self.seed = seed; a = seed }

    mutating func next() -> Double {
        a = a &+ 0x9E37_79B9
        var t = a ^ (a >> 16)
        t = t &* 0x21F0_AAAD
        t ^= t >> 15
        t = t &* 0x735A_2D97
        t ^= t >> 15
        return Double(t) / 4_294_967_296
    }

    mutating func range(_ lo: Double, _ hi: Double) -> Double { lo + (hi - lo) * next() }
    mutating func int(_ lo: Int, _ hi: Int) -> Int { lo + Int((next() * Double(hi - lo + 1)).rounded(.down)) }

    /// `(seed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0`.
    func fork(_ salt: Int) -> TankRng {
        TankRng(seed: seed ^ (UInt32(truncatingIfNeeded: salt &+ 1) &* 0x9E37_79B9))
    }
}

/// Port of packages/saver-metaquarium `plan.ts`: a seeded closed Catmull-Rom
/// loop with an arc-length table and a closed-form speed integral, so a
/// fish's pose is a pure function of (plan, t) — the same seed swims the same
/// route as the web tank.
struct SwimPlan: Sendable {
    struct Bounds: Sendable { var radius: Double; var yMin: Double; var yMax: Double }
    /// tank.ts `BOUNDS`.
    static let tank = Bounds(radius: 120, yMin: 15, yMax: 72)

    enum Shape: String, CaseIterable, Sendable { case wander, orbit, eight, helix, canyon, crossing }

    struct Pose: Equatable, Sendable {
        var x, y, z: Double
        /// Unit forward tangent.
        var fx, fy, fz: Double
        /// Bank roll (radians), into horizontal turns.
        var roll: Double
        var dist: Double
    }

    static let arcSamples = 1024

    var points: [SIMD3<Double>]
    /// Cumulative length at `arcSamples + 1` uniform params — a Float32Array
    /// on the web, so stored as Float to pick the same samples.
    var arc: [Float]
    var totalLength: Double
    var cruise: Double
    var wobble: [(amp: Double, w: Double, phase: Double)]

    init(rng: TankRng, bounds: Bounds = SwimPlan.tank, shape: Shape = .wander, cameraAzimuthDeg: Double = 0) {
        var rng = rng
        let pts = Self.waypoints(shape, &rng, bounds, cameraAzimuthDeg)
        let n = Double(pts.count)
        var arc = [Float](repeating: 0, count: Self.arcSamples + 1)
        var prev = Self.splineAt(pts, 0)
        var total = 0.0
        for s in 1...Self.arcSamples {
            let p = Self.splineAt(pts, Double(s) / Double(Self.arcSamples) * n)
            let d = p - prev
            total += (d.x * d.x + d.y * d.y + d.z * d.z).squareRoot()
            arc[s] = Float(total)
            prev = p
        }
        let cruise = 8 + rng.range(0, 4)
        var wobble: [(amp: Double, w: Double, phase: Double)] = []
        let w0 = 0.11 + rng.range(0, 0.05), p0 = rng.range(0, .pi * 2)
        wobble.append((cruise * 0.18, w0, p0))
        let w1 = 0.043 + rng.range(0, 0.02), p1 = rng.range(0, .pi * 2)
        wobble.append((cruise * 0.1, w1, p1))
        self.points = pts; self.arc = arc; self.totalLength = total
        self.cruise = cruise; self.wobble = wobble
    }

    /// Distance travelled by `t` seconds at `speed` scale — closed form.
    func distance(at t: Double, speed: Double = 1) -> Double {
        var d = cruise * t
        for h in wobble { d += (h.amp / h.w) * (cos(h.phase) - cos(h.w * t + h.phase)) }
        return d * speed
    }

    func pose(at t: Double, speed: Double = 1) -> Pose { pose(atDistance: distance(at: t, speed: speed)) }

    func pose(atDistance dist: Double) -> Pose {
        let g = param(forDistance: dist)
        let p = Self.splineAt(points, g)
        let n = Double(points.count)
        let step = n / Double(Self.arcSamples) * 8
        let ahead = Self.splineAt(points, g + step)
        let behind = Self.splineAt(points, g - step + n)
        var f = ahead - behind
        let m = (f.x * f.x + f.y * f.y + f.z * f.z).squareRoot()
        f /= (m == 0 ? 1 : m)
        let h0 = atan2(p.z - behind.z, p.x - behind.x)
        let h1 = atan2(ahead.z - p.z, ahead.x - p.x)
        var turn = h1 - h0
        if turn > .pi { turn -= .pi * 2 }
        if turn < -.pi { turn += .pi * 2 }
        let roll = max(-0.35, min(0.35, turn * 3.5))
        return Pose(x: p.x, y: p.y, z: p.z, fx: f.x, fy: f.y, fz: f.z, roll: roll, dist: dist)
    }

    private func param(forDistance dist: Double) -> Double {
        let n = Double(points.count)
        // JS `%` keeps the dividend's sign; fmod does too.
        let d = fmod(fmod(dist, totalLength) + totalLength, totalLength)
        var lo = 0, hi = Self.arcSamples
        while lo + 1 < hi {
            let mid = (lo + hi) >> 1
            if Double(arc[mid]) <= d { lo = mid } else { hi = mid }
        }
        let seg = Double(arc[hi]) - Double(arc[lo])
        let frac = (d - Double(arc[lo])) / (seg == 0 ? 1 : seg)
        return (Double(lo) + frac) / Double(Self.arcSamples) * n
    }

    private static func catmullRom(_ p0: Double, _ p1: Double, _ p2: Double, _ p3: Double, _ u: Double) -> Double {
        let u2 = u * u, u3 = u2 * u
        return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
    }

    static func splineAt(_ pts: [SIMD3<Double>], _ g: Double) -> SIMD3<Double> {
        let n = pts.count
        let fl = g.rounded(.down)
        let i = ((Int(fl) % n) + n) % n
        let u = g - fl
        let p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n]
        return SIMD3(catmullRom(p0.x, p1.x, p2.x, p3.x, u),
                     catmullRom(p0.y, p1.y, p2.y, p3.y, u),
                     catmullRom(p0.z, p1.z, p2.z, p3.z, u))
    }

    // swiftlint:disable:next function_body_length
    private static func waypoints(_ shape: Shape, _ rng: inout TankRng, _ b: Bounds, _ azDeg: Double) -> [SIMD3<Double>] {
        var pts: [SIMD3<Double>] = []
        let ySpan = b.yMax - b.yMin
        switch shape {
        case .crossing:
            let n = 16
            let az = azDeg * .pi / 180
            let rx = cos(az), rz = -sin(az), dx = sin(az), dz = cos(az)
            let len = b.radius * 0.9
            let depth = b.radius * rng.range(0.18, 0.3)
            let y0 = b.yMin + ySpan * rng.range(0.35, 0.6)
            let lift = ySpan * rng.range(0.04, 0.1)
            for i in 0..<n {
                let u = Double(i) / Double(n) * .pi * 2
                let along = sin(u) * len, toward = cos(u) * depth
                let y = y0 + (toward < 0 ? lift : 0) + ySpan * rng.range(0, 0.04)
                pts.append(SIMD3(rx * along + dx * toward, y, rz * along + dz * toward))
            }
        case .orbit:
            let n = 14 + rng.int(0, 4)
            let r0 = b.radius * rng.range(0.45, 0.8)
            let y0 = b.yMin + ySpan * rng.range(0.25, 0.75)
            let dir: Double = rng.next() < 0.5 ? 1 : -1
            for i in 0..<n {
                let a = dir * (Double(i) / Double(n)) * .pi * 2
                let r = r0 * (1 + rng.range(-0.08, 0.08))
                let y = y0 + ySpan * rng.range(-0.08, 0.08)
                pts.append(SIMD3(cos(a) * r, y, sin(a) * r))
            }
        case .eight:
            let n = 20 + rng.int(0, 4)
            let rx = b.radius * rng.range(0.6, 0.85)
            let rz = b.radius * rng.range(0.35, 0.55)
            let y0 = b.yMin + ySpan * rng.range(0.3, 0.7)
            let phase = rng.range(0, .pi * 2)
            for i in 0..<n {
                let u = Double(i) / Double(n) * .pi * 2
                pts.append(SIMD3(sin(u + phase) * rx, y0 + sin(u * 2 + phase) * ySpan * 0.12, sin(u * 2 + phase * 2) * rz))
            }
        case .helix:
            let n = 24
            let r0 = b.radius * rng.range(0.35, 0.6)
            let phase = rng.range(0, .pi * 2)
            for i in 0..<n {
                let u = Double(i) / Double(n)
                let a = phase + u * .pi * 4
                let climb = 1 - abs(1 - 2 * u)
                pts.append(SIMD3(cos(a) * r0, b.yMin + ySpan * (0.1 + climb * 0.8), sin(a) * r0))
            }
        case .canyon:
            let n = 16
            let axis = rng.range(0, .pi)
            let ax = cos(axis), az = sin(axis)
            let y0 = b.yMin + ySpan * rng.range(0.08, 0.28)
            let len = b.radius * 0.85
            let width = b.radius * rng.range(0.12, 0.3)
            for i in 0..<n {
                let u = Double(i) / Double(n) * .pi * 2
                let along = sin(u) * len, across = cos(u) * width
                let y = y0 + ySpan * rng.range(0, 0.08)
                pts.append(SIMD3(ax * along - az * across, y, az * along + ax * across))
            }
        case .wander:
            let n = 16 + rng.int(0, 4)
            var draws: [(Double, Double, Double)] = []
            for _ in 0..<n {
                let j = rng.range(-0.25, 0.25), r = rng.range(0, 1), d = rng.range(0.2, 0.8)
                draws.append((j, r, d))
            }
            let phase = draws[0].1 * .pi * 2
            for i in 0..<n {
                let (jitter, reach, depth) = draws[i]
                let base = Double(i) / Double(n) * .pi * 2
                let angle = base + jitter * 0.15
                let radius = b.radius * (0.55 + 0.27 * sin(2 * base + phase) + 0.08 * (reach - 0.5))
                pts.append(SIMD3(cos(angle) * radius, b.yMin + ySpan * depth, sin(angle) * radius))
            }
            for _ in 0..<4 {
                for f in [0.5, -0.53] {
                    let y = pts.map(\.y)
                    for i in 0..<n { pts[i].y = y[i] + f * ((y[(i - 1 + n) % n] + y[(i + 1) % n]) / 2 - y[i]) }
                }
            }
            for i in pts.indices { pts[i].y = min(b.yMin + ySpan * 0.9, max(b.yMin + ySpan * 0.1, pts[i].y)) }
        }
        return pts
    }
}
