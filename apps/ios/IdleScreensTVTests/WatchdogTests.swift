import XCTest
@testable import IdleScreensTV

final class WatchdogTests: XCTestCase {
    func testSustainedSlowFramesTriggerDowngrade() {
        let watchdog = FrameWatchdog(budget: 1.0 / 60.0, window: 5.0)
        var fired = false
        // ~6s of 40ms frames at 25fps — p90 well over 2× the 60fps budget.
        for i in 0..<150 {
            if watchdog.record(duration: 0.04, at: Double(i) * 0.04) { fired = true }
        }
        XCTAssertTrue(fired)
        XCTAssertTrue(watchdog.triggered)
    }

    func testHealthyFramesDoNotTrigger() {
        let watchdog = FrameWatchdog(budget: 1.0 / 60.0, window: 5.0)
        for i in 0..<400 {
            XCTAssertFalse(watchdog.record(duration: 0.016, at: Double(i) * 0.016))
        }
        XCTAssertFalse(watchdog.triggered)
    }

    func testTriggersOnlyOnce() {
        let watchdog = FrameWatchdog(budget: 1.0 / 60.0, window: 5.0)
        var fireCount = 0
        for i in 0..<300 {
            if watchdog.record(duration: 0.04, at: Double(i) * 0.04) { fireCount += 1 }
        }
        XCTAssertEqual(fireCount, 1)
    }

    func testBriefSpikeDoesNotTrigger() {
        let watchdog = FrameWatchdog(budget: 1.0 / 60.0, window: 5.0)
        // 1s of bad frames, then healthy — not a sustained window.
        for i in 0..<60 {
            let t = Double(i) * 0.016
            let d: TimeInterval = i < 30 ? 0.05 : 0.016
            XCTAssertFalse(watchdog.record(duration: d, at: t))
        }
        XCTAssertFalse(watchdog.triggered)
    }
}
