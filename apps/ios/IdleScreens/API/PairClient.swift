import Foundation

// MARK: - Models

/// A short-lived pair code minted for a TV (`POST /api/pair/new`).
struct PairCode: Decodable, Equatable, Sendable {
    let code: String
    /// Universal link the QR encodes: `https://idlescreens.com/pair/<code>`.
    let url: String
    /// Epoch milliseconds after which the code stops working.
    let expiresAt: Int?
}

/// Result of claiming a code on the phone (`POST /api/pair/claim`).
struct ClaimedPair: Decodable, Equatable, Sendable {
    /// Long-lived `isp_` push token — store in the Keychain, never UserDefaults.
    let pairToken: String
    let deviceId: String
    /// The channel the TV was watching when the code was claimed, if any.
    let channelId: String?
    /// The screen's X25519 public key (`PairKeySeal`), when it gave one. nil
    /// for a screen too old to: it can be sent channels, not keys.
    var publicKey: String? = nil
}

/// Where the paired TV is right now (`GET /api/pair/status`).
struct PairStatus: Decodable, Equatable, Sendable {
    let deviceId: String?
    let channelId: String?
    let lastSeenAt: Int?
}

/// Outcome of a switch push (`POST /api/pair/push`).
struct PairPushResult: Decodable, Equatable, Sendable {
    let ok: Bool?
    let delivered: Int?
    let error: String?
}

enum PairError: LocalizedError, Equatable {
    case invalidResponse
    case httpError(status: Int, message: String)
    /// `409 {code: "no-screen-key"}` from `/api/pair/push`: a sealed key was
    /// sent on a pairing the server holds no screen key for. Only pairing
    /// again fixes it, so it is not "the screen isn't answering".
    case noScreenKey

    var errorDescription: String? {
        switch self {
        case .invalidResponse: "Invalid response from server"
        case .httpError(_, let message): message
        case .noScreenKey: "This screen was paired before it could take a private channel's key. Pair it again, then send."
        }
    }
}

// MARK: - Client

/// Client for the device-pairing endpoints. The TV calls `createCode`; the
/// phone calls `claim`, `status`, and `push`.
actor PairClient {
    let baseURL: URL
    let transport: any HTTPTransport

    init(baseURL: URL, transport: any HTTPTransport = URLSessionTransport()) {
        self.baseURL = baseURL
        self.transport = transport
    }

    /// `POST /api/pair/new` — TV side: mint a fresh code for this device.
    /// `publicKey` lets the paired phone seal a private channel's key to it.
    func createCode(deviceId: String, channelId: String?, publicKey: String? = nil) async throws -> PairCode {
        var body: [String: String] = ["deviceId": deviceId]
        if let channelId { body["channelId"] = channelId }
        if let publicKey { body["publicKey"] = publicKey }
        return try await post(path: "api/pair/new", body: body, token: nil)
    }

    /// `POST /api/pair/claim` — phone side: exchange a scanned code for a pair token.
    func claim(code: String) async throws -> ClaimedPair {
        try await post(path: "api/pair/claim", body: ["code": code], token: nil)
    }

    /// `GET /api/pair/status` — phone side: where is the TV now?
    func status(pairToken: String) async throws -> PairStatus {
        let url = baseURL.appendingPathComponent("api/pair/status")
        var request = URLRequest(url: url)
        request.setValue("Bearer \(pairToken)", forHTTPHeaderField: "Authorization")
        let (data, http) = try await transport.data(for: request)
        guard (200...299).contains(http.statusCode) else {
            throw PairError.httpError(status: http.statusCode, message: Self.serverMessage(data, status: http.statusCode))
        }
        guard let status = try? JSONDecoder().decode(PairStatus.self, from: data) else {
            throw PairError.invalidResponse
        }
        return status
    }

    /// `POST /api/pair/push` — phone side: tell the TV what to show. A
    /// `sceneId` pins one stored scene of the channel; nil means live (the
    /// field is left out, which every server and screen reads as live).
    /// `sealedKey` hands the screen a private channel's viewer key
    /// (`PairKeySeal.seal`); the server relays it unread.
    @discardableResult
    func push(pairToken: String, channelId: String, sceneId: Int? = nil, sealedKey: String? = nil) async throws -> PairPushResult {
        try await post(path: "api/pair/push",
                       body: PushBody(channelId: channelId, sceneId: sceneId, sealedKey: sealedKey), token: pairToken)
    }

    private struct PushBody: Encodable {
        let channelId: String
        let sceneId: Int?
        let sealedKey: String?
    }

    // MARK: Internals

    private func post<T: Decodable, B: Encodable>(path: String, body: B, token: String?) async throws -> T {
        let url = baseURL.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try JSONEncoder().encode(body)
        let (data, http) = try await transport.data(for: request)
        guard (200...299).contains(http.statusCode) else {
            if http.statusCode == 409, Self.errorCode(data) == "no-screen-key" { throw PairError.noScreenKey }
            throw PairError.httpError(status: http.statusCode, message: Self.serverMessage(data, status: http.statusCode))
        }
        guard let decoded = try? JSONDecoder().decode(T.self, from: data) else {
            throw PairError.invalidResponse
        }
        return decoded
    }

    /// Prefer the server's own `error` string; fall back to the raw status.
    private static func errorCode(_ data: Data) -> String? {
        (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["code"] as? String
    }

    private static func serverMessage(_ data: Data, status: Int) -> String {
        if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let message = object["error"] as? String {
            return message
        }
        return "HTTP \(status)"
    }
}
