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

    var date: Date { Date(timeIntervalSince1970: at / 1000) }

    /// True when this event carries provenance worth showing. A bare
    /// `setParam` with no attribution tells the reader nothing.
    var hasAttribution: Bool {
        (model?.isEmpty == false) || (intent?.isEmpty == false)
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
