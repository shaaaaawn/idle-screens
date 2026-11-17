import Foundation

/// The half of a channel row the slim listing leaves out: what its poster
/// draws and what a mix republishes. Read from the channel's own
/// `GET /c/:id/state` by the same `PublicChannel` decoder that read the full
/// listing, so a poster is the one the full listing gave.
struct ChannelDetail: Equatable, Sendable {
    let spec: SpecSubset?
    let rawSpec: JSONValue?
    let classicSaverId: String?
    let classicParams: [String: String]
    /// `lastEvent.at` of the `/state` this came from. The listing carries the
    /// same field, and a publish or a steer moves both (checked on all 56
    /// prod channels, 2026-11-16), so it is the freshness key.
    let lastEventAt: Int?

    init(spec: SpecSubset?, rawSpec: JSONValue?, classicSaverId: String?,
         classicParams: [String: String], lastEventAt: Int?) {
        self.spec = spec
        self.rawSpec = rawSpec
        self.classicSaverId = classicSaverId
        self.classicParams = classicParams
        self.lastEventAt = lastEventAt
    }

    /// The scene half of a row decoded from a full shape (`/state`, the
    /// reduced copy on disk, or a full listing row).
    init(row: PublicChannel) {
        self.init(spec: row.spec, rawSpec: row.rawSpec, classicSaverId: row.classicSaverId,
                  classicParams: row.classicParams, lastEventAt: row.lastEventAt)
    }

    /// Decode reduced bytes (`Reduced.bytes`) — what is kept on disk.
    init?(reduced bytes: Data) {
        guard let row = try? JSONDecoder().decode(PublicChannel.self, from: bytes) else { return nil }
        self.init(row: row)
    }

    /// Exactly the keys `PublicChannel`'s decoder reads for the scene half,
    /// from a `/state` or a full listing row. A Screen Test reel's `/state` is
    /// up to 800 KB: the spec twice (`scene.spec` and `resolvedSpec` are the
    /// same document on every unsteered channel) and its steerable paths per
    /// segment. This keeps the spec once and the scene's track, which is where
    /// a tank's look lives (`classicParams`).
    struct Reduced: Codable {
        var resolvedSpec: JSONValue?
        var scene: Scene?
        var lastEvent: LastEvent?
        var access: String?

        struct Scene: Codable {
            /// Kept only when there is no `resolvedSpec`: the decoder reads it
            /// as the fallback, and `resolvedSpec` is it with the deltas applied.
            var spec: JSONValue?
            var track: JSONValue?
        }

        struct LastEvent: Codable {
            var at: Int?
        }

        /// The reduced form of a `/state` (or full listing row) body.
        static func from(_ data: Data) -> Reduced? {
            guard var reduced = try? JSONDecoder().decode(Reduced.self, from: data) else { return nil }
            if reduced.resolvedSpec != nil { reduced.scene?.spec = nil }
            return reduced
        }

        /// Always names `resolvedSpec` and `scene`, null or not, so the bytes
        /// read back as a row whose scene half is known.
        var bytes: Data? {
            var object: [String: JSONValue] = [
                "resolvedSpec": resolvedSpec ?? .null,
                "scene": scene.map { scene in
                    var s: [String: JSONValue] = [:]
                    if let spec = scene.spec { s["spec"] = spec }
                    if let track = scene.track { s["track"] = track }
                    return .object(s)
                } ?? .null,
            ]
            if let at = lastEvent?.at { object["lastEvent"] = .object(["at": .int(at)]) }
            if let access { object["access"] = .string(access) }
            return try? JSONEncoder().encode(JSONValue.object(object))
        }
    }
}

