import Foundation

/// Rendering capability tier for the tvOS viewer.
/// t3 = full native Canvas renderer, t2 = GPU SpriteKit renderer at 30fps,
/// t1 = thumbnail stream, t0 = braille perception floor.
enum CapabilityTier: String, CaseIterable, Sendable {
    case t3, t2, t1, t0

    func downgraded() -> CapabilityTier {
        switch self {
        case .t3: return .t2
        case .t2: return .t1
        case .t1: return .t0
        case .t0: return .t0
        }
    }
}

/// Maps `hw.machine` strings to capability tiers.
enum CapabilityDetector {
    /// e.g. "AppleTV14,1" on device, "arm64"/"x86_64" in the simulator.
    static var machine: String {
        var systemInfo = utsname()
        uname(&systemInfo)
        return withUnsafePointer(to: &systemInfo.machine) { ptr in
            ptr.withMemoryRebound(to: CChar.self, capacity: Int(_SYS_NAMELEN)) {
                String(cString: $0)
            }
        }
    }

    static func tier(forMachine machine: String) -> CapabilityTier {
        // Simulator — Apple Silicon / Intel hosts are t3-class.
        if machine == "arm64" || machine == "x86_64" { return .t3 }
        guard machine.hasPrefix("AppleTV") else { return .t2 }
        let parts = machine.dropFirst("AppleTV".count)
            .split(separator: ",")
            .compactMap { Int($0) }
        guard let major = parts.first else { return .t2 }
        // The CPU Canvas renderer (t3) is only for A12+; everything older
        // gets the GPU SpriteKit tier (t2), which even the 2015 A8 box can
        // drive — textured quads, not per-frame rasterization. New hardware
        // defaults to t3 by falling through.
        switch major {
        case 5, 6: return .t2  // AppleTV5,3 (A8), AppleTV6,x (A10X)
        default: return .t3    // AppleTV11,1 (A12), 14,1+ (A15/A17…)
        }
    }
}

/// How much work this box can be asked to do, independent of WHICH renderer
/// it uses. The tier picks the renderer; the class sizes its budgets.
///
/// Splitting the two is what lets a new Apple TV actually gain something: the
/// ceilings that decide "this scene is too heavy for the Canvas tier" were
/// derived on A12-class silicon, and left fixed they would kick a rich scene
/// down to the sprite renderer on hardware that could drive it comfortably.
enum RenderClass: String, Sendable, CaseIterable {
    /// A8 / A10X — the pre-4K boxes.
    case legacy
    /// A12 through A15 — the 4K generations the ceilings were tuned on.
    case standard
    /// A17 and newer. Same renderers, higher ceilings.
    case high

    /// Entities a scene may compile to before the Canvas tier gives way to
    /// the GPU sprite tier.
    var maxCanvasEntities: Int {
        switch self {
        case .legacy: return 600
        case .standard: return 900
        case .high: return 2_400
        }
    }

    /// Per-frame radial gradients are the Canvas renderer's dearest path, so
    /// soft circles get their own ceiling.
    var maxCanvasSoftCircles: Int {
        switch self {
        case .legacy: return 150
        case .standard: return 220
        case .high: return 600
        }
    }

    /// Total entities a fullscreen scene compiles to before thinning.
    var fullscreenEntityBudget: Int {
        switch self {
        case .legacy: return 2_500
        case .standard: return 4_000
        case .high: return 9_000
        }
    }

    /// Entity-draws available to ghost echoes (see NativeSceneView).
    var ghostDrawBudget: Int {
        switch self {
        case .legacy: return 0        // no echoes below the Canvas tier anyway
        case .standard: return 1_500
        case .high: return 4_500
        }
    }
}

extension CapabilityDetector {
    /// Performance class for a machine identifier, with RAM as a second
    /// opinion. Model numbers only move forward on this platform, so an
    /// identifier newer than anything known is treated as the best class
    /// rather than the worst — the same "default up" rule the tier map uses,
    /// and the watchdog plus the learned per-channel caps still catch it if
    /// a scene turns out heavier than the ceiling assumed.
    static func renderClass(forMachine machine: String,
                            memoryBytes: UInt64 = ProcessInfo.processInfo.physicalMemory)
        -> RenderClass {
        // Simulators run on the Mac's silicon; treat them as current, not new.
        if machine == "arm64" || machine == "x86_64" { return .standard }
        guard machine.hasPrefix("AppleTV") else { return .standard }
        let major = machine.dropFirst("AppleTV".count)
            .split(separator: ",").first.flatMap { Int($0) }
        guard let major else { return .standard }
        switch major {
        case ..<7: return .legacy          // AppleTV5,3 (A8), 6,x (A10X)
        case 7...14:
            // A 4K-generation identifier with more RAM than any shipped
            // A12–A15 box is new silicon under an old-looking number.
            return memoryBytes > 5_000_000_000 ? .high : .standard
        default: return .high              // AppleTV15,x and anything after
        }
    }

    static var renderClass: RenderClass { renderClass(forMachine: machine) }
}

/// Samples frame durations; if the p90 frame time exceeds 2× the frame budget
/// for a sustained window, it fires once so the app can downgrade a tier.
final class FrameWatchdog: @unchecked Sendable {
    private var samples: [(time: TimeInterval, duration: TimeInterval)] = []
    private(set) var triggered = false

    let budget: TimeInterval
    let window: TimeInterval

    init(budget: TimeInterval = 1.0 / 60.0, window: TimeInterval = 5.0) {
        self.budget = budget
        self.window = window
    }

    /// Record one frame. Returns true the first time the downgrade threshold trips.
    @discardableResult
    func record(duration: TimeInterval, at now: TimeInterval) -> Bool {
        guard !triggered else { return false }
        samples.append((now, duration))
        samples.removeAll { now - $0.time > window }
        guard let first = samples.first?.time,
              now - first >= window * 0.9,
              samples.count >= 10 else { return false }
        let sorted = samples.map(\.duration).sorted()
        let p90 = sorted[min(sorted.count - 1, Int(Double(sorted.count) * 0.9))]
        if p90 > budget * 2 {
            triggered = true
            return true
        }
        return false
    }
}
