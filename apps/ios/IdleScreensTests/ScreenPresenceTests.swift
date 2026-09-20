import XCTest
@testable import IdleScreens

/// The Screens tab showed a green dot for machines that were switched off.
///
/// `GET /api/pair/status` returns `{deviceId, channelId, lastSeenAt}`, and
/// `lastSeenAt` is stamped when the screen's socket CONNECTS and never again.
/// Verified against production on 2026-09-19: the response is byte-identical
/// before and after the socket closes. The old rule — "has it ever registered?"
/// — therefore painted every screen that had ever been on as live, forever.
///
/// Green now needs evidence. These tests pin what counts as evidence.
final class ScreenPresenceTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private func ms(_ secondsAgo: TimeInterval) -> Int { Int((1_800_000_000 - secondsAgo) * 1000) }

    private func screen(seenSecondsAgo: TimeInterval?, deliveredSecondsAgo: TimeInterval? = nil,
                        unansweredSecondsAgo: TimeInterval? = nil) -> PairedScreen {
        var s = PairedScreen(deviceId: "mac-abc", channelId: "lobby", pairedAt: now,
                             lastSeenAt: seenSecondsAgo.map(ms))
        s.lastDeliveredAt = deliveredSecondsAgo.map { now.addingTimeInterval(-$0) }
        s.lastUnansweredAt = unansweredSecondsAgo.map { now.addingTimeInterval(-$0) }
        return s
    }

    /// The bug itself: a Mac that connected last week and is now off.
    func testHavingConnectedOnceIsNotBeingOn() {
        XCTAssertEqual(screen(seenSecondsAgo: 7 * 86_400).presence(now: now), .unknown)
        XCTAssertEqual(screen(seenSecondsAgo: 3600).presence(now: now), .unknown)
    }

    func testNeverSeenIsNever() {
        XCTAssertEqual(screen(seenSecondsAgo: nil).presence(now: now), .never)
    }

    /// A push that landed is the one real proof the pairing API offers.
    func testADeliveredPushProvesPresence() {
        XCTAssertEqual(screen(seenSecondsAgo: 86_400, deliveredSecondsAgo: 30).presence(now: now), .connected)
    }

    /// …but proof goes stale. Yesterday's push says nothing about now.
    func testProofExpires() {
        let stale = PairedScreen.presenceWindow + 1
        XCTAssertEqual(screen(seenSecondsAgo: 86_400, deliveredSecondsAgo: stale).presence(now: now), .unknown)
    }

    /// 409 / delivered:0 — the pairing is fine, nobody is home.
    func testAnUnansweredPushSaysSo() {
        XCTAssertEqual(screen(seenSecondsAgo: 86_400, unansweredSecondsAgo: 10).presence(now: now), .notAnswering)
    }

    /// The most recent evidence wins, in both directions: a screen that was
    /// off and has since taken a push is back; one that took a push and then
    /// stopped answering is gone.
    func testNewestEvidenceWins() {
        XCTAssertEqual(screen(seenSecondsAgo: 86_400, deliveredSecondsAgo: 5, unansweredSecondsAgo: 60)
            .presence(now: now), .connected)
        XCTAssertEqual(screen(seenSecondsAgo: 86_400, deliveredSecondsAgo: 60, unansweredSecondsAgo: 5)
            .presence(now: now), .notAnswering)
    }

    func testAFreshConnectCountsOnItsOwn() {
        XCTAssertEqual(screen(seenSecondsAgo: 30).presence(now: now), .connected)
    }

    /// The card must never print the channel as if the screen were showing it
    /// right now unless presence is proven.
    func testStatusTextDoesNotImplyLiveWhenUnknown() {
        var old = PairedScreen(deviceId: "mac-abc", channelId: "lobby", pairedAt: Date(),
                               lastSeenAt: Int((Date().timeIntervalSince1970 - 3 * 86_400) * 1000))
        XCTAssertTrue(old.statusText.hasPrefix("last seen"), old.statusText)
        XCTAssertFalse(old.statusText.contains("lobby"))
        old.lastDeliveredAt = Date()
        XCTAssertEqual(old.statusText, "on · lobby")
    }

    /// Screens paired before this change have neither field. They must decode.
    func testOlderStoredScreensStillDecode() throws {
        let json = #"[{"deviceId":"mac-1","channelId":"lobby","pairedAt":700000000,"lastSeenAt":1}]"#
        let screens = try JSONDecoder().decode([PairedScreen].self, from: json.data(using: .utf8)!)
        XCTAssertNil(screens.first?.lastDeliveredAt)
        XCTAssertEqual(screens.first?.presence(), .unknown)
    }
}
