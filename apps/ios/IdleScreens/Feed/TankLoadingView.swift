import SwiftUI

// The loading card (8d4e44c) and the fish-ring gather (4431154) both lived
// here once. A loading tank now just shows the lo-fi 2D aquarium swimming
// until the 3D cast is in — no message, no special motion (2026-10-09).

/// When a 3D tank counts as loaded.
///
/// Best signal: the tank's own fish count (`data-mq-fish`). Once it is above
/// zero and has held still for `castQuiet`, the cast is in. Measured
/// 2026-10-17, a cached cast lands within ~0.3 s of mount (gaps of ~0.7 s between breeds when one is fetched) — the old rule below
/// had no downloads to see (models are bundled now) and so sat out its full
/// grace on every tank, ~4.3 s of nothing.
///
/// Fallback, for a page that never reports fish (an older site build):
/// downloads seen and all settled, or none seen and a grace period ran out.
struct TankLoadState: Equatable {
    private(set) var pending: Int?
    private(set) var sawDownloads = false
    private(set) var settled = false
    private(set) var fish: Int?
    private(set) var fishChangedAt: Date?

    /// How long the fish count must hold before the cast counts as in. Long
    /// enough to span the gap between breed chunks arriving on a cold install.
    static let castQuiet: TimeInterval = 1.0

    mutating func reportFish(_ count: Int, at now: Date = Date()) {
        guard count != fish else { return }
        fish = count
        fishChangedAt = now
    }

    /// The tank has fish, and has stopped adding them.
    func castIsIn(at now: Date = Date()) -> Bool {
        guard let fish, fish > 0, let fishChangedAt else { return false }
        return now.timeIntervalSince(fishChangedAt) >= Self.castQuiet
    }

    /// Longest the loader may stay up, whatever the page says.
    static let ceiling: TimeInterval = 25
    /// How long to wait for a first report before assuming there is none.
    static let quietGrace: TimeInterval = 4
    /// Decode + first paint after the last model lands.
    static let settleDelay: TimeInterval = 1.2

    mutating func report(_ count: Int) {
        pending = max(0, count)
        if count > 0 { sawDownloads = true; settled = false }
    }

    /// True once the last download has landed (call `markSettled` a beat later).
    var downloadsFinished: Bool { sawDownloads && pending == 0 }

    mutating func markSettled() { settled = true }

    func isLoading(elapsed: TimeInterval, now: Date = Date()) -> Bool {
        if settled || elapsed >= Self.ceiling { return false }
        if castIsIn(at: now) { return false }
        // Fish arriving: wait for them, not for downloads the tank doesn't make.
        if let fish, fish > 0 { return true }
        if !sawDownloads { return elapsed < Self.quietGrace }
        return true
    }

    /// Polls the state until the tank is in, reporting each change. Runs for at
    /// most `ceiling` seconds and stops when its task is cancelled.
    @MainActor
    static func watch(state: @MainActor () -> TankLoadState,
                      settle: @MainActor () -> Void,
                      onChange: @MainActor (Bool) -> Void) async {
        let started = Date()
        var last: Bool?
        while !Task.isCancelled {
            if state().downloadsFinished && !state().settled {
                try? await Task.sleep(for: .seconds(settleDelay))
                if Task.isCancelled { return }
                // Still finished after the beat? Another batch may have begun.
                if state().downloadsFinished { settle() }
            }
            let loading = state().isLoading(elapsed: Date().timeIntervalSince(started))
            if loading != last { onChange(loading); last = loading }
            if !loading { return }
            try? await Task.sleep(for: .seconds(0.35))
        }
    }
}
