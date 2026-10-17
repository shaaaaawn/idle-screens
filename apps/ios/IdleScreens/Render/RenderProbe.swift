import Foundation
import OSLog

/// Debug-only counters for what a UI change actually costs: how many
/// Canvas draws and view-body evaluations it triggers. Hardware-independent
/// (a redraw costs ten times more on an A8, but the COUNT is the same), so a
/// simulator run says whether a focus move redraws one poster or forty.
/// Compiled out of release builds.
enum RenderProbe {
    #if DEBUG
    nonisolated(unsafe) static var counts: [String: Int] = [:]
    static let log = Logger(subsystem: "com.hermosalabs.idlescreens", category: "render-probe")

    static func hit(_ key: String) { counts[key, default: 0] += 1 }

    /// Counters since the last call, then reset.
    static func drain() -> [String: Int] {
        defer { counts = [:] }
        return counts
    }
    #else
    @inline(__always) static func hit(_ key: String) {}
    #endif
}
