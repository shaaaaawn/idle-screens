import XCTest
@testable import IdleScreens

/// The guard exists to protect the device — but a guard that mistakes a
/// routine signal for a critical one is worse than none: it froze every
/// scene behind "device was low on memory" and never recovered.
@MainActor
final class RenderGuardTests: XCTestCase {
    func testStartsAtFullQualityOnAHealthyDevice() {
        let guardrail = RenderGuard()
        // Simulators/CI report .nominal thermals; a fresh guard must draw.
        if ProcessInfo.processInfo.thermalState == .nominal {
            XCTAssertEqual(guardrail.level, .full)
            XCTAssertNil(guardrail.reason)
        }
    }

    func testBackgroundingPausesAndForegroundingResumes() {
        let guardrail = RenderGuard()
        guardrail.setActive(false)
        XCTAssertEqual(guardrail.level, .paused, "offscreen scenes must stop drawing")
        guardrail.setActive(true)
        XCTAssertNotEqual(guardrail.level, .paused, "returning must resume rendering")
        XCTAssertNil(guardrail.reason)
    }

    /// Healthy 60fps frames must never trip the watchdog.
    func testSteadyFramesKeepFullQuality() {
        let guardrail = RenderGuard()
        var now: TimeInterval = 0
        for _ in 0..<400 {
            now += 1.0 / 60
            guardrail.recordFrame(duration: 1.0 / 60, at: now)
        }
        XCTAssertEqual(guardrail.level, .full)
    }

    /// Sustained slow frames should reduce quality — but only reduce, not
    /// jump straight to a frozen screen.
    func testSustainedSlowFramesStepDownToReduced() {
        let guardrail = RenderGuard()
        var now: TimeInterval = 0
        for _ in 0..<200 {
            now += 0.2
            guardrail.recordFrame(duration: 0.2, at: now)
        }
        XCTAssertEqual(guardrail.level, .reduced)
        XCTAssertEqual(guardrail.reason, "frames were running slow")
    }
}
