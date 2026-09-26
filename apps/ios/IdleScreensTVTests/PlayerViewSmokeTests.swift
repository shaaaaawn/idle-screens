import SwiftUI
import XCTest
@testable import IdleScreensTV

/// The player, composed and rendered in every state it can be in. These do
/// not judge pixels — they prove that each branch of the view builds and
/// draws without trapping, which is what a state nobody walked to on a real
/// remote would otherwise do in front of a viewer.
@MainActor
final class PlayerViewSmokeTests: XCTestCase {

    private func makeApp() -> TVAppState {
        let base = URL(string: "https://player-stub.test")!
        let transport = StubTransport(routes: [
            "/c/tide/history": ##"{"events":[{"id":9,"at":9000,"kind":"publish","actor":"spin","sceneId":3},{"id":7,"at":7000,"kind":"publish","actor":"curator","sceneId":2,"detail":{"label":"Tidal Drift"}}],"hasMore":false}"##,
            "/c/tide/scene/2": ##"{"id":2,"label":"Tidal Drift","seed":5,"spec":{"seed":5,"layers":[{"count":7,"sprite":{"kind":"circle","radius":[0.02,0.04],"color":"#fff"},"motion":{"type":"static"}}]}}"##,
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

    private func render(_ app: TVAppState, file: StaticString = #filePath, line: UInt = #line) {
        let renderer = ImageRenderer(content: ScreenSaverView().environment(app)
            .frame(width: 960, height: 540))
        renderer.scale = 1
        XCTAssertNotNil(renderer.cgImage, "player produced no frame", file: file, line: line)
    }

    private let bright = ##"{"seed":1,"layers":[{"count":40,"sprite":{"kind":"circle","radius":[0.03,0.06],"color":"#ffffff"},"motion":{"type":"drift","speed":[0.01,0.02]}}]}"##

    func testLoadingBeforeAnySceneArrives() {
        let app = makeApp()
        app.selectChannel("tide")
        render(app)
    }

    func testASchemaSceneOnEveryTier() {
        // tierOverride persists. Left behind in the simulator it silently
        // pins every later launch to the last tier tried — put it back.
        let key = TVAppState.tierOverrideKey
        let saved = UserDefaults.standard.string(forKey: key)
        defer {
            if let saved { UserDefaults.standard.set(saved, forKey: key) }
            else { UserDefaults.standard.removeObject(forKey: key) }
        }
        for tier in [CapabilityTier.t3, .t2, .t1, .t0] {
            let app = makeApp()
            app.tierOverride = tier
            app.selectChannel("tide")
            app.handle(.scene(spec: json(bright), seed: 1))
            app.handle(.overlay(text: "hello from a phone", ttl: 60_000))
            render(app)
        }
    }

    func testSleepingClassicAndInvisibleScenes() {
        let app = makeApp()
        app.selectChannel("tide")
        app.handle(.sleep)
        render(app)
        app.handle(.wake)
        for id in ["warp", "rainstorm", "metaquarium", "flying-toasters"] {
            app.handle(.scene(spec: json("{\"id\":\"\(id)\"}"), seed: 2))
            render(app)
        }
        app.reportThumbFailure()
        render(app)
        // Dark-on-dark, sub-pixel: the designed "not broadcasting" state.
        app.handle(.scene(spec: json(##"{"seed":1,"layers":[{"units":"px","count":3,"sprite":{"kind":"circle","radius":[0.2,0.3],"color":"#010101"},"motion":{"type":"static"}}]}"##), seed: 1))
        render(app)
    }

    func testThePastWithARelayedScene() async {
        let app = makeApp()
        app.selectChannel("tide")
        app.handle(.scene(spec: json(bright), seed: 1))
        app.stepTimeline(older: true)
        for _ in 0..<200 where app.timeline == .live { try? await Task.sleep(for: .milliseconds(10)) }
        XCTAssertEqual(app.timeline, .past(0))
        render(app)
        app.returnToLive()
        render(app)
    }
}
