import XCTest
@testable import IdleScreens

/// Which screens a send goes to unless you pick: the ones you chose last,
/// not every paired screen.
final class CastTargetsTests: XCTestCase {
    private let paired = ["tv-living", "mac-studio", "tv-bedroom"]

    func testRemembersTheLastChoice() {
        XCTAssertEqual(AppState.castTargets(remembered: ["tv-bedroom"], paired: paired), ["tv-bedroom"])
    }

    func testFirstSendIsEveryScreen() {
        XCTAssertEqual(AppState.castTargets(remembered: [], paired: paired), paired)
    }

    func testAnUnpairedScreenDropsOut() {
        XCTAssertEqual(AppState.castTargets(remembered: ["tv-gone", "mac-studio"], paired: paired), ["mac-studio"])
    }

    func testOnlyGoneScreensFallsBackToEvery() {
        XCTAssertEqual(AppState.castTargets(remembered: ["tv-gone"], paired: paired), paired,
                       "never an empty send because the remembered screen was unpaired")
    }

    func testFollowsThePairedOrder() {
        XCTAssertEqual(AppState.castTargets(remembered: ["tv-bedroom", "tv-living"], paired: paired),
                       ["tv-living", "tv-bedroom"])
    }

    func testPruningKeepsOnlyPairedScreens() {
        XCTAssertEqual(AppState.prunedCastScreens(remembered: ["tv-gone", "mac-studio"], paired: paired), ["mac-studio"])
    }

    func testPruningToNothingLeavesNothingRemembered() {
        XCTAssertEqual(AppState.prunedCastScreens(remembered: ["tv-gone"], paired: paired), [])
    }

    func testNothingPairedIsNothing() {
        XCTAssertEqual(AppState.castTargets(remembered: ["tv-living"], paired: []), [])
    }
}
