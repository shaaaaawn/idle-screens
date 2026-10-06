import XCTest
@testable import IdleScreens

final class ChannelBrowseTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 2_000_000_000)
    private var nowMs: Int { Int(now.timeIntervalSince1970 * 1000) }

    private func channel(_ id: String, label: String? = nil, tags: [String]? = nil, viewers: Int? = nil,
                         sleeping: Bool? = nil, lastEventAt: Int? = nil, saver: String? = nil,
                         steer: PublicChannel.Steer? = nil, protected: Bool? = nil) -> PublicChannel {
        PublicChannel(channelId: id, label: label, tags: tags, viewers: viewers, sleeping: sleeping,
                      lastEventAt: lastEventAt, saverLabel: saver, lastSteer: steer, isProtected: protected)
    }

    func testLiveMeansWatchedAndAwakeMostWatchedFirst() {
        let all = [channel("quiet"), channel("busy", viewers: 9), channel("some", viewers: 2),
                   channel("asleep", viewers: 5, sleeping: true)]
        XCTAssertEqual(ChannelBrowse.apply(.live, to: all, following: [], now: now).map(\.id), ["busy", "some"])
    }

    func testFreshIsTheLastWeekNewestFirst() {
        let day = 24 * 3600 * 1000
        let all = [channel("old", lastEventAt: nowMs - 8 * day), channel("yesterday", lastEventAt: nowMs - day),
                   channel("today", lastEventAt: nowMs - 1000), channel("never")]
        XCTAssertEqual(ChannelBrowse.apply(.fresh, to: all, following: [], now: now).map(\.id), ["today", "yesterday"])
    }

    func testFollowingOpenAndTagFilters() {
        let all = [channel("a", tags: ["ocean"], protected: true), channel("b", tags: ["ocean", "calm"]), channel("c")]
        XCTAssertEqual(ChannelBrowse.apply(.following, to: all, following: ["c", "gone"]).map(\.id), ["c"])
        XCTAssertEqual(ChannelBrowse.apply(.remixable, to: all, following: []).map(\.id), ["b", "c"])
        XCTAssertEqual(ChannelBrowse.apply(.tag("ocean"), to: all, following: []).map(\.id), ["a", "b"])
    }

    func testSearchNeedsEveryWordAndLooksAtArtistAndTags() {
        let claude = PublicChannel.Steer(actor: "Spin", harness: "pi", model: "claude-opus", summary: nil)
        let all = [channel("tides", label: "Low Tide", tags: ["ocean"], steer: claude),
                   channel("reef", tags: ["ocean"]), channel("warp", saver: "Starfield")]
        XCTAssertEqual(ChannelBrowse.search("ocean", in: all).map(\.id), ["tides", "reef"])
        XCTAssertEqual(ChannelBrowse.search("claude OCEAN", in: all).map(\.id), ["tides"])
        XCTAssertEqual(ChannelBrowse.search("#ocean spin", in: all).map(\.id), ["tides"])
        XCTAssertEqual(ChannelBrowse.search("starfield", in: all).map(\.id), ["warp"])
        XCTAssertEqual(ChannelBrowse.search("   ", in: all).count, 3)
        XCTAssertTrue(ChannelBrowse.search("nothing-here", in: all).isEmpty)
    }

    func testTopTagsNeedTwoChannelsAndSkipHousekeeping() {
        let all = [channel("a", tags: ["ocean", "featured", "solo"]), channel("b", tags: ["ocean", "calm", "featured"]),
                   channel("c", tags: ["calm", "ocean"])]
        XCTAssertEqual(ChannelBrowse.topTags(in: all), ["ocean", "calm"])
        XCTAssertEqual(ChannelBrowse.topTags(in: all, limit: 1), ["ocean"])
    }
}
