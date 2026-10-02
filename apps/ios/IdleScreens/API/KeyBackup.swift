import Foundation

/// Every key on this device as one private document — the "back up all"
/// escape hatch for anything iCloud Keychain does not cover (another Apple ID,
/// a password manager, a printout in a drawer).
///
/// Plain text on purpose: readable in ten years without this app, and each
/// key is written as the app's own handoff link, so restoring one is a tap
/// (`ChannelTokenFormat.handoff(from:)` parses exactly this shape).
enum KeyBackup {
    struct Entry: Equatable {
        let channelId: String
        let label: String
        let role: String?
        let token: String
    }

    static func document(_ entries: [Entry], generatedAt: Date = Date()) -> String {
        let stamp = generatedAt.formatted(.iso8601.year().month().day())
        var lines = [
            "idle screens — channel keys",
            "Backed up \(stamp). \(entries.count) \(entries.count == 1 ? "key" : "keys").",
            "",
            "KEEP THIS PRIVATE. Each key below gives full control of its channel to",
            "whoever holds it. To restore one, open its link on a device with idle",
            "screens installed, or paste it into Settings → Add a key.",
            "",
        ]
        for entry in entries.sorted(by: { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }) {
            lines.append("\(entry.label)\(entry.role.map { " (\($0))" } ?? "")")
            lines.append("  channel: \(entry.channelId)")
            lines.append("  key:     \(entry.token)")
            lines.append("  restore: idlescreens://channel/\(entry.channelId)?token=\(entry.token)")
            lines.append("")
        }
        return lines.joined(separator: "\n")
    }

    static func fileName(at date: Date = Date()) -> String {
        "idle-screens-keys-\(date.formatted(.iso8601.year().month().day())).txt"
    }
}