/// Fills in the scene half of the slim listing's rows, a channel at a time,
/// when something on screen needs it.
///
/// - `want` is called by a tile as it appears. Up to `maxRunning` reads run
///   at once, the most recently wanted first: after a fast scroll the tiles
///   now on screen go before the ones that already scrolled past (`unwant`
///   drops those that never started).
/// - A detail is kept by `lastEvent.at`. One that is at least as new as the
///   listing's row is never fetched again, on this launch or the next: the
///   reduced `/state` is on disk (`GalleryClient.fetchDetail`).
/// - Arrivals are handed over in batches (`onArrive`), not one by one: each
///   write to the app's `channels` re-evaluates the whole wall, and the
///   lowest Apple TV this ships to feels every one.
/// - Never everything at once: all 56 prod `/state`s come to 3.7 MB (325 KB
///   brotli), more than the full listing this replaces. Only what is seen.
@MainActor
final class ChannelDetails {
    private let gallery: GalleryClient
    private(set) var known: [String: ChannelDetail]
    /// Most recently wanted last.
    private var queue: [String] = []
    private var running: Set<String> = []
    private var failedAt: [String: Date] = [:]
    private var arrived: [String: ChannelDetail] = [:]
    private var flush: Task<Void, Never>?
    /// Every detail that landed in one beat, on the main actor.
    var onArrive: ([String: ChannelDetail]) -> Void = { _ in }

    static let maxRunning = 4
    /// A read that failed is not retried by every tile redraw.
    static let retryAfter: TimeInterval = 30
    static let coalesce: Duration = .milliseconds(120)

    init(gallery: GalleryClient, cached: [String: ChannelDetail] = [:]) {
        self.gallery = gallery
        self.known = cached
    }

    /// Whether what is known for `id` is at least as new as a listing row
    /// last changed at `lastEventAt`.
    func isFresh(_ id: String, lastEventAt: Int?) -> Bool {
        guard let have = known[id] else { return false }
        guard let lastEventAt else { return true }
        guard let haveAt = have.lastEventAt else { return false }
        return haveAt >= lastEventAt
    }

    /// A tile showing `channel` is on screen: fetch its scene unless what is
    /// known is current.
    func want(_ channel: PublicChannel) {
        let id = channel.id
        guard !isFresh(id, lastEventAt: channel.lastEventAt), !running.contains(id) else { return }
        if let failed = failedAt[id], Date().timeIntervalSince(failed) < Self.retryAfter { return }
        queue.removeAll { $0 == id }
        queue.append(id)
        pump()
    }

    /// The tile went off screen before its read started.
    func unwant(_ id: String) {
        queue.removeAll { $0 == id }
    }

    /// Learn the scene half of rows decoded whole (a channel's `/state`, the
    /// full-listing cache an earlier build wrote), so the slim rows that
    /// replace them keep their posters. Only rows decoded straight from a full
    /// shape: a row this class filled carries the listing's `lastEventAt`, not
    /// its detail's.
    func absorb(_ rows: [PublicChannel]) {
        for row in rows where row.detailLoaded {
            let detail = ChannelDetail(row: row)
            if let have = known[row.id], (have.lastEventAt ?? 0) > (detail.lastEventAt ?? 0) { continue }
            known[row.id] = detail
        }
    }

    /// `rows` with every known scene filled in — stale ones included: an old
    /// poster beats none while `want` fetches the new one.
    func apply(to rows: [PublicChannel]) -> [PublicChannel] {
        rows.map { row in
            guard !row.detailLoaded, let detail = known[row.id] else { return row }
            return row.with(detail)
        }
    }

    /// Read a channel's scene now, past the queue — for a mix, which must
    /// republish what the source shows at the moment of the tap.
    func fetchNow(_ id: String) async throws -> ChannelDetail {
        let detail = try await gallery.fetchDetail(channelId: id)
        landed(id, detail, wasRunning: false)
        return detail
    }

    private func pump() {
        while running.count < Self.maxRunning, let id = queue.popLast() {
            running.insert(id)
            let gallery = self.gallery
            Task { [weak self] in
                let detail = try? await gallery.fetchDetail(channelId: id)
                self?.landed(id, detail, wasRunning: true)
            }
        }
    }

    private func landed(_ id: String, _ detail: ChannelDetail?, wasRunning: Bool) {
        if wasRunning { running.remove(id) }
        if let detail {
            known[id] = detail
            failedAt[id] = nil
            arrived[id] = detail
            scheduleFlush()
        } else {
            failedAt[id] = Date()
        }
        pump()
    }

    private func scheduleFlush() {
        guard flush == nil else { return }
        flush = Task { [weak self] in
            try? await Task.sleep(for: Self.coalesce)
            guard let self else { return }
            let batch = arrived
            arrived = [:]
            flush = nil
            if !batch.isEmpty { onArrive(batch) }
        }
    }
}
