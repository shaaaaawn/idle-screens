import Foundation

/// The "steered 36m ago · curl · glm-5.3" line under a channel card.
///
/// A deliberate port of `site/src/lib/time.ts` (`agoLabel`, `namedActor`,
/// `distinctAttr`) so a card reads the same on the phone as on the wall. The
/// rules exist because the naive version is noise:
///
/// - Every card once read "steered 1d ago BY AGENT" — `agent` is the server's
///   default for an unattributed call, so it names nobody and is dropped.
/// - Agents often pass `agent: "pi"` while the harness is also `pi`, which
///   printed "pi · pi · glm". A label survives only if it adds a fact.
enum SteerLine {
    static func ago(_ atMs: Int, now: Date = Date()) -> String {
        let seconds = max(0, Int(now.timeIntervalSince1970) - atMs / 1000)
        if seconds < 60 { return "just now" }
        if seconds < 3600 { return "\(seconds / 60)m ago" }
        if seconds < 86_400 { return "\(seconds / 3600)h ago" }
        return "\(seconds / 86_400)d ago"
    }

    /// `agent` is the unattributed default, not a name.
    static func namedActor(_ actor: String?) -> String? {
        guard let actor, !actor.isEmpty, actor != "agent" else { return nil }
        return actor
    }

    /// Keep a label only when the line doesn't already say it.
    static func distinct(_ value: String?, from seen: String?...) -> String? {
        guard let value, !value.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        let needle = value.trimmingCharacters(in: .whitespaces).lowercased()
        for other in seen where other?.trimmingCharacters(in: .whitespaces).lowercased() == needle {
            return nil
        }
        return value
    }

    /// nil when the channel has never been steered — no line beats a fake one.
    static func text(for channel: PublicChannel, now: Date = Date()) -> String? {
        guard let at = channel.lastEventAt, at > 0 else { return nil }
        let by = namedActor(channel.lastSteer?.actor)
        let via = distinct(channel.lastSteer?.harness, from: by)
        let on = distinct(channel.lastSteer?.model, from: by, via)
        return (["steered \(ago(at, now: now))"] + [via, on].compactMap { $0 })
            .joined(separator: " · ")
    }

    /// The card's version: who, on what, when — in the order a narrow card
    /// truncates least harmfully. The web's sentence ("steered 13d ago ·
    /// claude-code · claude-op…") loses the model first, which is the part
    /// people browse by. The harness is dropped here; the feed shows it.
    static func cardLine(for channel: PublicChannel, now: Date = Date()) -> String? {
        guard let at = channel.lastEventAt, at > 0 else { return nil }
        let by = namedActor(channel.lastSteer?.actor)
        let on = distinct(channel.lastSteer?.model, from: by)
        return ([by, on].compactMap { $0 } + [ago(at, now: now)]).joined(separator: " · ")
    }
}
