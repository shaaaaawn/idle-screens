import XCTest
@testable import IdleScreensTV

/// Serves canned bodies by URL path, so app-state flows run end to end with
/// no network. Anything unlisted is a 404 — like the real server.
struct StubTransport: HTTPTransport {
    var routes: [String: String]

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let path = request.url?.path ?? ""
        // A route may pin a query (`/c/x/history?before=7`); the bare path
        // answers everything else.
        let before = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?
            .queryItems?.first { $0.name == "before" }?.value
        let body = before.flatMap { routes["\(path)?before=\($0)"] } ?? routes[path]
        let response = HTTPURLResponse(url: request.url!, statusCode: body == nil ? 404 : 200,
                                       httpVersion: nil, headerFields: nil)!
        return (Data((body ?? "{}").utf8), response)
    }
}

@MainActor
final class TimelineTests: XCTestCase {

    // MARK: - Pure stepping

    func testLeftStepsOlderAndStopsAtTheOldestScene() {
        typealias T = TVAppState.Timeline
        XCTAssertEqual(TVAppState.timelineStep(from: .live, older: true, stops: 3), T.past(0))
        XCTAssertEqual(TVAppState.timelineStep(from: .past(0), older: true, stops: 3), T.past(1))
        // The oldest scene is a wall, not a wrap: "keep pressing Left" must
        // never loop back round to live.
        XCTAssertEqual(TVAppState.timelineStep(from: .past(2), older: true, stops: 3), T.past(2))
    }

    func testFromASceneThePhoneSentLeftStartsTheHistoryAndRightIsLive() {
        typealias T = TVAppState.Timeline
        XCTAssertEqual(TVAppState.timelineStep(from: .pinned(sceneId: 42), older: true, stops: 3), T.past(0))
        XCTAssertEqual(TVAppState.timelineStep(from: .pinned(sceneId: 42), older: false, stops: 3), T.live)
        XCTAssertEqual(TVAppState.timelineStep(from: .pinned(sceneId: 42), older: true, stops: 0), T.live)
        // A pinned scene is not live: auto-rotate leaves what the phone sent.
        XCTAssertFalse(TVAppState.shouldRotate(minutes: 5, selected: "c", timeline: .pinned(sceneId: 42)))
    }

    func testRightComesBackAndStopsAtLive() {
        typealias T = TVAppState.Timeline
        XCTAssertEqual(TVAppState.timelineStep(from: .past(2), older: false, stops: 3), T.past(1))
        XCTAssertEqual(TVAppState.timelineStep(from: .past(0), older: false, stops: 3), T.live)
        XCTAssertEqual(TVAppState.timelineStep(from: .live, older: false, stops: 3), T.live)
    }

    func testAChannelWithNoPastStaysLive() {
        XCTAssertEqual(TVAppState.timelineStep(from: .live, older: true, stops: 0), .live)
    }

    // MARK: - Auto-rotate / resume

    func testRotationOnlyFiresOnALiveSelectedChannel() {
        XCTAssertTrue(TVAppState.shouldRotate(minutes: 5, selected: "lobby", timeline: .live))
        XCTAssertFalse(TVAppState.shouldRotate(minutes: 0, selected: "lobby", timeline: .live), "off")
        XCTAssertFalse(TVAppState.shouldRotate(minutes: 5, selected: nil, timeline: .live), "on the grid")
        // Someone in a channel's past is looking at something on purpose.
        XCTAssertFalse(TVAppState.shouldRotate(minutes: 5, selected: "lobby", timeline: .past(1)))
    }

    func testResumeNeedsBothTheSettingAndARealLastChannel() {
        let defaults = UserDefaults.standard
        let savedLast = defaults.string(forKey: TVAppState.lastChannelKey)
        let savedFlag = defaults.bool(forKey: TVAppState.resumeOnLaunchKey)
        defer {
            defaults.set(savedLast, forKey: TVAppState.lastChannelKey)
            defaults.set(savedFlag, forKey: TVAppState.resumeOnLaunchKey)
        }
        defaults.removeObject(forKey: TVAppState.lastChannelKey)
        let app = TVAppState()
        app.resumeOnLaunch = true
        // First run: "default" is a socket fallback, not somewhere the viewer
        // chose to be, so it must not be resumed into.
        XCTAssertNil(app.resumeChannelId)
        defaults.set("aurora", forKey: TVAppState.lastChannelKey)
        XCTAssertEqual(app.resumeChannelId, "aurora")
        app.resumeOnLaunch = false
        XCTAssertNil(app.resumeChannelId)
    }

    // MARK: - End to end through a stub server

