import Foundation
import Observation
import UIKit

/// Decides how many scene previews may animate at once, app-wide.
///
/// The gallery can have a dozen live tiles on screen while scrolling, and each
/// animating tile is its own 30fps Canvas. That is fine on an iPhone 17 and is
/// not fine on an iPhone 13 Pro — the honest answer isn't a fixed number, it's
/// a budget that reads the device and the current pressure and adapts.
///
/// Tiles that don't get a slot still render — one static frame — so the gallery
/// looks identical at rest and simply animates fewer things at once.
@MainActor @Observable
final class PreviewBudget {
    static let shared = PreviewBudget()

    /// How many previews may animate concurrently right now.
    private(set) var allowance: Int
    /// Set when pressure forced the allowance down, for the diagnostics sheet.
    private(set) var throttleReason: String?
    /// How many fullscreen viewers are on screen; nothing in the gallery may
    /// animate while any is. A depth rather than a flag because SwiftUI can
    /// land the incoming view's `onAppear` before the outgoing one's
    /// `onDisappear` — with a bool, that ordering un-revokes the gallery
    /// underneath a viewer that is still very much on screen.
    private(set) var fullscreenDepth = 0

    private var occupied: Set<Int> = []
    private var memorySource: DispatchSourceMemoryPressure?
    private var recoveryTask: Task<Void, Never>?
    private let ceiling: Int
    private let recovery: Duration

    /// Physical memory is the most reliable proxy for GPU/CPU headroom that
    /// doesn't need a device-model lookup table: 4GB (13 Pro-class) gets a
    /// tighter budget than an 8GB phone. This is why the crash was
    /// device-specific — the same gallery is fine on a 17 and fatal on a 13.
    static func ceiling(forGigabytes gigabytes: Double) -> Int {
        switch gigabytes {
        case ..<4.5: 4     // iPhone 12/13-class
        case ..<7.5: 6     // 14/15-class
        default: 8
        }
    }

    private init(ceiling: Int, recovery: Duration, observePressure: Bool) {
        self.ceiling = ceiling
        self.recovery = recovery
        allowance = ceiling
        if observePressure { startObservingPressure() }
    }

    private convenience init() {
        let gigabytes = Double(ProcessInfo.processInfo.physicalMemory) / 1_073_741_824
        self.init(ceiling: Self.ceiling(forGigabytes: gigabytes),
                  recovery: .seconds(20),
                  observePressure: true)
    }

    /// An isolated budget with no real pressure source, so tests can drive the
    /// pressure transitions directly instead of waiting on the OS.
    static func forTesting(ceiling: Int, recovery: Duration = .seconds(20)) -> PreviewBudget {
        PreviewBudget(ceiling: ceiling, recovery: recovery, observePressure: false)
    }

    /// Take the lowest free slot number, or nil if the gallery is already full.
    /// Numbered rather than counted so the budget stays *revocable*: when
    /// pressure drops the allowance to N, every holder above N stops animating
    /// on its next render without needing to be told individually. A pure
    /// counter could only refuse new claims — useless when the tiles that need
    /// to stop are already on screen.
    func claimSlot() -> Int? {
        guard occupied.count < ceiling else { return nil }
        var slot = 0
        while occupied.contains(slot) { slot += 1 }
        occupied.insert(slot)
        return slot
    }

    func releaseSlot(_ slot: Int) {
        occupied.remove(slot)
    }

    /// Whether a holder of this slot may animate *right now*. Views read this
    /// in `body`, so @Observable re-renders them the moment allowance moves.
    func permits(slot: Int) -> Bool { fullscreenDepth == 0 && slot < allowance }

    /// Fullscreen viewing is a single canvas — give it the whole device and
    /// stop every background tile animating behind it. Tracked as an override
    /// rather than by zeroing the allowance, so a pressure recovery timer
    /// firing mid-viewing can't quietly wake the gallery up behind it.
    func enterFullscreen() { fullscreenDepth += 1 }

    func exitFullscreen() { fullscreenDepth = max(0, fullscreenDepth - 1) }

    /// Step the budget down in response to real memory pressure, and schedule a
    /// recovery — pressure is transient, a permanently frozen gallery is not.
    func applyPressure(critical: Bool) {
        if critical {
            allowance = 0
            throttleReason = "paused previews — memory was critical"
        } else {
            allowance = max(1, ceiling / 2)
            throttleReason = "fewer live previews — memory was tight"
        }
        recoveryTask?.cancel()
        recoveryTask = Task { [weak self, recovery] in
            try? await Task.sleep(for: recovery)
            guard !Task.isCancelled, let self else { return }
            self.allowance = self.ceiling
            self.throttleReason = nil
        }
    }

    private func startObservingPressure() {
        let source = DispatchSource.makeMemoryPressureSource(
            eventMask: [.warning, .critical], queue: .main)
        source.setEventHandler { [weak self] in
            // `source.data` is the event that fired; `source.mask` is only what
            // we registered for and would always look critical.
            let critical = source.data.contains(.critical)
            Task { @MainActor [weak self] in
                self?.applyPressure(critical: critical)
            }
        }
        source.resume()
        memorySource = source
    }
}
