import Foundation
import Security

/// Capability tokens for claimed channels, one per channel id.
///
/// A claimed channel rejects writes without its token ("This channel is
/// protected"), and the token *is* the authorization — there are no accounts.
/// It's a credential, so it lives in the Keychain rather than defaults, keyed
/// the same way the iOS app keys its own (`channel.token.<id>`).
enum ChannelToken {
  private static let service = "com.idlescreens.mac"

  private static func account(_ channelId: String) -> String { "channel.token.\(channelId)" }

  static func load(for channelId: String) -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account(channelId),
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: AnyObject?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
      let data = result as? Data, let token = String(data: data, encoding: .utf8),
      !token.isEmpty
    else { return nil }
    return token
  }

  @discardableResult
  static func save(_ token: String, for channelId: String) -> Bool {
    guard let data = token.data(using: .utf8) else { return false }
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account(channelId),
    ]
    SecItemDelete(query as CFDictionary)  // replace, don't duplicate
    var attrs = query
    attrs[kSecValueData as String] = data
    attrs[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    let status = SecItemAdd(attrs as CFDictionary, nil)
    if status != errSecSuccess {
      NSLog("[idle-screens] keychain save failed for \(channelId): OSStatus \(status)")
      return false
    }
    return true
  }

  /// Every channel this Mac holds a token for, sorted. Scoped to this app's
  /// Keychain service — it can't see (and must not claim to see) the tokens
  /// the iPhone app holds under its own service.
  static func allChannels() -> [String] {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecReturnAttributes as String: true,
      kSecMatchLimit as String: kSecMatchLimitAll,
    ]
    var result: AnyObject?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
      let items = result as? [[String: Any]]
    else { return [] }
    let prefix = "channel.token."
    return
      items
      .compactMap { $0[kSecAttrAccount as String] as? String }
      .filter { $0.hasPrefix(prefix) }
      .map { String($0.dropFirst(prefix.count)) }
      .sorted()
  }

  static func delete(for channelId: String) {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account(channelId),
    ]
    SecItemDelete(query as CFDictionary)
  }

  /// True when a failure came from the capability gate rather than anything
  /// the user could fix by retrying. The DO answers with a JSON `error` body
  /// that MCP relays as tool-error text.
  static func isProtectionFailure(_ message: String) -> Bool {
    message.localizedCaseInsensitiveContains("protected")
      || message.localizedCaseInsensitiveContains("valid token")
  }
}
