import Foundation
import Observation
import UIKit

/// Keeps a hostile or merely heavy scene from taking the app down.
///
/// Budgets (SpecSubset.Budget) bound a scene at compile time, but cost also
/// depends on the device and what else is running: a scene that's fine on an
/// iPhone 17 can pin an older phone, and memory pressure can arrive from
/// anywhere. This watches actual frame times and system pressure at runtime
/// and steps the renderer down — 60fps → 30fps → paused — rather than letting
/// the system kill the process.
@MainActor @Observable
final class RenderGuard {
    /// What the renderer should do right now.
    enum Level: String {
        case full      // t3: 60fps, gradients, blend modes
        case reduced   // t2: 30fps, flat fills, entity thinning
        case paused    // frozen frame — recovering, backgrounded, or critical

        var tier: CapabilityTier { self == .full ? .t3 : .t2 }
    }

    private(set) var level: Level = .full
    private(set) var reason: String?

    private let watchdog = FrameWatchdog()
    /// Held for the guard's lifetime; DispatchSource cancels itself when the
    /// last reference goes away, so no deinit dance across actor isolation.
    private var memorySource: DispatchSourceMemoryPressure?
    private var recoveryTask: Task<Void, Never>?

    init() {
        // Start reduced on devices without the headroom for the full path.
        if ProcessInfo.processInfo.thermalState != .nominal {
            level = .reduced
            reason = "device is warm"
        }
        observeMemoryPressure()
    }

    /// Fed by the renderer each frame; steps down on sustained slow frames.
    func recordFrame(duration: TimeInterval, at time: TimeInterval) {
        guard level != .paused else { return }
        if watchdog.record(duration: duration, at: time) {
            stepDown(reason: "frames were running slow")
        }
    }

    /// Backgrounding: stop drawing entirely. A view that keeps animating off
    /// screen is pure battery and memory cost with nothing to show for it.
    func setActive(_ active: Bool) {
        if active {
            if level == .paused, reason == "app was in the background" {
                level = .reduced
                reason = nil
            }
        } else {
            level = .paused
            reason = "app was in the background"
        }
    }

    private func stepDown(reason: String) {
        switch level {
        case .full:
            level = .reduced
            self.reason = reason
        case .reduced:
            level = .paused
            self.reason = reason
            // A pause from overload isn't permanent — try again shortly, so a
            // transient spike doesn't leave a frozen scene forever.
            scheduleRecovery()
        case .paused:
            // Already paused: make sure a recovery attempt is pending, so
            // pressure that arrives while paused can't strand the scene.
            scheduleRecovery()
        }
    }

    /// A pause is never permanent — retry at reduced quality shortly, so a
    /// transient spike doesn't leave a frozen black screen.
    private func scheduleRecovery() {
        recoveryTask?.cancel()
        recoveryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(4))
            guard let self, self.level == .paused else { return }
            self.level = .reduced
            self.reason = nil
        }
    }

    private func observeMemoryPressure() {
        let source = DispatchSource.makeMemoryPressureSource(
            eventMask: [.warning, .critical], queue: .main)
        source.setEventHandler { [weak self] in
            guard let self else { return }
            // `source.data` is the event that FIRED. `source.mask` is the mask
            // we registered — it always contains .critical, so reading it made
            // every pressure signal look critical and froze the scene forever.
            let event = source.data
            if event.contains(.critical) {
                // Critical: stop drawing now, but always leave a way back.
                self.level = .paused
                self.reason = "device was low on memory"
                self.scheduleRecovery()
            } else {
                self.stepDown(reason: "device was low on memory")
            }
        }
        source.resume()
        memorySource = source
    }
}
