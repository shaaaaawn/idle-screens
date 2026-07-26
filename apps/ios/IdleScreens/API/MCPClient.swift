import Foundation

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

enum MCPError: LocalizedError, Equatable {
    case invalidResponse
    case httpError(status: Int, body: String)
    case toolError(tool: String, message: String)
    case unparsableResult(tool: String, text: String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: "Invalid response from server"
        case .httpError(let status, let body): "HTTP \(status): \(body)"
        case .toolError(let tool, let message): "Tool '\(tool)' failed: \(message)"
        case .unparsableResult(let tool, let text): "Could not parse '\(tool)' result: \(text)"
        }
    }
}

// MARK: - MCP client

/// Stateless JSON-RPC client for `POST /mcp` (`tools/call`).
/// Tool results arrive as `result.content[0].text`, a stringified JSON payload.
actor MCPClient {
    let endpoint: URL
    let transport: any HTTPTransport
    private var nextID = 0

    init(baseURL: URL, transport: any HTTPTransport = URLSessionTransport()) {
        self.endpoint = baseURL.appendingPathComponent("mcp")
        self.transport = transport
    }

    // MARK: Raw call

    /// Call a tool and return the first content text. Throws on HTTP non-2xx
    /// or when the tool reports `isError`.
    @discardableResult
    func callTool(_ name: String, arguments: [String: JSONValue] = [:]) async throws -> String {
        nextID += 1
        let envelope = MCPRequest(id: nextID, params: .init(name: name, arguments: arguments))

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
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
        let text = result.content.first?.text ?? ""
        if result.isError == true {
            throw MCPError.toolError(tool: name, message: text)
        }
        return text
    }

    /// Call a tool and parse the first content text as JSON.
    func callTool<T: Decodable>(_ name: String, arguments: [String: JSONValue] = [:], as type: T.Type) async throws -> T {
        let text = try await callTool(name, arguments: arguments)
        guard let data = text.data(using: .utf8),
              let decoded = try? JSONDecoder().decode(T.self, from: data) else {
            throw MCPError.unparsableResult(tool: name, text: text)
        }
        return decoded
    }

    // MARK: Typed tools

    /// Claim a channel. The returned capability token (`isk_…`) is shown once —
    /// the caller must persist it immediately.
    func createChannel(channelId: String? = nil, label: String? = nil, tags: [String] = []) async throws -> CreatedChannel {
        var args: [String: JSONValue] = [:]
        if let channelId, !channelId.isEmpty { args["channelId"] = .string(channelId) }
        if let label, !label.isEmpty { args["label"] = .string(label) }
        if !tags.isEmpty { args["tags"] = .array(tags.map { .string($0) }) }
        return try await callTool("createChannel", arguments: args, as: CreatedChannel.self)
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

    func publishScene(channelId: String, token: String, saverId: String, seed: Int,
                      model: String? = nil, intent: String? = nil) async throws {
        var args: [String: JSONValue] = [
            "channelId": .string(channelId),
            "token": .string(token),
            "spec": .object(["id": .string(saverId)]),
            "seed": .int(seed),
        ]
        if let model { args["model"] = .string(model) }
        if let intent { args["intent"] = .string(intent) }
        try await callTool("publishScene", arguments: args)
    }

    func setSeed(channelId: String, token: String, seed: Int) async throws {
        try await callTool("setSeed", arguments: [
            "channelId": .string(channelId),
            "token": .string(token),
            "seed": .int(seed),
        ])
    }

    func sleep(channelId: String, token: String) async throws {
        try await callTool("sleep", arguments: [
            "channelId": .string(channelId),
            "token": .string(token),
        ])
    }

    func wake(channelId: String, token: String) async throws {
        try await callTool("wake", arguments: [
            "channelId": .string(channelId),
            "token": .string(token),
        ])
    }

    func overlay(channelId: String, token: String, text: String,
                 tag: String? = nil, ttl: Int? = nil) async throws {
        var args: [String: JSONValue] = [
            "channelId": .string(channelId),
            "token": .string(token),
            "text": .string(text),
        ]
        if let tag { args["tag"] = .string(tag) }
        if let ttl { args["ttl"] = .int(ttl) }
        try await callTool("overlay", arguments: args)
    }
}
