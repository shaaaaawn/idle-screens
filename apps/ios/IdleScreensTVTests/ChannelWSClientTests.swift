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

    func send(_ text: String) { continuation.yield(text) }
    func fail(_ error: Error) { continuation.finish(throwing: error) }
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

    private func makeStream(connector: MockWSConnector) async -> (AsyncThrowingStream<ChannelWSEvent, Error>, MockWSSession) {
        let client = ChannelWSClient(connector: connector)
        let stream = await client.events(baseURL: baseURL, channelId: "test-chan")
        // Give the receive task a beat to open the session.
        try? await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(connector.sessions.count, 1)
        return (stream, connector.sessions[0])
    }

    func testWebSocketURL() async {
        let url = await ChannelWSClient.webSocketURL(baseURL: baseURL, channelId: "abc")
        XCTAssertEqual(url.absoluteString, "wss://example.com/c/abc/ws")
    }

    func testWebSocketURLWithDeviceId() async {
        let url = await ChannelWSClient.webSocketURL(
            baseURL: baseURL, channelId: "abc", deviceId: "tv-device-1"
        )
        XCTAssertEqual(url.absoluteString, "wss://example.com/c/abc/ws?device=tv-device-1")
    }

    func testSwitchDecode() async throws {
        let connector = MockWSConnector()
        let (stream, session) = await makeStream(connector: connector)
        var iterator = stream.makeAsyncIterator()

        session.send(#"{"type":"switch","channelId":"lobby"}"#)

        let event = try await iterator.next()
        XCTAssertEqual(event, .switchChannel(channelId: "lobby"))
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
