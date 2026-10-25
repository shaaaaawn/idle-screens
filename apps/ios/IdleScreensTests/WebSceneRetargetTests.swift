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
        document.getElementById('screen').replaceChildren(document.createElement('canvas'));
        openChannel(id);
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
        host.onReused = { reused = true }
        // Keep alpha's socket alive past the switch, as a closing socket is.
        _ = try await webView.callAsyncJavaScript("window.openChannel = (id) => { new WebSocket('ws://localhost:9/c/' + id + '/ws'); }; return true",
                                                  contentWorld: .page)
        host.retarget(webView, to: "beta")
        XCTAssertEqual(host.channelId, "beta")
        XCTAssertNil(host.lastFrame, "alpha's state is forgotten, never replayed as beta's")
        frames = []
        try await waitFor("beta's frames") { self.frames.count >= 3 }
        try await waitFor("the switch to report drawn") { reused }
        XCTAssertTrue(frames.allSatisfy { $0 == "frame from /c/beta/ws" }, "\(frames)")
        let path = try await webView.evaluateJavaScript("location.pathname + location.search") as? String
        XCTAssertEqual(path, "/channel/beta?chrome=off")
    }

    /// A reload after a switch boots for the channel it is on now.
    func testRetargetRewritesTheBootstrapForLaterLoads() {
        host.retarget(webView, to: "beta")
        let scripts = webView.configuration.userContentController.userScripts
        XCTAssertEqual(scripts.count, 1)
        XCTAssertTrue(scripts[0].source.contains("window.WebSocket = Tapped"))
    }
}
