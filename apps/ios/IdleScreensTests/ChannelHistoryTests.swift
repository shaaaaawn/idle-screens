import XCTest
@testable import IdleScreens

/// Decoding is where this feature actually breaks, so it is where the test
/// lives. Captured from a real `GET /c/lobby/history` response — including the
/// shapes that are easy to get wrong.
final class ChannelHistoryTests: XCTestCase {
    /// `detail` is a JSON OBJECT, not a string. Typing it as `String?` made the
    /// decoder throw on the whole page, and the history sheet rendered its
    /// "couldn't load" state against a perfectly healthy HTTP 200 — a failure
    /// that looks like a network problem and isn't.
    func testDecodesRealPayloadIncludingObjectDetail() throws {
        let json = """
        {"events":[
          {"id":337,"at":1786749366287,"kind":"overlay","actor":"agent",
           "summary":"overlay: smoke","detail":{"style":"fade","region":"random"},
           "sceneId":null,"model":null,"intent":null,"harness":"curl"},
          {"id":336,"at":1786749000000,"kind":"scheduled","actor":"agent",
           "summary":"published","detail":null,
           "sceneId":42,"model":"glm-5.2","intent":"weekly rotation","harness":"cron"}
        ],"hasMore":true}
        """.data(using: .utf8)!

        let page = try JSONDecoder().decode(ChannelHistoryPage.self, from: json)
        XCTAssertEqual(page.events.count, 2)
        XCTAssertEqual(page.hasMore, true)
    }

    /// Only scene-backed events can be brought back; a recall button on an
    /// overlay would 404 or silently no-op.
    func testOnlySceneBackedEventsAreRecallable() throws {
        let json = """
        {"events":[
          {"id":1,"at":1,"kind":"overlay","actor":"a","summary":null,"sceneId":null,
           "model":null,"intent":null,"harness":null},
          {"id":2,"at":2,"kind":"publish","actor":"a","summary":null,"sceneId":9,
           "model":null,"intent":null,"harness":null}
        ],"hasMore":false}
        """.data(using: .utf8)!
        let page = try JSONDecoder().decode(ChannelHistoryPage.self, from: json)
        XCTAssertEqual(page.events.filter { $0.sceneId != nil }.map(\.id), [2])
    }

    /// An event with neither a model nor an intent tells the reader nothing —
    /// showing "agent" alone is worse than showing no provenance section.
    func testAttributionRequiresModelOrIntent() throws {
        let json = """
        {"events":[
          {"id":1,"at":1,"kind":"setParam","actor":"agent","summary":null,"sceneId":null,
           "model":null,"intent":null,"harness":null},
          {"id":2,"at":2,"kind":"publish","actor":"agent","summary":null,"sceneId":9,
           "model":"claude-opus-5","intent":null,"harness":null}
        ],"hasMore":false}
        """.data(using: .utf8)!
        let page = try JSONDecoder().decode(ChannelHistoryPage.self, from: json)
        XCTAssertFalse(page.events[0].hasAttribution)
        XCTAssertTrue(page.events[1].hasAttribution)
    }

    func testEpochMillisecondsBecomeADate() throws {
        let json = """
        {"events":[{"id":1,"at":1786749366287,"kind":"publish","actor":null,
         "summary":null,"sceneId":1,"model":null,"intent":null,"harness":null}],
         "hasMore":false}
        """.data(using: .utf8)!
        let page = try JSONDecoder().decode(ChannelHistoryPage.self, from: json)
        XCTAssertEqual(page.events[0].date.timeIntervalSince1970, 1786749366.287, accuracy: 0.01)
    }
}
