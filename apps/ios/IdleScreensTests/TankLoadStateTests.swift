import XCTest
@testable import IdleScreens

/// When a 3D tank counts as loaded. "The web view booted" is 10–20 s too early:
/// the scene mounts empty and its models arrive afterwards.
final class TankLoadStateTests: XCTestCase {
    func testLoadsWhileModelsAreInFlightAndUntilTheySettle() {
        var tank = TankLoadState()
        tank.report(3)
        XCTAssertTrue(tank.isLoading(elapsed: 10))
        tank.report(1)
        XCTAssertFalse(tank.downloadsFinished)
        tank.report(0)
        XCTAssertTrue(tank.downloadsFinished)
        // Landed is not painted: still loading until the settle beat is marked.
        XCTAssertTrue(tank.isLoading(elapsed: 10))
        tank.markSettled()
        XCTAssertFalse(tank.isLoading(elapsed: 10))
    }

    func testASecondBatchReopensTheWait() {
        var tank = TankLoadState()
        tank.report(1); tank.report(0); tank.markSettled()
        tank.report(2)
        XCTAssertTrue(tank.isLoading(elapsed: 5))
        XCTAssertFalse(tank.downloadsFinished)
    }

    func testAQuietPageOnlyGetsAShortGrace() {
        let tank = TankLoadState()   // everything cached, or a page that can't be tapped
        XCTAssertTrue(tank.isLoading(elapsed: 1))
        XCTAssertFalse(tank.isLoading(elapsed: TankLoadState.quietGrace))
    }

    func testTheLoaderNeverOutlivesItsCeiling() {
        var tank = TankLoadState()
        tank.report(5)   // a download that never finishes
        XCTAssertTrue(tank.isLoading(elapsed: TankLoadState.ceiling - 1))
        XCTAssertFalse(tank.isLoading(elapsed: TankLoadState.ceiling))
    }

    func testNegativeCountsFromAnUntrustedPageAreClamped() {
        var tank = TankLoadState()
        tank.report(-4)
        XCTAssertEqual(tank.pending, 0)
        XCTAssertFalse(tank.downloadsFinished)   // it never saw a download
    }

    // MARK: The tank's own fish count

    func testTheCastIsInOnceTheFishCountHoldsStill() {
        var tank = TankLoadState()
        let t0 = Date()
        tank.reportFish(3, at: t0)
        tank.reportFish(8, at: t0.addingTimeInterval(0.2))
        // Still arriving: loading, even though no download was ever seen.
        XCTAssertTrue(tank.isLoading(elapsed: 0.5, now: t0.addingTimeInterval(0.5)))
        // Held for the quiet window: in, well before the 4 s grace.
        let settledAt = t0.addingTimeInterval(0.2 + TankLoadState.castQuiet + 0.01)
        XCTAssertFalse(tank.isLoading(elapsed: 1, now: settledAt))
    }

    func testARepeatedCountDoesNotRestartTheQuietWindow() {
        var tank = TankLoadState()
        let t0 = Date()
        tank.reportFish(5, at: t0)
        tank.reportFish(5, at: t0.addingTimeInterval(0.6))
        XCTAssertTrue(tank.castIsIn(at: t0.addingTimeInterval(TankLoadState.castQuiet + 0.01)))
    }

    func testFishStillArrivingOutwaitTheGrace() {
        var tank = TankLoadState()
        let t0 = Date()
        tank.reportFish(2, at: t0.addingTimeInterval(4.8))
        XCTAssertTrue(tank.isLoading(elapsed: 5, now: t0.addingTimeInterval(5)))
        XCTAssertFalse(tank.isLoading(elapsed: TankLoadState.ceiling, now: t0.addingTimeInterval(5)))
    }

    func testAnEmptyTankFallsBackToTheGrace() {
        var tank = TankLoadState()
        tank.reportFish(0)
        XCTAssertTrue(tank.isLoading(elapsed: 1))
        XCTAssertFalse(tank.isLoading(elapsed: TankLoadState.quietGrace))
    }
}
