import Foundation

// MARK: - Transport (mockable, same pattern as HTTPTransport)

/// A live WebSocket session yielding inbound text frames.
protocol WebSocketSession: Sendable {
    var incoming: AsyncThrowingStream<String, Error> { get }
    /// Send one text frame. The only frame a screen sends is the private
    /// channel handshake's `auth`.
    func write(_ text: String) async throws
    /// The code the server closed with, once `incoming` has ended: 4401 is a
    /// refused or missing key, 4410 a deleted channel. nil when the socket
    /// dropped without a close frame (a network failure).
    func closeCode() async -> Int?
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

    func write(_ text: String) async throws {
        try await task.send(.string(text))
    }

    func closeCode() async -> Int? {
        // `.invalid` (0) until a close frame arrives. A server's own codes
        // (4401, 4410) come through as raw values outside Apple's enum.
        let raw = task.closeCode.rawValue
        return raw == 0 ? nil : raw
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
    /// The server's wall clock when it sent this (ms): the device's skew.
    var now: Int?
}

enum ChannelWSEvent: Equatable, Sendable {
    case snapshot(ChannelSnapshot)
    /// A new scene went live (publish, recall, a scheduled entry). `transition`
    /// is how the agent asked screens to replace the old one; nil = the default.
    /// `epoch`: the publish time (ms) the channel's shared clock counts from.
    /// `track`: the scene's control track — kept steers, and a publish's own
    /// glide (`fromPublish`) that each screen plays from its mount.
    case scene(spec: JSONValue?, seed: Int?, transition: SceneTransition? = nil, epoch: Int? = nil,
               track: JSONValue? = nil)
    /// The channel was reseeded (setSeed): a new arrangement and a new epoch.
    case reseed(seed: Int?, epoch: Int?)
    case delta(JSONValue?)
    /// The channel's whole control track after a steer (the server sends it
    /// beside every `delta` so screens converge instead of stacking steers).
    case track(JSONValue?, epoch: Int?)
    case sleep
    case wake
    case overlay(text: String?, ttl: Int?)
    /// A paired phone retargeted this screen: a channel, and optionally one
    /// stored scene of it to pin (`sceneId`; nil = live).
    /// `sealedKey`: a private channel's viewer key, sealed to this screen's
    /// pairing key by the phone (`PairKeySeal`). Opaque until opened.
    case switchChannel(channelId: String?, sceneId: Int? = nil, sealedKey: String? = nil)
    /// The channel is private (idle-server capability-auth.md, "WebSocket").
    /// `answered`: this device held a key and sent it; the scene follows an
    /// `authOK`. Not answered: there is nothing to show without a key, and the
    /// socket stays open and silent, so a paired phone's push still lands.
    case authRequired(answered: Bool)
    /// The key was accepted, in this role. The snapshot comes next.
    case authOK(role: ChannelRole?)
    /// The server closed the socket with 4401 after this device answered with
    /// its key: the key does not open the channel (revoked, rotated, or for
    /// another channel). The stream ends; retrying would be refused again.
    case refused
    /// The channel was deleted (4410). The stream ends.
    case deleted
}

// MARK: - Scene transitions

/// How a screen replaces the scene it shows with a new one (idle-server
/// transition.ts): `fade` (default) dissolves over `dur` ms, `cut` swaps at
/// once, `morph` dissolves here until native renderers can glide a spec.
struct SceneTransition: Equatable, Sendable {
    enum Kind: String, Sendable { case fade, cut, morph }
    let kind: Kind
    /// Milliseconds, when the agent set one.
    let dur: Double?

    /// The default when a scene message carries none: the web viewer's 0.8 s crossfade.
    static let defaultSeconds: TimeInterval = 0.8

    init(kind: Kind, dur: Double? = nil) { self.kind = kind; self.dur = dur }

    /// Lenient: a malformed or absent value is nil (the server already refused bad ones).
    init?(_ json: JSONValue?) {
        guard case .object(let o)? = json, let raw = o["type"]?.stringValue, let kind = Kind(rawValue: raw) else { return nil }
        var dur: Double?
        switch o["dur"] {
        case .int(let i)?: dur = Double(i)
        case .double(let d)?: dur = d
        default: dur = nil
        }
        self.kind = kind
        self.dur = dur.map { min(max($0, 0), 10_000) }
    }