    private func makeApp() -> TVAppState {
        let base = URL(string: "https://stub.test")!
        let transport = StubTransport(routes: [
            "/c/tide/history": ##"""
            {"events":[
              {"id":9,"at":9000,"kind":"publish","actor":"spin","sceneId":3},
              {"id":8,"at":8000,"kind":"setParam","actor":"spin"},
              {"id":7,"at":7000,"kind":"publish","actor":"spin","sceneId":2,"detail":{"label":"Tidal Drift"}},
              {"id":6,"at":6000,"kind":"publish","actor":"spin","sceneId":1}],
             "hasMore":false}
            """##,
            "/c/tide/scene/2": ##"""
            {"id":2,"label":"Tidal Drift","seed":5,"spec":{"seed":5,"layers":[
              {"count":7,"sprite":{"kind":"circle","radius":[0.01,0.02],"color":"#fff"},
               "motion":{"type":"static"}}]}}
            """##,
            // A classic scene travels as a bare saver document, as on the wire.
            "/c/tide/scene/1": ##"{"id":1,"label":"Warp","spec":{"id":"warp"}}"##,
        ])
        return TVAppState(gallery: GalleryClient(baseURL: base, transport: transport),
                          mcp: MCPClient(baseURL: base, transport: transport),
                          ws: ChannelWSClient(),
                          pair: PairClient(baseURL: base, transport: transport),
                          baseURL: base)
    }

    private func json(_ text: String) -> JSONValue {
        try! JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
    }

    private func settle(_ app: TVAppState, until done: @escaping () -> Bool) async {
        for _ in 0..<200 where !done() { try? await Task.sleep(for: .milliseconds(10)) }
    }

    func testTheHistoryPagesOnInsteadOfHittingAWall() async {
        let base = URL(string: "https://paged.test")!
        func scene(_ id: Int) -> String {
            ##"{"id":"## + "\(id)" + ##","label":"S"## + "\(id)" + ##"","seed":1,"spec":{"seed":1,"layers":[{"count":"## + "\(id)" + ##","sprite":{"kind":"circle","radius":[0.01,0.02],"color":"#fff"},"motion":{"type":"static"}}]}}"##
        }
        var routes: [String: String] = [
            // Page one: live scene 9, then 8 and 7. More to come.
            "/c/deep/history": ##"{"events":[{"id":30,"at":3000,"kind":"publish","actor":"spin","sceneId":9},{"id":29,"at":2900,"kind":"publish","actor":"spin","sceneId":8},{"id":28,"at":2800,"kind":"publish","actor":"spin","sceneId":7}],"hasMore":true}"##,
            // Page two, strictly older than event 28: scenes 6 and 5, the end.
            "/c/deep/history?before=28": ##"{"events":[{"id":20,"at":2000,"kind":"publish","actor":"spin","sceneId":6},{"id":19,"at":1900,"kind":"publish","actor":"spin","sceneId":5}],"hasMore":false}"##,
        ]
        for id in 5...8 { routes["/c/deep/scene/\(id)"] = scene(id) }
        let transport = StubTransport(routes: routes)
        let app = TVAppState(gallery: GalleryClient(baseURL: base, transport: transport),
                             mcp: MCPClient(baseURL: base, transport: transport),
                             ws: ChannelWSClient(), pair: PairClient(baseURL: base, transport: transport),
                             baseURL: base)
        app.selectChannel("deep")
        for want in 0..<4 {
            app.stepTimeline(older: true)
            await settle(app) { app.timeline == .past(want) }
            XCTAssertEqual(app.timeline, .past(want), "step \(want)")
        }
        XCTAssertEqual(app.historyStops.map(\.sceneId), [8, 7, 6, 5], "the second page joined the first")
        XCTAssertEqual(app.compiledScene.first?.entities.count, 5)
        // The oldest scene is still a wall once the server says there is no more.
        app.stepTimeline(older: true)
        try? await Task.sleep(for: .milliseconds(200))
        XCTAssertEqual(app.timeline, .past(3))
    }

    func testSteppingLeftRendersThePastSceneAndRightReturnsToLive() async {
        let app = makeApp()
        app.selectChannel("tide")
        // Live scene arrives over the socket.
        app.handle(.scene(spec: json(##"""
        {"seed":1,"layers":[{"count":2,"sprite":{"kind":"circle","radius":[0.01,0.02],"color":"#fff"},
          "motion":{"type":"static"}}]}
        """##), seed: 1))
        XCTAssertEqual(app.compiledScene.first?.entities.count, 2)

        app.stepTimeline(older: true)
        await settle(app) { app.timeline == .past(0) }
        XCTAssertEqual(app.timeline, .past(0))
        // Event 9 (sceneId 3) is what is live — dropped; setParam has no
        // frame. The first stop back is scene 2.
        XCTAssertEqual(app.historyStops.map(\.sceneId), [2, 1])
        XCTAssertEqual(app.pastScene?.label, "Tidal Drift")
        XCTAssertEqual(app.compiledScene.first?.entities.count, 7, "the past scene is on screen")

        // The channel keeps living: a new live scene must NOT yank the viewer
        // out of the past…
        app.handle(.scene(spec: json(##"{"seed":1,"layers":[]}"##), seed: 1))
        XCTAssertEqual(app.compiledScene.first?.entities.count, 7)

        // …one more step reaches a classic scene, rendered by its native port.
        app.stepTimeline(older: true)
        await settle(app) { app.timeline == .past(1) }
        XCTAssertTrue(app.isClassicSpec)
        XCTAssertEqual(app.classicSaverId, "warp")

        app.returnToLive()
        XCTAssertEqual(app.timeline, .live)
        XCTAssertFalse(app.isClassicSpec)
        XCTAssertTrue(app.compiledScene.isEmpty, "back on the NEWEST live scene, not the one we left")
    }

    func testChangingChannelForgetsThePast() async {
        let app = makeApp()
        app.selectChannel("tide")
        app.stepTimeline(older: true)
        await settle(app) { app.timeline == .past(0) }
        app.selectChannel("other")
        XCTAssertEqual(app.timeline, .live)
        XCTAssertTrue(app.historyStops.isEmpty)
        XCTAssertNil(app.pastScene)
    }

    func testAFailedHistoryFetchLeavesTheViewerOnLive() async {
        let app = makeApp()
        app.selectChannel("no-such-channel")     // 404s in the stub
        app.stepTimeline(older: true)
        try? await Task.sleep(for: .milliseconds(150))
        XCTAssertEqual(app.timeline, .live, "a dead endpoint must not strand the player")
    }
}
