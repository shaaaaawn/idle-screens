import AppIntents
import Foundation
import WidgetKit

/// The app's half of the widgets and Control Center control: keeping
/// `RemoteSnapshot` current, and making the sends only the app can make
/// (a private channel, whose viewer key it mints and seals per screen).
extension AppState {
    /// How many channels the snapshot offers. A large widget shows nine.
    static let remoteChannelLimit = 16

    /// Rewrite the snapshot from what the app knows now, then ask WidgetKit
    /// to redraw. Cheap: called on every pairing change, after the wall
    /// loads and whenever the app leaves the foreground.
    func refreshRemoteSnapshot() {
        let prior = RemoteSnapshot.load()
        // A send made from a widget since the app last looked: the screens
        // that took it show that channel now, and the app adopts it.
        if let sent = prior?.lastSend {
            var changed = false
            for i in pairedScreens.indices where sent.delivered.contains(pairedScreens[i].deviceId) {
                if (pairedScreens[i].lastDeliveredAt ?? .distantPast) < sent.at {
                    pairedScreens[i].channelId = sent.channelId
                    pairedScreens[i].lastDeliveredAt = sent.at
                    changed = true
                }
            }
            if changed {
                UserDefaults.standard.set(try? JSONEncoder().encode(pairedScreens), forKey: Self.pairedScreensKey)
            }
        }

        let snapshot = RemoteSnapshot(
            baseURL: Config.baseURL,
            screens: pairedScreens.map { screen in
                .init(deviceId: screen.deviceId, label: screen.kind.label, icon: screen.kind.icon,
                      channelId: screen.channelId,
                      channelLabel: screen.channelId.flatMap { id in channels.first { $0.id == id }?.label })
            },
            channels: remoteChannels(),
            lastSend: prior?.lastSend,
            writtenAt: Date(),
            castScreens: castTargets)
        // Unchanged apart from the stamp: leave the widgets alone.
        if let prior, prior.screens == snapshot.screens, prior.channels == snapshot.channels,
           prior.baseURL == snapshot.baseURL, prior.castScreens == snapshot.castScreens { return }
        snapshot.save()
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// The quick list, best first: your follows, your own channels, then the
    /// wall's featured and busiest — de-duplicated, hidden channels left out.
    func remoteChannels() -> [RemoteSnapshot.Channel] {
        var seen = Set<String>()
        var out: [RemoteSnapshot.Channel] = []
        func add(_ id: String, _ label: String?) {
            guard !seen.contains(id), !hidden.isHidden(id) else { return }
            seen.insert(id)
            let row = channels.first { $0.id == id }
            out.append(.init(id: id, label: row?.label ?? label ?? id,
                             isPrivate: Self.needsAppToSend(access: row?.access, holdsKey: token(for: id) != nil)))
        }
        for id in follows.followed.sorted() { add(id, nil) }
        for credential in credentials { add(credential.channelId, credential.label) }
        let wall = channels.filter { $0.access != "private" }
        let featured = wall.filter { $0.tags?.contains("featured") == true }
        let busiest = wall.sorted { ($0.viewers ?? 0) > ($1.viewers ?? 0) }
        for row in featured + busiest where out.count < Self.remoteChannelLimit { add(row.id, row.label) }
        return Array(out.prefix(Self.remoteChannelLimit))
    }

    /// A channel the widget must hand to the app: private (its key is sealed
    /// per screen here), or one whose access the wall hasn't told us while we
    /// hold its key — it may be private, and a TV without the key shows nothing.
    nonisolated static func needsAppToSend(access: String?, holdsKey: Bool) -> Bool {
        if access == "private" { return true }
        return access == nil && holdsKey
    }

    /// `idlescreens://send/<channel>[?screen=<id>]` — a widget tile for a
    /// channel the extension can't send. Every screen unless one is named.
    func handleRemoteLink(_ url: URL) -> Bool {
        guard let link = ScreenRemote.parseAppLink(url) else { return false }
        Task {
            // No screen named (a widget set to none): the screens you chose last.
            let ids = link.screenId.map { [$0] } ?? castTargets
            let started = Date()
            _ = await push(channelId: link.channelId, sceneId: nil, to: ids)
            var snapshot = RemoteSnapshot.load()
            let label = channels.first { $0.id == link.channelId }?.displayLabel ?? link.channelId
            // A delivered push stamps the screen; that is the proof it took this one.
            let delivered = pairedScreens.filter { ids.contains($0.deviceId) && ($0.lastDeliveredAt ?? .distantPast) >= started }
                .map(\.deviceId)
            snapshot?.record(SendOutcome(channelId: link.channelId, channelLabel: label, delivered: delivered,
                                         asked: ids.count, unanswered: [], at: Date()))
            snapshot?.save()
            refreshRemoteSnapshot()
            WidgetCenter.shared.reloadAllTimelines()
        }
        return true
    }
}

/// Siri, Shortcuts, Spotlight and the Action button.
struct IdleScreensShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: SendChannelIntent(),
                    phrases: [
                        "Show \(\.$channel) on my \(.applicationName) screens",
                        "Put \(\.$channel) on \(.applicationName)",
                        "Next channel on \(.applicationName)",
                        "Change the channel on \(.applicationName)",
                    ],
                    shortTitle: "Send to Screens",
                    systemImageName: "tv")
    }
}
