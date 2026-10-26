import Foundation
#if canImport(UIKit)
import UIKit
#endif

// MARK: - Transport

/// Pluggable HTTP transport so clients can be mocked in tests.
protocol HTTPTransport: Sendable {
    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

struct URLSessionTransport: HTTPTransport {
    let session: URLSession = .shared

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw MCPError.invalidResponse
        }
        return (data, http)
    }
}

// MARK: - Errors

/// One tool refusal, as the server's error envelope describes it
/// (`structuredContent.error = {code, message, retryable, hint, docs}`).
/// Older servers send only a text block; then `code` is nil and `message` is
/// the text's `error` sentence, or the raw text.
struct MCPToolFailure: Equatable, Sendable {
    let tool: String
    let code: String?
    let message: String
    let hint: String?
    let retryable: Bool?

    init(tool: String, code: String? = nil, message: String, hint: String? = nil, retryable: Bool? = nil) {
        self.tool = tool
        self.code = code
        self.message = message
        self.hint = hint
        self.retryable = retryable
    }
}

enum MCPError: LocalizedError, Equatable {
    case invalidResponse
    case httpError(status: Int, body: String)
    case tool(MCPToolFailure)
    case unparsableResult(tool: String, text: String)
    /// The server asked for a confirmation and the person said no. Nothing
    /// was sent a second time, so nothing happened — callers stay quiet.
    case cancelled(tool: String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: "Invalid response from server"
        case .httpError(let status, let body): "HTTP \(status): \(body)"
        case .tool(let failure): failure.message
        case .unparsableResult(let tool, let text): "Could not parse '\(tool)' result: \(text)"
        case .cancelled: "Cancelled."
        }
    }

    /// The server's next-step advice, when it gave one a person can act on.
    /// Hints written for agents (JSON examples, argument names) are left out.
    var recoverySuggestion: String? {
        guard case .tool(let failure) = self, let hint = failure.hint, !hint.isEmpty,
              Self.humanHintCodes.contains(failure.code ?? "") else { return nil }
        return hint
    }

    /// Codes whose default hint reads as advice to a person, not to an agent.
    private static let humanHintCodes: Set<String> = ["rate_limited", "unavailable"]

    /// Message plus any person-facing hint — what an alert or toast shows.
    var displayText: String {
        [errorDescription, recoverySuggestion].compactMap { $0 }.joined(separator: " ")
    }

    var code: String? {
        if case .tool(let failure) = self { return failure.code }
        return nil
    }

    var isCancellation: Bool {
        if case .cancelled = self { return true }
        return false
    }
}

extension Error {
    /// True when the person cancelled a server confirmation: not a failure.
    var isMCPCancellation: Bool { (self as? MCPError)?.isCancellation == true }

    /// The text to show a person for this error.
    var mcpDisplayText: String { (self as? MCPError)?.displayText ?? localizedDescription }
}

// MARK: - Identity and confirmation

/// Who is calling. idlescreens.com attributes every write (PR #250's
/// contract): `intent` is required, `harness` says where the call came from.
/// No AI acts here, so — like the web UI, which sends
/// `harness: idlescreens-web` and no `agent` — the app names its surface and
/// leaves `agent` out.
struct MCPClientIdentity: Equatable, Sendable {
    /// `idlescreens-ios` / `idlescreens-tvos`.
    let harness: String
    /// The device word used in default intents ("iPhone", "iPad", "Apple TV").
    let surface: String
    /// Sent as `User-Agent` on MCP requests. Deliberately NOT URLSession's
    /// `IdleScreens/<build> CFNetwork/…` default: the server keeps a
    /// compatibility path for that UA (shipped builds that send no intent get
    /// a default one and skip the server confirm). A build that speaks the
    /// contract identifies itself differently so the server can tell the two
    /// apart and retire that path.
    let userAgent: String

    #if os(tvOS)
    static let platformDefault = MCPClientIdentity(
        harness: "idlescreens-tvos", surface: "Apple TV", userAgent: userAgent(platform: "tvOS", harness: "idlescreens-tvos"))
    #else
    static let platformDefault = MCPClientIdentity(
        harness: "idlescreens-ios", surface: "iPhone", userAgent: userAgent(platform: "iOS", harness: "idlescreens-ios"))

    /// The same identity with the real device word (iPad vs iPhone).
    @MainActor static func current() -> MCPClientIdentity {
        let surface = UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
        return MCPClientIdentity(harness: platformDefault.harness, surface: surface,
                                 userAgent: platformDefault.userAgent)
    }
    #endif

