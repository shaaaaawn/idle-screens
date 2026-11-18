import XCTest

/// The Top Shelf carousel's picks (`IdleScreensTVTopShelf/TopShelfCatalog.swift`,
/// compiled into this target): which channels, in what order, with what words,
/// and which ones ask the server for a motion clip.
final class TopShelfCatalogTests: XCTestCase {

    private let base = URL(string: "https://idlescreens.com")!

    private func channel(_ id: String, label: String? = nil, tags: [String]? = nil, viewers: Int? = nil,
                         sleeping: Bool? = nil, saver: String? = nil) -> TopShelfCatalog.Channel {
        TopShelfCatalog.Channel(id: id, label: label, tags: tags, viewers: viewers, sleeping: sleeping, saver: saver)
    }

    func testFeaturedFirstThenMostWatchedAndNeverAsleep() {
        let entries = TopShelfCatalog.entries(from: [
            channel("quiet", viewers: 1),
            channel("lobby", tags: ["featured"]),
            channel("busy", viewers: 9),
            channel("napping", tags: ["featured"], sleeping: true),
            channel("math", tags: ["featured", "math"], viewers: 2),
            channel(""),
        ], baseURL: base)
        XCTAssertEqual(entries.map(\.id), ["lobby", "math", "busy", "quiet"])
        XCTAssertEqual(entries.map(\.context), ["Featured", "Featured", "Live now", "Live now"])
    }

    func testCapsAtTheCarouselsEight() {
        let many = (0..<20).map { channel("c\($0)", tags: ["featured"]) }
        XCTAssertEqual(TopShelfCatalog.entries(from: many, baseURL: base).count, TopShelfCatalog.maxItems)
    }

    func testOnlyFeaturedChannelsAskForAClip() {
        let entries = TopShelfCatalog.entries(from: [channel("fishtank", tags: ["featured"]), channel("other", viewers: 3)], baseURL: base)
        XCTAssertEqual(entries[0].previewVideoURL?.absoluteString, "https://idlescreens.com/c/fishtank/preview.mp4")
        XCTAssertNil(entries[1].previewVideoURL)
        XCTAssertEqual(entries[0].imageURL.absoluteString, "https://idlescreens.com/c/fishtank/og.jpg")
        XCTAssertEqual(entries[0].link.absoluteString, "idlescreens://channel/fishtank")
    }

    func testWordsReadAsTitles() {
        let e = TopShelfCatalog.entries(from: [
            channel("lobby", label: "lobby", tags: ["featured"], viewers: 1, saver: "Cloudbank, Golden Hour"),
            channel("ipad", label: "iPad wall", tags: ["featured", "deep-sea"], saver: "metaquarium"),
            channel("bare", tags: ["featured"]),
        ], baseURL: base)
        XCTAssertEqual(e.map(\.title), ["Lobby", "iPad wall", "Bare"])
        XCTAssertEqual(e[0].summary, "Now showing Cloudbank, Golden Hour")
        XCTAssertEqual(e[1].summary, "Now showing Metaquarium")
        XCTAssertNil(e[2].summary)
        XCTAssertNil(e[0].genre, "featured alone is no genre")
        XCTAssertEqual(e[1].genre, "Deep sea")
        XCTAssertEqual(TopShelfCatalog.watchingText(e[0].watching), "1 screen")
        XCTAssertEqual(TopShelfCatalog.watchingText(10), "10 screens")
        XCTAssertNil(TopShelfCatalog.watchingText(0))
    }

    func testDecodesTheSlimListing() throws {
        let json = #"[{"id":"math","label":"Math","tags":["featured","math"],"sleeping":false,"viewers":10,"saver":"Cut Into Loops","lastEvent":{"at":1}}]"#
        let channels = try JSONDecoder().decode([TopShelfCatalog.Channel].self, from: Data(json.utf8))
        XCTAssertEqual(channels.first?.saver, "Cut Into Loops")
        XCTAssertEqual(TopShelfCatalog.channelsURL(baseURL: base).absoluteString, "https://idlescreens.com/api/channels?slim=1")
    }
}
