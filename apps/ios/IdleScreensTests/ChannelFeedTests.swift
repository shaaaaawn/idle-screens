import XCTest
@testable import IdleScreens

/// The feed's two judgement calls: which channel comes first, and which moments
/// of a channel's past are worth a swipe.
final class ChannelFeedOrderTests: XCTestCase {
    private func channel(_ id: String, steeredAt: Int?, sleeping: Bool = false,
                         access: String? = nil) -> PublicChannel {
        PublicChannel(channelId: id, label: nil, tags: nil, viewers: nil,
                      sleeping: sleeping, lastEventAt: steeredAt, access: access)
    }

    func testLatestUpdateComesFirst() {
        let feed = ChannelFeed.latestFirst([
            channel("old", steeredAt: 100), channel("new", steeredAt: 300), channel("mid", steeredAt: 200),
        ])
        XCTAssertEqual(feed.map(\.id), ["new", "mid", "old"])
    }

    /// A sleeping channel is a moon and a sentence. However recently it was
    /// touched, it must not be the first thing someone opening the app sees.
    func testSleepingChannelsGoToTheBack() {
        let feed = ChannelFeed.latestFirst([
            channel("asleep", steeredAt: 999, sleeping: true), channel("awake", steeredAt: 1),
        ])
        XCTAssertEqual(feed.map(\.id), ["awake", "asleep"])
    }

    /// A private channel gates every read. Without its token the page could
    /// only ever show a failure, so it is not offered at all.
    func testPrivateChannelsNeedAToken() {
        let channels = [channel("mine", steeredAt: 2, access: "private"),
                        channel("theirs", steeredAt: 3, access: "private"),
                        channel("open", steeredAt: 1, access: "public")]
        let feed = ChannelFeed.latestFirst(channels) { $0.id == "mine" }
        XCTAssertEqual(feed.map(\.id), ["mine", "open"])
    }

    /// The API's order is not guaranteed. A feed that reshuffles equal entries
    /// between refreshes loses your place.
    func testTiesAreStable() {
        let a = ChannelFeed.latestFirst([channel("b", steeredAt: 5), channel("a", steeredAt: 5)])
        let b = ChannelFeed.latestFirst([channel("a", steeredAt: 5), channel("b", steeredAt: 5)])
        XCTAssertEqual(a.map(\.id), ["a", "b"])
        XCTAssertEqual(a.map(\.id), b.map(\.id))
    }

    func testNeverSteeredSortsLast() {
        let feed = ChannelFeed.latestFirst([channel("never", steeredAt: nil), channel("once", steeredAt: 1)])
        XCTAssertEqual(feed.map(\.id), ["once", "never"])
    }
}

final class ChannelFeedStopsTests: XCTestCase {
    private func events(_ rows: [(id: Int, at: Double, sceneId: Int?)]) throws -> [ChannelEvent] {
        let body = rows.map {
            #"{"id":\#($0.id),"at":\#($0.at),"kind":"publish","sceneId":\#($0.sceneId.map(String.init) ?? "null")}"#
        }.joined(separator: ",")
        let data = #"{"events":[\#(body)],"hasMore":false}"#.data(using: .utf8)!
        return try JSONDecoder().decode(ChannelHistoryPage.self, from: data).events
    }

    /// The newest scene IS the live page. Meeting it again one swipe later
    /// reads as a bug, so history starts at the one before.
    func testTheLiveSceneIsNotAlsoAHistoryStop() throws {
        let stops = ChannelFeed.stops(from: try events([(1, 100, 10), (2, 200, 20), (3, 300, 30)]))
        XCTAssertEqual(stops.map(\.sceneId), [20, 10])
    }

    /// An overlay or a setParam has no frame to return to.
    func testOnlySceneBackedEventsBecomeStops() throws {
        let stops = ChannelFeed.stops(from: try events([(1, 100, 10), (2, 150, nil), (3, 200, 20), (4, 250, nil)]))
        XCTAssertEqual(stops.map(\.sceneId), [10])
    }

    /// A scene recalled or re-scheduled airs twice. The strip is a list of
    /// pictures, not of log lines — it appears once, at its latest airing.
    func testARepeatedSceneAppearsOnceAtItsLatestAiring() throws {
        let stops = ChannelFeed.stops(from: try events([(1, 100, 10), (2, 200, 20), (3, 300, 10), (4, 400, 30)]))
        XCTAssertEqual(stops.map(\.sceneId), [10, 20])
        XCTAssertEqual(stops.first?.event.at, 300)
    }

