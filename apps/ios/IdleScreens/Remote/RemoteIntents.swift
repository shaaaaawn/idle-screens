import AppIntents
import WidgetKit

// MARK: - Entities

/// A channel the widgets and shortcuts can send: the app's quick list
/// (follows, your own channels, the wall) from `RemoteSnapshot`.
struct ChannelEntity: AppEntity, Sendable {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Channel"
    static let defaultQuery = ChannelQuery()

    let id: String
    let label: String

    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(label)") }

    init(id: String, label: String) { self.id = id; self.label = label }
    init(_ channel: RemoteSnapshot.Channel) { self.init(id: channel.id, label: channel.label) }
}

struct ChannelQuery: EntityStringQuery {
    /// Private channels are sent from the app (it seals their key), so they
    /// are not offered where only the extension would run the send.
    private var sendable: [RemoteSnapshot.Channel] {
        (RemoteSnapshot.load()?.quickChannels ?? []).filter { !$0.isPrivate }
    }

    func entities(for identifiers: [String]) async throws -> [ChannelEntity] {
        let snapshot = RemoteSnapshot.load()
        return identifiers.map { id in
            ChannelEntity(id: id, label: snapshot?.channel(id)?.label ?? id)
        }
    }

    func entities(matching string: String) async throws -> [ChannelEntity] {
        sendable.filter { $0.label.localizedCaseInsensitiveContains(string) || $0.id.localizedCaseInsensitiveContains(string) }
            .map(ChannelEntity.init)
    }

    func suggestedEntities() async throws -> [ChannelEntity] { sendable.map(ChannelEntity.init) }
}

/// One paired screen. Leaving the screen out of an intent means every screen.
struct ScreenEntity: AppEntity, Sendable {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Screen"
    static let defaultQuery = ScreenQuery()

    let id: String
    let label: String
    let icon: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(label)", image: .init(systemName: icon))
    }

    init(_ screen: RemoteSnapshot.Screen, among screens: [RemoteSnapshot.Screen]) {
        id = screen.deviceId
        // Two Apple TVs read "Apple TV 1a2b3c" and "Apple TV 9f8e7d".
        let twins = screens.filter { $0.label == screen.label }.count > 1
        label = twins ? "\(screen.label) \(screen.deviceId.suffix(6))" : screen.label
        icon = screen.icon
    }
}

struct ScreenQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [ScreenEntity] {
        let screens = RemoteSnapshot.load()?.screens ?? []
        return screens.filter { identifiers.contains($0.deviceId) }.map { ScreenEntity($0, among: screens) }
    }

    func suggestedEntities() async throws -> [ScreenEntity] {
        let screens = RemoteSnapshot.load()?.screens ?? []
        return screens.map { ScreenEntity($0, among: screens) }
    }
}

// MARK: - Send

/// Put a channel on your screens — from a widget tile, the Control Center
/// control, Siri, Shortcuts or the Action button. With no channel it moves
/// the screens on to the next one in the quick list.
struct SendChannelIntent: AppIntent {
    static let title: LocalizedStringResource = "Send a Channel to Your Screens"
    // Intent text must not name Apple products (ITMS-90626 rejected build
    // 2026111701 for "Apple TV, Mac"); AppIntentsMetadataTests guards it.
    static let description = IntentDescription("Shows a channel on your paired screens.")

    @Parameter(title: "Channel", description: "Leave empty to move on to the next channel.")
    var channel: ChannelEntity?

    @Parameter(title: "Screen", description: "Leave empty for the screens you last chose in the app, or every paired screen if none is left.")
    var screen: ScreenEntity?

    init() {}

    init(channel: ChannelEntity?, screen: ScreenEntity?) {
        self.channel = channel
        self.screen = screen
    }

    static var parameterSummary: some ParameterSummary {
        Summary("Show \(\.$channel) on \(\.$screen)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let outcome = try await Self.send(channelId: channel?.id, label: channel?.label, screenId: screen?.id)
        return .result(dialog: "\(outcome.channelLabel) — \(outcome.message.lowercased()).")
    }

    /// The send every surface shares: a channel by id (nil = the next one),
    /// to one screen or all, recorded in the snapshot for the widget to show.
    static func send(channelId: String?, label: String? = nil, screenId: String?) async throws -> SendOutcome {
        guard var snapshot = RemoteSnapshot.load(), !snapshot.screens.isEmpty else {
            throw RemoteError.noScreens
        }
        let target: RemoteSnapshot.Channel
        if let channelId {
            target = snapshot.channel(channelId) ?? .init(id: channelId, label: label ?? channelId, isPrivate: false)
        } else if let next = Self.next(in: snapshot, screen: screenId) {
            target = next
        } else {
            throw RemoteError.noChannels
        }
        if target.isPrivate { throw RemoteError.privateChannel(target.label) }

        let outcome = await ScreenRemote().send(target, to: screenId, in: snapshot)
        snapshot.record(outcome)
        snapshot.save()
        WidgetCenter.shared.reloadAllTimelines()
        guard outcome.succeeded else { throw RemoteError.notDelivered(outcome.message) }
        return outcome
    }

    /// The quick channel after the one the screen (or the first screen) shows.
    static func next(in snapshot: RemoteSnapshot, screen: String?) -> RemoteSnapshot.Channel? {
        let list = snapshot.quickChannels.filter { !$0.isPrivate }
        guard !list.isEmpty else { return nil }
        let targets = snapshot.targets(for: screen)
        let showing = snapshot.screens.first { targets.contains($0.deviceId) }?.channelId
        guard let showing, let at = list.firstIndex(where: { $0.id == showing }) else { return list[0] }
        return list[(at + 1) % list.count]
    }
}

/// A widget tile's or the Control Center control's button. Plain string ids,
/// not entities: an `AppEntity` set on a `Button(intent:)` in a widget arrived
/// at `perform()` as nil (logged "Prepared channel to ChannelEntity(nil)"),
/// so every tile sent "the next channel" whichever one was tapped.
struct SendTileIntent: AppIntent {
    static let title: LocalizedStringResource = "Send a Channel from a Widget"
    static let isDiscoverable = false

    @Parameter(title: "Channel") var channelId: String?
    @Parameter(title: "Screen") var screenId: String?

    init() {}

    init(channelId: String?, screenId: String?) {
        self.channelId = channelId
        self.screenId = screenId
    }

    func perform() async throws -> some IntentResult {
        // The widget shows what happened, so a failure is recorded, not raised.
        _ = try? await SendChannelIntent.send(channelId: channelId, screenId: screenId)
        return .result()
    }
}

enum RemoteError: Error, CustomLocalizedStringResourceConvertible {
    case noScreens
    case noChannels
    case privateChannel(String)
    case notDelivered(String)

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .noScreens: "Pair a screen in idle screens first."
        case .noChannels: "Follow a channel in idle screens first."
        case .privateChannel(let label): "\(label) is private — send it from the idle screens app."
        case .notDelivered(let message): "\(message). Open idle screens on the screen and try again."
        }
    }
}

// MARK: - Widget configuration

/// Which screen a widget steers. Empty means every paired screen.
struct ScreensWidgetIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Screens"
    static let description = IntentDescription("Channels to put on your screens with one tap.")

    @Parameter(title: "Screen", description: "Leave empty for the screens you last chose in the app, or every paired screen if none is left.")
    var screen: ScreenEntity?

    init() {}
}
