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

    /// `GET /api/channels` — public channel list. Successful responses are
    /// cached to disk so a cold launch can render instantly from
    /// `cachedChannels()` while the refresh is in flight.
    func fetchChannels() async throws -> [PublicChannel] {
        let url = baseURL.appendingPathComponent("api/channels")
        let (data, http) = try await transport.data(for: URLRequest(url: url))
        guard (200...299).contains(http.statusCode) else {
            throw GalleryError.httpError(status: http.statusCode, body: String(data: data, encoding: .utf8) ?? "")
        }
        guard let channels = try? JSONDecoder().decode([PublicChannel].self, from: data) else {
            throw GalleryError.invalidResponse
        }
        try? data.write(to: cacheFileURL(), options: .atomic)
        // Opportunistic cleanup of the pre-`v2` blob this version supersedes —
        // a missing file or a failed removal doesn't affect the refresh.
        try? FileManager.default.removeItem(at: legacyCacheFileURL())
        return channels
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

    /// Last successfully fetched channel list, or nil if never fetched.
    /// The inline scene specs make cached content fully renderable offline.
    nonisolated func cachedChannels() -> [PublicChannel]? {
        guard let data = try? Data(contentsOf: cacheFileURL()) else { return nil }
        return try? JSONDecoder().decode([PublicChannel].self, from: data)
    }

    /// Cache file is keyed by host so localhost dev and prod don't mix.
    ///
    /// The `v2` bump is deliberate: `PublicChannel` gained `isProtected` and
    /// `access`, and a cache blob written before that ships them as nil —
    /// which the Remixable filter and the private-channel gate both read as
    /// "safe to show". Versioning the filename makes a pre-upgrade cache a
    /// clean miss instead of a silent, wrongly-permissive decode. Bump this
    /// again if `PublicChannel` ever gains another field whose absence must
    /// not be read as a default.
    private nonisolated func cacheFileURL() -> URL {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let host = baseURL.host ?? "unknown"
        return dir.appendingPathComponent("channels-v2-\(host).json")
    }

    /// The pre-`v2` cache blob this version supersedes. Existing installs
    /// wrote this filename before the bump above and it is now a dead file —
    /// removed opportunistically once a fresh `v2` write succeeds.
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
        let url = baseURL.appendingPathComponent("c").appendingPathComponent(channelId)
            .appendingPathComponent("state")
        guard let (data, http) = try? await channelRead(url, channelId: channelId) else { return nil }
        // The key was sent and refused (revoked or rotated): keep the row, so
        // opening it reaches the gate's "Add a new key" instead of the
        // channel quietly leaving the wall.
        // Only a key that was actually sent: a malformed one never is.
        if http.statusCode == 403, Self.isPrivateRefusal(data),
           let held = key(channelId), ChannelTokenFormat.isWellFormedToken(held) {
            return PublicChannel(channelId: channelId, label: label, tags: nil, viewers: nil, access: "private")
        }
        guard (200...299).contains(http.statusCode),
              let row = try? JSONDecoder().decode(PublicChannel.self, from: data),
              row.access == "private" else { return nil }
        // `/state` names the channel under `meta.label`; the keyring's own
        // name (often just the id) is the fallback.
        let named = (try? JSONDecoder().decode(StateMeta.self, from: data))?.meta?.label
        return row.withIdentity(channelId: channelId, label: named ?? label)
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
