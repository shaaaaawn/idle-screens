import Foundation

/// One recorded mutation on a channel — who changed it, on what, and why.
///
/// The `intent` field is the interesting one and the reason this type exists:
/// it is the free-text prompt or brief behind a change, so a channel can
/// explain *why* it looks the way it does months later, to someone who wasn't
/// in the conversation. Nothing else in this product carries that.
struct ChannelEvent: Decodable, Identifiable, Equatable, Sendable {
    let id: Int
    /// Epoch milliseconds.
    let at: Double
    /// `publish`, `setParam`, `overlay`, `scheduled`, `create`, …
    let kind: String
    /// Who made the change — an agent name, or "agent" when unattributed.
    let actor: String?
    let summary: String?
    // NOTE: the payload also carries `detail`, which is an arbitrary JSON
    // OBJECT (`{"style":"fade",…}`) rather than a string. Declaring it as
    // String? made JSONDecoder throw on the whole page, so the history sheet
    // showed its failure state against a perfectly healthy 200. Unused keys are
    // ignored — leave it out unless something actually renders it.
    /// Present when this event put a scene on air; recallable, because the
    /// format is deterministic — a past frame is reproducible, not a snapshot.
    let sceneId: Int?
    /// The model the actor was running on.
    let model: String?
    /// The prompt or reasoning behind the change.
    let intent: String?
    /// Where the call came from — the harness or host.
    let harness: String?
    /// The scene's name, lifted out of `detail.label` when the event has one.
    /// `detail` itself is an arbitrary object and stays undecoded.
    let label: String?

    private enum CodingKeys: String, CodingKey {
        case id, at, kind, actor, summary, sceneId, model, intent, harness, detail
    }
    private struct Detail: Decodable { let label: String? }

    init(id: Int, at: Double, kind: String, actor: String? = nil, summary: String? = nil,
         sceneId: Int? = nil, model: String? = nil, intent: String? = nil,
         harness: String? = nil, label: String? = nil) {
        self.id = id; self.at = at; self.kind = kind; self.actor = actor
        self.summary = summary; self.sceneId = sceneId; self.model = model
        self.intent = intent; self.harness = harness; self.label = label
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        at = try c.decode(Double.self, forKey: .at)
        kind = try c.decode(String.self, forKey: .kind)
        actor = try c.decodeIfPresent(String.self, forKey: .actor)
        summary = try c.decodeIfPresent(String.self, forKey: .summary)
        sceneId = try c.decodeIfPresent(Int.self, forKey: .sceneId)
        model = try c.decodeIfPresent(String.self, forKey: .model)
        intent = try c.decodeIfPresent(String.self, forKey: .intent)
        harness = try c.decodeIfPresent(String.self, forKey: .harness)
        // Lenient on purpose: `detail` has been a string, an object and absent.
        label = (try? c.decodeIfPresent(Detail.self, forKey: .detail))?.label
    }

    var date: Date { Date(timeIntervalSince1970: at / 1000) }

    /// True when this event carries provenance worth showing. A bare
    /// `setParam` with no attribution tells the reader nothing.
    var hasAttribution: Bool {
        (model?.isEmpty == false) || (intent?.isEmpty == false)
    }
}

/// Who actually made a scene, when the event that aired it cannot say.
///
/// The nightly curator and the scheduler re-air saved scenes under their own
/// name with no model, so a wall of channels all read "curator". The server
/// does not carry the original credit forward — but the channel's own log
/// often still holds the first publish of that scene, by name, with its model.
enum SceneCredit {
    /// Actors that put scenes on air without having made them.
    static let relays: Set<String> = ["curator", "scheduler", "schedule", "nightly"]

    static func isRelay(_ actor: String?) -> Bool {
        guard let actor else { return false }
        return relays.contains(actor.lowercased())
    }

    /// The earliest event for the same scene name that a real author signed:
    /// a model, or a named actor that is not a relay. nil when the log holds
    /// no such event — which is an honest "unknown", not an error.
    static func original(for event: ChannelEvent, in events: [ChannelEvent]) -> ChannelEvent? {
        guard isRelay(event.actor), let label = event.label?.lowercased(), !label.isEmpty else { return nil }
        return events
            .filter { $0.label?.lowercased() == label && !isRelay($0.actor) }
            .filter { ($0.model?.isEmpty == false) || SteerLine.namedActor($0.actor) != nil }
            .min { $0.at < $1.at }
    }
}

struct ChannelHistoryPage: Decodable, Equatable, Sendable {
    let events: [ChannelEvent]
    let hasMore: Bool?
}

extension GalleryClient {
    /// `GET /c/:id/history` — the channel's event log.
    ///
    /// Deliberately unauthenticated: this endpoint is public, which is what
    /// makes provenance a viewer-facing feature rather than an owner-only one.
    /// It also means `intent` text is world-readable — see
    /// `docs/ios-client-roadmap.md` §3.
    func fetchHistory(channelId: String, limit: Int = 40) async throws -> [ChannelEvent] {
        var components = URLComponents(
            url: baseURL
                .appendingPathComponent("c")
                .appendingPathComponent(channelId)
                .appendingPathComponent("history"),
            resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "limit", value: String(limit))]
        guard let url = components?.url else { throw GalleryError.invalidResponse }

        let (data, http) = try await transport.data(for: URLRequest(url: url))
        guard (200...299).contains(http.statusCode) else {
            throw GalleryError.httpError(
                status: http.statusCode, body: String(data: data, encoding: .utf8) ?? "")
        }
        guard let page = try? JSONDecoder().decode(ChannelHistoryPage.self, from: data) else {
            throw GalleryError.invalidResponse
        }
        return page.events
    }
}
