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

    init(baseURL: URL, transport: any HTTPTransport = URLSessionTransport()) {
        self.baseURL = baseURL
        self.transport = transport
    }

    /// `GET /api/channels` — public channel list.
    func fetchChannels() async throws -> [PublicChannel] {
        let url = baseURL.appendingPathComponent("api/channels")
        let (data, http) = try await transport.data(for: URLRequest(url: url))
        guard (200...299).contains(http.statusCode) else {
            throw GalleryError.httpError(status: http.statusCode, body: String(data: data, encoding: .utf8) ?? "")
        }
        guard let channels = try? JSONDecoder().decode([PublicChannel].self, from: data) else {
            throw GalleryError.invalidResponse
        }
        return channels
    }

    /// `GET /c/:channelId/state` — public read-only state.
    func fetchState(channelId: String) async throws -> ChannelState {
        let url = baseURL
            .appendingPathComponent("c")
            .appendingPathComponent(channelId)
            .appendingPathComponent("state")
        let (data, http) = try await transport.data(for: URLRequest(url: url))
        guard (200...299).contains(http.statusCode) else {
            throw GalleryError.httpError(status: http.statusCode, body: String(data: data, encoding: .utf8) ?? "")
        }
        guard let state = try? JSONDecoder().decode(ChannelState.self, from: data) else {
            throw GalleryError.invalidResponse
        }
        return state
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

    /// `GET /c/:channelId/thumb` — JPEG thumbnail.
    nonisolated func thumbURL(for channelId: String) -> URL {
        baseURL
            .appendingPathComponent("c")
            .appendingPathComponent(channelId)
            .appendingPathComponent("thumb")
    }

    /// `GET /channel/:channelId` — the hosted viewer web page.
    nonisolated func viewerURL(for channelId: String) -> URL {
        baseURL
            .appendingPathComponent("channel")
            .appendingPathComponent(channelId)
    }
}
