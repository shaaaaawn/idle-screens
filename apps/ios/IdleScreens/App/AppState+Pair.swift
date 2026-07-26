import Foundation

/// The TV this phone is paired with. Metadata lives in UserDefaults; the
/// `isp_` push token lives in the Keychain (same split as ChannelCredential).
struct PairedTV: Codable, Equatable, Sendable {
    let deviceId: String
    /// Last channel the TV was known to be watching.
    var channelId: String?
    let pairedAt: Date
}

extension AppState {
    static let pairedTVKey = "paired_tv"
    static let pairTokenKeychainKey = "pair.token"

    // MARK: Persistence

    static func loadPairedTV(from defaults: UserDefaults = .standard) -> PairedTV? {
        guard let data = defaults.data(forKey: pairedTVKey) else { return nil }
        return try? JSONDecoder().decode(PairedTV.self, from: data)
    }

    private func savePairedTV() {
        if let pairedTV {
            UserDefaults.standard.set(try? JSONEncoder().encode(pairedTV), forKey: Self.pairedTVKey)
        } else {
            UserDefaults.standard.removeObject(forKey: Self.pairedTVKey)
        }
    }

    var pairToken: String? {
        KeychainHelper.load(key: Self.pairTokenKeychainKey)
    }

    // MARK: Claiming

    /// Extract a pair code from a pairing link. Accepts the universal link
    /// (`https://idlescreens.com/pair/<code>`) and the custom scheme
    /// (`idlescreens://pair/<code>`).
    static func pairCode(from url: URL) -> String? {
        let parts = url.pathComponents.filter { $0 != "/" }
        if url.scheme == "idlescreens" {
            // idlescreens://pair/<code> — "pair" is the host, the code the path.
            if url.host == "pair", let code = parts.first { return code }
        }
        if let i = parts.firstIndex(of: "pair"), parts.indices.contains(i + 1) {
            return parts[i + 1]
        }
        return nil
    }

    /// Claim a scanned/typed pair code. On success the phone owns a push
    /// token for the TV and knows which channel it is watching.
    @discardableResult
    func claimPairCode(_ rawCode: String) async -> Bool {
        let code = rawCode.uppercased().filter { $0.isLetter || $0.isNumber }
        guard !code.isEmpty else { return false }
        isPairing = true
        defer { isPairing = false }
        do {
            let claimed = try await pairClient.claim(code: code)
            KeychainHelper.save(key: Self.pairTokenKeychainKey, value: claimed.pairToken)
            pairedTV = PairedTV(deviceId: claimed.deviceId, channelId: claimed.channelId, pairedAt: Date())
            savePairedTV()
            pairPushError = nil
            return true
        } catch {
            pairPushError = error.localizedDescription
            return false
        }
    }

    func unpairTV() {
        pairedTV = nil
        savePairedTV()
        KeychainHelper.delete(key: Self.pairTokenKeychainKey)
        pairPushError = nil
    }

    // MARK: Steering

    /// Push a channel to the paired TV over its live channel socket.
    @discardableResult
    func pushToTV(channelId: String) async -> Bool {
        guard let token = pairToken else { return false }
        isPairing = true
        defer { isPairing = false }
        do {
            try await pairClient.push(pairToken: token, channelId: channelId)
            if pairedTV != nil {
                pairedTV?.channelId = channelId
                savePairedTV()
            }
            pairPushError = nil
            return true
        } catch {
            pairPushError = error.localizedDescription
            return false
        }
    }

    /// Refresh which channel the TV is watching (it can change under us —
    /// someone with the Siri Remote, or another paired phone).
    func refreshTVStatus() async {
        guard let token = pairToken else { return }
        guard let status = try? await pairClient.status(pairToken: token) else { return }
        if pairedTV != nil {
            pairedTV?.channelId = status.channelId
            savePairedTV()
        }
    }
}
