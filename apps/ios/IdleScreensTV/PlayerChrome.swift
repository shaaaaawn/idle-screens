import Foundation

/// Every word the player's chrome prints, as pure functions of app state.
/// The view only lays these out — so what the TV says about a scene ("who
/// made this", "you are in the past", "3 of 61") is testable without a
/// television, and cannot drift from the phone's wording unnoticed.
enum PlayerChrome {

    /// "Warp Tunnel · steered 36m ago · pi · glm-5.3" — scene first, then the
    /// shared SteerLine so the TV credits a scene the way the phone and the
    /// website do.
    static func creditLine(for channel: PublicChannel?, now: Date = Date()) -> String? {
        guard let channel else { return nil }
        let parts = [channel.saverLabel, SteerLine.text(for: channel, now: now)]
            .compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// "Earlier · Tidal Drift · 3d ago · spin" — the past scene's own name,
    /// when it aired, and who made it. A relay (the nightly curator, a
    /// schedule) put the scene on air without making it, so it is not
    /// credited as the author.
    static func pastLine(stop: ChannelFeed.Stop?, sceneLabel: String?, now: Date = Date()) -> String {
        guard let event = stop?.event else { return "Earlier" }
        let author = SteerLine.namedActor(event.actor)
        let label = [sceneLabel, event.label].compactMap { $0 }.first { !$0.isEmpty }
        let parts: [String?] = ["Earlier", label, SteerLine.ago(Int(event.at), now: now),
                                SceneCredit.isRelay(author) ? nil : author]
        return parts.compactMap { $0 }.joined(separator: " · ")
    }

    /// The right-hand hint: where you are, and the one key that matters.
    /// nil when there is nothing to say (a lone channel, live).
    static func positionLine(timeline: TVAppState.Timeline, stops: Int,
                             surf: (index: Int, count: Int)?) -> String? {
        switch timeline {
        case .past(let i):
            return "\(i + 1) of \(max(stops, i + 1)) back · Right for live"
        case .live:
            guard let surf, surf.count > 1 else { return nil }
            return "\(surf.index) of \(surf.count)"
        }
    }

    /// Renderer identity per timeline position, so stepping crossfades.
    static func timelineKey(_ timeline: TVAppState.Timeline) -> String {
        if case .past(let i) = timeline { return "past-\(i)" }
        return "live"
    }
}
