import Foundation

/// What a key lets its holder do on the channel it belongs to.
///
/// idlescreens.com has no accounts, on purpose: the token IS the authorization,
/// and a key belongs to a channel, not to a person (see
/// `idle-server/docs/capability-auth.md`). So "who am I here?" has no answer in
/// the abstract — only "which key do I hold for this channel?". The app is a
/// keyring, and a role is a property of a key on it.
///
/// Roles nest downward: an owner also edits, an editor also reads.
enum ChannelRole: String, Codable, Sendable, Comparable {
    case viewer, editor, owner

    private var rank: Int {
        switch self {
        case .viewer: 0
        case .editor: 1
        case .owner: 2
        }
    }

    static func < (a: ChannelRole, b: ChannelRole) -> Bool { a.rank < b.rank }

    /// Publish, steer, schedule, presets, overlay, recall, sleep and wake.
    var canEdit: Bool { self >= .editor }
    /// Mint, list and revoke keys; rotate; visibility; delete.
    var canAdminister: Bool { self == .owner }

    var label: String {
        switch self {
        case .owner: "owner"
        case .editor: "can edit"
        case .viewer: "can view"
        }
    }

    var icon: String {
        switch self {
        case .owner: "key.fill"
        case .editor: "paintbrush.pointed.fill"
        case .viewer: "eye.fill"
        }
    }

    /// The role a key's PREFIX advertises. A hint for display before the
    /// server has answered — never the authorization, which is whatever the
    /// channel stored against the key's hash. An owner KEY (`isk_own_`) mints
    /// channels and holds no role on any of them, so it maps to nil.
    static func hint(fromToken token: String) -> ChannelRole? {
        if token.hasPrefix("isk_own_") { return nil }
        if token.hasPrefix("isk_view_") { return .viewer }
        if token.hasPrefix("isk_edit_") { return .editor }
        if token.hasPrefix("isk_") { return .owner }
        return nil
    }
}

/// `POST /c/:id/verify` — the server's word on what a key is.
struct KeyVerdict: Decodable, Equatable, Sendable {
    /// Any role at all.
    let valid: Bool
    /// nil on an open channel (nobody owns lobby) or for an unknown key.
    let role: ChannelRole?
    /// `"public"` or `"private"`.
    let access: String?
    /// False for the open demo channels, which take anyone's agent.
    let protected: Bool?

    private enum CodingKeys: String, CodingKey { case valid, role, access, protected, approved, ok }

    init(valid: Bool, role: ChannelRole?, access: String? = nil, protected: Bool? = nil) {
        self.valid = valid; self.role = role; self.access = access; self.protected = protected
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // Older servers answered `approved` / `ok`.
        valid = (try? c.decodeIfPresent(Bool.self, forKey: .valid))
            ?? (try? c.decodeIfPresent(Bool.self, forKey: .approved))
            ?? (try? c.decodeIfPresent(Bool.self, forKey: .ok)) ?? false
        // An unrecognised role string must not fail the whole verdict.
        role = (try? c.decodeIfPresent(String.self, forKey: .role)).flatMap { $0 }.flatMap(ChannelRole.init(rawValue:))
        access = try? c.decodeIfPresent(String.self, forKey: .access)
        protected = try? c.decodeIfPresent(Bool.self, forKey: .protected)
    }
}

/// One key an owner has minted, as `listTokens` reports it. Ids only — the
/// server never returns a key after the moment it is created.
struct KeyGrant: Decodable, Identifiable, Equatable, Sendable {
    let id: String
    let role: ChannelRole?
    let label: String?
    let createdAt: Double?

    private enum CodingKeys: String, CodingKey { case id, role, label, createdAt }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        role = (try? c.decodeIfPresent(String.self, forKey: .role)).flatMap { $0 }.flatMap(ChannelRole.init(rawValue:))
        label = try? c.decodeIfPresent(String.self, forKey: .label)
        createdAt = try? c.decodeIfPresent(Double.self, forKey: .createdAt)
    }
}

/// A freshly minted key. The plaintext exists exactly here, once.
struct MintedKey: Decodable, Equatable, Sendable {
    let id: String
    let token: String
}

struct KeyGrantList: Decodable, Sendable {
    let access: String?
    let tokens: [KeyGrant]
}

extension GalleryClient {
    func verdict(channelId: String, token: String) async throws -> KeyVerdict {
        let url = baseURL.appendingPathComponent("c").appendingPathComponent(channelId)
            .appendingPathComponent("verify")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["token": token])
        let (data, http) = try await transport.data(for: request)
        guard (200...299).contains(http.statusCode),
              let verdict = try? JSONDecoder().decode(KeyVerdict.self, from: data) else {
            return KeyVerdict(valid: false, role: nil)
        }
        return verdict
    }
}

extension MCPClient {
    /// Mint a key for someone else. Owner only. The returned plaintext is the
    /// only time it will ever be seen.
    func createToken(channelId: String, token: String, role: ChannelRole, label: String) async throws -> MintedKey {
        try await callTool("createToken", arguments: [
            "channelId": .string(channelId), "token": .string(token),
            "role": .string(role.rawValue), "label": .string(label),
            "agent": .string("idle-screens-ios"), "harness": .string("ios-app"),
        ], as: MintedKey.self)
    }

    func listTokens(channelId: String, token: String) async throws -> [KeyGrant] {
        try await callTool("listTokens", arguments: [
            "channelId": .string(channelId), "token": .string(token),
        ], as: KeyGrantList.self).tokens
    }

    /// Ends exactly one relationship. Every other key keeps working.
    func revokeToken(channelId: String, token: String, id: String) async throws {
        try await callTool("revokeToken", arguments: [
            "channelId": .string(channelId), "token": .string(token), "id": .string(id),
            "agent": .string("idle-screens-ios"), "harness": .string("ios-app"),
        ])
    }
}
