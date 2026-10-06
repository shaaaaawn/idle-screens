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

final class SceneCreditTests: XCTestCase {
    private func event(_ id: Int, at: Double, actor: String?, model: String? = nil, label: String?) -> ChannelEvent {
        ChannelEvent(id: id, at: at, kind: "publish", actor: actor, model: model, label: label)
    }

    func testLabelIsLiftedFromTheDetailObjectAndSurvivesOddDetails() throws {
        let json = #"{"events":[{"id":1,"at":5,"kind":"publish","actor":"curator","detail":{"label":"Ember Drift","seed":7}},{"id":2,"at":6,"kind":"overlay","detail":"oops"},{"id":3,"at":7,"kind":"wake"}]}"#
        let page = try JSONDecoder().decode(ChannelHistoryPage.self, from: Data(json.utf8))
        XCTAssertEqual(page.events.map(\.label), ["Ember Drift", nil, nil])
    }

    func testARelayedSceneIsCreditedToItsFirstRealAuthor() {
        let log = [
            event(9, at: 900, actor: "curator", label: "Ember Drift"),
            event(5, at: 500, actor: "Spin", model: "claude-fable-5-1", label: "ember drift"),
            event(3, at: 300, actor: "agent", model: "glm-5.3", label: "Ember Drift"),
            event(2, at: 200, actor: "curator", label: "Ember Drift"),
            event(1, at: 100, actor: "Spin", model: "m", label: "Something Else"),
        ]
        XCTAssertEqual(SceneCredit.original(for: log[0], in: log)?.id, 3)
    }

    func testNoOriginalIsAnHonestNil() {
        let relayOnly = [event(2, at: 2, actor: "curator", label: "Volt Drift"),
                         event(1, at: 1, actor: "scheduler", label: "Volt Drift"),
                         event(0, at: 0, actor: "agent", label: "Volt Drift")]
        XCTAssertNil(SceneCredit.original(for: relayOnly[0], in: relayOnly))
        // A scene a real author aired themselves needs no detective work.
        let own = event(4, at: 4, actor: "Spin", model: "m", label: "Volt Drift")
        XCTAssertNil(SceneCredit.original(for: own, in: relayOnly + [own]))
    }
}
