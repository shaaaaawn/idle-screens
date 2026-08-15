import Foundation

/// A screen this phone can steer — Apple TV, Mac, or Linux display.
/// Metadata lives in UserDefaults; each screen's `isp_` push token lives in
/// the Keychain, keyed by device id (same split as ChannelCredential).
struct PairedScreen: Codable, Equatable, Identifiable, Sendable {
    let deviceId: String
    /// Last channel this screen was known to be watching.
    var channelId: String?
    let pairedAt: Date
    /// Server's last-seen stamp (epoch ms) — drives the live online dot.
    var lastSeenAt: Int?

    var id: String { deviceId }

    /// Native hosts stamp their platform into the device id (`mac-…`,
    /// `linux-…`); tvOS mints a bare UUID.
    enum Kind: String, Codable, Sendable {
        case appleTV, mac, linux

        var label: String {
            switch self {
            case .appleTV: "Apple TV"
            case .mac: "Mac"
            case .linux: "Linux"
            }
        }

        var icon: String {
            switch self {
            case .appleTV: "appletv"
            case .mac: "menubar.rectangle"
            case .linux: "desktopcomputer"
            }
        }
    }

    var kind: Kind {
        if deviceId.hasPrefix("mac-") { return .mac }
        if deviceId.hasPrefix("linux-") { return .linux }
        return .appleTV
    }

    /// Seconds since the server last saw this screen attach, or nil if never.
    ///
    /// NOTE: the server stamps `lastSeenAt` when a screen's socket *connects*,
    /// not continuously — so a healthy screen holding one stable socket keeps
    /// an old stamp while a flapping one looks fresh. Freshness therefore
    /// can't mean "online"; it means "we know it reached us at least once".
    /// A tighter signal needs the server to report live socket presence.
    var lastSeenAge: TimeInterval? {
        guard let lastSeenAt else { return nil }
        return Date().timeIntervalSince1970 - Double(lastSeenAt) / 1000
    }

    /// Has this screen ever registered? Never-seen means pairing didn't take
    /// (the screen isn't running, or is too old to hold a control socket).
    var hasRegistered: Bool { lastSeenAt != nil }

    /// Human status line for the card.
    var statusText: String {
        guard let age = lastSeenAge else { return "not connected yet" }
        if let channelId, !channelId.isEmpty { return "▸ \(channelId)" }
        if age < 90 { return "connected" }
        return "seen \(Self.ago(age))"
    }

    static func ago(_ seconds: TimeInterval) -> String {
        if seconds < 90 { return "just now" }
        if seconds < 3600 { return "\(Int(seconds / 60))m ago" }
        if seconds < 86_400 { return "\(Int(seconds / 3600))h ago" }
        return "\(Int(seconds / 86_400))d ago"
    }

    var shortId: String { String(deviceId.suffix(6)) }
}

extension AppState {
    static let pairedScreensKey = "paired_screens"
    /// Pre-multi-screen single-TV storage, migrated on first load.
    static let legacyPairedTVKey = "paired_tv"
    static let legacyPairTokenKey = "pair.token"

    static func pairTokenKey(for deviceId: String) -> String { "pair.token.\(deviceId)" }

    // MARK: Persistence

    static func loadPairedScreens(from defaults: UserDefaults = .standard) -> [PairedScreen] {
        if let data = defaults.data(forKey: pairedScreensKey),
           let screens = try? JSONDecoder().decode([PairedScreen].self, from: data) {
            return screens
        }
        // Migrate the single-TV pairing (token moves to a per-device key).
        if let data = defaults.data(forKey: legacyPairedTVKey),
           let legacy = try? JSONDecoder().decode(PairedScreen.self, from: data) {
            if let token = KeychainHelper.load(key: legacyPairTokenKey) {
                KeychainHelper.save(key: pairTokenKey(for: legacy.deviceId), value: token)
                KeychainHelper.delete(key: legacyPairTokenKey)
            }
            defaults.removeObject(forKey: legacyPairedTVKey)
            defaults.set(try? JSONEncoder().encode([legacy]), forKey: pairedScreensKey)
            return [legacy]
        }
        return []
    }

    func savePairedScreens() {
        UserDefaults.standard.set(try? JSONEncoder().encode(pairedScreens), forKey: Self.pairedScreensKey)
    }

    func token(forScreen deviceId: String) -> String? {
        KeychainHelper.load(key: Self.pairTokenKey(for: deviceId))
    }

    // MARK: Claiming

    /// Extract a pair code from a pairing link. Accepts the universal link
    /// (`https://idlescreens.com/pair/<code>`) and the custom scheme
    /// (`idlescreens://pair/<code>`).
    static func pairCode(from url: URL) -> String? {
        PairCodeFormat.pairCode(fromURL: url)
    }

