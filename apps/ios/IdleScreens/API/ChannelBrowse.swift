import Foundation

/// Finding a channel: search, quick filters and the tag cloud behind the
/// Channels tab. Pure functions over the gallery payload so the rules are
/// testable without a view.
enum ChannelBrowse {
    enum Filter: Hashable, Identifiable {
        case all, live, fresh, following, remixable, tag(String)

        var id: String {
            switch self {
            case .all: "all"
            case .live: "live"
            case .fresh: "fresh"
            case .following: "following"
            case .remixable: "open"
            case .tag(let tag): "tag:\(tag)"
            }
        }

        var title: String {
            switch self {
            case .all: "All"
            case .live: "Watching now"
            case .fresh: "New this week"
            case .following: "Following"
            case .remixable: "Open to steer"
            case .tag(let tag): "#\(tag)"
            }
        }
    }

    /// A week: long enough that the chip is rarely empty, short enough that
    /// "new" still means something.
    static let freshWindow: TimeInterval = 7 * 24 * 3600

    static func apply(_ filter: Filter, to channels: [PublicChannel],
                      following: Set<String>, now: Date = Date()) -> [PublicChannel] {
        switch filter {
        case .all:
            return channels
        case .live:
            return channels.filter { ($0.viewers ?? 0) > 0 && $0.sleeping != true }
                .sorted { ($0.viewers ?? 0, $1.id) > ($1.viewers ?? 0, $0.id) }
        case .fresh:
            let cutoff = (now.timeIntervalSince1970 - freshWindow) * 1000
            return channels.filter { Double($0.lastEventAt ?? 0) >= cutoff }
                .sorted { ($0.lastEventAt ?? 0, $1.id) > ($1.lastEventAt ?? 0, $0.id) }
        case .following:
            return channels.filter { following.contains($0.id) }
        case .remixable:
            // Unclaimed: anyone can steer it right now, no key needed.
            return channels.filter { $0.isProtected != true }
        case .tag(let tag):
            return channels.filter { $0.tags?.contains(tag) == true }
        }
    }

    /// Every word must match somewhere — name, id, a tag, the scene, or
    /// whoever last steered it — so "claude ocean" narrows rather than widens.
    static func search(_ query: String, in channels: [PublicChannel]) -> [PublicChannel] {
        let words = query.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
        guard !words.isEmpty else { return channels }
        return channels.filter { channel in
            let haystack = ([channel.id, channel.label, channel.saverLabel,
                             channel.lastSteer?.actor, channel.lastSteer?.model,
                             channel.lastSteer?.harness] as [String?])
                .compactMap { $0 }
                .appending(contentsOf: channel.tags ?? [])
                .joined(separator: " ")
                .lowercased()
            return words.allSatisfy { haystack.contains($0.hasPrefix("#") ? String($0.dropFirst()) : $0) }
        }
    }

    /// The tags worth a chip: used by at least two channels, most used first.
    /// Housekeeping tags the shelves already speak for are left out.
    static func topTags(in channels: [PublicChannel], limit: Int = 8,
                        excluding: Set<String> = ["featured"]) -> [String] {
        var counts: [String: Int] = [:]
        for tag in channels.flatMap({ $0.tags ?? [] }) where !excluding.contains(tag) {
            counts[tag, default: 0] += 1
        }
        return counts.filter { $0.value >= 2 }
            .sorted { ($0.value, $1.key) > ($1.value, $0.key) }
            .prefix(limit).map(\.key)
    }
}

private extension Array {
    func appending(contentsOf other: [Element]) -> [Element] { self + other }
}
