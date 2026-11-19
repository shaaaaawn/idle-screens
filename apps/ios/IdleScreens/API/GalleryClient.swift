import Foundation

enum GalleryError: LocalizedError, Equatable {
    case invalidResponse
    case httpError(status: Int, body: String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: "Invalid response from server"
        case .httpError(let status, let body): "HTTP \(status): \(body)"
        }
    }
}

/// Client for the public read-only gallery endpoints.
actor GalleryClient {
    let baseURL: URL
    let transport: any HTTPTransport
    /// The key this device holds for a channel, if any — for the per-channel
    /// reads a private channel gates (`channelRead`).
    private let key: @Sendable (String) -> String?

    init(baseURL: URL, transport: any HTTPTransport = URLSessionTransport(),
         key: @escaping @Sendable (String) -> String? = { _ in nil }) {
        self.key = key
        self.baseURL = baseURL
        self.transport = transport
    }

    /// `GET /api/channels?slim=1` — the public channel list without its
    /// scenes: 34 KB on prod (2026-11-16) where the full list was 1.9–2.5 MB,
    /// most of it the Screen Test reels' sequences. A tile's scene comes from
    /// `fetchDetail` when it shows (`ChannelDetails`). Successful responses are
    /// cached to disk so a cold launch can render instantly from
    /// `cachedChannels()` while the refresh is in flight.
    func fetchChannels() async throws -> [PublicChannel] {
        // Not `appendingPathComponent("api/channels?slim=1")`: that encodes
        // the `?` into the path.
        var parts = URLComponents(url: baseURL.appendingPathComponent("api/channels"),
                                  resolvingAgainstBaseURL: false)!
        parts.queryItems = [URLQueryItem(name: "slim", value: "1")]
        let (data, http) = try await transport.data(for: URLRequest(url: parts.url!))
        guard (200...299).contains(http.statusCode) else {
            throw GalleryError.httpError(status: http.statusCode, body: String(data: data, encoding: .utf8) ?? "")
        }
        guard let channels = try? JSONDecoder().decode([PublicChannel].self, from: data).map(\.asListed) else {
            throw GalleryError.invalidResponse
        }
        try? data.write(to: cacheFileURL(), options: .atomic)
        // The full list an earlier build cached becomes per-channel scenes
        // once, so the first launch after the update keeps every poster.
        migrateFullListCache()
        // Opportunistic cleanup of the pre-`v2` blob — a missing file or a
        // failed removal doesn't affect the refresh.
        try? FileManager.default.removeItem(at: legacyCacheFileURL())
        pruneDetails(keeping: Set(channels.map(\.id)))
        return channels
    }

    /// `GET /c/:id/state`, reduced to the scene half of a row and kept on
    /// disk by channel. Read with this device's key on a private channel
    /// (`channelRead`); a private channel's scene is never written to disk.
    func fetchDetail(channelId: String) async throws -> ChannelDetail {
        let url = baseURL.appendingPathComponent("c").appendingPathComponent(channelId)
            .appendingPathComponent("state")
        let (data, http) = try await channelRead(url, channelId: channelId)
        guard (200...299).contains(http.statusCode) else {
            throw GalleryError.httpError(status: http.statusCode, body: String(data: data, encoding: .utf8) ?? "")
        }
        guard let reduced = ChannelDetail.Reduced.from(data), let bytes = reduced.bytes,
              let detail = ChannelDetail(reduced: bytes) else {
            throw GalleryError.invalidResponse
        }
        if reduced.access != "private" {
            let dir = detailsDirectoryURL()
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try? bytes.write(to: detailFileURL(channelId, in: dir), options: .atomic)
        }
        return detail
    }

    /// Every channel's scene fetched before, by id. Read once, at launch,
    /// so the cached wall's posters are there on its first frame.
    nonisolated func cachedDetails() -> [String: ChannelDetail] {
        let dir = detailsDirectoryURL()
        guard let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)
        else { return [:] }
        var out: [String: ChannelDetail] = [:]
        for file in files where file.pathExtension == "json" {
            guard let id = file.deletingPathExtension().lastPathComponent.removingPercentEncoding,
                  let bytes = try? Data(contentsOf: file),
                  let detail = ChannelDetail(reduced: bytes) else { continue }
            out[id] = detail
        }
        return out
    }

    /// A channel that left the listing takes its scene off disk with it.
    private func pruneDetails(keeping ids: Set<String>) {
        let dir = detailsDirectoryURL()
        guard let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)
        else { return }
        for file in files {
            let id = file.deletingPathExtension().lastPathComponent.removingPercentEncoding
            if id.map(ids.contains) != true { try? FileManager.default.removeItem(at: file) }
        }
    }

    /// The full listing builds before this one cached (`channels-v2-<host>`):
    /// split into per-channel scenes, then deleted. A channel already fetched
    /// keeps its own (newer) file.
    private func migrateFullListCache() {
        let legacy = fullListCacheFileURL()
        guard let data = try? Data(contentsOf: legacy) else { return }
        guard case .array(let rows)? = try? JSONDecoder().decode(JSONValue.self, from: data) else { return }
        let dir = detailsDirectoryURL()
        // The legacy file goes only once every scene it held is on disk (or
        // was deliberately skipped): a failed write keeps it for next launch.
        var complete = (try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)) != nil
        for row in rows {
            guard case .object(let fields) = row, case .string(let id)? = fields["id"],
                  let rowData = try? JSONEncoder().encode(row),
                  let reduced = ChannelDetail.Reduced.from(rowData), reduced.access != "private",
                  let bytes = reduced.bytes else { continue }
            let file = detailFileURL(id, in: dir)
            if FileManager.default.fileExists(atPath: file.path) { continue }
            if (try? bytes.write(to: file, options: .atomic)) == nil { complete = false }
        }
        if complete { try? FileManager.default.removeItem(at: legacy) }
    }

    /// `GET /api/categories` — editorial shelf catalog. Cached to disk like
    /// the channel list so cold launches shelve instantly.
    func fetchCategories() async throws -> [ChannelCategory] {
        let url = baseURL.appendingPathComponent("api/categories")
        let (data, http) = try await transport.data(for: URLRequest(url: url))
        guard (200...299).contains(http.statusCode) else {
            throw GalleryError.httpError(status: http.statusCode, body: String(data: data, encoding: .utf8) ?? "")
        }
        guard let wrapped = try? JSONDecoder().decode(CategoriesResponse.self, from: data) else {
            throw GalleryError.invalidResponse
        }
        try? data.write(to: categoriesCacheFileURL(), options: .atomic)
        return wrapped.categories
    }

    /// Last successfully fetched category catalog, or nil if never fetched.
    nonisolated func cachedCategories() -> [ChannelCategory]? {
        guard let data = try? Data(contentsOf: categoriesCacheFileURL()) else { return nil }
        return (try? JSONDecoder().decode(CategoriesResponse.self, from: data))?.categories
    }

    private struct CategoriesResponse: Decodable {
        let categories: [ChannelCategory]
    }

    private nonisolated func categoriesCacheFileURL() -> URL {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let host = baseURL.host ?? "unknown"
        return dir.appendingPathComponent("categories-\(host).json")
    }

    /// Last successfully fetched channel list, or nil if never fetched. The
    /// slim rows carry no scene; `cachedDetails()` has the ones fetched before,
    /// which is what keeps a cached wall renderable offline. On the first
    /// launch after the update this is the full list an earlier build cached
    /// (scenes inline) until the first slim fetch replaces it.
    nonisolated func cachedChannels() -> [PublicChannel]? {
        guard let data = (try? Data(contentsOf: cacheFileURL())) ?? (try? Data(contentsOf: fullListCacheFileURL()))
        else { return nil }
        return (try? JSONDecoder().decode([PublicChannel].self, from: data))?.map(\.asListed)
    }

    /// Cache file is keyed by host so localhost dev and prod don't mix.
    ///
    /// Versioned on purpose: `PublicChannel` gained `isProtected` and
    /// `access` (the `v2` bump), and a cache blob written before that ships
    /// them as nil — which the Remixable filter and the private-channel gate
    /// both read as "safe to show". A new filename makes a pre-upgrade cache
    /// a clean miss instead of a silent, wrongly-permissive decode. `slim-v1`
    /// is the slim listing. Bump it if `PublicChannel` ever gains another
    /// field whose absence must not be read as a default.
    private nonisolated func cacheFileURL() -> URL {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let host = baseURL.host ?? "unknown"
        return dir.appendingPathComponent("channels-slim-v1-\(host).json")
    }

    /// The full listing (scenes inline) that builds before the slim one
    /// cached. Read as a fallback until `migrateFullListCache` removes it.
    private nonisolated func fullListCacheFileURL() -> URL {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let host = baseURL.host ?? "unknown"
        return dir.appendingPathComponent("channels-v2-\(host).json")
    }

    /// One reduced `/state` per channel (`ChannelDetail.Reduced`), keyed by
    /// host like the listing.
    private nonisolated func detailsDirectoryURL() -> URL {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let host = baseURL.host ?? "unknown"
        return dir.appendingPathComponent("channel-details-v1-\(host)", isDirectory: true)
    }

    private nonisolated func detailFileURL(_ channelId: String, in dir: URL) -> URL {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-_")
        let name = channelId.addingPercentEncoding(withAllowedCharacters: allowed) ?? channelId
        return dir.appendingPathComponent(name).appendingPathExtension("json")
    }

    /// The pre-`v2` cache blob. Existing installs wrote this filename before
    /// the `v2` bump and it is now a dead file — removed opportunistically
    /// once a fresh write succeeds.
    private func legacyCacheFileURL() -> URL {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let host = baseURL.host ?? "unknown"
        return dir.appendingPathComponent("channels-\(host).json")
    }

    /// A per-channel read (`/state`, `/history`, `/scene/:n`): anonymous
    /// first, and again with this device's key only when the channel answers
    /// 403 because it is private. Anonymous first keeps public reads on the
    /// edge cache (a request carrying a key never reads it) and keeps a key
    /// off the wire wherever it is not needed. The key rides a header, never
    /// the URL.
    func channelRead(_ url: URL, channelId: String) async throws -> (Data, HTTPURLResponse) {
        let (data, http) = try await transport.data(for: URLRequest(url: url))
        guard http.statusCode == 403, Self.isPrivateRefusal(data),
              let key = key(channelId), ChannelTokenFormat.isWellFormedToken(key) else {
            return (data, http)
        }
        var request = URLRequest(url: url)
        request.setValue(key, forHTTPHeaderField: "X-Idle-Token")
        return try await transport.data(for: request)
    }

    /// The read gate's own refusal: `403 {code: "private"}`.
    static func isPrivateRefusal(_ data: Data) -> Bool {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        return object["code"] as? String == "private"
    }

    /// `GET /c/:channelId/state` — read-only state (a private channel's needs
    /// this device's key; see `channelRead`).
    func fetchState(channelId: String) async throws -> ChannelState {
        let url = baseURL
            .appendingPathComponent("c")
            .appendingPathComponent(channelId)
            .appendingPathComponent("state")
        let (data, http) = try await channelRead(url, channelId: channelId)
        guard (200...299).contains(http.statusCode) else {
            throw GalleryError.httpError(status: http.statusCode, body: String(data: data, encoding: .utf8) ?? "")
        }
        guard let state = try? JSONDecoder().decode(ChannelState.self, from: data) else {
            throw GalleryError.invalidResponse
        }
        return state
    }

    /// A private channel on this device's keyring, as a gallery row. The
    /// listing never carries one (private forces unlisted), so without this
    /// a key opened nothing to watch. `/state` has the fields the row reads
    /// (`scene`, `resolvedSpec`, `access`, `lastEvent`, `sleeping`), and its
    /// name under `meta.label` (the keyring's is the fallback). nil for a public
    /// channel: those reach the wall through the listing or not at all.
    func fetchPrivateChannel(channelId: String, label: String) async -> PublicChannel? {
        if case .privateRow(let row) = await readKeyringChannel(channelId: channelId, label: label) { return row }
        return nil
    }

    /// What a keyring channel's own `/state` says about it.
    enum KeyringRead: Sendable {
        /// Private: its row, for the wall.
        case privateRow(PublicChannel)
        /// Public, though the listing left it out (unlisted).
        case isPublic
        /// The read failed or said nothing either way.
        case unknown
    }

    /// `fetchPrivateChannel`, keeping the answer for a public channel too:
    /// the widget sends a public one itself, and needs the app for a private one.
    func readKeyringChannel(channelId: String, label: String) async -> KeyringRead {
        let url = baseURL.appendingPathComponent("c").appendingPathComponent(channelId)
            .appendingPathComponent("state")
        guard let (data, http) = try? await channelRead(url, channelId: channelId) else { return .unknown }
        // The key was sent and refused (revoked or rotated): keep the row, so
        // opening it reaches the gate's "Add a new key" instead of the
        // channel quietly leaving the wall.
        // Only a key that was actually sent: a malformed one never is.
        if http.statusCode == 403, Self.isPrivateRefusal(data),
           let held = key(channelId), ChannelTokenFormat.isWellFormedToken(held) {
            return .privateRow(PublicChannel(channelId: channelId, label: label, tags: nil, viewers: nil, access: "private"))
        }
        guard (200...299).contains(http.statusCode),
              let row = try? JSONDecoder().decode(PublicChannel.self, from: data) else { return .unknown }
        guard row.access == "private" else { return row.access == "public" ? .isPublic : .unknown }
        // `/state` names the channel under `meta.label`; the keyring's own
        // name (often just the id) is the fallback.
        let named = (try? JSONDecoder().decode(StateMeta.self, from: data))?.meta?.label
        return .privateRow(row.withIdentity(channelId: channelId, label: named ?? label))
    }

    private struct StateMeta: Decodable {
        struct Meta: Decodable { let label: String? }
        let meta: Meta?
    }

    /// `POST /c/:channelId/verify` — check a capability token before saving it.
    /// HTTP 200 + an affirmative boolean field means approved; anything else declined.
    func verify(channelId: String, token: String) async throws -> Bool {
        let url = baseURL
            .appendingPathComponent("c")
            .appendingPathComponent(channelId)
            .appendingPathComponent("verify")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["token": token])

        let (data, http) = try await transport.data(for: request)
        guard (200...299).contains(http.statusCode) else { return false }
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        for key in ["approved", "ok", "valid"] {
            if let value = object[key] as? Bool { return value }
        }
        return false
    }

    /// `GET /c/:channelId/thumb` — the channel's picture: 16:9 by default, or
    /// the upright 9:16 one (`?aspect=portrait`) for tall cards. The server
    /// falls back to the 16:9 picture when it has no upright one yet.
    nonisolated func thumbURL(for channelId: String, portrait: Bool = false) -> URL {
        let url = baseURL
            .appendingPathComponent("c")
            .appendingPathComponent(channelId)
            .appendingPathComponent("thumb")
        guard portrait, var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        parts.queryItems = [URLQueryItem(name: "aspect", value: "portrait")]
        return parts.url ?? url
    }

    /// `GET /channel/:channelId` — the hosted viewer web page.
    nonisolated func viewerURL(for channelId: String) -> URL {
        baseURL
            .appendingPathComponent("channel")
            .appendingPathComponent(channelId)
    }
}
