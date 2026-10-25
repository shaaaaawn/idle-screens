import XCTest
import WebKit
@testable import IdleScreens

/// The bridge's trust property, held in a real web view running the real
/// bootstrap: WHICH channel's frames reach native is native state. Page script
/// can open any socket and post anything, but it cannot move the tap — only
/// `Coordinator.retarget`, called from Swift, can.
///
/// The page is a stand-in for the site: a fake `WebSocket` (installed before
/// the bootstrap, so the tap wraps it) streams frames naming the socket they
/// came from, and a `popstate` handler swaps the canvas and opens the new
/// channel's socket, as ChannelViewer does.
@MainActor
final class WebSceneRetargetTests: XCTestCase {
    private let base = URL(string: "http://localhost:9")!
    private var window: UIWindow?
    private var webView: WKWebView!
    private var host: WebSceneView.Coordinator!
    private var frames: [String] = []
    /// The view the page is handed to on a retarget, as `WebSceneView` does.
    private var sink: WebSceneView.Coordinator!
    private var sinkFrames: [String] = []

    private func handToSink() {
        sinkFrames = []
        sink = WebSceneView.Coordinator(channelId: "beta", baseURL: base,
                                        onFrame: { [weak self] in self?.sinkFrames.append($0) }, onFailure: {})
        host.sink = sink
    }

    private let fakeSocket = """
    window.WebSocket = function (url) {
      const t = new EventTarget();
      const from = new URL(url, location.href).pathname;
      const id = setInterval(() => t.dispatchEvent(new MessageEvent('message', { data: 'frame from ' + from })), 40);
      t.close = () => clearInterval(id);
      return t;
    };
    window.WebSocket.prototype = EventTarget.prototype;
    """

    private let page = """
    <!doctype html><html><body><div id="screen"><canvas></canvas></div><script>
      let socket = null;
      window.openChannel = (id) => {
        if (socket) socket.close();
        socket = new WebSocket('ws://localhost:9/c/' + id + '/ws' + '?device=x');
      };
      openChannel('alpha');
      window.addEventListener('popstate', () => {
        const id = location.pathname.split('/')[2];
        // As the site does: the socket opens at once, the canvas mounts once
        // its scene has arrived.
        document.getElementById('screen').replaceChildren();
        openChannel(id);
        if (!window.noCanvas) setTimeout(() => document.getElementById('screen').append(document.createElement('canvas')), 300);
      });
    </script></body></html>
    """

