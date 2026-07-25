import Foundation

/// Rendering capability tier for the tvOS viewer.
/// t3 = full native Canvas renderer, t2 = native at 30fps,
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
        switch major {
        case 5: return .t2   // AppleTV5,3 (A8)
        default: return .t3  // AppleTV6,2 (A10X), 11,1 (A12), 14,1+ (A15/A17…)
        }
    }
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
