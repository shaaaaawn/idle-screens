import XCTest
import WebKit
@testable import IdleScreens

/// The warm-page pool's rules. Each page is a web process and a socket, so the
/// bounds matter as much as the reuse.
@MainActor
final class WebScenePoolTests: XCTestCase {
    private let base = URL(string: "https://idlescreens.com")!

    private func park(_ pool: WebScenePool, _ channel: String, _ scene: Int?) {
        let host = WebSceneView.Coordinator(baseURL: base, onFrame: { _ in }, onFailure: {})
        pool.park(.init(channelId: channel, sceneId: scene, keyed: false),
                  webView: WKWebView(frame: .zero), host: host)
    }

    override func setUp() async throws { WebScenePool.shared.drain() }
    override func tearDown() async throws { WebScenePool.shared.drain() }

    func testTakeReturnsTheParkedPageOnce() {
        let pool = WebScenePool.shared
        park(pool, "studio", 597)
        XCTAssertNotNil(pool.take(.init(channelId: "studio", sceneId: 597, keyed: false)))
        XCTAssertNil(pool.take(.init(channelId: "studio", sceneId: 597, keyed: false)))
    }

    /// A page seeded with a key is never handed to a view that asked for none.
    func testKeyedAndPublicPagesDoNotMix() {
        let pool = WebScenePool.shared
        park(pool, "studio", nil)
        XCTAssertNil(pool.take(.init(channelId: "studio", sceneId: nil, keyed: true)))
    }

    func testOverTheLimitTheOldestHistoryPageGoesAndLiveStays() {
        let pool = WebScenePool.shared
        park(pool, "studio", nil)          // live, parked first (oldest)
        park(pool, "studio", 1)
        park(pool, "studio", 2)
        park(pool, "studio", 3)            // one over the limit
        XCTAssertEqual(pool.idleCount, pool.maxIdle)
        XCTAssertTrue(pool.has(channelId: "studio", sceneId: nil), "live is kept")
        XCTAssertFalse(pool.has(channelId: "studio", sceneId: 1), "oldest history page evicted")
        XCTAssertTrue(pool.has(channelId: "studio", sceneId: 3))
    }

    func testLeavingAChannelDrainsOnlyThatChannel() {
        let pool = WebScenePool.shared
        park(pool, "studio", nil)
        park(pool, "lobby", nil)
        pool.drain(channelId: "studio")
        XCTAssertFalse(pool.has(channelId: "studio", sceneId: nil))
        XCTAssertTrue(pool.has(channelId: "lobby", sceneId: nil))
    }

    /// A pooled page is replayed to its next view: the host remembers.
    func testHostForwardsToItsCurrentSinkAndRemembersFrames() {
        let host = WebSceneView.Coordinator(baseURL: base, onFrame: { _ in }, onFailure: {})
        var seen: [String] = []
        let sink = WebSceneView.Coordinator(baseURL: base, onFrame: { seen.append($0) }, onFailure: {})
        host.sink = sink
        let controller = WKUserContentController()
        host.userContentController(controller, didReceive: FakeMessage(body: ["kind": "frame", "body": "{\"t\":1}"]))
        XCTAssertEqual(seen, ["{\"t\":1}"])
        XCTAssertEqual(host.lastFrame, "{\"t\":1}")
    }

    func testSnapshotsAreBoundedAndForgottenWithTheirChannel() {
        let pool = WebScenePool.shared
        let picture = UIImage()
        for scene in 0...pool.maxSnapshots {
            pool.storeSnapshot(picture, channelId: "studio", sceneId: scene)
        }
        pool.storeSnapshot(picture, channelId: "lobby", sceneId: nil)
        XCTAssertNil(pool.snapshot(channelId: "studio", sceneId: 0), "oldest picture goes first")
        XCTAssertNil(pool.snapshot(channelId: "studio", sceneId: 1))
        XCTAssertNotNil(pool.snapshot(channelId: "studio", sceneId: pool.maxSnapshots))
        XCTAssertNil(pool.snapshot(channelId: "studio", sceneId: nil), "live and history pictures are separate")

        pool.drain(channelId: "studio")
        XCTAssertNil(pool.snapshot(channelId: "studio", sceneId: pool.maxSnapshots))
        XCTAssertNotNil(pool.snapshot(channelId: "lobby", sceneId: nil))
    }
}

private final class FakeMessage: WKScriptMessage {
    private let payload: Any
    init(body: Any) { payload = body; super.init() }
    override var body: Any { payload }
}
