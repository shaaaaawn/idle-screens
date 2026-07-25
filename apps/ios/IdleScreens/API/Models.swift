import Foundation

// MARK: - Gallery models (decoded leniently — all fields optional)

/// A public channel from `GET /api/channels`.
struct PublicChannel: Decodable, Identifiable, Equatable {
    let channelId: String?
    let label: String?
    let tags: [String]?
    let viewers: Int?

    var id: String { channelId ?? label ?? "unknown" }
    var displayLabel: String { label ?? channelId ?? "unknown" }
}

/// Read-only channel state from `GET /c/:channelId/state`.
struct ChannelState: Equatable {
    var sleeping: Bool?
    var viewers: Int?
    var protected: Bool?
    var presets: [String]?
    var epoch: Int?
    var scene: SceneSummary?

    struct SceneSummary: Equatable {
        var id: String?
        var label: String?
    }
}

extension ChannelState: Decodable {
    private enum CodingKeys: String, CodingKey {
        case sleeping, viewers, protected, presets, epoch, scene, spec
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sleeping = try c.decodeIfPresent(Bool.self, forKey: .sleeping)
        viewers = try c.decodeIfPresent(Int.self, forKey: .viewers)
        protected = try c.decodeIfPresent(Bool.self, forKey: .protected)
        presets = try c.decodeIfPresent([String].self, forKey: .presets)
        epoch = try c.decodeIfPresent(Int.self, forKey: .epoch)
        scene = try c.decodeIfPresent(SceneSummary.self, forKey: .scene)
            ?? c.decodeIfPresent(SceneSummary.self, forKey: .spec)
    }
}

extension ChannelState.SceneSummary: Decodable {
    private enum CodingKeys: String, CodingKey { case id, label }

    init(from decoder: Decoder) throws {
        // Tolerate `"scene": "warp"` as well as `"scene": {"id": ..., "label": ...}`.
        if let single = try? decoder.singleValueContainer(),
           let s = try? single.decode(String.self) {
            self.init(id: s, label: s)
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            id: try c.decodeIfPresent(String.self, forKey: .id),
            label: try c.decodeIfPresent(String.self, forKey: .label)
        )
    }
}

// MARK: - MCP tool result models

/// A built-in saver from the `listSavers` MCP tool.
struct SaverInfo: Decodable, Identifiable, Equatable {
    let id: String
    let label: String?
    let description: String?

    var displayLabel: String { label ?? id }
}

/// Result of the `createChannel` MCP tool. The token is shown exactly once.
struct CreatedChannel: Decodable, Equatable {
    let channelId: String
    let token: String
}

// MARK: - JSON-RPC envelopes for POST /mcp

struct MCPRequest: Encodable {
    let jsonrpc = "2.0"
    let id: Int
    let method = "tools/call"
    let params: Params

    struct Params: Encodable {
        let name: String
        let arguments: [String: JSONValue]
    }
}

struct MCPResponse: Decodable {
    let result: Result?

    struct Result: Decodable {
        let content: [Content]
        let isError: Bool?
    }

    struct Content: Decodable {
        let type: String
        let text: String
    }
}

/// Minimal JSON value type for building MCP tool arguments.
enum JSONValue: Codable, Sendable, Equatable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case array([JSONValue])
    case object([String: JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let i = try? c.decode(Int.self) { self = .int(i) }
        else if let d = try? c.decode(Double.self) { self = .double(d) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .int(let i): try c.encode(i)
        case .double(let d): try c.encode(d)
        case .bool(let b): try c.encode(b)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        case .null: try c.encodeNil()
        }
    }
}
