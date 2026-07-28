import Foundation

// MARK: - Gallery models (decoded leniently — all fields optional)

/// A public channel from `GET /api/channels`.
struct PublicChannel: Decodable, Identifiable, Equatable {
    let channelId: String?
    let label: String?
    let tags: [String]?
    let viewers: Int?
    let sleeping: Bool?
    /// Inline scene spec (`scene.spec`) — powers live native previews.
    let spec: SpecSubset?
    /// The same spec as untouched JSON. `SpecSubset` is a lossy, decode-only
    /// view (custom decoders, no encoder), so re-publishing it would drop
    /// every field the renderer doesn't read. Mixing a scene onto another
    /// channel must send the ORIGINAL — keep it verbatim.
    let rawSpec: JSONValue?

    var id: String { channelId ?? label ?? "unknown" }
    var displayLabel: String { label ?? channelId ?? "unknown" }

    private enum CodingKeys: String, CodingKey {
        case id, channelId, label, tags, viewers, sleeping, scene, resolvedSpec
    }

    private struct SceneWrap: Decodable {
        let spec: SpecSubset?
        let rawSpec: JSONValue?

        private enum Keys: String, CodingKey { case spec }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            spec = try? c.decodeIfPresent(SpecSubset.self, forKey: .spec)
            rawSpec = try? c.decodeIfPresent(JSONValue.self, forKey: .spec)
        }
    }

    init(channelId: String?, label: String?, tags: [String]?, viewers: Int?,
         sleeping: Bool? = nil, spec: SpecSubset? = nil, rawSpec: JSONValue? = nil) {
        self.channelId = channelId
        self.label = label
        self.tags = tags
        self.viewers = viewers
        self.sleeping = sleeping
        self.spec = spec
        self.rawSpec = rawSpec
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // The API serves the channel id as `id`; accept legacy `channelId` too.
        channelId = (try? c.decodeIfPresent(String.self, forKey: .id))
            ?? (try? c.decodeIfPresent(String.self, forKey: .channelId))
            ?? nil
        label = try? c.decodeIfPresent(String.self, forKey: .label)
        tags = try? c.decodeIfPresent([String].self, forKey: .tags)
        viewers = try? c.decodeIfPresent(Int.self, forKey: .viewers)
        sleeping = try? c.decodeIfPresent(Bool.self, forKey: .sleeping)
        // Prefer the RESOLVED spec (base + all steering deltas applied) —
        // it's what the fullscreen viewer shows. The base `scene.spec` can be
        // a placeholder that renders nothing like the live channel, which
        // made posters render black/wrong while fullscreen looked fine.
        let scene = (try? c.decodeIfPresent(SceneWrap.self, forKey: .scene)) ?? nil
        spec = (try? c.decodeIfPresent(SpecSubset.self, forKey: .resolvedSpec))
            ?? scene?.spec
        // Same precedence for the verbatim copy, so mixing publishes exactly
        // what the viewer is showing.
        rawSpec = (try? c.decodeIfPresent(JSONValue.self, forKey: .resolvedSpec))
            ?? scene?.rawSpec
    }
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
    private enum CodingKeys: String, CodingKey { case id, label, spec }

    init(from decoder: Decoder) throws {
        // Tolerate `"scene": "warp"`, `"scene": {"id": ...}` AND the live
        // shape `"scene": {"spec": {"id": ..., "label": ...}}` — the deck
        // showed "—" for every playing channel until the nested form parsed.
        if let single = try? decoder.singleValueContainer(),
           let s = try? single.decode(String.self) {
            self.init(id: s, label: s)
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let nested = try? c.decodeIfPresent(ChannelState.SceneSummary.self, forKey: .spec),
           nested.id != nil || nested.label != nil {
            self = nested
            return
        }
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
