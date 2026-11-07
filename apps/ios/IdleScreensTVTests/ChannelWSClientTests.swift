import XCTest
@testable import IdleScreensTV

/// Scripted WS session — yields frames pushed by the test.
final class MockWSSession: WebSocketSession, @unchecked Sendable {
    let incoming: AsyncThrowingStream<String, Error>
    private let continuation: AsyncThrowingStream<String, Error>.Continuation

    init() {
        var c: AsyncThrowingStream<String, Error>.Continuation!
        incoming = AsyncThrowingStream { c = $0 }
        continuation = c
    }

    private let lock = NSLock()
    private var _written: [String] = []
    private var _closeCode: Int?
    /// Frames the client sent (the handshake's `auth`).
    var written: [String] { lock.withLock { _written } }

    func send(_ text: String) { continuation.yield(text) }
    func fail(_ error: Error) { continuation.finish(throwing: error) }
    /// The server closes with a code (4401, 4410, …).
    func close(code: Int) {
        lock.withLock { _closeCode = code }
        continuation.finish()
    }
    func write(_ text: String) async throws { lock.withLock { _written.append(text) } }
    func closeCode() async -> Int? { lock.withLock { _closeCode } }
    func cancel() async { continuation.finish() }
}

final class MockWSConnector: WebSocketConnecting, @unchecked Sendable {
    private(set) var sessions: [MockWSSession] = []

    func open(_ url: URL) async throws -> any WebSocketSession {
        let session = MockWSSession()
        sessions.append(session)
        return session
    }
}

final class ChannelWSClientTests: XCTestCase {
    private let baseURL = URL(string: "https://example.com")!

    private func makeStream(connector: MockWSConnector,
                            token: @escaping @Sendable () -> String? = { nil }) async -> (AsyncThrowingStream<ChannelWSEvent, Error>, MockWSSession) {
        let client = ChannelWSClient(connector: connector)
        let stream = await client.events(baseURL: baseURL, channelId: "test-chan", token: token)
        // Give the receive task a beat to open the session.
        try? await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(connector.sessions.count, 1)
        return (stream, connector.sessions[0])
    }

    func testWebSocketURL() async {
        let url = ChannelWSClient.webSocketURL(baseURL: baseURL, channelId: "abc")
        XCTAssertEqual(url.absoluteString, "wss://example.com/c/abc/ws")
    }

    func testWebSocketURLWithDeviceId() async {
        let url = ChannelWSClient.webSocketURL(
            baseURL: baseURL, channelId: "abc", deviceId: "tv-device-1"
        )
        XCTAssertEqual(url.absoluteString, "wss://example.com/c/abc/ws?device=tv-device-1")
    }

    // MARK: Private channel handshake

    static let viewerKey = "isk_view_0123456789abcdef0123456789abcdef"

