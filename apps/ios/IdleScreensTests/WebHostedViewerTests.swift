import XCTest
@testable import IdleScreens

/// The viewer draws with the web engine and controls with native UI. These
/// tests hold the two seams of that design: what reaches the page, and what
/// the native chrome learns back from it.
final class WebSceneBootstrapTests: XCTestCase {
    private let base = URL(string: "https://idlescreens.com")!

    /// `?chrome=off` is the site's own mode for native hosts. Without it the
    /// page brings its whole control bar, and the app has two UIs.
    func testSceneURLAsksForTheBarePage() {
        let url = WebSceneView.sceneURL(baseURL: base, channelId: "lobby")
        XCTAssertEqual(url.absoluteString, "https://idlescreens.com/channel/lobby?chrome=off")
    }

    /// The server's threat model rules tokens out of URLs — they land in logs.
    /// The token goes into page storage instead, so it must never appear here.
    func testTokenNeverRidesTheURL() {
        let url = WebSceneView.sceneURL(baseURL: base, channelId: "lobby")
        XCTAssertFalse(url.absoluteString.contains("token"))
        XCTAssertFalse(url.absoluteString.contains("isk_"))
    }

    func testValidTokenIsSeededIntoTheKeyThePageReads() {
        let script = WebSceneView.bootstrapScript(channelId: "lobby", token: "isk_abc-123_XYZ", baseURL: base)
        // `site/src/lib/tokens.ts` reads `isk:<channelId>` from localStorage.
        XCTAssertTrue(script.contains(#"localStorage.setItem("isk:lobby", "isk_abc-123_XYZ")"#))
    }

    func testNoTokenMeansNoSeed() {
        let script = WebSceneView.bootstrapScript(channelId: "lobby", token: nil, baseURL: base)
        XCTAssertFalse(script.contains("localStorage.setItem"))
    }

    /// A Keychain value is data, and this string becomes script. Anything that
    /// isn't shaped exactly like a token is dropped rather than escaped.
    func testMalformedTokenCannotBecomeScript() {
        for hostile in [#"isk_");alert(1);//"#, "isk_a b", "<script>", "isk_\nx", "isk_abc\n", "isk_", ""] {
            let script = WebSceneView.bootstrapScript(channelId: "lobby", token: hostile, baseURL: base)
            XCTAssertFalse(script.contains("localStorage.setItem"), "seeded a malformed token: \(hostile)")
            XCTAssertFalse(script.contains("alert(1)"))
        }
    }

    func testChannelIdIsEmbeddedAsAJSONLiteral() {
        let script = WebSceneView.bootstrapScript(channelId: #"a"b"#, token: "isk_ok", baseURL: base)
        XCTAssertTrue(script.contains(#""isk:a\"b""#), "the quote must arrive escaped")
    }

    /// The tap is how native chrome hears the channel without a second socket.
    func testScriptTapsTheSocketAndHidesTheWebTokenGate() {
        let script = WebSceneView.bootstrapScript(channelId: "lobby", token: nil, baseURL: base)
        XCTAssertTrue(script.contains("window.WebSocket = Tapped"))
        XCTAssertTrue(script.contains("Tapped.prototype = Native.prototype"),
                      "without this, the page's `instanceof WebSocket` checks break")
        XCTAssertTrue(script.contains("messageHandlers.\(WebSceneView.handlerName)"))
        XCTAssertTrue(script.contains(".private-gate{display:none!important}"))
    }

    /// A socket must match the channel's own origin, not just its path suffix
    /// — `wss://attacker.example/anything/c/lobby/ws` must not slip through.
    func testSocketTapPinsToTheFullOriginNotJustThePathSuffix() {
        let script = WebSceneView.bootstrapScript(channelId: "lobby", token: nil, baseURL: base)
        XCTAssertTrue(script.contains(#"const channelSocketProtocol = "wss:""#))
        XCTAssertTrue(script.contains(#"const channelSocketHost = "idlescreens.com""#))
        XCTAssertFalse(script.contains(".pathname.endsWith("), "must not fall back to a path-suffix check")
    }
}

/// Frames captured from production on 2026-09-19 (trimmed).
@MainActor
final class HostedSessionTests: XCTestCase {
    private let snapshot = """
    {"type":"snapshot","epoch":7,"sleeping":false,"viewers":1,
     "presets":["thirty-days","star-compass"],
     "resolvedSpec":{"id":"machine-elves","label":"Machine Elves — The Court Assembles",
       "background":{"type":"gradient","stops":[{"at":0,"color":"#12002B"},{"at":1,"color":"#000000"}]},
       "layers":[{"count":400,"sprite":{"kind":"circle"}}]}}
    """

    func testHostModeLearnsTheChromeFactsAndCompilesNothing() {
        let session = ChannelSession()
        session.start(channelId: "lobby", seedSpec: nil, source: .host)
        session.ingest(snapshot)

        XCTAssertEqual(session.sceneLabel, "Machine Elves — The Court Assembles")
        XCTAssertEqual(session.presets, ["thirty-days", "star-compass"])
        XCTAssertEqual(session.viewers, 1)
        XCTAssertEqual(session.backdrop, "#12002B")
        XCTAssertEqual(session.phase, .live)
        // The web engine is drawing. 400 entities compiled here would be CPU
        // and memory spent on a picture nobody sees.
        XCTAssertTrue(session.compiledScene.isEmpty)
    }

    /// A classic saver is just `{"id":"warp"}`. The native path used to treat
    /// that as "cannot render"; hosted, it is simply another scene.
    func testClassicSaverIsJustAnotherSceneWhenHosted() {
        let session = ChannelSession()
        session.start(channelId: "lobby", seedSpec: nil, source: .host)
        session.ingest(#"{"type":"scene","spec":{"id":"warp"},"seed":3}"#)
        XCTAssertEqual(session.sceneLabel, "warp")
        XCTAssertEqual(session.phase, .live)
        XCTAssertFalse(session.isClassicSpec)
    }

    /// The page draws overlays itself, styled and placed. A native copy on top
    /// would show every overlay twice.
    func testOverlaysAreLeftToThePage() {
        let session = ChannelSession()
        session.start(channelId: "lobby", seedSpec: nil, source: .host)
        session.ingest(#"{"type":"overlay","text":"hello","ttl":4000}"#)
        XCTAssertNil(session.overlayText)
    }

    func testSleepAndWakeStillDriveTheNativeChrome() {
        let session = ChannelSession()
        session.start(channelId: "lobby", seedSpec: nil, source: .host)
        session.ingest(#"{"type":"sleep"}"#)
        XCTAssertTrue(session.sleeping)
        session.ingest(#"{"type":"wake"}"#)
        XCTAssertFalse(session.sleeping)
    }

    func testPageFailureBeforeAnyFrameIsUnreachable() {
        let session = ChannelSession()
        session.start(channelId: "lobby", seedSpec: nil, source: .host)
        session.hostFailed()
        XCTAssertEqual(session.phase, .unreachable)
    }

    /// A sub-resource hiccup after the scene is up must not tear down a
    /// channel that is visibly playing.
    func testPageFailureAfterASceneDoesNotBlankALiveChannel() {
        let session = ChannelSession()
        session.start(channelId: "lobby", seedSpec: nil, source: .host)
        session.ingest(snapshot)
        session.hostFailed()
        XCTAssertEqual(session.phase, .live)
    }

    /// Socket-fed sessions (tvOS, `-native-render`) must not accept frames
    /// from a page — two feeds would race.
    func testSocketSessionsIgnoreIngestedFrames() {
        let session = ChannelSession()
        session.ingest(snapshot)
        XCTAssertNil(session.sceneLabel)
    }
}

/// WebKit finds delegate methods by Objective-C selector. A Swift method whose
/// type only *nearly* matches the protocol requirement is never exposed under
/// that selector — the compiler warns, the build passes, and the policy simply
/// stops running. That happened to the navigation policy on an SDK bump, which
/// left a web view holding a seeded key free to navigate anywhere.
final class WebSceneDelegateConformanceTests: XCTestCase {
    func testWebKitCanActuallyCallTheNavigationPolicy() {
        let coordinator = WebSceneView.Coordinator(
            baseURL: URL(string: "https://idlescreens.com")!, onFrame: { _ in }, onFailure: {})
        let policy = NSSelectorFromString("webView:decidePolicyForNavigationAction:decisionHandler:")
        XCTAssertTrue(coordinator.responds(to: policy),
                      "navigation policy is not visible to WebKit — check the handler's exact type")
        XCTAssertTrue(coordinator.responds(to: NSSelectorFromString("webViewWebContentProcessDidTerminate:")))
    }
}
