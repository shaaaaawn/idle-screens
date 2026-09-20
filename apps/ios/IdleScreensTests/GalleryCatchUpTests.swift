import XCTest
@testable import IdleScreens

final class SteerLineTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private func channel(minutesAgo: Int?, actor: String? = nil, harness: String? = nil,
                         model: String? = nil) -> PublicChannel {
        PublicChannel(
            channelId: "c", label: nil, tags: nil, viewers: nil,
            lastEventAt: minutesAgo.map { (1_800_000_000 - $0 * 60) * 1000 },
            lastSteer: .init(actor: actor, harness: harness, model: model, summary: nil))
    }

    func testBucketsMatchTheWeb() {
        XCTAssertEqual(SteerLine.text(for: channel(minutesAgo: 0), now: now), "steered just now")
        XCTAssertEqual(SteerLine.text(for: channel(minutesAgo: 36), now: now), "steered 36m ago")
        XCTAssertEqual(SteerLine.text(for: channel(minutesAgo: 60 * 5), now: now), "steered 5h ago")
        XCTAssertEqual(SteerLine.text(for: channel(minutesAgo: 60 * 24 * 51), now: now), "steered 51d ago")
    }

    func testHarnessAndModelAreShown() {
        XCTAssertEqual(
            SteerLine.text(for: channel(minutesAgo: 36, actor: "Spin", harness: "claude-code",
                                        model: "claude-fable-5-1"), now: now),
            "steered 36m ago · claude-code · claude-fable-5-1")
    }

    /// Agents pass `agent: "pi"` while the harness is also `pi`. The wall once
    /// printed "pi · pi · glm" — the same word twice for no new information.
    func testALabelThatRepeatsTheActorIsDropped() {
        XCTAssertEqual(
            SteerLine.text(for: channel(minutesAgo: 5, actor: "pi", harness: "PI", model: "glm-5.3"), now: now),
            "steered 5m ago · glm-5.3")
    }

    /// `agent` is the server's default for an unattributed call. It names
    /// nobody, so it must not suppress a real harness called "agent"-nothing.
    func testUnattributedDefaultIsNotAName() {
        XCTAssertNil(SteerLine.namedActor("agent"))
        XCTAssertEqual(SteerLine.namedActor("Spin"), "Spin")
    }

    func testNeverSteeredMeansNoLine() {
        XCTAssertNil(SteerLine.text(for: channel(minutesAgo: nil), now: now))
    }
}

final class PublicChannelCatchUpTests: XCTestCase {
    /// Shape captured from `GET /api/channels` on 2026-09-19.
    func testDecodesTheFieldsTheWallNowCarries() throws {
        let json = """
        [{"id":"theatre","label":"theatre","tags":["epoch","curated"],"protected":true,
          "remixOf":"lobby","access":"public","createdAt":0,
          "lastEvent":{"at":1788647705288,"actor":"Spin","harness":"pi",
                       "model":"glm-5.3","summary":"published Overture"}}]
        """.data(using: .utf8)!
        let channel = try XCTUnwrap(JSONDecoder().decode([PublicChannel].self, from: json).first)
        XCTAssertEqual(channel.isProtected, true)
        XCTAssertEqual(channel.remixOf, "lobby")
        XCTAssertEqual(channel.access, "public")
        XCTAssertEqual(channel.lastEventAt, 1_788_647_705_288)
        XCTAssertEqual(channel.lastSteer?.summary, "published Overture")
        XCTAssertEqual(channel.lastSteer?.harness, "pi")
    }

    /// Every new field is optional: an older or thinner payload still decodes.
    func testOlderPayloadStillDecodes() throws {
        let json = #"[{"id":"lobby"}]"#.data(using: .utf8)!
        let channel = try XCTUnwrap(JSONDecoder().decode([PublicChannel].self, from: json).first)
        XCTAssertNil(channel.isProtected)
        XCTAssertNil(channel.lastSteer)
    }
}

final class CardLineTests: XCTestCase {
    func testCardLineLeadsWithArtistAndModelAndDropsTheHarness() {
        let now = Date(timeIntervalSince1970: 2_000_000_000)
        let at = Int(now.timeIntervalSince1970 * 1000) - 36 * 60 * 1000
        func channel(_ steer: PublicChannel.Steer?) -> PublicChannel {
            PublicChannel(channelId: "c", label: nil, tags: nil, viewers: nil, lastEventAt: at, lastSteer: steer)
        }
        let full = PublicChannel.Steer(actor: "Spin", harness: "claude-code", model: "claude-fable-5-1", summary: nil)
        XCTAssertEqual(SteerLine.cardLine(for: channel(full), now: now), "Spin · claude-fable-5-1 · 36m ago")
        let anon = PublicChannel.Steer(actor: "agent", harness: "cli", model: "glm-5.3", summary: nil)
        XCTAssertEqual(SteerLine.cardLine(for: channel(anon), now: now), "glm-5.3 · 36m ago")
        XCTAssertEqual(SteerLine.cardLine(for: channel(nil), now: now), "36m ago")
    }
}