    /// `IdleScreens-iOS/1.4 (build 42; idlescreens-ios)`. Never the substring
    /// "pi": the server's older UA heuristic substring-matches it to a harness.
    static func userAgent(platform: String, harness: String, bundle: Bundle = .main) -> String {
        let version = bundle.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
        let build = bundle.infoDictionary?["CFBundleVersion"] as? String ?? "0"
        return "IdleScreens-\(platform)/\(version) (build \(build); \(harness))"
    }
}

/// What the server said it needs a yes for, before a second call does it.
struct MCPConfirmationRequest: Equatable, Sendable {
    let tool: String
    /// The server's own sentence: exactly what will happen (with viewer counts).
    let message: String
}

/// Ask the person. True repeats the call with the server's confirm token.
typealias MCPConfirmer = @Sendable (MCPConfirmationRequest) async -> Bool

// MARK: - MCP client

/// Stateless JSON-RPC client for `POST /mcp` (`tools/call`).
/// Tool results arrive as `result.content[0].text`, a stringified JSON payload.
///
/// Every mutating call goes through `callTool`, which applies the server's
/// contract in one place: `intent` + `harness` on every write, the two-step
/// confirm (`confirmation_required` → ask → repeat with `confirm`), and the
/// error envelope.
actor MCPClient {
    let endpoint: URL
    let transport: any HTTPTransport
    let identity: MCPClientIdentity
    private let confirmer: MCPConfirmer?
    private var nextID = 0

    init(baseURL: URL, transport: any HTTPTransport = URLSessionTransport(),
         identity: MCPClientIdentity = .platformDefault, confirmer: MCPConfirmer? = nil) {
        self.endpoint = baseURL.appendingPathComponent("mcp")
        self.transport = transport
        self.identity = identity
        self.confirmer = confirmer
    }

    /// Tools that change nothing. Everything else — including a tool this
    /// list has never heard of — is treated as a write and attributed, which
    /// is the safe direction.
    static let readOnlyTools: Set<String> = [
        "listSavers", "previewScene", "compareScenes", "perceiveChannel", "getState", "getHistory",
        "getPolicy", "getPreset", "listTokens", "listCategories", "listDevices", "listSchedule",
    ]

    static func isMutating(_ tool: String) -> Bool { !readOnlyTools.contains(tool) }

    /// The arguments actually sent: for a write, `harness` (unless the caller
    /// set one) and a non-empty `intent` — the caller's, else a default that
    /// still says what the person did. Reads go out untouched.
    nonisolated func attributed(_ tool: String, _ arguments: [String: JSONValue], intent: String?) -> [String: JSONValue] {
        guard Self.isMutating(tool) else { return arguments }
        var args = arguments
        if Self.nonEmpty(args["harness"]) == nil {
            args["harness"] = .string(identity.harness)
        }
        let given = Self.nonEmpty(intent.map(JSONValue.string)) ?? Self.nonEmpty(args["intent"])
        args["intent"] = .string(given ?? "\(tool) from the Idle Screens \(identity.surface) app")
        return args
    }

    private static func nonEmpty(_ value: JSONValue?) -> String? {
        guard case .string(let s)? = value else { return nil }
        let trimmed = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    // MARK: Raw call

    /// Call a tool and return the first content text. Throws on HTTP non-2xx
    /// or when the tool reports `isError`. A `confirmation_required` answer is
    /// put to the person (via `confirmer`) and, on yes, repeated once with the
    /// server's token; on no it throws `.cancelled` and sends nothing more.
    @discardableResult
    func callTool(_ name: String, arguments: [String: JSONValue] = [:], intent: String? = nil) async throws -> String {
        let args = attributed(name, arguments, intent: intent)
        let first = try await send(name, args)
        guard first.isError else { return first.text }
        let failure = Self.failure(tool: name, result: first)
        guard failure.code == "confirmation_required", let state = first.envelope?.requestState, !state.isEmpty else {
            throw MCPError.tool(failure)
        }
        // No way to ask (e.g. a background path): surface the server's question
        // as the error, never a silent no-op.
        guard let confirmer else { throw MCPError.tool(failure) }
        guard await confirmer(MCPConfirmationRequest(tool: name, message: failure.message)) else {
            throw MCPError.cancelled(tool: name)
        }
        var confirmed = args
        confirmed["confirm"] = .string(state)
        let second = try await send(name, confirmed)
        guard second.isError else { return second.text }
        throw MCPError.tool(Self.failure(tool: name, result: second))
    }

    private struct Outcome {
        let text: String
        let isError: Bool
        let envelope: MCPResponse.ErrorEnvelope?
    }

    private func send(_ name: String, _ arguments: [String: JSONValue]) async throws -> Outcome {
        nextID += 1
        let envelope = MCPRequest(id: nextID, params: .init(name: name, arguments: arguments))

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(identity.userAgent, forHTTPHeaderField: "User-Agent")
        request.httpBody = try JSONEncoder().encode(envelope)

        let (data, http) = try await transport.data(for: request)
        guard (200...299).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw MCPError.httpError(status: http.statusCode, body: body)
        }

        guard let response = try? JSONDecoder().decode(MCPResponse.self, from: data),
              let result = response.result else {
            throw MCPError.invalidResponse
        }
        return Outcome(text: result.content.first?.text ?? "",
                       isError: result.isError == true,
                       envelope: result.structuredContent?.error)
    }

    /// The envelope when there is one; otherwise the text's `error` sentence
    /// (servers before the envelope), otherwise the raw text.
    private static func failure(tool: String, result: Outcome) -> MCPToolFailure {
        if let env = result.envelope, let message = env.message, !message.isEmpty {
            return MCPToolFailure(tool: tool, code: env.code, message: message, hint: env.hint, retryable: env.retryable)
        }
        if let data = result.text.data(using: .utf8),
           let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let message = object["error"] as? String, !message.isEmpty {
            return MCPToolFailure(tool: tool, code: object["code"] as? String, message: message,
                                  hint: object["hint"] as? String)
        }
        return MCPToolFailure(tool: tool, message: result.text.isEmpty ? "\(tool) failed." : result.text)
    }

    /// Call a tool and parse the first content text as JSON.
    func callTool<T: Decodable>(_ name: String, arguments: [String: JSONValue] = [:], intent: String? = nil,
                                as type: T.Type) async throws -> T {
        let text = try await callTool(name, arguments: arguments, intent: intent)
        guard let data = text.data(using: .utf8),
              let decoded = try? JSONDecoder().decode(T.self, from: data) else {
            throw MCPError.unparsableResult(tool: name, text: text)
        }
        return decoded
    }

    // MARK: Typed tools
    //
    // Each write passes an `intent` naming what the person did. They show in
    // the channel's public timeline next to `harness`.

    /// Claim a channel. The returned capability token (`isk_…`) is shown once —
    /// the caller must persist it immediately.
    func createChannel(channelId: String? = nil, label: String? = nil, tags: [String] = []) async throws -> CreatedChannel {
        var args: [String: JSONValue] = [:]
        if let channelId, !channelId.isEmpty { args["channelId"] = .string(channelId) }
        if let label, !label.isEmpty { args["label"] = .string(label) }
        if !tags.isEmpty { args["tags"] = .array(tags.map { .string($0) }) }
        return try await callTool("createChannel", arguments: args,
                                  intent: "user created a channel from the \(identity.surface) app", as: CreatedChannel.self)
    }

    /// The live server groups savers (`{"classicSavers": [...], ...}`);
    /// older shapes returned a bare array. Accept both — decoding only the
    /// flat shape left the saver list permanently empty against production.
    func listSavers() async throws -> [SaverInfo] {
        let text = try await callTool("listSavers")
        guard let data = text.data(using: .utf8) else {
            throw MCPError.unparsableResult(tool: "listSavers", text: text)
        }
        if let flat = try? JSONDecoder().decode([SaverInfo].self, from: data) {
            return flat
        }
        if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            var all: [SaverInfo] = []
            for key in object.keys.sorted() {
                guard let group = object[key] as? [[String: Any]],
                      let groupData = try? JSONSerialization.data(withJSONObject: group),
                      let infos = try? JSONDecoder().decode([SaverInfo].self, from: groupData) else {
                    continue
                }
                all.append(contentsOf: infos)
            }
            if !all.isEmpty { return all }
        }
        throw MCPError.unparsableResult(tool: "listSavers", text: text)
    }

    /// Fork another channel's *current* scene into a brand-new channel you
    /// own — one atomic call that returns the new id and its token. `token`
    /// authorizes the read when the source is private and only a viewer key
    /// is held for it; a public source needs none.
    func remixChannel(sourceChannelId: String, label: String? = nil, token: String? = nil) async throws -> CreatedChannel {
        var args: [String: JSONValue] = ["channelId": .string(sourceChannelId)]
        if let label, !label.isEmpty { args["label"] = .string(label) }
        if let token, !token.isEmpty { args["token"] = .string(token) }
        return try await callTool("remixChannel", arguments: args,
                                  intent: "user remixed \(sourceChannelId) into a new channel from the \(identity.surface) app",
                                  as: CreatedChannel.self)
    }

    /// Publish a full SaverSpec (as opposed to a classic saver id) — the path
    /// used when adopting another channel's scene onto one you own.
    func publishSpec(channelId: String, token: String, spec: JSONValue, seed: Int,
                     intent: String? = nil) async throws {
        try await callTool("publishScene", arguments: [
            "channelId": .string(channelId),
            "token": .string(token),
            "spec": spec,
            "seed": .int(seed),
        ], intent: intent ?? "user published a scene from the \(identity.surface) app")
    }

    func publishScene(channelId: String, token: String, saverId: String, seed: Int,
                      model: String? = nil, intent: String? = nil) async throws {
        var args: [String: JSONValue] = [
            "channelId": .string(channelId),
            "token": .string(token),
            "spec": .object(["id": .string(saverId)]),
            "seed": .int(seed),
        ]
        if let model { args["model"] = .string(model) }
        try await callTool("publishScene", arguments: args,
                           intent: intent ?? "user put \(saverId) on air from the \(identity.surface) remote")
    }

    func setSeed(channelId: String, token: String, seed: Int) async throws {
        try await callTool("setSeed", arguments: [
            "channelId": .string(channelId),
            "token": .string(token),
            "seed": .int(seed),
        ], intent: "user reshuffled the seed from the \(identity.surface) remote")
    }

    /// Pause every screen on the channel. While screens are watching, the
    /// server asks first (`confirmation_required`) and `callTool` puts its
    /// sentence to the person.
    func sleepChannel(channelId: String, token: String) async throws {
        try await callTool("sleepChannel", arguments: [
            "channelId": .string(channelId),
            "token": .string(token),
        ], intent: "user paused the channel from the \(identity.surface) remote")
    }

    /// Delete a channel for good: scene, history, timeline and schedule. Owner
    /// key only (the server refuses any other), and the server may ask first
    /// (`confirmation_required`), which `callTool` puts to the person.
    func deleteChannel(channelId: String, token: String) async throws {
        try await callTool("deleteChannel", arguments: [
            "channelId": .string(channelId),
            "token": .string(token),
        ], intent: "owner deleted the channel from the \(identity.surface) app")
    }

    func wakeChannel(channelId: String, token: String) async throws {
        try await callTool("wakeChannel", arguments: [
            "channelId": .string(channelId),
            "token": .string(token),
        ], intent: "user resumed the channel from the \(identity.surface) remote")
    }

    /// Bring a past scene back on air by its `sceneId` from the history.
    func recallScene(channelId: String, token: String, sceneId: Int) async throws {
        try await callTool("recallScene", arguments: [
            "channelId": .string(channelId),
            "token": .string(token),
            "sceneId": .int(sceneId),
        ], intent: "user brought scene #\(sceneId) back from the \(identity.surface) app")
    }

    /// Bring a saved preset back on air. The format is deterministic, so the
    /// recalled scene renders exactly as it did when it was saved.
    func recallScene(channelId: String, token: String, presetName: String) async throws {
        try await callTool("recallScene", arguments: [
            "channelId": .string(channelId),
            "token": .string(token),
            "name": .string(presetName),
        ], intent: "user recalled the preset “\(presetName)” from the \(identity.surface) app")
    }

    /// Bookmark the channel's current scene under a name.
    func savePreset(channelId: String, token: String, name: String) async throws {
        try await callTool("savePreset", arguments: [
            "channelId": .string(channelId),
            "token": .string(token),
            "name": .string(name),
        ], intent: "user saved the scene on air as the preset “\(name)” from the \(identity.surface) app")
    }

    func showOverlay(channelId: String, token: String, text: String,
                     tag: String? = nil, ttl: Int? = nil) async throws {
        var args: [String: JSONValue] = [
            "channelId": .string(channelId),
            "token": .string(token),
            "text": .string(text),
        ]
        if let tag { args["tag"] = .string(tag) }
        if let ttl { args["ttl"] = .int(ttl) }
        try await callTool("showOverlay", arguments: args,
                           intent: "user flashed a message on every screen from the \(identity.surface) remote")
    }
}