    override func setUp() async throws {
        frames = []
        host = WebSceneView.Coordinator(channelId: "alpha", baseURL: base,
                                        onFrame: { [weak self] in self?.frames.append($0) }, onFailure: {})
        let config = WKWebViewConfiguration()
        let controller = config.userContentController
        controller.add(host, name: WebSceneView.handlerName)
        controller.addUserScript(WKUserScript(source: fakeSocket, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        controller.addUserScript(WKUserScript(
            source: WebSceneView.bootstrapScript(channelId: "alpha", token: nil, baseURL: base),
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 200, height: 400), configuration: config)
        let window = UIWindow(frame: webView.frame)
        window.addSubview(webView)
        window.isHidden = false
        self.window = window
        webView.loadHTMLString(page, baseURL: base.appendingPathComponent("channel/alpha"))
        try await waitFor("the page's own socket to stream") { self.frames.count >= 2 }
    }

    override func tearDown() async throws {
        webView.configuration.userContentController.removeAllScriptMessageHandlers()
        webView.removeFromSuperview()
        window = nil
    }

    private func waitFor(_ what: String, timeout: TimeInterval = 10, _ done: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !done() {
            if Date() > deadline { XCTFail("timed out waiting for \(what)"); return }
            try await Task.sleep(for: .milliseconds(20))
        }
    }

    func testThePageOwnSocketIsHeard() {
        XCTAssertTrue(frames.allSatisfy { $0 == "frame from /c/alpha/ws" }, "\(frames)")
    }

    /// Everything page script could try, short of native calling retarget:
    /// open another channel's socket, switch its own address the way the site
    /// does, post a forged frame for another socket, ask for a retarget by
    /// message, and poke at globals. Native keeps hearing alpha only.
    func testPageScriptCannotRetargetTheTap() async throws {
        _ = try await webView.callAsyncJavaScript("""
            new WebSocket('ws://localhost:9/c/beta/ws');
            history.pushState(null, '', '/channel/beta?chrome=off');
            window.dispatchEvent(new PopStateEvent('popstate'));
            const h = window.webkit.messageHandlers.idleHost;
            h.postMessage({ kind: 'retarget', body: 'beta' });
            h.postMessage({ kind: 'frame', body: 'forged', socket: '/c/beta/ws' });
            h.postMessage({ kind: 'frame', body: 'forged', socket: '/c/beta/ws', channel: 'alpha' });
            if (window.__idleRetarget) window.__idleRetarget('beta');
            window.WebSocket.__idleTapped = false;
            return true;
            """, contentWorld: .page)
        let before = frames.count
        try await Task.sleep(for: .milliseconds(400))
        XCTAssertEqual(host.channelId, "alpha")
        XCTAssertEqual(frames.count, before, "beta's socket (and the forgeries) must not reach native: \(frames.suffix(5))")
        XCTAssertFalse(frames.contains { $0.contains("beta") || $0 == "forged" })
    }

    /// Native retargets: the old channel's socket is still streaming for a
    /// moment and none of it counts; the new channel's frames do, and the view
    /// is told the page is reused only once the new canvas has drawn.
    func testNativeRetargetSwitchesInPlaceAndDropsTheOldSocket() async throws {
        var reused = false
        // Keep alpha's socket alive past the switch, as a closing socket is.
        _ = try await webView.callAsyncJavaScript("window.openChannel = (id) => { new WebSocket('ws://localhost:9/c/' + id + '/ws'); }; return true",
                                                  contentWorld: .page)
        handToSink()
        var framesWhenDrawn = -1
        var drawnAt: Date?
        sink.onReused = { reused = true; framesWhenDrawn = self.sinkFrames.count; drawnAt = Date() }
        // Stamp the sink's first frame: held frames are flushed in the same
        // turn as "drawn", so the two stamps coincide; unheld, the first
        // frame lands a whole canvas delay (300 ms) earlier.
        var firstFrameAt: Date?
        let record = sink.onFrame
        sink.onFrame = { if firstFrameAt == nil { firstFrameAt = Date() }; record($0) }
        host.retarget(webView, to: "beta")
        XCTAssertEqual(host.channelId, "beta")
        XCTAssertNil(host.lastFrame, "alpha's state is forgotten, never replayed as beta's")
        try await waitFor("the switch to report drawn") { reused }
        // A view reveals a beat after its first frame: mid-switch that beat
        // must not start before the new canvas has drawn. So beta's frames
        // (every one held, in order) arrive together with "drawn", not ahead
        // of it: the sink hears nothing until then, then the whole backlog.
        XCTAssertGreaterThanOrEqual(framesWhenDrawn, 1, "the held frames are delivered with drawn")
        let lead = try XCTUnwrap(drawnAt).timeIntervalSince(try XCTUnwrap(firstFrameAt))
        XCTAssertLessThan(lead, 0.1, "the sink's first frame came \(lead)s ahead of drawn")
        try await waitFor("beta's frames") { self.sinkFrames.count >= 3 }
        XCTAssertTrue(sinkFrames.allSatisfy { $0 == "frame from /c/beta/ws" }, "\(sinkFrames)")
        let path = try await webView.evaluateJavaScript("location.pathname + location.search") as? String
        XCTAssertEqual(path, "/channel/beta?chrome=off")
    }

    /// A scene that mounts no new canvas (asleep, a gate) still reaches the
    /// chrome: the hold gives up after `switchHoldMax`, well before the
    /// switch's own 2.5 s timeout.
    func testHeldFramesAreReleasedWhenNoCanvasComes() async throws {
        _ = try await webView.callAsyncJavaScript("window.noCanvas = true; return true", contentWorld: .page)
        handToSink()
        let start = Date()
        host.retarget(webView, to: "beta")
        try await waitFor("beta's frame without a canvas") { !self.sinkFrames.isEmpty }
        let waited = Date().timeIntervalSince(start)
        XCTAssertLessThan(waited, 2.2, "released by the hold's own bound, not the switch timeout")
        XCTAssertEqual(sinkFrames.first, "frame from /c/beta/ws")
    }

    /// Held frames carry different news (a snapshot, then a sleep): all of
    /// them reach the chrome, in order, when the switch draws.
    func testEveryHeldFrameIsDeliveredInOrder() async throws {
        _ = try await webView.callAsyncJavaScript("window.noCanvas = true; return true", contentWorld: .page)
        handToSink()
        host.retarget(webView, to: "beta")
        let socket = WebSceneView.Coordinator.socketPath("beta")
        for body in ["snapshot", "sleep"] {
            host.receive(["kind": "frame", "body": body, "socket": socket])
        }
        XCTAssertEqual(sinkFrames, [], "held while the switch is in flight")
        try await waitFor("the hold to release") { self.sinkFrames.contains("sleep") }
        let mine = sinkFrames.filter { $0 == "snapshot" || $0 == "sleep" }
        XCTAssertEqual(mine, ["snapshot", "sleep"], "\(sinkFrames)")
    }

    /// Once moved off its first channel, a page with no view showing it says
    /// nothing: its own callbacks belong to the first channel's page, which
    /// must never hear the new channel's frames.
    func testARetargetedPageWithNoViewTellsTheOldPageNothing() async throws {
        handToSink()
        var reused = false
        sink.onReused = { reused = true }
        host.retarget(webView, to: "beta")
        try await waitFor("the switch") { reused }
        frames = []
        host.sink = nil                     // parked, or spared for adoption
        try await Task.sleep(for: .milliseconds(300))
        XCTAssertEqual(frames, [], "alpha's page heard beta: \(frames.prefix(3))")
    }

    // MARK: Back on screen (`returnCount`)

    /// A page that stayed mounted while its view was off screen (a lazy stack
    /// one swipe away) says it is drawn again when the view comes back — once
    /// per return, after the page has composited.
    func testComingBackOnScreenSaysDrawnAgain() async throws {
        var reused = 0
        host.onReused = { reused += 1 }
        host.cameBack(1, in: webView)
        try await waitFor("the return to report drawn") { reused == 1 }
        host.cameBack(1, in: webView)       // an ordinary update: not a return
        try await Task.sleep(for: .milliseconds(300))
        XCTAssertEqual(reused, 1)
        host.cameBack(2, in: webView)
        try await waitFor("the next return") { reused == 2 }
    }

    /// Nothing drawn yet (a page still loading, as on a view's very first
    /// appearance): a return says nothing, even when the first frame lands
    /// during the wait — that frame comes a beat before the canvas paints,
    /// and the first-frame path (`onFrame`) is what waits for it.
    func testComingBackBeforeAnyFrameSaysNothing() async throws {
        var reused = false
        let fresh = WebSceneView.Coordinator(channelId: "gamma", baseURL: base, onFrame: { _ in }, onFailure: {})
        fresh.onReused = { reused = true }
        fresh.cameBack(1, in: webView)
        fresh.receive(["kind": "frame", "body": "first", "socket": WebSceneView.Coordinator.socketPath("gamma")])
        XCTAssertNotNil(fresh.lastFrame)
        try await Task.sleep(for: .milliseconds(400))
        XCTAssertFalse(reused, "revealed on a frame that arrived after the return")
    }

    /// Mid-switch the page still shows the channel it left: the return stays
    /// quiet, and the switch reports once the new canvas has drawn.
    func testComingBackMidSwitchLeavesItToTheSwitch() async throws {
        _ = try await webView.callAsyncJavaScript("window.noCanvas = true; return true", contentWorld: .page)
        handToSink()
        sink.host = host
        var reused = false
        sink.onReused = { reused = true }
        host.retarget(webView, to: "beta")
        try await waitFor("beta's first (held) frame") { self.host.lastFrame != nil }
        sink.cameBack(1, in: webView)
        try await Task.sleep(for: .milliseconds(400))
        XCTAssertTrue(host.switching, "still inside the hold")
        XCTAssertFalse(reused, "revealed the page before the new channel drew")
    }

    /// Back and away and back again before the page answers: only the latest
    /// return reports.
    func testALaterReturnSupersedesAnEarlierOne() async throws {
        var reused = 0
        host.onReused = { reused += 1 }
        host.cameBack(1, in: webView)
        host.cameBack(2, in: webView)
        try await waitFor("the latest return") { reused >= 1 }
        try await Task.sleep(for: .milliseconds(300))
        XCTAssertEqual(reused, 1)
    }

    /// The renderer died and the page reloads: it has drawn nothing yet, so a
    /// return must not report it drawn.
    func testRendererRestartForgetsWhatWasDrawn() async throws {
        host.receive(["kind": "frame", "body": "x", "socket": WebSceneView.Coordinator.socketPath("alpha")])
        XCTAssertNotNil(host.lastFrame)
        host.webViewWebContentProcessDidTerminate(webView)
        XCTAssertNil(host.lastFrame)
        var reused = false
        host.onReused = { reused = true }
        host.cameBack(1, in: webView)
        try await Task.sleep(for: .milliseconds(300))
        XCTAssertFalse(reused, "revealed a reloading page")
    }

    /// Retarget replaces the page's scripts with one fresh bootstrap, so a
    /// later load (process restart, retry) boots the tap again. (A public
    /// bootstrap names no channel; the URL a reload uses is the pushed one.)
    func testRetargetRewritesTheBootstrapForLaterLoads() {
        host.retarget(webView, to: "beta")
        let scripts = webView.configuration.userContentController.userScripts
        XCTAssertEqual(scripts.count, 1)
        XCTAssertTrue(scripts[0].source.contains("window.WebSocket = Tapped"))
    }
}