    func testOrderDoesNotDependOnTheServersOrder() throws {
        let stops = ChannelFeed.stops(from: try events([(3, 300, 30), (1, 100, 10), (2, 200, 20)]))
        XCTAssertEqual(stops.map(\.sceneId), [20, 10])
    }

    func testAChannelWithOneSceneHasNoPast() throws {
        XCTAssertTrue(ChannelFeed.stops(from: try events([(1, 100, 10)])).isEmpty)
        XCTAssertTrue(ChannelFeed.stops(from: []).isEmpty)
    }

    func testStopsAreCapped() throws {
        let many = (1...60).map { (id: $0, at: Double($0), sceneId: Optional($0)) }
        XCTAssertEqual(ChannelFeed.stops(from: try events(many), limit: 24).count, 24)
    }
}

/// Shapes captured from `GET /c/lobby/scene/182` on 2026-09-19.
final class RecordedSceneTests: XCTestCase {
    private func decode(_ json: String) throws -> RecordedScene {
        try JSONDecoder().decode(RecordedScene.self, from: json.data(using: .utf8)!)
    }

    func testSchemaSceneDecodesWithItsSeed() throws {
        let scene = try decode("""
        {"id":182,"seed":1980,"label":"Mandelbrot Engine III","publishedAt":1788000000000,"author":"curator",
         "spec":{"schemaVersion":1,"id":"mandelbrot","label":"Mandelbrot Engine III",
                 "layers":[{"count":10,"sprite":{"kind":"circle"}}]}}
        """)
        XCTAssertEqual(scene.seed, 1980)
        XCTAssertEqual(scene.label, "Mandelbrot Engine III")
        XCTAssertNotNil(scene.spec)
        XCTAssertNil(scene.classicSaverId)
    }

    /// `{"id":"warp"}` has no layers. It must surface as a classic saver, not
    /// as an empty schema scene that draws a black page.
    func testClassicSaverIsRecognised() throws {
        let scene = try decode(#"{"id":7,"seed":3,"spec":{"id":"warp"}}"#)
        XCTAssertNil(scene.spec)
        XCTAssertEqual(scene.classicSaverId, "warp")
        XCTAssertEqual(scene.label, "warp")
    }

    func testSequencePostersItsFirstSegment() throws {
        let scene = try decode("""
        {"id":9,"seed":1,"spec":{"format":"idle-sequence","id":"triptych","segments":[
          {"key":"dawn","duration":4,"scene":{"id":"dawn","label":"Dawn","layers":[{"count":3,"sprite":{"kind":"circle"}}]}},
          {"key":"noon","duration":4,"scene":{"id":"noon","layers":[{"count":3,"sprite":{"kind":"circle"}}]}}]}}
        """)
        XCTAssertEqual(scene.spec?.id, "dawn")
        XCTAssertNil(scene.classicSaverId)
    }
}

/// Which past scenes get the web engine. The aquarium's native port is a 2D
/// stand-in that ignores the scene's staging; everything the phone CAN draw
/// faithfully must stay native, because a WebView per history page is the
/// expensive path.
final class WebEngineHistoryTests: XCTestCase {
    private func decode(_ json: String) throws -> RecordedScene {
        try JSONDecoder().decode(RecordedScene.self, from: json.data(using: .utf8)!)
    }

    func testTheTankGoesToTheWebEngineAndNativeScenesDoNot() throws {
        XCTAssertTrue(try decode(#"{"id":1,"seed":1,"spec":{"id":"metaquarium","params":{"fishCount":3}}}"#).needsWebEngine)
        XCTAssertFalse(try decode(#"{"id":2,"seed":1,"spec":{"id":"warp"}}"#).needsWebEngine)
        XCTAssertFalse(try decode("""
        {"id":3,"seed":1,"spec":{"schemaVersion":1,"id":"x","label":"x","layers":[{"count":1,"sprite":{"kind":"circle"}}]}}
        """).needsWebEngine)
    }

    func testPinnedSceneRidesTheURLAndNothingElseDoes() {
        let base = URL(string: "https://idlescreens.com")!
        XCTAssertEqual(WebSceneView.sceneURL(baseURL: base, channelId: "fishtank", sceneId: 412).absoluteString,
                       "https://idlescreens.com/channel/fishtank?chrome=off&scene=412")
        XCTAssertEqual(WebSceneView.sceneURL(baseURL: base, channelId: "fishtank").absoluteString,
                       "https://idlescreens.com/channel/fishtank?chrome=off")
        XCTAssertEqual(WebSceneView.sceneURL(baseURL: base, channelId: "fishtank", sceneId: 0).absoluteString,
                       "https://idlescreens.com/channel/fishtank?chrome=off")
    }
}