    /// Seconds to dissolve over, given the scene message's transition (nil = default).
    static func seconds(for transition: SceneTransition?) -> TimeInterval {
        guard let transition else { return defaultSeconds }
        if transition.kind == .cut { return 0 }
        return (transition.dur.map { $0 / 1000 }) ?? defaultSeconds
    }
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
    /// consuming task is cancelled or `disconnect()` is called — or until the
    /// server refuses this device's key or deletes the channel, which no
    /// retry would change (`refused`, `deleted`).
    ///
    /// `token` is asked on every connect, never captured once: a key can be
    /// added, or replaced, while the stream runs. It is sent in the first
    /// frame when the server says `auth-required`, never in the URL (the
    /// threat model's rule: URLs land in logs).
    func events(baseURL: URL, channelId: String, deviceId: String? = nil,
                token: @escaping @Sendable () -> String? = { nil }) -> AsyncThrowingStream<ChannelWSEvent, Error> {
        let url = Self.webSocketURL(baseURL: baseURL, channelId: channelId, deviceId: deviceId)
        // The element type is pinned explicitly. Left to inference, the compiler
        // resolves to AsyncThrowingStream(unfolding:) — whose closure takes no
        // arguments — and reports the misleading "expects 0 arguments, but 1 was
        // used" rather than anything about the actual body.
        return AsyncThrowingStream<ChannelWSEvent, Error> { continuation in
            let task = Task { [self] in
                var backoff: UInt64 = 1
                while !Task.isCancelled {
                    var handshake = Handshake()
                    var opened: (any WebSocketSession)?
                    do {
                        let session = try await connector.open(url)
                        opened = session
                        // Actor state is only ever touched through an isolated
                        // method; this closure itself is @Sendable and cannot
                        // assign to `self.session` directly.
                        adopt(session: session)
                        backoff = 1
                        for try await text in session.incoming {
                            guard var event = Self.parse(text) else { continue }
                            if case .authRequired = event {
                                // Answer from the key this device holds, if any.
                                // A malformed stored value is not sent: the
                                // server would only close on it.
                                if let key = token(), ChannelTokenFormat.isWellFormedToken(key) {
                                    try await session.write(Self.authFrame(token: key))
                                    handshake.answered = true
                                }
                                event = .authRequired(answered: handshake.answered)
                            } else if case .authOK = event {
                                handshake.proved = true
                            }
                            continuation.yield(event)
                        }
                    } catch is CancellationError {
                        break
                    } catch {
                        // Connection dropped — fall through to the close code.
                    }
                    if Task.isCancelled { break }
                    switch Self.afterClose(code: await opened?.closeCode(), handshake: handshake) {
                    case .refused:
                        continuation.yield(.refused)
                        continuation.finish()
                        return
                    case .deleted:
                        continuation.yield(.deleted)
                        continuation.finish()
                        return
                    case .retry:
                        break
                    }
                    try? await Task.sleep(for: .seconds(backoff))
                    backoff = min(backoff * 2, 30)
                }
                continuation.finish()
            }
            Task { self.adopt(task: task) }
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

    // MARK: - Private channel handshake

    /// What one connection said about the handshake, so its close can be read.
    struct Handshake: Equatable, Sendable {
        /// This device sent its key (`auth`).
        var answered = false
        /// The server accepted it (`auth-ok`).
        var proved = false
    }

    enum AfterClose: Equatable { case retry, refused, deleted }

    /// Close code 4401 (idle-server `WS_CLOSE_UNAUTHORIZED`) and 4410
    /// (`CLOSE_DELETED`), the two the server uses to say "don't come back".
    static let closeUnauthorized = 4401
    static let closeDeleted = 4410

    /// Whether a closed connection is worth reopening.
    ///
    /// A 4401 means three different things, and only one is final:
    /// - sent a key, never accepted: the key is refused. Stop.
    /// - sent a key, accepted, later 4401: the owner revoked or rotated SOME
    ///   key, and the server closes every proved socket rather than track
    ///   which hash each one used. A good key re-proves in a second. Retry.
    /// - never asked: the channel just went private under an anonymous
    ///   socket. The next connection is asked and answers (or shows the
    ///   gate). Retry.
    static func afterClose(code: Int?, handshake: Handshake) -> AfterClose {
        switch code {
        case closeDeleted?:
            return .deleted
        case closeUnauthorized?:
            return handshake.answered && !handshake.proved ? .refused : .retry
        default:
            return .retry
        }
    }

    /// The handshake's one client frame. Encoded, never spliced into a string.
    static func authFrame(token: String) -> String {
        let data = (try? JSONEncoder().encode(["type": "auth", "token": token])) ?? Data()
        return String(decoding: data, as: UTF8.self)
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
                presets: message["presets"]?.stringArray,
                now: message["now"]?.intValue
            ))
        case "scene":
            return .scene(
                spec: message["spec"]?.normalizedSpec(),
                seed: message["seed"]?.intValue,
                transition: SceneTransition(message["transition"]),
                epoch: message["epoch"]?.intValue,
                track: message["track"]
            )
        case "seed":
            return .reseed(seed: message["seed"]?.intValue, epoch: message["epoch"]?.intValue)
        case "delta":
            // The server spreads the delta's fields onto the message itself.
            return .delta(message["delta"] ?? message["patch"] ?? .object(message.filter { $0.key != "type" }))
        case "track":
            return .track(message["track"], epoch: message["epoch"]?.intValue)
        case "sleep":
            return .sleep
        case "wake":
            return .wake
        case "overlay":
            return .overlay(
                text: message["text"]?.stringValue,
                ttl: message["ttl"]?.intValue
            )
        case "auth-required":
            // `answered` is the socket's to say; a page tap's frame is the
            // page's business (it answers from its own storage).
            return .authRequired(answered: false)
        case "auth-ok":
            return .authOK(role: message["role"]?.stringValue.flatMap(ChannelRole.init(rawValue:)))
        case "switch":
            let scene = message["sceneId"]?.intValue
            return .switchChannel(channelId: message["channelId"]?.stringValue,
                                  sceneId: scene.flatMap { $0 > 0 ? $0 : nil },
                                  sealedKey: message["sealedKey"]?.stringValue)
        default:
            return nil
        }
    }
}
