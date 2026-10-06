import XCTest
@testable import IdleScreensTV

/// TVAppState driven the way the television drives it: a gallery from the
/// (stubbed) server, socket events by hand, the remote's keys as calls.
@MainActor
final class AppStateFlowTests: XCTestCase {

    private static let gallery = ##"""
    [{"id":"old","label":"Old","tags":[],"sleeping":false,"lastEvent":{"at":1,"actor":"spin"}},
     {"id":"newest","label":"Newest","tags":["featured"],"sleeping":false,"lastEvent":{"at":9,"actor":"spin"}},
     {"id":"mid","label":"Mid","tags":[],"sleeping":false,"lastEvent":{"at":5,"actor":"spin"}},
     {"id":"moon","label":"Moon","tags":[],"sleeping":true,"lastEvent":{"at":99,"actor":"spin"}}]
    """##

    private func makeApp(routes: [String: String] = ["/api/channels": AppStateFlowTests.gallery]) -> TVAppState {
        let base = URL(string: "https://flow-stub.test")!
        let transport = StubTransport(routes: routes)
        return TVAppState(gallery: GalleryClient(baseURL: base, transport: transport),
                          mcp: MCPClient(baseURL: base, transport: transport),
                          ws: ChannelWSClient(),
                          pair: PairClient(baseURL: base, transport: transport),
                          baseURL: base)
    }

    private func json(_ text: String) -> JSONValue {
        try! JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
    }

    private let dots = ##"{"seed":1,"layers":[{"count":3,"sprite":{"kind":"circle","radius":[0.01,0.02],"color":"#fff"},"motion":{"type":"static"}}]}"##

    // MARK: - Gallery

    func testGalleryLoadsFromTheServer() async {
        let app = makeApp()
        await app.loadGallery()
        XCTAssertEqual(Set(app.channels.map(\.id)), ["old", "newest", "mid", "moon"])
        XCTAssertNil(app.galleryError)
        XCTAssertFalse(app.isLoadingGallery)
    }

    func testAFailedRefreshKeepsWhatIsAlreadyOnScreen() async {
        let app = makeApp()
        await app.loadGallery()
        let shown = app.channels
        // Same host (so the same disk cache), now answering 404 to everything.
        let dead = makeApp(routes: [:])
        await dead.loadGallery()
        XCTAssertEqual(dead.channels.map(\.id), shown.map(\.id), "cache-first survives an outage")
        XCTAssertNil(dead.galleryError, "an error is only worth showing when there is nothing else to show")
    }

    // MARK: - Surfing

    func testSurfWalksTheFeedOrderAndKeepsTheSurface() async {
        let app = makeApp()
        await app.loadGallery()
        app.selectChannel("newest", from: .search)
        XCTAssertEqual(app.surfPosition?.index, 1)
        XCTAssertEqual(app.surfPosition?.count, 3, "the sleeping channel is not a stop")

        app.surf(1)
        XCTAssertEqual(app.selectedChannelId, "mid")
        XCTAssertEqual(app.presentingSurface, .search, "Back must still return to Search")
        XCTAssertEqual(app.surfPosition?.index, 2)

        app.surf(-1); app.surf(-1)
        XCTAssertEqual(app.selectedChannelId, "old", "the ring wraps")
        app.surf(0)
        XCTAssertEqual(app.selectedChannelId, "old")
    }

    func testSurfingClearsThePreviousChannelsPicture() async {
        let app = makeApp()
        await app.loadGallery()
        app.selectChannel("newest")
        app.handle(.scene(spec: json(dots), seed: 1))
        XCTAssertFalse(app.compiledScene.isEmpty)
        app.handle(.overlay(text: "hello", ttl: 60_000))
        app.surf(1)
        XCTAssertEqual(app.timeline, .live)
        XCTAssertNil(app.pastScene)
    }

    func testSurfOnAnEmptyGalleryIsANoOp() {
        let app = makeApp(routes: [:])
        app.selectChannel("solo")
        app.surf(1)
        XCTAssertEqual(app.selectedChannelId, "solo")
        XCTAssertNil(app.surfPosition)
    }

    // MARK: - Leaving

    func testExitReturnsToTheGridAndRemembersTheChannel() async {
        let app = makeApp()
        await app.loadGallery()
        app.selectChannel("mid")
        app.handle(.overlay(text: "hi", ttl: 60_000))
        app.exitChannel()
        XCTAssertNil(app.selectedChannelId)
        XCTAssertNil(app.overlayText)
        XCTAssertEqual(app.timeline, .live)
        XCTAssertEqual(app.lastChannelId, "mid", "a paired phone still reaches this TV on the grid")
    }

    // MARK: - Socket events

    func testSleepWakeAndViewerCount() {
        let app = makeApp()
        app.selectChannel("mid")
        app.handle(.sleep)
        XCTAssertTrue(app.sleeping)
        app.handle(.wake)
        XCTAssertFalse(app.sleeping)
    }

    func testAPhonePushSwitchesChannelAndMarksThePairing() {
        let app = makeApp()
        app.selectChannel("mid", from: .search)
        XCTAssertNil(app.phonePushAt)
        app.handle(.switchChannel(channelId: "old"))
        XCTAssertEqual(app.selectedChannelId, "old")
        XCTAssertEqual(app.presentingSurface, .grid, "a push lands on the gallery's player")
        XCTAssertNotNil(app.phonePushAt)
        // The same-channel ack is a pairing cue, not a reload.
        app.handle(.switchChannel(channelId: "old"))
        app.handle(.switchChannel(channelId: ""))
        app.handle(.switchChannel(channelId: nil))
        XCTAssertEqual(app.selectedChannelId, "old")
    }

    func testAClassicSceneRoutesToItsNativePort() {
        let app = makeApp()
        app.selectChannel("tank")
        app.handle(.scene(spec: json(##"{"id":"metaquarium"}"##), seed: 4))
        XCTAssertTrue(app.isClassicSpec)
        XCTAssertEqual(app.classicSaverId, "metaquarium")
        // …and a schema scene afterwards takes the screen back.
        app.handle(.scene(spec: json(dots), seed: 1))
        XCTAssertFalse(app.isClassicSpec)
        XCTAssertEqual(app.compiledScene.first?.entities.count, 3)
    }

    func testGarbageOnTheSocketNeverTakesThePictureDown() {
        let app = makeApp()
        app.selectChannel("mid")
        app.handle(.scene(spec: json(dots), seed: 1))
        for junk in ["null", "[]", "42", ##""text""##, "{}", ##"{"layers":"nope"}"##, ##"{"layers":[{"count":"x"}]}"##] {
            app.handle(.scene(spec: json(junk), seed: nil))
        }
        app.handle(.scene(spec: nil, seed: nil))
        app.handle(.delta(json("{}")))
        // Whatever the junk did, the app is still standing and answers.
        XCTAssertEqual(app.selectedChannelId, "mid")
    }

    // MARK: - Classic track params

    func testTrackParamsFlattenToStrings() {
        let scene = json(##"""
        {"spec":{"id":"metaquarium"},"track":{"deltas":[
          {"t":0,"path":"environment","value":"reef"},
          {"t":0,"path":"count","value":12},
          {"t":0,"path":"speed","value":1.5},
          {"t":0,"path":"whole","value":3.0},
          {"t":0,"path":"rays","value":true},
          {"t":0,"path":"nested","value":{"a":1}},
          {"t":0,"value":"no path"},
          "not a delta",
          {"t":5,"path":"environment","value":"kelp"}]}}
        """##)
        let params = TVAppState.trackParams(from: scene)
        XCTAssertEqual(params["environment"], "kelp", "last write wins")
        XCTAssertEqual(params["count"], "12")
        XCTAssertEqual(params["speed"], "1.5")
        XCTAssertEqual(params["whole"], "3")
        XCTAssertEqual(params["rays"], "true")
        XCTAssertNil(params["nested"])
        XCTAssertEqual(params.count, 5)
    }

    func testTrackParamsToleratesEveryWrongShape() {
        XCTAssertEqual(TVAppState.trackParams(from: nil), [:])
        for shape in ["null", "[]", "{}", ##"{"track":1}"##, ##"{"track":{}}"##, ##"{"track":{"deltas":{}}}"##] {
            XCTAssertEqual(TVAppState.trackParams(from: json(shape)), [:], shape)
        }
    }

    // MARK: - Sequences

    private let twoActs = ##"""
    {"format":"idle-sequence","schemaVersion":1,"id":"acts","seed":3,"loop":true,"segments":[
      {"key":"one","duration":60000,"transition":{"type":"cut"},
       "scene":{"layers":[{"count":2,"sprite":{"kind":"circle","radius":[0.01,0.02],"color":"#fff"},"motion":{"type":"static"}}]}},
      {"key":"two","duration":60000,"transition":{"type":"morph","duration":1500},
       "scene":{"layers":[{"count":5,"sprite":{"kind":"circle","radius":[0.01,0.02],"color":"#fff"},"motion":{"type":"static"}}]}}]}
    """##

    func testASequenceOpensOnItsFirstAct() {
        let app = makeApp()
        app.selectChannel("stage")
        app.handle(.scene(spec: json(twoActs), seed: 3))
        XCTAssertNotNil(app.activeSequence)
        XCTAssertEqual(app.sequenceSegmentKey, "one")
        XCTAssertEqual(app.compiledScene.first?.entities.count, 2)
        XCTAssertEqual(app.sequenceCrossfade, 0, "a cut is a cut")
    }

    func testARepeatedSnapshotDoesNotRestartTheShow() {
        let app = makeApp()
        app.selectChannel("stage")
        app.handle(.scene(spec: json(twoActs), seed: 3))
        let first = app.activeSequence
        app.handle(.scene(spec: json(twoActs), seed: 3))
        XCTAssertEqual(app.activeSequence, first)
        XCTAssertEqual(app.sequenceSegmentKey, "one")
    }

    func testAPlainSceneEndsTheSequence() {
        let app = makeApp()
        app.selectChannel("stage")
        app.handle(.scene(spec: json(twoActs), seed: 3))
        app.handle(.scene(spec: json(dots), seed: 1))
        XCTAssertNil(app.activeSequence)
        XCTAssertNil(app.sequenceSegmentKey)
        XCTAssertEqual(app.compiledScene.first?.entities.count, 3)
    }

    // MARK: - App lifecycle

    func testBackgroundThenForegroundIsSafeOnTheGridAndInAChannel() async {
        let app = makeApp()
        app.scenePhaseChanged(active: true)     // cold boot edge: nothing open yet
        app.scenePhaseChanged(active: false)
        app.scenePhaseChanged(active: true)
        app.selectChannel("mid")
        app.scenePhaseChanged(active: false)
        app.scenePhaseChanged(active: false)    // a doubled edge must not crash
        app.scenePhaseChanged(active: true)
        XCTAssertEqual(app.selectedChannelId, "mid")
        app.exitChannel()
    }

    // MARK: - Ambient settings

    func testRotateMinutesPersistsAndClampsNothingSurprising() {
        let saved = UserDefaults.standard.integer(forKey: TVAppState.rotateMinutesKey)
        defer { UserDefaults.standard.set(saved, forKey: TVAppState.rotateMinutesKey) }
        let app = makeApp()
        app.rotateMinutes = 15
        XCTAssertEqual(UserDefaults.standard.integer(forKey: TVAppState.rotateMinutesKey), 15)
        XCTAssertEqual(makeApp().rotateMinutes, 15, "a relaunch keeps the choice")
        app.rotateMinutes = 0
        XCTAssertEqual(makeApp().rotateMinutes, 0)
    }
}
