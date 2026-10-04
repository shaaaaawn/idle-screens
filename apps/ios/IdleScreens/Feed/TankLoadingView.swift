import SwiftUI

// The fish-ring card that used to sit over a loading tank lived here until
// 2026-10-01; the loading signal is now the scene itself (AquariumField.Gather).
// It is in git history (8d4e44c) if it is wanted back.

/// When a 3D tank counts as loaded.
///
/// The page mounts empty and its models arrive over 10–20 s, so "the web view
/// booted" is far too early. Loaded means: it has reported downloads, and they
/// have all settled — or it never reported any and a grace period ran out (a
/// scene with everything cached, or a page that can't be tapped).
struct TankLoadState: Equatable {
    private(set) var pending: Int?
    private(set) var sawDownloads = false
    private(set) var settled = false

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

    func isLoading(elapsed: TimeInterval) -> Bool {
        if settled || elapsed >= Self.ceiling { return false }
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