    /// Claim a scanned/typed pair code, adding (or refreshing) that screen.
    /// Multiple screens can be paired at once — one phone, every display.
    @discardableResult
    func claimPairCode(_ rawCode: String) async -> Bool {
        // Normalising HERE rather than in the view means every entry point —
        // typed, pasted, scanned, universal link — gets URL unwrapping and
        // alphabet filtering for free.
        guard let code = PairCodeFormat.normalize(rawCode) else {
            pairClaimError = "That doesn't look like a pairing code."
            return false
        }
        isPairing = true
        defer { isPairing = false }
        do {
            let claimed = try await pairClient.claim(code: code)
            KeychainHelper.save(
                key: Self.pairTokenKey(for: claimed.deviceId), value: claimed.pairToken)
            let screen = PairedScreen(
                deviceId: claimed.deviceId,
                channelId: claimed.channelId,
                pairedAt: Date(),
                lastSeenAt: Int(Date().timeIntervalSince1970 * 1000))
            // Re-pairing the same screen refreshes it rather than duplicating.
            if let index = pairedScreens.firstIndex(where: { $0.deviceId == claimed.deviceId }) {
                pairedScreens[index] = screen
            } else {
                pairedScreens.append(screen)
            }
            savePairedScreens()
            pairClaimError = nil
            pairPushError = nil
            // Ack the pairing on the TV: a same-channel push is a no-op
            // switch, but its arrival over the socket is the TV's cue to
            // show its "✓ Paired" moment. Fire-and-forget — pairing already
            // succeeded even if the TV isn't listening right now.
            if let channelId = claimed.channelId, !channelId.isEmpty {
                let token = claimed.pairToken
                Task { [pairClient] in
                    _ = try? await pairClient.push(pairToken: token, channelId: channelId)
                }
            }
            await refreshScreenStatuses()
            return true
        } catch {
            // Claim failures are almost always a wrong/expired code (or the
            // service being unreachable) — say that, not "HTTP 404". Kept in
            // its OWN field: a failed push must not greet the user as a stale
            // error the next time they open "Add a screen".
            if let pairError = error as? PairError, case .httpError = pairError {
                pairClaimError = "That code didn't work. It may have expired — your screen can show a fresh one."
            } else {
                pairClaimError = error.localizedDescription
            }
            return false
        }
    }

    func unpair(_ screen: PairedScreen) {
        pairedScreens.removeAll { $0.deviceId == screen.deviceId }
        savePairedScreens()
        KeychainHelper.delete(key: Self.pairTokenKey(for: screen.deviceId))
        pairPushError = nil
    }

    func unpairAllScreens() {
        for screen in pairedScreens {
            KeychainHelper.delete(key: Self.pairTokenKey(for: screen.deviceId))
        }
        pairedScreens = []
        savePairedScreens()
        pairPushError = nil
    }

    // MARK: Steering

    /// Push a channel to one screen.
    @discardableResult
    func push(channelId: String, to screen: PairedScreen) async -> Bool {
        guard let token = token(forScreen: screen.deviceId) else { return false }
        isPairing = true
        defer { isPairing = false }
        do {
            try await pairClient.push(pairToken: token, channelId: channelId)
            if let index = pairedScreens.firstIndex(where: { $0.deviceId == screen.deviceId }) {
                pairedScreens[index].channelId = channelId
                savePairedScreens()
            }
            pairPushError = nil
            return true
        } catch {
            pairPushError = error.localizedDescription
            return false
        }
    }

    /// Push to every paired screen — the "put this everywhere" action.
    /// Returns how many screens accepted it.
    @discardableResult
    func pushToAllScreens(channelId: String) async -> Int {
        var delivered = 0
        for screen in pairedScreens where await push(channelId: channelId, to: screen) {
            delivered += 1
        }
        return delivered
    }

    /// Refresh every screen's channel + last-seen stamp, concurrently. The
    /// Screens tab polls this so the online dots stay live while it's open.
    func refreshScreenStatuses() async {
        let screens = pairedScreens
        guard !screens.isEmpty else { return }
        await withTaskGroup(of: (String, PairStatus?).self) { group in
            for screen in screens {
                guard let token = token(forScreen: screen.deviceId) else { continue }
                group.addTask { [pairClient] in
                    (screen.deviceId, try? await pairClient.status(pairToken: token))
                }
            }
            for await (deviceId, status) in group {
                guard let status,
                      let index = pairedScreens.firstIndex(where: { $0.deviceId == deviceId })
                else { continue }
                pairedScreens[index].channelId = status.channelId
                pairedScreens[index].lastSeenAt = status.lastSeenAt
            }
        }
        savePairedScreens()
    }
}

#if DEBUG
extension AppState {
    /// QA affordance for `-seed-screens`: one paired screen per platform,
    /// with the Linux one stale so the offline state is visible too.
    func seedDemoScreens() {
        let now = Int(Date().timeIntervalSince1970 * 1000)
        pairedScreens = [
            PairedScreen(deviceId: "demo-appletv-0001", channelId: "aurora-drift",
                         pairedAt: Date(), lastSeenAt: now),
            PairedScreen(deviceId: "mac-demo-0002", channelId: "lobby",
                         pairedAt: Date(), lastSeenAt: now),
            PairedScreen(deviceId: "linux-demo-0003", channelId: nil,
                         pairedAt: Date(), lastSeenAt: now - 600_000),
        ]
        savePairedScreens()
    }
}
#endif
