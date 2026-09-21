import XCTest
@testable import IdleScreensTV

/// Up/Down in the player. The ring is the iPhone feed's order, so both
/// devices flip through the same channels the same way.
@MainActor
final class ChannelSurfTests: XCTestCase {

    private func channel(_ id: String, steered: Int, sleeping: Bool = false) -> PublicChannel {
        PublicChannel(channelId: id, label: id, tags: [], viewers: nil,
                      sleeping: sleeping, lastEventAt: steered)
    }

    private var channels: [PublicChannel] {
        [channel("old", steered: 1), channel("newest", steered: 9),
         channel("mid", steered: 5), channel("moon", steered: 99, sleeping: true)]
    }

    func testDownStepsToTheNextMostRecentlySteered() {
        XCTAssertEqual(TVAppState.surfTarget(from: "newest", step: 1, in: channels), "mid")
        XCTAssertEqual(TVAppState.surfTarget(from: "mid", step: 1, in: channels), "old")
        XCTAssertEqual(TVAppState.surfTarget(from: "mid", step: -1, in: channels), "newest")
    }

    func testTheRingWrapsBothWays() {
        XCTAssertEqual(TVAppState.surfTarget(from: "old", step: 1, in: channels), "newest")
        XCTAssertEqual(TVAppState.surfTarget(from: "newest", step: -1, in: channels), "old")
    }

    func testSleepingChannelsAreNeverSurfedInto() {
        // `moon` is the most recently touched of all, and still never a stop:
        // when you are surfing, a moon and a sentence is a dud page.
        var visited = Set<String>()
        var at = "newest"
        for _ in 0..<8 {
            at = TVAppState.surfTarget(from: at, step: 1, in: channels) ?? at
            visited.insert(at)
        }
        XCTAssertFalse(visited.contains("moon"))
        XCTAssertEqual(visited, ["newest", "mid", "old"])
    }

    func testASleepingStartingPointCanStillBeLeft() {
        // Opened from the grid, a sleeping channel must not strand the remote.
        XCTAssertNotNil(TVAppState.surfTarget(from: "moon", step: 1, in: channels))
        XCTAssertNotEqual(TVAppState.surfTarget(from: "moon", step: 1, in: channels), "moon")
    }

    func testNothingToSurfIsNotACrash() {
        XCTAssertNil(TVAppState.surfTarget(from: "only", step: 1, in: [channel("only", steered: 1)]))
        XCTAssertNil(TVAppState.surfTarget(from: nil, step: 1, in: []))
        XCTAssertNil(TVAppState.surfTarget(from: "mid", step: 0, in: channels))
    }

    func testAnUnknownChannelJoinsTheRingAtTheTop() {
        // e.g. an unlisted channel opened by id from Settings.
        XCTAssertEqual(TVAppState.surfTarget(from: "unlisted", step: 1, in: channels), "newest")
    }
}
