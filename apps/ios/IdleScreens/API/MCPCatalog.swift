import Foundation

/// What the MCP server itself offers, read live: its tools, its readable
/// resources, and its feedback board. Powers the Agents tab's "Inside the MCP"
/// page, so people can see what an agent can actually do before connecting one.
enum MCPCatalog {
    struct Tool: Decodable, Identifiable, Equatable {
        let name: String
        let title: String?
        let description: String?
        var id: String { name }

        /// The description's first sentence — the tool list is long, and most
        /// descriptions run to a paragraph of agent guidance.
        var summary: String {
            let text = (description ?? "").replacingOccurrences(of: "\n", with: " ")
            guard let end = text.range(of: #"\.(\s|$)"#, options: .regularExpression) else { return text }
            return String(text[..<end.lowerBound]) + "."
        }
    }

    struct Resource: Decodable, Identifiable, Equatable {
        let uri: String
        let name: String?
        let description: String?
        var id: String { uri }
    }

    struct Feedback: Decodable, Equatable {
        struct Finding: Decodable, Identifiable, Equatable {
            let id: String
            let title: String
            let status: String?
        }
        struct Submission: Decodable, Identifiable, Equatable {
            let id: String
            let title: String
            let kind: String?
            let severity: String?
            let status: String?
            let votes: Int?
        }
        let findings: [Finding]
        let submissions: [Submission]?
        let findingsAsOf: String?
    }

    /// The groups a person thinks in, not the alphabet. A tool not named here
    /// lands in "More" — the server grows tools faster than this list.
    static let groups: [(title: String, icon: String, tools: [String])] = [
        ("Make", "wand.and.stars", ["createChannel", "remixChannel", "publishScene", "previewScene", "compareScenes"]),
        ("Steer", "slider.horizontal.3", ["setParam", "setTrack", "setSeed", "showOverlay", "sleepChannel", "wakeChannel", "recallScene", "savePreset"]),
        ("Program", "calendar", ["scheduleScenes", "queueScene", "listSchedule", "cancelSchedule"]),
        ("See", "eye", ["getState", "getHistory", "perceiveChannel", "listDevices", "listSavers", "getPolicy", "listCategories"]),
        ("Keys & access", "key", ["createToken", "listTokens", "revokeToken", "rotateToken", "createOwnerKey", "setVisibility", "deleteChannel"]),
        ("Curate", "tag", ["setTags", "setCategory"]),
        ("Feedback", "bubble.left.and.exclamationmark.bubble.right", ["submitFeedback", "upvoteFeedback"]),
    ]

    static func grouped(_ tools: [Tool]) -> [(title: String, icon: String, tools: [Tool])] {
        let byName = Dictionary(tools.map { ($0.name, $0) }, uniquingKeysWith: { a, _ in a })
        var used = Set<String>()
        var out: [(String, String, [Tool])] = []
        for group in groups {
            let members = group.tools.compactMap { byName[$0] }
            used.formUnion(members.map(\.name))
            if !members.isEmpty { out.append((group.title, group.icon, members)) }
        }
        let rest = tools.filter { !used.contains($0.name) }.sorted { $0.name < $1.name }
        if !rest.isEmpty { out.append(("More", "ellipsis.circle", rest)) }
        return out
    }
}

// MARK: - Wire

extension MCPClient {
    private struct RPC: Encodable {
        let jsonrpc = "2.0"
        let id: Int
        let method: String
        let params: [String: String]
    }
    private struct ToolsResult: Decodable { let result: Inner?; struct Inner: Decodable { let tools: [MCPCatalog.Tool] } }
    private struct ResourcesResult: Decodable { let result: Inner?; struct Inner: Decodable { let resources: [MCPCatalog.Resource] } }
    private struct ReadResult: Decodable {
        let result: Inner?
        struct Inner: Decodable { let contents: [Content] }
        struct Content: Decodable { let text: String? }
    }

    private func rpc(_ method: String, params: [String: String] = [:]) async throws -> Data {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(RPC(id: Int.random(in: 1...1_000_000), method: method, params: params))
        let (data, http) = try await transport.data(for: request)
        guard (200...299).contains(http.statusCode) else {
            throw MCPError.httpError(status: http.statusCode, body: String(data: data, encoding: .utf8) ?? "")
        }
        return data
    }

    func listTools() async throws -> [MCPCatalog.Tool] {
        guard let tools = try JSONDecoder().decode(ToolsResult.self, from: try await rpc("tools/list")).result?.tools
        else { throw MCPError.invalidResponse }
        return tools
    }

    func listResources() async throws -> [MCPCatalog.Resource] {
        guard let list = try JSONDecoder().decode(ResourcesResult.self, from: try await rpc("resources/list")).result?.resources
        else { throw MCPError.invalidResponse }
        return list
    }

    /// The server's known-issues board (`screen://feedback`).
    func feedback() async throws -> MCPCatalog.Feedback {
        let read = try JSONDecoder().decode(ReadResult.self, from: try await rpc("resources/read", params: ["uri": "screen://feedback"]))
        guard let text = read.result?.contents.first?.text, let data = text.data(using: .utf8) else {
            throw MCPError.invalidResponse
        }
        return try JSONDecoder().decode(MCPCatalog.Feedback.self, from: data)
    }
}