    func testAuthRequiredIsAnsweredWithTheStoredKey() async throws {
        let connector = MockWSConnector()
        let (stream, session) = await makeStream(connector: connector, token: { Self.viewerKey })
        var iterator = stream.makeAsyncIterator()

        session.send(#"{"type":"auth-required","access":"private"}"#)
        let asked = try await iterator.next()
        XCTAssertEqual(asked, .authRequired(answered: true))
        XCTAssertEqual(session.written.count, 1)
        let frame = try JSONDecoder().decode([String: String].self, from: Data(session.written[0].utf8))
        XCTAssertEqual(frame, ["type": "auth", "token": Self.viewerKey])

        session.send(#"{"type":"auth-ok","role":"viewer"}"#)
        let ok = try await iterator.next()
        XCTAssertEqual(ok, .authOK(role: .viewer))
    }

    func testAuthRequiredWithoutAKeySendsNothing() async throws {
        let connector = MockWSConnector()
        let (stream, session) = await makeStream(connector: connector)
        var iterator = stream.makeAsyncIterator()

        session.send(#"{"type":"auth-required","access":"private"}"#)
        let asked = try await iterator.next()
        XCTAssertEqual(asked, .authRequired(answered: false))
        XCTAssertTrue(session.written.isEmpty, "no key: the socket stays pending and silent, so pushes still land")
    }

    func testAMalformedStoredKeyIsNotSent() async throws {
        let connector = MockWSConnector()
        let (stream, session) = await makeStream(connector: connector, token: { "isk_view_abc\n\"}" })
        var iterator = stream.makeAsyncIterator()

        session.send(#"{"type":"auth-required","access":"private"}"#)
        let asked = try await iterator.next()
        XCTAssertEqual(asked, .authRequired(answered: false))
        XCTAssertTrue(session.written.isEmpty)
    }

    func testARefusedKeyEndsTheStreamWithoutReconnecting() async throws {
        let connector = MockWSConnector()
        let (stream, session) = await makeStream(connector: connector, token: { Self.viewerKey })
        var iterator = stream.makeAsyncIterator()

        session.send(#"{"type":"auth-required","access":"private"}"#)
        _ = try await iterator.next()
        session.close(code: 4401)
        let refused = try await iterator.next()
        XCTAssertEqual(refused, .refused)
        let end = try await iterator.next()
        XCTAssertNil(end, "a refusal ends the stream")
        try? await Task.sleep(for: .milliseconds(200))
        XCTAssertEqual(connector.sessions.count, 1, "a refused key is not retried")
    }

    func testADeletedChannelEndsTheStream() async throws {
        let connector = MockWSConnector()
        let (stream, session) = await makeStream(connector: connector)
        var iterator = stream.makeAsyncIterator()

        session.close(code: 4410)
        let deleted = try await iterator.next()
        XCTAssertEqual(deleted, .deleted)
        let end = try await iterator.next()
        XCTAssertNil(end)
    }

    func testCloseCodesAreReadByWhatTheHandshakeSaid() {
        typealias C = ChannelWSClient
        // Sent a key, never accepted: refused.
        XCTAssertEqual(C.afterClose(code: 4401, handshake: .init(answered: true, proved: false)), .refused)
        // Proved, then closed: the owner revoked SOME key. Re-prove.
        XCTAssertEqual(C.afterClose(code: 4401, handshake: .init(answered: true, proved: true)), .retry)
        // Never asked: the channel went private under us. Reconnect and be asked.
        XCTAssertEqual(C.afterClose(code: 4401, handshake: .init()), .retry)
        XCTAssertEqual(C.afterClose(code: 4410, handshake: .init()), .deleted)
        XCTAssertEqual(C.afterClose(code: nil, handshake: .init(answered: true)), .retry)
        XCTAssertEqual(C.afterClose(code: 1006, handshake: .init()), .retry)
    }

    func testAuthFrameIsEncodedNotSpliced() throws {
        let frame = ChannelWSClient.authFrame(token: #"isk_"x"#)
        let decoded = try JSONDecoder().decode([String: String].self, from: Data(frame.utf8))
        XCTAssertEqual(decoded["token"], #"isk_"x"#)
    }

    func testSwitchDecode() async throws {
        let connector = MockWSConnector()
        let (stream, session) = await makeStream(connector: connector)
        var iterator = stream.makeAsyncIterator()

        session.send(#"{"type":"switch","channelId":"lobby"}"#)

        let event = try await iterator.next()
        XCTAssertEqual(event, .switchChannel(channelId: "lobby"))
    }

    func testSwitchCarriesAPinnedScene() async throws {
        let connector = MockWSConnector()
        let (stream, session) = await makeStream(connector: connector)
        var iterator = stream.makeAsyncIterator()

        session.send(#"{"type":"switch","channelId":"studio","sceneId":598}"#)
        let pinned = try await iterator.next()
        XCTAssertEqual(pinned, .switchChannel(channelId: "studio", sceneId: 598))

        // A nonsense id is no pin: the screen goes to the channel live.
        session.send(#"{"type":"switch","channelId":"studio","sceneId":-2}"#)
        let live = try await iterator.next()
        XCTAssertEqual(live, .switchChannel(channelId: "studio", sceneId: nil))
    }

    func testSnapshotWithResolvedSpecAsObject() async throws {
        let connector = MockWSConnector()
        let (stream, session) = await makeStream(connector: connector)
        var iterator = stream.makeAsyncIterator()

        session.send(#"{"type":"snapshot","epoch":3,"sleeping":false,"viewers":7,"resolvedSpec":{"id":"snowfall","layers":[]}}"#)

        let event = try await iterator.next()
        XCTAssertEqual(event, .snapshot(ChannelSnapshot(
            resolvedSpec: .object(["id": .string("snowfall"), "layers": .array([])]),
            epoch: 3,
            sleeping: false,
            viewers: 7
        )))
    }

    func testSnapshotWithResolvedSpecAsString() async throws {
        let connector = MockWSConnector()
        let (stream, session) = await makeStream(connector: connector)
        var iterator = stream.makeAsyncIterator()

        // resolvedSpec arrives as stringified JSON.
        session.send(#"{"type":"snapshot","epoch":9,"sleeping":true,"resolvedSpec":"{\"id\":\"aurora\",\"seed\":66}"}"#)

        let event = try await iterator.next()
        XCTAssertEqual(event, .snapshot(ChannelSnapshot(
            resolvedSpec: .object(["id": .string("aurora"), "seed": .int(66)]),
            epoch: 9,
            sleeping: true
        )))
    }

    func testSceneSleepWakeOverlayDecode() async throws {
        let connector = MockWSConnector()
        let (stream, session) = await makeStream(connector: connector)
        var iterator = stream.makeAsyncIterator()

        session.send(#"{"type":"scene","spec":{"id":"warp"},"seed":42}"#)
        session.send(#"{"type":"sleep"}"#)
        session.send(#"{"type":"wake"}"#)
        session.send(#"{"type":"overlay","text":"hello","ttl":4000}"#)

        let sceneEvent = try await iterator.next()
        let sleepEvent = try await iterator.next()
        let wakeEvent = try await iterator.next()
        let overlayEvent = try await iterator.next()
        XCTAssertEqual(sceneEvent, .scene(spec: .object(["id": .string("warp")]), seed: 42))
        XCTAssertEqual(sleepEvent, .sleep)
        XCTAssertEqual(wakeEvent, .wake)
        XCTAssertEqual(overlayEvent, .overlay(text: "hello", ttl: 4000))
    }

    func testGarbageFramesAreSkipped() async throws {
        let connector = MockWSConnector()
        let (stream, session) = await makeStream(connector: connector)
        var iterator = stream.makeAsyncIterator()

        session.send("not json at all")
        session.send(#"{"type":"unknown-future-type","x":1}"#)
        session.send(#"{"type":"wake"}"#)

        let event = try await iterator.next()
        XCTAssertEqual(event, .wake)
    }
}
