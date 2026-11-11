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
            channelId: "lobby", baseURL: URL(string: "https://idlescreens.com")!, onFrame: { _ in }, onFailure: {})
        let policy = NSSelectorFromString("webView:decidePolicyForNavigationAction:decisionHandler:")
        XCTAssertTrue(coordinator.responds(to: policy),
                      "navigation policy is not visible to WebKit — check the handler's exact type")
        XCTAssertTrue(coordinator.responds(to: NSSelectorFromString("webViewWebContentProcessDidTerminate:")))
    }
}

/// What a hosted page's private-channel handshake and closes mean natively.
@MainActor
final class HostedPrivateGateTests: XCTestCase {
    private let key = "isk_view_0123456789abcdef0123456789abcdef"

    func testNoKeyShowsTheGateAndARefusedKeyTheRefusedOne() {
        let session = ChannelSession()
        session.start(channelId: "secret", seedSpec: nil, source: .host)
        session.ingest(#"{"type":"auth-required","access":"private"}"#)
        XCTAssertEqual(session.phase, .locked(refused: false))

        let keyed = ChannelSession()
        let key = self.key
        keyed.start(channelId: "secret", seedSpec: nil, source: .host, key: { key })
        keyed.ingest(#"{"type":"auth-required","access":"private"}"#)
        XCTAssertEqual(keyed.phase, .connecting, "held: the page answers, so no gate yet")
        keyed.hostClosed(code: 4401)
        XCTAssertEqual(keyed.phase, .locked(refused: true))
    }

    /// Let in, then 4401: some key was revoked or rotated under a watching
    /// page. Not proof this key is refused, so "Try again", not the gate.
    func testA4401AfterAuthOKIsNotARefusal() {
        let session = ChannelSession()
        let key = self.key
        session.start(channelId: "secret", seedSpec: nil, source: .host, key: { key })
        session.ingest(#"{"type":"auth-required","access":"private"}"#)
        session.ingest(#"{"type":"auth-ok","role":"viewer"}"#)
        session.hostClosed(code: 4401)
        XCTAssertEqual(session.phase, .unreachable)
    }

    func testAMalformedStoredKeyIsNoKey() {
        let session = ChannelSession()
        session.start(channelId: "secret", seedSpec: nil, source: .host, key: { "isk_bad\n" })
        session.ingest(#"{"type":"auth-required","access":"private"}"#)
        XCTAssertEqual(session.phase, .locked(refused: false))
    }

    func testADeletedChannelIsFinalNotUnreachable() {
        let session = ChannelSession()
        session.start(channelId: "gone", seedSpec: nil, source: .host)
        session.hostClosed(code: 4410)
        XCTAssertEqual(session.phase, .deleted)
    }
}

/// The pairing wire fields a private channel's hand-off rides on. A
/// misspelt key would fail silently: the server ignores it, and the TV
/// never gets its viewer key.
final class PairClientWireTests: XCTestCase {
    private let base = URL(string: "https://example.com")!

    private func body(_ request: URLRequest) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any]) ?? [:]
    }

    func testPushSendsSealedKeyOnlyWhenSet() async throws {
        let transport = MockTransport()
        transport.handler = { _ in (Data(#"{"ok":true,"delivered":1}"#.utf8), 200) }
        let client = PairClient(baseURL: base, transport: transport)
        try await client.push(pairToken: "isp_x", channelId: "secret", sealedKey: "c2VhbGVk")
        try await client.push(pairToken: "isp_x", channelId: "lobby")
        XCTAssertEqual(body(transport.requests[0])["sealedKey"] as? String, "c2VhbGVk")
        XCTAssertNil(body(transport.requests[1])["sealedKey"], "left out, not null")
    }

    func testCreateCodeSendsPublicKeyAndClaimReadsIt() async throws {
        let transport = MockTransport()
        transport.handler = { request in
            if request.url?.path == "/api/pair/claim" {
                return (Data(#"{"ok":true,"pairToken":"isp_x","deviceId":"tv-1234567","channelId":null,"publicKey":"pk"}"#.utf8), 200)
            }
            return (Data(#"{"code":"ABCDEF","url":"https://example.com/pair/ABCDEF","expiresAt":1}"#.utf8), 200)
        }
        let client = PairClient(baseURL: base, transport: transport)
        _ = try? await client.createCode(deviceId: "tv-1234567", channelId: nil, publicKey: "pk")
        XCTAssertEqual(body(transport.requests[0])["publicKey"] as? String, "pk")
        let claimed = try await client.claim(code: "ABCDEF")
        XCTAssertEqual(claimed.publicKey, "pk")
    }

    func testAPairingWithNoScreenKeyIsTold() async {
        let transport = MockTransport()
        transport.handler = { _ in (Data(#"{"ok":false,"delivered":0,"code":"no-screen-key","error":"x"}"#.utf8), 409) }
        let client = PairClient(baseURL: base, transport: transport)
        do {
            try await client.push(pairToken: "isp_x", channelId: "secret", sealedKey: "c2VhbGVk")
            XCTFail("expected noScreenKey")
        } catch {
            XCTAssertEqual(error as? PairError, .noScreenKey)
        }
    }
}
