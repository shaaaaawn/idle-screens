import XCTest
@testable import IdleScreensTV

/// The player animates a scene's `timeline` on the scene's own clock.
@MainActor
final class KeyframeDriverTests: XCTestCase {

    private func makeApp() -> TVAppState {
        let base = URL(string: "https://keys-stub.test")!
        let transport = StubTransport(routes: [:])
        return TVAppState(gallery: GalleryClient(baseURL: base, transport: transport),
                          mcp: MCPClient(baseURL: base, transport: transport),
                          ws: ChannelWSClient(),
                          pair: PairClient(baseURL: base, transport: transport),
                          baseURL: base)
    }

    private func json(_ text: String) -> JSONValue {
        try! JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
    }

    /// Red, then a cut to blue at 150 ms, and the dots fade to 0 opacity at 300.
    private let timed = ##"""
    {"seed":2,"layers":[{"key":"dots","count":3,"opacity":1,
      "sprite":{"kind":"circle","radius":[0.02,0.02],"color":"#ff0000"},"motion":{"type":"static"}}],
     "timeline":{"keys":[{"t":150,"path":"dots.sprite.color","value":"#0000ff","dur":0},
                         {"t":300,"path":"dots.opacity","value":0,"dur":0}]}}
    """##

    private func wait(until done: () -> Bool) async {
        for _ in 0..<300 where !done() { try? await Task.sleep(for: .milliseconds(10)) }
    }

    func testKeysChangeTheSceneOnItsOwnClock() async {
        let app = makeApp()
        app.selectChannel("timed")
        app.handle(.scene(spec: json(timed), seed: 2))
        XCTAssertEqual(app.compiledScene.first?.entities.first?.color, "#ff0000")
        await wait { app.compiledScene.first?.entities.first?.color == "#0000ff" }
        XCTAssertEqual(app.compiledScene.first?.entities.first?.color, "#0000ff", "the 150 ms key landed")
        await wait { app.compiledScene.first?.opacity == 0 }
        XCTAssertEqual(app.compiledScene.first?.opacity, 0, "the 300 ms key landed")
        XCTAssertEqual(app.compiledScene.first?.entities.count, 3, "recompiles keep every entity")
    }

    /// Snapshots repeat the document. A repeat must neither rewind the clock
    /// nor flash the un-keyed base scene.
    func testARepeatedSnapshotKeepsTheClock() async {
        let app = makeApp()
        app.selectChannel("timed")
        app.handle(.scene(spec: json(timed), seed: 2))
        try? await Task.sleep(for: .milliseconds(100))
        app.handle(.scene(spec: json(timed), seed: 2))      // the same scene again
        await wait { app.compiledScene.first?.entities.first?.color == "#0000ff" }
        XCTAssertEqual(app.compiledScene.first?.entities.first?.color, "#0000ff")
        // Past the 150 ms key, a repeat must not paint the red base back.
        app.handle(.scene(spec: json(timed), seed: 2))
        XCTAssertEqual(app.compiledScene.first?.entities.first?.color, "#0000ff", "no flash of the base scene")
        await wait { app.compiledScene.first?.opacity == 0 }
        XCTAssertEqual(app.compiledScene.first?.opacity, 0, "the 300 ms key still lands on the original clock")
    }

    func testARepeatedSequenceKeepsItsSegmentKeysRunning() async {
        let seq = ##"""
        {"format":"idle-sequence","schemaVersion":1,"seed":3,"segments":[
          {"key":"only","scene":{"layers":[{"key":"dots","count":2,"sprite":{"kind":"circle","radius":[0.02,0.02],"color":"#ff0000"},"motion":{"type":"static"}}],
            "timeline":{"keys":[{"t":200,"path":"dots.sprite.color","value":"#00ff00","dur":0}]}}}]}
        """##
        let app = makeApp()
        app.selectChannel("show")
        app.handle(.scene(spec: json(seq), seed: 3))
        try? await Task.sleep(for: .milliseconds(80))
        app.handle(.scene(spec: json(seq), seed: 3))
        await wait { app.compiledScene.first?.entities.first?.color == "#00ff00" }
        XCTAssertEqual(app.compiledScene.first?.entities.first?.color, "#00ff00", "the segment's key still fires")
    }

    func testLeavingTheChannelStopsItsKeyframes() async {
        let app = makeApp()
        app.selectChannel("timed")
        app.handle(.scene(spec: json(timed), seed: 2))
        app.exitChannel()
        app.selectChannel("other")
        try? await Task.sleep(for: .milliseconds(450))
        XCTAssertTrue(app.compiledScene.isEmpty, "the old channel's keys must not repaint the new one")
    }

    func testAPlainSceneHasNoDriver() async {
        let app = makeApp()
        app.selectChannel("plain")
        app.handle(.scene(spec: json(##"{"seed":1,"layers":[{"count":1,"sprite":{"kind":"circle","radius":[0.01,0.01],"color":"#abcdef"},"motion":{"type":"static"}}]}"##), seed: 1))
        try? await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(app.compiledScene.first?.entities.first?.color, "#abcdef")
    }
}
