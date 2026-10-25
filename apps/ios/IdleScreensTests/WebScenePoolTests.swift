import XCTest
import WebKit
@testable import IdleScreens

/// The warm-page pool's rules. Each page is a web process and a socket, so the
/// bounds matter as much as the reuse.
@MainActor
final class WebScenePoolTests: XCTestCase {
    private let base = URL(string: "https://idlescreens.com")!

    private func park(_ pool: WebScenePool, _ channel: String, _ scene: Int?, keyed: Bool = false) {
        let host = WebSceneView.Coordinator(channelId: channel, baseURL: base, onFrame: { _ in }, onFailure: {})
        pool.park(.init(channelId: channel, sceneId: scene, keyed: keyed),
                  webView: WKWebView(frame: .zero), host: host)
    }

    override func setUp() async throws { WebScenePool.shared.drain() }
    override func tearDown() async throws {
        WebScenePool.shared.drain()
        WebScenePool.shared.adoptionGrace = .seconds(3)
    }

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
        park(pool, "studio", 4)
        park(pool, "lobby", 4)
        pool.drain(channelId: "studio")
        XCTAssertFalse(pool.has(channelId: "studio", sceneId: 4))
        XCTAssertTrue(pool.has(channelId: "lobby", sceneId: 4))
    }

    /// The live page of the channel you flipped away from is the page the
    /// next channel switches in place — so leaving spares it, briefly.
    func testLeavingAChannelSparesItsPublicLivePageForAdoption() {
        let pool = WebScenePool.shared
        park(pool, "studio", nil)
        park(pool, "studio", 9)
        pool.drain(channelId: "studio")
        XCTAssertTrue(pool.has(channelId: "studio", sceneId: nil))
        XCTAssertFalse(pool.has(channelId: "studio", sceneId: 9), "history pages still go")
        let adopted = pool.adopt(forChannel: "lobby")
        XCTAssertEqual(adopted?.1.channelId, "studio")
        XCTAssertNil(pool.adopt(forChannel: "lobby"), "adopted once")
    }

    /// Unclaimed, it is still a viewer of the channel you left: it goes.
    func testAnUnadoptedSparePageGoesAfterTheGrace() async throws {
        let pool = WebScenePool.shared
        pool.adoptionGrace = .milliseconds(50)
        park(pool, "studio", nil)
        pool.drain(channelId: "studio")
        XCTAssertTrue(pool.has(channelId: "studio", sceneId: nil))
        try await Task.sleep(for: .milliseconds(300))
        XCTAssertFalse(pool.has(channelId: "studio", sceneId: nil))
    }

    /// Leaving the feed (drain all) spares nothing.
    func testDrainingEverythingSparesNothing() {
        let pool = WebScenePool.shared
        park(pool, "studio", nil)
        pool.drain()
        XCTAssertEqual(pool.idleCount, 0)
    }

    /// Only a public live page of ANOTHER channel is switched in place: a
    /// keyed page has its own store and token, a pinned scene its own
    /// document, and the same channel is an ordinary `take`.
    func testAdoptionTakesOnlyAPublicLivePageOfAnotherChannel() {
        let pool = WebScenePool.shared
        park(pool, "studio", nil, keyed: true)
        park(pool, "studio", 12)
        park(pool, "lobby", nil)
        XCTAssertNil(pool.adopt(forChannel: "lobby"))
        XCTAssertEqual(pool.adopt(forChannel: "default")?.1.channelId, "lobby")
        XCTAssertNil(pool.adopt(forChannel: "default"))
    }

    /// SwiftUI builds the next channel's page before it dismantles the last,
    /// so the page being left is taken straight out of its (still mounted)
    /// view. That view is left empty, and never hands over its own channel.
    func testHandOverTakesThePageOnScreenOutOfItsView() {
        let pool = WebScenePool.shared
        let coordinator = WebSceneView.Coordinator(channelId: "studio", baseURL: base, onFrame: { _ in }, onFailure: {})
        coordinator.host = coordinator
        let container = SceneHostView()
        container.coordinator = coordinator
        let webView = WKWebView(frame: .zero)
        container.show(webView)
        pool.showing(container)
        XCTAssertNil(pool.handOver(forChannel: "studio"), "a channel is never handed itself")
        let handed = pool.handOver(forChannel: "lobby")
        XCTAssertTrue(handed?.0 === webView)
        XCTAssertEqual(handed?.1.channelId, "studio")
        XCTAssertNil(container.webView)
        XCTAssertNil(webView.superview)
        XCTAssertNil(pool.handOver(forChannel: "lobby"), "handed over once")
    }

    /// A pooled page is replayed to its next view: the host remembers.
    func testHostForwardsToItsCurrentSinkAndRemembersFrames() {
        let host = WebSceneView.Coordinator(channelId: "studio", baseURL: base, onFrame: { _ in }, onFailure: {})
        var seen: [String] = []
        let sink = WebSceneView.Coordinator(channelId: "studio", baseURL: base, onFrame: { seen.append($0) }, onFailure: {})
        host.sink = sink
        let controller = WKUserContentController()
        host.userContentController(controller, didReceive: FakeMessage(body: ["kind": "frame", "body": "{\"t\":1}", "socket": "/c/studio/ws"]))
        XCTAssertEqual(seen, ["{\"t\":1}"])
        XCTAssertEqual(host.lastFrame, "{\"t\":1}")
    }

    func testOnlyPlainChannelIdsBecomeLaunchStillFileNames() {
        XCTAssertTrue(WebScenePool.isSafeFileName("fishtank"))
        XCTAssertTrue(WebScenePool.isSafeFileName("show-holdfast_2"))
        for bad in ["", "../etc", "a/b", "a~1", "a.jpg", "é", String(repeating: "a", count: 65)] {
            XCTAssertFalse(WebScenePool.isSafeFileName(bad), bad)
        }
    }

    func testBackgroundingKeepsPicturesButDropsWarmPages() {
        let pool = WebScenePool.shared
        park(pool, "studio", 597)
        pool.storeSnapshot(UIImage(), channelId: "studio", sceneId: nil)
        pool.drain(keepSnapshots: true)
        XCTAssertEqual(pool.idleCount, 0)
        XCTAssertNotNil(pool.snapshot(channelId: "studio", sceneId: nil))
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
