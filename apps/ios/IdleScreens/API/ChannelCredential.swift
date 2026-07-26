import Foundation

/// A channel the user controls. Metadata lives in UserDefaults;
/// the capability token lives in the Keychain, keyed by channelId.
struct ChannelCredential: Codable, Equatable, Hashable, Identifiable, Sendable {
    let channelId: String
    var label: String
    let createdAt: Date

    var id: String { channelId }
}

/// Persists the credential list (UserDefaults JSON) and tokens (Keychain).
final class CredentialStore: @unchecked Sendable {
    private let defaults: UserDefaults
    private let listKey = "channel_credentials"

    init(userDefaults: UserDefaults = .standard) {
        self.defaults = userDefaults
    }

    // MARK: Credential list

    func load() -> [ChannelCredential] {
        guard let data = defaults.data(forKey: listKey),
              let credentials = try? JSONDecoder().decode([ChannelCredential].self, from: data) else {
            return []
        }
        return credentials
    }

    func save(_ credentials: [ChannelCredential]) {
        defaults.set(try? JSONEncoder().encode(credentials), forKey: listKey)
    }

    // MARK: Tokens

    func token(for channelId: String) -> String? {
        KeychainHelper.load(key: Self.tokenKey(for: channelId))
    }

    func setToken(_ token: String, for channelId: String) {
        KeychainHelper.save(key: Self.tokenKey(for: channelId), value: token)
    }

    func removeToken(for channelId: String) {
        KeychainHelper.delete(key: Self.tokenKey(for: channelId))
    }

    static func tokenKey(for channelId: String) -> String {
        "channel.token.\(channelId)"
    }
}
