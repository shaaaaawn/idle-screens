import XCTest
@testable import IdleScreensTV

/// The running order is a contract shared with the web gallery
/// (site/src/features/gallery/Gallery.tsx). These pin the rules that make the
/// two surfaces agree; if the web order changes, these should fail first.
final class HomeSectionsTests: XCTestCase {

    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private var nowMs: Int { Int(now.timeIntervalSince1970 * 1000) }
    private var day: Int { 24 * 60 * 60 * 1000 }

    private func channel(_ id: String,
                         tags: [String] = [],
                         created: Int = 0,
                         steered: Int = 0) -> PublicChannel {
        PublicChannel(channelId: id, label: id, tags: tags, viewers: nil,
                      createdAt: created, lastEventAt: steered)
    }

    func testRunningOrderMatchesTheWeb() {
        let channels = [
            channel("plain-a", created: 0, steered: 10),
            channel("feat", tags: ["featured"], steered: 1),
            channel("study", tags: ["style-study"], steered: 5),
            channel("eval", tags: ["eval"], steered: 6),
        ]
        let sections = HomeSections.build(channels: channels, categories: [], now: now)
        XCTAssertEqual(sections.map(\.id), ["featured", "evals", "other"])
        XCTAssertEqual(sections[0].channels.map(\.id), ["feat"])
        // Both eval tags land on one shelf, most-recently-steered first.
        XCTAssertEqual(sections[1].channels.map(\.id), ["eval", "study"])
        XCTAssertEqual(sections[2].subtitle, "1 channels")
    }

    func testFeaturedOutranksRecency() {
        // Without the featured key the curated channels sink below whatever
        // an agent last touched — the bug the web sort exists to prevent.
        let channels = [
            channel("busy", steered: 9_999),
            channel("curated", tags: ["featured"], steered: 1),
        ]
        let sections = HomeSections.build(channels: channels, categories: [], now: now)
        XCTAssertEqual(sections.first?.channels.first?.id, "curated")
    }

    func testChannelAppearsInExactlyOneSection() {
        // A style-study that is ALSO in a category must not be listed twice.
        let channels = (1...4).map { channel("s\($0)", tags: ["style-study"], steered: $0) }
        let category = ChannelCategory(id: "style-studies", title: "Style studies",
                                       subtitle: nil, sort: 0,
                                       channelIds: channels.map(\.id))
        let sections = HomeSections.build(channels: channels, categories: [category], now: now)
        let ids = sections.flatMap { $0.channels.map(\.id) }
        XCTAssertEqual(ids.count, Set(ids).count, "a channel was listed on two shelves")
        // Evals is taken before curated shelves, so the category is emptied.
        XCTAssertEqual(sections.map(\.id), ["evals"])
    }

    func testThinCategoryIsNotAShelf() {
        // A row of one is a stranded card; it stays in the tail.
        let channels = [channel("a", steered: 3), channel("b", steered: 2)]
        let thin = ChannelCategory(id: "duo", title: "Duo", subtitle: nil, sort: 0,
                                   channelIds: ["a", "b"])
        let sections = HomeSections.build(channels: channels, categories: [thin], now: now)
        XCTAssertEqual(sections.map(\.id), ["other"])
    }

    func testCategoryShelfRendersAtThreshold() {
        let channels = (1...3).map { channel("c\($0)", steered: $0) }
        let category = ChannelCategory(id: "moods", title: "Moods",
                                       subtitle: "Slow ones", sort: 0,
                                       channelIds: channels.map(\.id))
        let sections = HomeSections.build(channels: channels, categories: [category], now: now)
        XCTAssertEqual(sections.map(\.id), ["moods"])
        XCTAssertEqual(sections[0].title, "Moods")
        XCTAssertEqual(sections[0].subtitle, "Slow ones")
    }

    func testLatestWindowExcludesSeededAndStaleChannels() {
        let channels = [
            channel("seeded", created: 0, steered: 1),                 // demo channels
            channel("stale", created: nowMs - 60 * day, steered: 2),   // older than the window
            channel("new", created: nowMs - day, steered: 3),
        ]
        let sections = HomeSections.build(channels: channels, categories: [], now: now)
        XCTAssertEqual(sections.map(\.id), ["latest", "other"])
        XCTAssertEqual(sections[0].channels.map(\.id), ["new"])
        XCTAssertEqual(sections[0].subtitle, "Newest on the wall")
    }

    func testLatestIsCappedAndSortedByCreation() {
        // Sorted by createdAt, NOT the recency key: otherwise it just
        // re-lists the busiest channels under a fresh-sounding name.
        let channels = (1...8).map {
            channel("n\($0)", created: nowMs - $0 * 1000, steered: $0)
        }
        let sections = HomeSections.build(channels: channels, categories: [], now: now)
        let latest = sections.first { $0.id == "latest" }
        XCTAssertEqual(latest?.channels.count, HomeSections.maximumLatest)
        XCTAssertEqual(latest?.channels.first?.id, "n1", "newest first")
        XCTAssertEqual(latest?.subtitle, "6 newest on the wall")
    }

    func testShelvesOwnTheirTags() {
        let sections = HomeSections.build(
            channels: [channel("f", tags: ["featured", "ambient"]),
                       channel("e", tags: ["eval"])],
            categories: [], now: now)
        XCTAssertEqual(sections[0].ownedTags, ["featured"])
        XCTAssertEqual(sections[1].ownedTags, ["eval", "style-study"])
    }

    func testHeroIsLiftedOutOfTheFirstShelf() {
        let channels = [
            channel("hero", tags: ["featured"], steered: 9),
            channel("second", tags: ["featured"], steered: 8),
            channel("tail", steered: 1),
        ]
        let layout = HomeSections.layout(channels: channels, categories: [], now: now)
        XCTAssertEqual(layout.hero?.id, "hero")
        // The hero must not also appear as a card under itself.
        XCTAssertEqual(layout.sections.first?.channels.map(\.id), ["second"])
        XCTAssertFalse(layout.sections.flatMap { $0.channels.map(\.id) }.contains("hero"))
    }

    func testSoleFeaturedChannelLeavesNoEmptyShelf() {
        let layout = HomeSections.layout(
            channels: [channel("only", tags: ["featured"]), channel("tail", steered: 1)],
            categories: [], now: now)
        XCTAssertEqual(layout.hero?.id, "only")
        XCTAssertEqual(layout.sections.map(\.id), ["other"])
    }

    func testEmptyGalleryIsEmpty() {
        let layout = HomeSections.layout(channels: [], categories: [], now: now)
        XCTAssertNil(layout.hero)
        XCTAssertTrue(layout.sections.isEmpty)
    }

    func testCategoryDecodesMembershipFromTheEndpoint() throws {
        let json = """
        {"id":"style-studies","title":"Style studies","subtitle":"Eval-derived",
         "sort":0,"channels":[{"id":"a"},{"id":"b"}]}
        """
        let category = try JSONDecoder().decode(ChannelCategory.self, from: Data(json.utf8))
        XCTAssertEqual(category.channelIds, ["a", "b"])
    }

    func testChannelDecodesSortKeys() throws {
        let json = """
        {"id":"lobby","createdAt":1784225977286,
         "lastEvent":{"at":1787734846311,"actor":"curator"}}
        """
        let channel = try JSONDecoder().decode(PublicChannel.self, from: Data(json.utf8))
        XCTAssertEqual(channel.createdAt, 1784225977286)
        XCTAssertEqual(channel.lastEventAt, 1787734846311)
    }
}
