import XCTest
@testable import IdleScreens

/// The gallery scrolls a dozen tiles past the eye at once. Each animating tile
/// is its own 30fps Canvas, and on a 4GB phone that is a jetsam kill — the
/// crash a user reads as "scrolling the channels crashes the app".
///
/// The budget's whole job is to be *revocable*: a pushed fullscreen viewer does
/// not fire onDisappear on the gallery behind it, so lowering the allowance has
/// to stop tiles that are already on screen and already animating. A simple
/// counter can only refuse new claims, which is exactly the case that doesn't
/// matter.
@MainActor
final class PreviewBudgetTests: XCTestCase {
    private func fresh() -> PreviewBudget {
        let budget = PreviewBudget.forTesting(ceiling: 4)
        return budget
    }

    func testSlotsAreHandedOutUpToTheCeiling() {
        let budget = fresh()
        let slots = (0..<4).map { _ in budget.claimSlot() }
        XCTAssertEqual(slots.compactMap { $0 }.count, 4)
        XCTAssertNil(budget.claimSlot(), "a 5th tile must fall back to static")
    }

    func testReleasedSlotIsReusedRatherThanLeaked() {
        let budget = fresh()
        let first = budget.claimSlot()
        _ = budget.claimSlot()
        budget.releaseSlot(first!)
        XCTAssertEqual(budget.claimSlot(), first,
                       "scrolling away and back must not exhaust the budget")
    }

    func testFullscreenRevokesSlotsAlreadyHeld() {
        let budget = fresh()
        let slot = budget.claimSlot()!
        XCTAssertTrue(budget.permits(slot: slot))

        budget.enterFullscreen()
        XCTAssertFalse(budget.permits(slot: slot),
                       "tiles behind a pushed viewer must stop animating")

        budget.exitFullscreen()
        XCTAssertTrue(budget.permits(slot: slot), "and resume when it pops")
    }

    /// SwiftUI can run the incoming view's onAppear before the outgoing one's
    /// onDisappear. With a bool, that pop-then-push wakes the whole gallery up
    /// behind a viewer that is still on screen.
    func testInterleavedViewerTransitionKeepsTheGalleryQuiet() {
        let budget = fresh()
        let slot = budget.claimSlot()!
        budget.enterFullscreen()          // viewer A
        budget.enterFullscreen()          // viewer B appears...
        budget.exitFullscreen()           // ...before A disappears
        XCTAssertFalse(budget.permits(slot: slot), "B is still on screen")

        budget.exitFullscreen()
        XCTAssertTrue(budget.permits(slot: slot))
    }

    func testPressureRevokesTheHighestSlotsFirst() {
        let budget = fresh()
        let held = (0..<4).compactMap { _ in budget.claimSlot() }
        budget.applyPressure(critical: false)

        // Half the budget survives; the newest tiles are the ones that stop.
        XCTAssertTrue(budget.permits(slot: held[0]))
        XCTAssertFalse(budget.permits(slot: held[3]))
        XCTAssertNotNil(budget.throttleReason)
    }

    func testCriticalPressureStopsEverythingThenRecovers() async throws {
        let budget = PreviewBudget.forTesting(ceiling: 4, recovery: .milliseconds(50))
        let slot = budget.claimSlot()!
        budget.applyPressure(critical: true)
        XCTAssertFalse(budget.permits(slot: slot))

        try await Task.sleep(for: .milliseconds(250))
        XCTAssertTrue(budget.permits(slot: slot),
                      "pressure is transient; a permanently frozen gallery is not")
        XCTAssertNil(budget.throttleReason)
    }

    func testCeilingTracksPhysicalMemory() {
        // A 4GB iPhone 13 Pro must get a tighter budget than an 8GB phone —
        // this is the whole reason the crash was device-specific.
        XCTAssertLessThan(PreviewBudget.ceiling(forGigabytes: 4),
                          PreviewBudget.ceiling(forGigabytes: 8))
        XCTAssertGreaterThan(PreviewBudget.ceiling(forGigabytes: 4), 0,
                             "even the smallest device animates something")
    }
}
