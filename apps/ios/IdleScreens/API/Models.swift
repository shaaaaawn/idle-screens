import Foundation

// MARK: - Gallery models (decoded leniently — all fields optional)

/// A public channel from `GET /api/channels`.
struct PublicChannel: Decodable, Identifiable, Equatable {
    let channelId: String?
    let label: String?
    let tags: [String]?
    let viewers: Int?
    let sleeping: Bool?
    /// Editorial category (`/api/categories` catalog) and position within it.
    let categoryId: String?
    let categorySort: Int?
    /// The scene's own name ("Warp Tunnel", "Constellation") — what a viewer
    /// sees on screen, and so what they search for. Distinct from `label`,
    /// which names the channel that happens to be showing it.
    let saverLabel: String?
    /// Epoch ms the channel was minted. The seeded demo channels carry 0,
    /// which is what keeps them out of a "Latest" shelf without naming them.
    let createdAt: Int?
    /// Epoch ms of the last steer — the home page's recency sort key. It is
    /// deliberately NOT `createdAt`: this one moves whenever anyone touches a
    /// channel, so ordering "Latest" by it would just re-list the busiest.
    let lastEventAt: Int?
    /// Inline scene spec (`scene.spec`) — powers live native previews.
    let spec: SpecSubset?
    /// Saver id when the channel publishes a classic saver (`{"id":"warp"}`)
    /// rather than a schema scene — those carry no layers, so `spec` is nil
    /// and the poster comes from the native classic port instead.
    let classicSaverId: String?
    /// The same spec as untouched JSON. `SpecSubset` is a lossy, decode-only
    /// view (custom decoders, no encoder), so re-publishing it would drop
    /// every field the renderer doesn't read. Mixing a scene onto another
    /// channel must send the ORIGINAL — keep it verbatim.
    let rawSpec: JSONValue?

    var id: String { channelId ?? label ?? "unknown" }
    var displayLabel: String { label ?? channelId ?? "unknown" }

    private enum CodingKeys: String, CodingKey {
        case id, channelId, label, tags, viewers, sleeping, scene, resolvedSpec
        case categoryId, categorySort, createdAt, lastEvent, saver
    }

    private struct LastEvent: Decodable {
        let at: Int?
    }

    /// Minimal probe for classic saver documents: `{"id": "warp"}`.
    private struct ClassicIdProbe: Decodable {
        let id: String?
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
         sleeping: Bool? = nil, spec: SpecSubset? = nil, rawSpec: JSONValue? = nil,
         categoryId: String? = nil, categorySort: Int? = nil,
         classicSaverId: String? = nil,
         createdAt: Int? = nil, lastEventAt: Int? = nil,
         saverLabel: String? = nil) {
        self.channelId = channelId
        self.label = label
        self.tags = tags
        self.viewers = viewers
        self.sleeping = sleeping
        self.spec = spec
        self.rawSpec = rawSpec
        self.categoryId = categoryId
        self.categorySort = categorySort
        self.classicSaverId = classicSaverId
        self.createdAt = createdAt
        self.lastEventAt = lastEventAt
        self.saverLabel = saverLabel
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
        categoryId = try? c.decodeIfPresent(String.self, forKey: .categoryId)
        categorySort = try? c.decodeIfPresent(Int.self, forKey: .categorySort)
        saverLabel = try? c.decodeIfPresent(String.self, forKey: .saver)
        createdAt = try? c.decodeIfPresent(Int.self, forKey: .createdAt)
        lastEventAt = (try? c.decodeIfPresent(LastEvent.self, forKey: .lastEvent))??.at
        // Prefer the RESOLVED spec (base + all steering deltas applied) —
        // it's what the fullscreen viewer shows. The base `scene.spec` can be
        // a placeholder that renders nothing like the live channel, which
        // made posters render black/wrong while fullscreen looked fine.
        let scene = (try? c.decodeIfPresent(SceneWrap.self, forKey: .scene)) ?? nil
        // Sequence channels serve an `idle-sequence` envelope (no top-level
        // layers) as their resolvedSpec; poster the first segment's scene so
        // the grid shows real art instead of falling back to thumbs.
        if let seq = try? c.decodeIfPresent(SequenceSubset.self, forKey: .resolvedSpec),
           SequenceSubset.isSequenceDocument(format: seq.format),
           let first = seq.segments.first {
            spec = first.scene
        } else {
            spec = (try? c.decodeIfPresent(SpecSubset.self, forKey: .resolvedSpec))
                ?? scene?.spec
        }
        // A classic saver document is just `{"id": "warp"}` — no layers, so
        // the schema decode above yields nil. Keep the saver id so the grid
        // can poster it from the native port instead of a (often broken)
        // server thumb.
        if spec == nil,
           let probe = try? c.decodeIfPresent(ClassicIdProbe.self, forKey: .resolvedSpec) {
            classicSaverId = probe.id
        } else {
            classicSaverId = nil
        }
        // Same precedence for the verbatim copy, so mixing publishes exactly
        // what the viewer is showing.
        rawSpec = (try? c.decodeIfPresent(JSONValue.self, forKey: .resolvedSpec))
            ?? scene?.rawSpec
    }
}

/// An editorial category from `GET /api/categories` — server-curated shelf
/// metadata (title, subtitle, order) plus the ids it contains.
struct ChannelCategory: Decodable, Identifiable, Equatable {
    let id: String
    let title: String?
    let subtitle: String?
    let sort: Int?
    /// Ids of the channels the catalog places on this shelf. The web home
    /// page groups on this rather than on each channel's `categoryId`, so
    /// the two surfaces agree even when one field lags the other.
    let channelIds: [String]

    var displayTitle: String { title ?? id }

    private enum CodingKeys: String, CodingKey { case id, title, subtitle, sort, channels }
    private struct Member: Decodable { let id: String? }

    init(id: String, title: String?, subtitle: String?, sort: Int?, channelIds: [String] = []) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
        self.sort = sort
        self.channelIds = channelIds
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try? c.decodeIfPresent(String.self, forKey: .title)
        subtitle = try? c.decodeIfPresent(String.self, forKey: .subtitle)
        sort = try? c.decodeIfPresent(Int.self, forKey: .sort)
        channelIds = ((try? c.decodeIfPresent([Member].self, forKey: .channels)) ?? [])?
            .compactMap(\.id) ?? []
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
