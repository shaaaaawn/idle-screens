import XCTest
@testable import IdleScreensTV

/// The words on the player's chrome, and the small labels on Settings and
/// Search — all pure, so the copy is pinned without a television.
@MainActor
final class PlayerChromeTests: XCTestCase {

    private let now = Date(timeIntervalSince1970: 1_000_000)

    private func stop(actor: String?, label: String? = nil, agoSeconds: Double = 3 * 86_400) -> ChannelFeed.Stop {
        let at = (now.timeIntervalSince1970 - agoSeconds) * 1000
        let event = ChannelEvent(id: 1, at: at, kind: "publish", actor: actor, summary: nil,
                                 sceneId: 2, model: nil, intent: nil, harness: nil, label: label)
        return ChannelFeed.Stop(sceneId: 2, event: event)
    }

    // MARK: past line

    func testPastLineNamesTheSceneWhenAndWho() {
        let line = PlayerChrome.pastLine(stop: stop(actor: "spin", label: "From The Log"),
                                         sceneLabel: "Tidal Drift", now: now)
        XCTAssertTrue(line.hasPrefix("Earlier · Tidal Drift · "), line)
        XCTAssertTrue(line.hasSuffix(" · spin"), line)
        XCTAssertTrue(line.contains("3d"), line)
    }

    func testPastLineFallsBackToTheLoggedLabel() {
        let line = PlayerChrome.pastLine(stop: stop(actor: "spin", label: "From The Log"),
                                         sceneLabel: nil, now: now)
        XCTAssertTrue(line.contains("From The Log"), line)
        let blank = PlayerChrome.pastLine(stop: stop(actor: "spin", label: "From The Log"),
                                          sceneLabel: "", now: now)
        XCTAssertTrue(blank.contains("From The Log"), "an empty scene label is not a label")
    }

    func testARelayIsNotCreditedAsTheAuthor() {
        for relay in ["curator", "Scheduler", "nightly"] {
            let line = PlayerChrome.pastLine(stop: stop(actor: relay), sceneLabel: "Dusk", now: now)
            XCTAssertFalse(line.lowercased().contains(relay.lowercased()), line)
        }
    }

    func testPastLineWithNothingKnownStillSaysEarlier() {
        XCTAssertEqual(PlayerChrome.pastLine(stop: nil, sceneLabel: nil, now: now), "Earlier")
        let bare = PlayerChrome.pastLine(stop: stop(actor: nil), sceneLabel: nil, now: now)
        XCTAssertTrue(bare.hasPrefix("Earlier · "), bare)
        XCTAssertFalse(bare.hasSuffix(" · "), bare)
    }

    // MARK: credit line

    func testCreditLineIsNilWithoutAChannel() {
        XCTAssertNil(PlayerChrome.creditLine(for: nil, now: now))
    }

    func testCreditLineForAnUnsteeredChannelHasNoDanglingSeparator() {
        let quiet = PublicChannel(channelId: "q", label: "Quiet", tags: [], viewers: nil,
                                  sleeping: false, lastEventAt: nil)
        let line = PlayerChrome.creditLine(for: quiet, now: now)
        if let line {
            XCTAssertFalse(line.hasPrefix(" · ") || line.hasSuffix(" · "), line)
            XCTAssertFalse(line.isEmpty)
        }
    }

    // MARK: position line

    func testPositionLine() {
        XCTAssertEqual(PlayerChrome.positionLine(timeline: .live, stops: 0, surf: (4, 74)), "4 of 74")
        XCTAssertNil(PlayerChrome.positionLine(timeline: .live, stops: 0, surf: (1, 1)), "a lone channel has no ring")
        XCTAssertNil(PlayerChrome.positionLine(timeline: .live, stops: 0, surf: nil))
        XCTAssertEqual(PlayerChrome.positionLine(timeline: .past(0), stops: 5, surf: (4, 74)),
                       "1 of 5 back · Right for live")
        // Never "3 of 2": a stale stop count must not print nonsense.
        XCTAssertEqual(PlayerChrome.positionLine(timeline: .past(2), stops: 2, surf: nil),
                       "3 of 3 back · Right for live")
    }

    func testTimelineKeyIsDistinctPerStop() {
        XCTAssertEqual(PlayerChrome.timelineKey(.live), "live")
        XCTAssertEqual(PlayerChrome.timelineKey(.past(0)), "past-0")
        XCTAssertNotEqual(PlayerChrome.timelineKey(.past(1)), PlayerChrome.timelineKey(.past(2)))
    }

    // MARK: Settings / Search copy

    func testEveryTierAndClassHasPlainLanguage() {
        for tier in [CapabilityTier.t0, .t1, .t2, .t3] {
            let label = SettingsView.tierLabel(tier)
            XCTAssertFalse(label.lowercased().hasPrefix("t"), "tier codes mean nothing on a sofa: \(label)")
            XCTAssertTrue(label.contains(" — "))
        }
        let classes = [RenderClass.legacy, .standard, .high].map(SettingsView.classLabel)
        XCTAssertEqual(Set(classes).count, 3)
    }

    func testAnEmptyFilterSaysSoInWords() {
        XCTAssertEqual(SearchView.heading(for: .live, count: 0), "Nothing under Watching now right now")
        XCTAssertEqual(SearchView.heading(for: .tag("ocean"), count: 4), "#ocean · 4")
    }

    // MARK: Browse, as the TV uses it

    func testBrowseFiltersAndTagsOnTheTVTarget() {
        let week = ChannelBrowse.freshWindow
        let nowMs = Int(now.timeIntervalSince1970 * 1000)
        let channels = [
            PublicChannel(channelId: "a", label: "Alpha", tags: ["ocean", "featured"], viewers: 2,
                          sleeping: false, lastEventAt: nowMs),
            PublicChannel(channelId: "b", label: "Beta", tags: ["ocean", "release-3"], viewers: 0,
                          sleeping: false, lastEventAt: nowMs - Int(week * 1000) * 2),
        ]
        XCTAssertEqual(ChannelBrowse.apply(.all, to: channels, following: []).count, 2)
        XCTAssertEqual(ChannelBrowse.apply(.live, to: channels, following: []).map(\.id), ["a"])
        XCTAssertEqual(ChannelBrowse.apply(.tag("ocean"), to: channels, following: []).count, 2)
        XCTAssertEqual(ChannelBrowse.apply(.following, to: channels, following: ["b"]).map(\.id), ["b"])
        XCTAssertEqual(ChannelBrowse.search("#ocean alpha", in: channels).map(\.id), ["a"])
        let tags = ChannelBrowse.topTags(in: channels, limit: 8, excluding: ["featured", "test"])
        XCTAssertEqual(tags.first, "ocean")
        XCTAssertFalse(tags.contains("featured"))
        for filter in [ChannelBrowse.Filter.all, .live, .fresh, .following, .remixable, .tag("x")] {
            XCTAssertFalse(filter.title.isEmpty)
            XCTAssertFalse(filter.id.isEmpty)
        }
    }
}
