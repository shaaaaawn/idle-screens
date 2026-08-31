import XCTest
@testable import IdleScreensTV

final class ChannelSearchTests: XCTestCase {

    private func channel(_ id: String, label: String? = nil,
                         tags: [String] = [], steered: Int = 0,
                         featured: Bool = false) -> PublicChannel {
        PublicChannel(channelId: id, label: label ?? id,
                      tags: featured ? tags + ["featured"] : tags,
                      viewers: nil, lastEventAt: steered)
    }

    private let catalog = [
        ChannelCategory(id: "style-studies", title: "Style studies",
                        subtitle: nil, sort: 0, channelIds: ["evals-pointillist"]),
    ]

    private var channels: [PublicChannel] {
        [
            channel("lobby", label: "lobby", tags: ["featured", "ambient"]),
            channel("night-lanterns", label: "Night Lanterns", tags: ["ambient", "art"]),
            channel("evals-pointillist", label: "Pointillist Field", tags: ["eval", "style-study"]),
            channel("coral-tide-f2", label: "coral tide", tags: ["ambient"]),
        ]
    }

    func testEmptyQueryReturnsNothing() {
        XCTAssertTrue(ChannelSearch.results(query: "", channels: channels).isEmpty)
        XCTAssertTrue(ChannelSearch.results(query: "   ", channels: channels).isEmpty)
    }

    func testExactLabelOutranksTagMatch() {
        // "ambient" is a tag on lobby, but a channel literally named for the
        // query should never sit below one that merely carries it as a tag.
        let results = ChannelSearch.results(query: "lobby", channels: channels)
        XCTAssertEqual(results.first?.id, "lobby")
    }

    func testTagSearchFindsEveryChannelCarryingIt() {
        let results = ChannelSearch.results(query: "ambient", channels: channels)
        XCTAssertEqual(Set(results.map(\.id)), ["lobby", "night-lanterns", "coral-tide-f2"])
    }

    func testSearchIsCaseAndPunctuationInsensitive() {
        XCTAssertEqual(ChannelSearch.results(query: "NIGHT", channels: channels).first?.id,
                       "night-lanterns")
        XCTAssertEqual(ChannelSearch.results(query: "coral-tide", channels: channels).first?.id,
                       "coral-tide-f2")
    }

    func testAllTokensMustMatch() {
        // Two words mean both — "night lanterns" must not fall back to every
        // channel matching either word.
        let hit = ChannelSearch.results(query: "night lanterns", channels: channels)
        XCTAssertEqual(hit.map(\.id), ["night-lanterns"])
        let miss = ChannelSearch.results(query: "night pointillist", channels: channels)
        XCTAssertTrue(miss.isEmpty)
    }

    func testCategoryTitleIsSearchable() {
        // Nothing on the card says "style studies"; the shelf it sits on does.
        let results = ChannelSearch.results(query: "studies", channels: channels,
                                            categories: catalog)
        XCTAssertEqual(results.map(\.id), ["evals-pointillist"])
    }

    func testClassicSaverIdIsSearchable() {
        let warp = PublicChannel(channelId: "wild-signal", label: "wild signal",
                                 tags: [], viewers: nil, classicSaverId: "warp")
        let results = ChannelSearch.results(query: "warp", channels: [warp])
        XCTAssertEqual(results.map(\.id), ["wild-signal"])
    }

    func testSceneNameIsSearchable() {
        // The channel is called "default"; what is ON it is "Warp Tunnel".
        let c = PublicChannel(channelId: "default", label: "default", tags: [],
                              viewers: nil, saverLabel: "Warp Tunnel")
        XCTAssertEqual(ChannelSearch.results(query: "warp", channels: [c]).map(\.id),
                       ["default"])
        XCTAssertEqual(ChannelSearch.results(query: "tunnel", channels: [c]).map(\.id),
                       ["default"])
    }

    func testChannelDecodesSceneName() throws {
        let channel = try JSONDecoder().decode(
            PublicChannel.self,
            from: Data(#"{"id":"lobby","label":"lobby","saver":"Constellation"}"#.utf8))
        XCTAssertEqual(channel.saverLabel, "Constellation")
    }

    func testNoMatchIsEmptyNotEverything() {
        XCTAssertTrue(ChannelSearch.results(query: "zzzznope", channels: channels).isEmpty)
    }

    func testTiesBreakOnFeaturedThenRecency() {
        let a = channel("tag-a", label: "A", tags: ["calm"], steered: 1)
        let b = channel("tag-b", label: "B", tags: ["calm"], steered: 9)
        let c = channel("tag-c", label: "C", tags: ["calm"], steered: 2, featured: true)
        let results = ChannelSearch.results(query: "calm", channels: [a, b, c])
        XCTAssertEqual(results.map(\.id), ["tag-c", "tag-b", "tag-a"])
    }

    func testPopularTagsSkipFeaturedAndRankByCount() {
        let tags = ChannelSearch.popularTags(in: channels, limit: 3)
        XCTAssertFalse(tags.contains("featured"), "not a browsable category")
        XCTAssertEqual(tags.first, "ambient", "most common first")
    }
}
