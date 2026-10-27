import Foundation
import Observation

// MARK: - Reporting a channel

/// A viewer flagging a channel's content (App Review guideline 1.2: channels
/// are agent-authored, so the app must let a person report one and get it
/// out of their sight).
///
/// The report rides the server's existing intake, `submitFeedback`, which a
/// person reads. That board is public, so a report carries only words the
/// app wrote — the channel, the reason picked from a fixed list, the device —
/// and never anything the viewer typed. Swap `MCPClient.reportChannel` for a
/// private route when the server has one; nothing else needs to change.
enum ContentReport {
    enum Reason: String, CaseIterable, Identifiable, Sendable {
        case sexual
        case violent
        case hateful
        case harassment
        case infringement
        case misleading
        case other

        var id: String { rawValue }

        /// What the viewer picks from.
        var title: String {
            switch self {
            case .sexual: "Sexual or nude content"
            case .violent: "Violent or graphic"
            case .hateful: "Hateful or abusive"
            case .harassment: "Targets a real person"
            case .infringement: "Uses someone else's work or brand"
            case .misleading: "Spam or misleading"
            case .other: "Something else"
            }
        }
    }

    /// The `submitFeedback` arguments for one report. Pure, so the exact words
    /// that reach the board are pinned by a test.
    static func arguments(channelId: String, label: String?, reason: Reason,
                          surface: String) -> [String: JSONValue] {
        let name = label.flatMap { $0 == channelId || $0.isEmpty ? nil : "\"\($0)\" " } ?? ""
        let body = """
            A viewer reported the channel \(name)(\(channelId)) from the Idle Screens \(surface) app.
            Reason: \(reason.title).
            This is a content report from a person, not an agent finding: review the channel and \
            unlist or remove it if it breaks the content policy.
            """
        return [
            "kind": .string("other"),
            "title": .string("Content report: \(channelId) (\(reason.rawValue))"),
            "body": .string(body),
            "channelId": .string(channelId),
        ]
    }
}

extension MCPClient {
    /// File a viewer's report on a channel. Throws on any refusal, so the UI
    /// never thanks someone for a report that was not recorded.
    func reportChannel(channelId: String, label: String?, reason: ContentReport.Reason) async throws {
        let args = ContentReport.arguments(channelId: channelId, label: label, reason: reason,
                                           surface: identity.surface)
        try await callTool("submitFeedback", arguments: args,
                           intent: "A viewer reported this channel from the Idle Screens \(identity.surface) app")
    }
}

// MARK: - Hiding a channel

/// Channels this viewer never wants to see again, kept on this device.
///
/// Hiding is the immediate half of a report: the server's review takes a
/// person, the viewer's relief should not. Like follows, it is not a server
/// feature — nobody learns what you hid.
@MainActor @Observable
final class HiddenChannels {
    private(set) var ids: Set<String>

    /// Where the list is kept. Injected so tests don't touch UserDefaults.
    struct Storage {
        var load: () -> [String]?
        var save: ([String]) -> Void
    }

    @ObservationIgnored private let storage: Storage

    init(storage: Storage = .userDefaults) {
        self.storage = storage
        ids = Set(storage.load() ?? [])
    }

    func isHidden(_ channelId: String) -> Bool { ids.contains(channelId) }

    func hide(_ channelId: String) {
        guard ids.insert(channelId).inserted else { return }
        storage.save(ids.sorted())
    }

    func unhide(_ channelId: String) {
        guard ids.remove(channelId) != nil else { return }
        storage.save(ids.sorted())
    }

    /// The channels this viewer has not hidden, order kept.
    func visible(_ channels: [PublicChannel]) -> [PublicChannel] {
        ids.isEmpty ? channels : channels.filter { !ids.contains($0.id) }
    }
}

extension HiddenChannels.Storage {
    private static let key = "hiddenChannels.v1"

    static var userDefaults: HiddenChannels.Storage {
        HiddenChannels.Storage(
            load: { UserDefaults.standard.stringArray(forKey: key) },
            save: { UserDefaults.standard.set($0, forKey: key) }
        )
    }

    /// For tests and previews.
    static var inMemory: HiddenChannels.Storage {
        let box = Locked<[String]>([])
        return HiddenChannels.Storage(load: { box.withLock { $0 } },
                                      save: { ids in box.withLock { $0 = ids } })
    }
}
