import Foundation

/// What the widgets, the Control Center control and Shortcuts know about this
/// phone's screens: the app writes it whenever its screens, follows or keys
/// change, and the extension reads it to draw tiles and to send. It lives in
/// the Keychain (device-only, the app's shared access group) rather than an
/// App Group, which would need a new identifier and new provisioning profiles.
///
/// Nothing secret is in it: each screen's push token stays in its own Keychain
/// item (`pair.token.<deviceId>`), read only at the moment of a send.
struct RemoteSnapshot: Codable, Equatable, Sendable {
    struct Screen: Codable, Equatable, Identifiable, Sendable {
        let deviceId: String
        /// "Apple TV", "Mac" or "Linux".
        var label: String
        /// SF Symbol for the kind.
        var icon: String
        /// The channel it was last told to show.
        var channelId: String?
        /// That channel's name, when the app knows it.
        var channelLabel: String? = nil
        var id: String { deviceId }
    }

    struct Channel: Codable, Equatable, Identifiable, Sendable {
        let id: String
        var label: String
        /// A private channel needs a viewer key sealed to each TV, which only
        /// the app can mint — so it is sent from the app, never the widget.
        var isPrivate: Bool
    }

    /// The server the app talks to (a lane build points both at the lane).
    var baseURL: String
    var screens: [Screen]
    /// Quick channels, best first: followed, your own, then the wall.
    var channels: [Channel]
    /// The last send from a widget or shortcut, for the widget to report.
    var lastSend: SendOutcome?
    var writtenAt: Date
    /// The screens you last chose in the app's "Send to screens" — what a
    /// widget, control or shortcut that names no screen sends to. nil in a
    /// snapshot written before this existed.
    var castScreens: [String]? = nil

    static let keychainKey = "remote.snapshot"

    static func load() -> RemoteSnapshot? {
        guard let data = KeychainHelper.loadLocal(key: keychainKey) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        return try? decoder.decode(RemoteSnapshot.self, from: data)
    }

    @discardableResult
    func save() -> Bool {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        guard let data = try? encoder.encode(self) else { return false }
        return KeychainHelper.saveLocal(key: Self.keychainKey, data: data)
    }

    func channel(_ id: String) -> Channel? { channels.first { $0.id == id } }

    /// Where a send that names no screen goes: the screens chosen last in the
    /// app, still paired; every paired screen when none of those is left.
    var defaultTargets: [String] {
        Self.targets(remembered: castScreens ?? [], paired: screens.map(\.deviceId))
    }

    /// The one rule the app (`AppState.castTargets`) and the extension share.
    static func targets(remembered: [String], paired: [String]) -> [String] {
        let kept = paired.filter(remembered.contains)
        return kept.isEmpty ? paired : kept
    }

    /// The screens a send goes to: the named one, else `defaultTargets`.
    func targets(for screenId: String?) -> [String] {
        screenId.map { id in screens.contains { $0.deviceId == id } ? [id] : [] } ?? defaultTargets
    }

    /// A channel's name: from the quick list, else from a screen showing it.
    func label(of id: String) -> String {
        channel(id)?.label ?? screens.first { $0.channelId == id }?.channelLabel ?? id
    }

    /// Quick channels in the app's order. Deliberately not re-sorted by what
    /// was just sent: a tile must not jump away from the finger that tapped it.
    var quickChannels: [Channel] { channels }

    /// After a send: the screens that took it now show the channel.
    mutating func record(_ outcome: SendOutcome) {
        lastSend = outcome
        for i in screens.indices where outcome.delivered.contains(screens[i].deviceId) {
            screens[i].channelId = outcome.channelId
            screens[i].channelLabel = outcome.channelLabel
        }
    }
}

/// What one send did, worded for a widget line.
struct SendOutcome: Codable, Equatable, Sendable {
    let channelId: String
    let channelLabel: String
    /// Screens that took it.
    let delivered: [String]
    /// Screens that were asked.
    let asked: Int
    /// Screens that answered 409: paired, but nobody home.
    let unanswered: [String]
    let at: Date

    var message: String {
        if asked == 0 { return "No screens paired" }
        if delivered.count == asked { return asked == 1 ? "On your screen" : "On \(asked) screens" }
        if delivered.isEmpty {
            return unanswered.isEmpty ? "Couldn't reach your screens" : "Screens aren't answering"
        }
        return "On \(delivered.count) of \(asked) screens"
    }

    var succeeded: Bool { !delivered.isEmpty }
}
