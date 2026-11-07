import CryptoKit
import Foundation
import Security

/// Handing a paired screen the viewer key for a private channel.
///
/// A TV cannot type a key, and tvOS does not sync the Keychain through iCloud,
/// so a key held on the phone never reaches the TV on its own. The phone
/// sends it through pairing instead (idle-server `capability-auth.md`,
/// "Native screens, and a key for a TV"):
///
/// - The screen gives its X25519 public key with its pair code
///   (`/api/pair/new`), and the claim hands it to the phone.
/// - The phone seals a VIEWER key to it with HPKE and sends the blob with
///   its push (`/api/pair/push` `sealedKey`).
/// - The server relays the blob unread inside the `switch` frame. That frame
///   goes to every socket claiming the screen's device id on its current
///   channel, and a device id is no proof, so the key must not be readable
///   there. Sealed, it opens only with this screen's private key, and only
///   for the device and channel it was sealed for (both are in HPKE's info).
enum PairKeySeal {
    static let suite = HPKE.Ciphersuite.Curve25519_SHA256_ChachaPoly

    enum SealError: LocalizedError, Equatable {
        case badPublicKey
        var errorDescription: String? { "The screen's key is not readable. Pair it again." }
    }

    /// HPKE's info: what the key is for, and for whom. A blob replayed to
    /// another device, or relabelled for another channel, does not open.
    static func info(deviceId: String, channelId: String) -> Data {
        var data = Data("idlescreens pair key v1".utf8)
        data.append(0)
        data.append(Data(deviceId.utf8))
        data.append(0)
        data.append(Data(channelId.utf8))
        return data
    }

    /// The blob for `/api/pair/push`: the encapsulated key, then the
    /// ciphertext, as unpadded base64url.
    static func seal(token: String, to publicKey: String, deviceId: String, channelId: String) throws -> String {
        guard let raw = Base64URL.decode(publicKey), raw.count == 32,
              let key = try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: raw) else {
            throw SealError.badPublicKey
        }
        var sender = try HPKE.Sender(recipientKey: key, ciphersuite: suite,
                                     info: info(deviceId: deviceId, channelId: channelId))
        let ciphertext = try sender.seal(Data(token.utf8))
        return Base64URL.encode(sender.encapsulatedKey + ciphertext)
    }

    /// The viewer key inside a blob, or nil: not for this screen, this
    /// channel, or not a viewer key at all. A screen never accepts more than
    /// it needs to watch, whatever a phone sends.
    static func open(_ sealed: String, with privateKey: Curve25519.KeyAgreement.PrivateKey,
                     deviceId: String, channelId: String) -> String? {
        guard let blob = Base64URL.decode(sealed), blob.count > 32,
              var recipient = try? HPKE.Recipient(privateKey: privateKey, ciphersuite: suite,
                                                  info: info(deviceId: deviceId, channelId: channelId),
                                                  encapsulatedKey: Data(blob.prefix(32))),
              let plaintext = try? recipient.open(Data(blob.dropFirst(32))),
              let token = String(data: plaintext, encoding: .utf8),
              token.hasPrefix("isk_view_"), ChannelTokenFormat.isWellFormedToken(token) else {
            return nil
        }
        return token
    }
}

/// Unpadded base64url (RFC 4648 §5), the form the server checks.
enum Base64URL {
    static func encode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func decode(_ text: String) -> Data? {
        guard text.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }) else { return nil }
        var base64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        return Data(base64Encoded: base64)
    }
}

/// This screen's own pairing key: minted once, kept in the Keychain, never
/// synced and never in a backup that leaves the device
/// (`…AfterFirstUnlockThisDeviceOnly`). Separate from `KeychainHelper`, which
/// writes every item synchronizable — right for channel keys a person carries
/// between their phones, wrong for a key that IS this device.
enum ScreenKey {
    private static let service = "com.hermosalabs.idlescreens.screen-key"
    private static let account = "pair.screen-key.v1"

    private static var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: false,
        ]
    }

    /// The key, minting and storing it the first time. nil only when the
    /// Keychain will not hold it, in which case pairing goes ahead without
    /// one (the screen switches channels but cannot be sent a key).
    static func privateKey() -> Curve25519.KeyAgreement.PrivateKey? {
        var read = query
        read[kSecReturnData as String] = true
        read[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        if SecItemCopyMatching(read as CFDictionary, &result) == errSecSuccess,
           let data = result as? Data,
           let key = try? Curve25519.KeyAgreement.PrivateKey(rawRepresentation: data) {
            return key
        }
        let key = Curve25519.KeyAgreement.PrivateKey()
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = key.rawRepresentation
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(add as CFDictionary, nil) == errSecSuccess else { return nil }
        return key
    }

    /// The public half, as `/api/pair/new` takes it.
    static func publicKey() -> String? {
        privateKey().map { Base64URL.encode($0.publicKey.rawRepresentation) }
    }
}
