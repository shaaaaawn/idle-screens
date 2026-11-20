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
        session.send(#"{"type":"sleep","sleptAt":4000}"#)
        session.send(#"{"type":"wake","pausedMs":20000}"#)
        session.send(#"{"type":"overlay","text":"hello","ttl":4000}"#)

        let sceneEvent = try await iterator.next()
        let sleepEvent = try await iterator.next()
        let wakeEvent = try await iterator.next()
        let overlayEvent = try await iterator.next()
        XCTAssertEqual(sceneEvent, .scene(spec: .object(["id": .string("warp")]), seed: 42))
        XCTAssertEqual(sleepEvent, .sleep(sleptAt: 4000))
        XCTAssertEqual(wakeEvent, .wake(pausedMs: 20000))
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
        XCTAssertEqual(event, .wake(pausedMs: nil), "an older server's bare wake still parses")
    }

    // MARK: Reconnect backoff (audit 2026-11-18 #11)

    /// Rungs of the ladder, seconds: each wait falls in `rung / 2 ... rung`.
    private static let rungs: [Double] = [1, 2, 4, 8, 16, 30, 30, 30]

    private func assertOnRungs(_ waits: [Double], _ rungs: [Double],
                               file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(waits.count, rungs.count, "waits \(waits)", file: file, line: line)
        for (i, (wait, rung)) in zip(waits, rungs).enumerated() {
            XCTAssertGreaterThanOrEqual(wait, rung / 2, "wait \(i): \(waits)", file: file, line: line)
            XCTAssertLessThanOrEqual(wait, rung, "wait \(i): \(waits)", file: file, line: line)
        }
    }

    /// Runs a client against `connector` until it has asked to wait `count`
    /// times, recording each wait instead of sleeping it; then stops it.
    private func reconnectWaits(_ connector: DroppingWSConnector, count: Int) async throws -> [Double] {
        let log = WaitLog()
        let client = ChannelWSClient(connector: connector, pause: { seconds in
            // Past the waits under test, park (cancellable) rather than spin.
            if log.record(seconds) >= count { try? await Task.sleep(for: .seconds(3600)) }
        })
        let stream = await client.events(baseURL: baseURL, channelId: "test-chan")
        let consumer = Task { for try await _ in stream {} }
        defer { consumer.cancel() }
        let deadline = Date().addingTimeInterval(20)
        while log.waits.count < count, Date() < deadline {
            try await Task.sleep(for: .milliseconds(10))
        }
        return Array(log.waits.prefix(count))
    }

    func testBackoffClimbsWithJitterAndCaps() {
        var low = ReconnectBackoff(), high = ReconnectBackoff()
        XCTAssertEqual(Self.rungs.map { _ in low.next(unit: 0) }, [0.5, 1, 2, 4, 8, 15, 15, 15])
        XCTAssertEqual(Self.rungs.map { _ in high.next(unit: 1) }, Self.rungs)
        high.reset()
        XCTAssertEqual(high.next(unit: 1), 1, "a reset starts the ladder over")
        var odd = ReconnectBackoff()
        XCTAssertEqual(odd.next(unit: 7), 1, "a unit outside 0...1 is clamped")
    }

    /// The outage case: every socket fails before the server says a word.
    /// `open` only builds the task, so it is no sign the server is back: the
    /// waits must climb to the cap, not stay at one second.
    func testAnOutageClimbsTheLadderInsteadOfRetryingEverySecond() async throws {
        let connector = DroppingWSConnector(speaking: [])
        let waits = try await reconnectWaits(connector, count: Self.rungs.count)
        assertOnRungs(waits, Self.rungs)
        XCTAssertGreaterThanOrEqual(connector.opened, Self.rungs.count)
    }

    /// A connection that delivered a frame was real: the ladder starts over.
    func testAFrameFromTheServerResetsTheLadder() async throws {
        // Sockets 1-3 fail silently; socket 4 delivers one frame, then drops.
        let connector = DroppingWSConnector(speaking: [4])
        let waits = try await reconnectWaits(connector, count: 5)
        assertOnRungs(waits, [1, 2, 4, 1, 2])
    }
}

/// Records each reconnect wait the client asks for.
final class WaitLog: @unchecked Sendable {
    private let lock = NSLock()
    private var _waits: [Double] = []
    var waits: [Double] { lock.withLock { _waits } }
    /// Returns how many waits there have been, this one included.
    func record(_ seconds: Double) -> Int { lock.withLock { _waits.append(seconds); return _waits.count } }
}

/// A server that drops every socket at once: `incoming` throws immediately,
/// after one frame on the sockets (1-based) listed in `speaking`.
final class DroppingWSConnector: WebSocketConnecting, @unchecked Sendable {
    let speaking: Set<Int>
    private let lock = NSLock()
    private var _opened = 0
    var opened: Int { lock.withLock { _opened } }

    init(speaking: Set<Int>) { self.speaking = speaking }

    func open(_ url: URL) async throws -> any WebSocketSession {
        let n = lock.withLock { _opened += 1; return _opened }
        return DroppingWSSession(frame: speaking.contains(n) ? #"{"type":"wake"}"# : nil)
    }
}

final class DroppingWSSession: WebSocketSession, @unchecked Sendable {
    let incoming: AsyncThrowingStream<String, Error>

    init(frame: String?) {
        incoming = AsyncThrowingStream { continuation in
            if let frame { continuation.yield(frame) }
            continuation.finish(throwing: URLError(.networkConnectionLost))
        }
    }

    func write(_ text: String) async throws {}
    func closeCode() async -> Int? { nil }
    func cancel() async {}
}
