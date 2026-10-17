import Foundation

/// DEBUG-only stopwatch for the history swipe (perf work, 2026-10-16). Prints
/// `[swipe] +1234ms label` relative to the last `start`.
enum SwipeTiming {
    #if DEBUG
    nonisolated(unsafe) private static var t0 = Date()
    static func start(_ label: String) { t0 = Date(); print("[swipe] +0ms \(label)") }
    static func mark(_ label: String) {
        print("[swipe] +\(Int(Date().timeIntervalSince(t0) * 1000))ms \(label)")
    }
    #else
    static func start(_ label: String) {}
    static func mark(_ label: String) {}
    #endif
}
