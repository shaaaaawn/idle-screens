import Foundation

// MARK: - Transport (mockable, same pattern as HTTPTransport)

/// A live WebSocket session yielding inbound text frames.
protocol WebSocketSession: Sendable {
    var incoming: AsyncThrowingStream<String, Error> { get }
    func cancel() async
}

/// Opens WebSocket sessions. Mocked in tests to script inbound frames.
protocol WebSocketConnecting: Sendable {
    func open(_ url: URL) async throws -> any WebSocketSession
}

final class URLSessionWebSocketSession: WebSocketSession, @unchecked Sendable {
    let task: URLSessionWebSocketTask
    let incoming: AsyncThrowingStream<String, Error>

    init(task: URLSessionWebSocketTask) {
        self.task = task
        self.incoming = AsyncThrowingStream { continuation in
            task.resume()
            Task {
                do {
                    while !Task.isCancelled {
                        let message = try await task.receive()
                        switch message {
                        case .string(let text):
                            continuation.yield(text)
                        case .data(let data):
                            if let text = String(data: data, encoding: .utf8) {
                                continuation.yield(text)
                            }
                        @unknown default:
                            break
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
    }

    func cancel() async {
        task.cancel(with: .normalClosure, reason: nil)
    }
}

final class URLSessionWebSocketConnector: WebSocketConnecting {
    init() {}

    func open(_ url: URL) async throws -> any WebSocketSession {
        URLSessionWebSocketSession(task: URLSession.shared.webSocketTask(with: url))
    }
}

// MARK: - Events

/// Live channel state pushed by the server. All fields optional — decode leniently.
struct ChannelSnapshot: Equatable, Sendable {
    var scene: JSONValue?
    var spec: JSONValue?
    var resolvedSpec: JSONValue?
    var epoch: Int?
    var sleeping: Bool?
    var viewers: Int?
    var presets: [String]?
}

enum ChannelWSEvent: Equatable, Sendable {
    case snapshot(ChannelSnapshot)
    case scene(spec: JSONValue?, seed: Int?)
    case delta(JSONValue?)
    case sleep
    case wake
    case overlay(text: String?, ttl: Int?)
    /// A paired phone pushed a channel change to this device.
    case switchChannel(channelId: String?)
}

// MARK: - JSONValue lenient accessors

extension JSONValue {
    var stringValue: String? {
        if case .string(let s) = self { return s }
        return nil
    }

    var intValue: Int? {
        switch self {
        case .int(let i): return i
        case .double(let d): return Int(d)
        default: return nil
        }
    }

    var boolValue: Bool? {
        if case .bool(let b) = self { return b }
        return nil
    }

    var stringArray: [String]? {
        if case .array(let a) = self { return a.compactMap(\.stringValue) }
        return nil
    }

    /// `resolvedSpec` may arrive as an object or as stringified JSON — normalize.
    func normalizedSpec() -> JSONValue {
        if case .string(let s) = self,
           let data = s.data(using: .utf8),
           let parsed = try? JSONDecoder().decode(JSONValue.self, from: data) {
            return parsed
        }
        return self
    }
}

// MARK: - Client

/// Live channel feed over `wss://<base>/c/:channelId/ws`.
/// Delivers typed events; reconnects with exponential backoff (1s → 30s cap).
actor ChannelWSClient {
    /// `nonisolated` so the reconnect loop — which runs in the stream's
    /// non-isolated build closure — can reach it without hopping the actor.
    /// Safe because it is a `let` of a `Sendable` type.
    private nonisolated let connector: any WebSocketConnecting
    private var session: (any WebSocketSession)?
    private var receiveTask: Task<Void, Never>?

    init(connector: any WebSocketConnecting = URLSessionWebSocketConnector()) {
        self.connector = connector
    }

    static func webSocketURL(baseURL: URL, channelId: String, deviceId: String? = nil) -> URL {
        let httpURL = baseURL
            .appendingPathComponent("c")
            .appendingPathComponent(channelId)
            .appendingPathComponent("ws")
        var components = URLComponents(url: httpURL, resolvingAgainstBaseURL: false)!
        components.scheme = baseURL.scheme == "http" ? "ws" : "wss"
        if let deviceId {
            // Identifies this device to the server so a paired phone can
            // address its socket with a "switch" push.
            components.queryItems = [URLQueryItem(name: "device", value: deviceId)]
        }
        return components.url!
    }

    /// Stream of events for a channel. Reconnects automatically until the
    /// consuming task is cancelled or `disconnect()` is called.
    func events(baseURL: URL, channelId: String, deviceId: String? = nil) -> AsyncThrowingStream<ChannelWSEvent, Error> {
        let url = Self.webSocketURL(baseURL: baseURL, channelId: channelId, deviceId: deviceId)
        // The element type is pinned explicitly. Left to inference, the compiler
        // resolves to AsyncThrowingStream(unfolding:) — whose closure takes no
        // arguments — and reports the misleading "expects 0 arguments, but 1 was
        // used" rather than anything about the actual body.
        return AsyncThrowingStream<ChannelWSEvent, Error> { continuation in
            let task = Task { [self] in
                var backoff: UInt64 = 1
                while !Task.isCancelled {
                    do {
                        let session = try await connector.open(url)
                        // Actor state is only ever touched through an isolated
                        // method; this closure itself is @Sendable and cannot
                        // assign to `self.session` directly.
                        await adopt(session: session)
                        backoff = 1
                        for try await text in session.incoming {
                            if let event = Self.parse(text) {
                                continuation.yield(event)
                            }
                        }
                    } catch is CancellationError {
                        break
                    } catch {
                        // Connection dropped — fall through to backoff and retry.
                    }
                    if Task.isCancelled { break }
                    try? await Task.sleep(for: .seconds(backoff))
                    backoff = min(backoff * 2, 30)
                }
                continuation.finish()
            }
            Task { await self.adopt(task: task) }
            // `onTermination` is a property, not a method — a trailing closure
            // here does not compile.
            continuation.onTermination = { _ in
                task.cancel()
                Task { await self.tearDownSession() }
            }
        }
    }

    private func adopt(session: any WebSocketSession) {
        self.session = session
    }

    private func adopt(task: Task<Void, Never>) {
        self.receiveTask = task
    }

    func disconnect() {
        receiveTask?.cancel()
        receiveTask = nil
        let current = session
        session = nil
        Task { await current?.cancel() }
    }

    private func tearDownSession() {
        let current = session
        session = nil
        Task { await current?.cancel() }
    }

    // MARK: - Parsing

    static func parse(_ text: String) -> ChannelWSEvent? {
        guard let data = text.data(using: .utf8),
              let message = try? JSONDecoder().decode([String: JSONValue].self, from: data),
              case .string(let type)? = message["type"] else {
            return nil
        }
        switch type {
        case "snapshot":
            return .snapshot(ChannelSnapshot(
                scene: message["scene"],
                spec: message["spec"],
                resolvedSpec: message["resolvedSpec"]?.normalizedSpec(),
                epoch: message["epoch"]?.intValue,
                sleeping: message["sleeping"]?.boolValue,
                viewers: message["viewers"]?.intValue,
                presets: message["presets"]?.stringArray
            ))
        case "scene":
            return .scene(
                spec: message["spec"]?.normalizedSpec(),
                seed: message["seed"]?.intValue
            )
        case "delta":
            return .delta(message["delta"] ?? message["patch"])
        case "sleep":
            return .sleep
        case "wake":
            return .wake
        case "overlay":
            return .overlay(
                text: message["text"]?.stringValue,
                ttl: message["ttl"]?.intValue
            )
        case "switch":
            return .switchChannel(channelId: message["channelId"]?.stringValue)
        default:
            return nil
        }
    }
}
