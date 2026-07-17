import CoreGraphics
import Foundation

/// Polls the session idle time via CGEventSource — a passive query that needs
/// no Accessibility/Input Monitoring permission. kCGAnyInputEventType has no
/// Swift constant; the header defines it as `~0`.
final class IdleMonitor {
  var thresholdSeconds: TimeInterval
  var onIdle: (() -> Void)?

  private var timer: Timer?

  init(thresholdSeconds: TimeInterval) {
    self.thresholdSeconds = thresholdSeconds
  }

  static var secondsIdle: TimeInterval {
    CGEventSource.secondsSinceLastEventType(
      .combinedSessionState,
      eventType: CGEventType(rawValue: ~0)!
    )
  }

  func start() {
    stop()
    let t = Timer(timeInterval: 2, repeats: true) { [weak self] _ in
      guard let self, self.thresholdSeconds > 0 else { return }
      if Self.secondsIdle >= self.thresholdSeconds {
        self.onIdle?()
      }
    }
    t.tolerance = 0.5
    RunLoop.main.add(t, forMode: .common)
    timer = t
  }

  func stop() {
    timer?.invalidate()
    timer = nil
  }
}
