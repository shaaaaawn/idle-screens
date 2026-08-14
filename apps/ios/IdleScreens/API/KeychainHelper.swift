import Foundation
import Security

/// Thin wrapper over the iOS Keychain for channel capability tokens.
/// Pattern matches farco-bolo's KeychainHelper (service-scoped generic passwords).
///
/// Items are stored **synchronizable**, so they ride iCloud Keychain to the
/// user's other devices. Without it a token lives on exactly one phone: an iPad
/// signed into the same account sees channels it cannot steer, and a device set
/// up from an iCloud Backup (which does not carry the Keychain the way an
/// encrypted Finder backup does) arrives with the channel list restored from
/// UserDefaults and no credentials to go with it.
enum KeychainHelper {
    private static let service = "com.hermosalabs.idlescreens"

    /// `kSecAttrSynchronizable` is part of the **query predicate**, not just an
    /// attribute: an item written without it is invisible to a query that asks
    /// for it, and vice versa. That makes a naive flag flip look like total
    /// data loss, so reads fall back to the local-only item and migrate it.
    private static func baseQuery(key: String, synchronizable: Bool) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecAttrSynchronizable as String: synchronizable,
        ]
    }

    @discardableResult
    static func save(key: String, value: String) -> Bool {
        guard let data = value.data(using: .utf8) else { return false }

        // Clear both variants so a migrated item can't leave a stale local twin
        // that a later read would prefer.
        SecItemDelete(baseQuery(key: key, synchronizable: true) as CFDictionary)
        SecItemDelete(baseQuery(key: key, synchronizable: false) as CFDictionary)

        var attrs = baseQuery(key: key, synchronizable: true)
        attrs[kSecValueData as String] = data
        // Required for synchronizable items, and already what we used.
        attrs[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(attrs as CFDictionary, nil)

        if status != errSecSuccess {
            print("[KeychainHelper] Failed to save '\(key)': OSStatus \(status)")
            return false
        }
        return true
    }

    static func load(key: String) -> String? {
        if let synced = read(key: key, synchronizable: true) { return synced }
        // Written before sync existed. Read it, then rewrite it synchronized so
        // the migration happens once, silently, on first access.
        guard let local = read(key: key, synchronizable: false) else { return nil }
        _ = save(key: key, value: local)
        return local
    }

    private static func read(key: String, synchronizable: Bool) -> String? {
        var query = baseQuery(key: key, synchronizable: synchronizable)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(key: String) {
        SecItemDelete(baseQuery(key: key, synchronizable: true) as CFDictionary)
        SecItemDelete(baseQuery(key: key, synchronizable: false) as CFDictionary)
    }
}
