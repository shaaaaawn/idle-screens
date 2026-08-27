import Foundation

/// Ranked channel search, as a pure function so the ordering is testable
/// without a keyboard.
///
/// Typing on a Siri Remote is expensive, so short queries have to be worth
/// the effort: every token must match somewhere (AND, not OR), and matches
/// are ranked by how directly they hit — a channel literally called "lobby"
/// outranks one that merely carries a "lobby" tag.
enum ChannelSearch {

    static func results(query: String,
                        channels: [PublicChannel],
                        categories: [ChannelCategory] = []) -> [PublicChannel] {
        let tokens = normalize(query)
        guard !tokens.isEmpty else { return [] }

        // Category titles are searchable too: "style" should find the
        // channels on the Style studies shelf even though none of them say
        // the word themselves.
        var categoryTitles: [String: [String]] = [:]
        for category in categories {
            let title = category.displayTitle.lowercased()
            for id in category.channelIds {
                categoryTitles[id, default: []].append(title)
            }
        }

        let scored: [(channel: PublicChannel, score: Double)] = channels.compactMap { channel in
            var total = 0.0
            for token in tokens {
                let best = score(channel: channel, token: token,
                                 categoryTitles: categoryTitles[channel.id] ?? [])
                // One miss disqualifies: with two words the reader means both.
                guard best > 0 else { return nil }
                total += best
            }
            return (channel, total)
        }

        return scored
            .sorted { a, b in
                if a.score != b.score { return a.score > b.score }
                if a.channel.isFeatured != b.channel.isFeatured { return a.channel.isFeatured }
                let la = a.channel.lastEventAt ?? 0, lb = b.channel.lastEventAt ?? 0
                if la != lb { return la > lb }
                return a.channel.id < b.channel.id
            }
            .map(\.channel)
    }

    /// Suggested tags for the empty state — the most common ones, so the
    /// reader can browse by clicking instead of spelling anything out.
    static func popularTags(in channels: [PublicChannel], limit: Int = 8) -> [String] {
        var counts: [String: Int] = [:]
        for channel in channels {
            for tag in channel.tags ?? [] where tag != "featured" {
                counts[tag, default: 0] += 1
            }
        }
        return counts
            .sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }
            .prefix(limit)
            .map(\.key)
    }

    // MARK: - Internals

    static func normalize(_ query: String) -> [String] {
        query.lowercased()
            .split(whereSeparator: { !$0.isLetter && !$0.isNumber })
            .map(String.init)
            .filter { !$0.isEmpty }
    }

    private static func score(channel: PublicChannel, token: String,
                              categoryTitles: [String]) -> Double {
        let label = channel.displayLabel.lowercased()
        let id = channel.id.lowercased()
        var best = 0.0

        if label == token { best = max(best, 100) }
        else if label.hasPrefix(token) { best = max(best, 60) }
        else if label.contains(token) { best = max(best, 40) }

        if id == token { best = max(best, 80) }
        else if id.contains(token) { best = max(best, 25) }

        for tag in channel.tags ?? [] {
            let tag = tag.lowercased()
            if tag == token { best = max(best, 50) }
            else if tag.contains(token) { best = max(best, 20) }
        }

        if categoryTitles.contains(where: { $0.contains(token) }) {
            best = max(best, 15)
        }
        // The saver id is how someone finds every warp channel at once.
        if let saver = channel.classicSaverId?.lowercased() {
            if saver == token { best = max(best, 45) }
            else if saver.contains(token) { best = max(best, 18) }
        }
        // The scene's own name is what is actually on screen — someone who
        // saw "Warp Tunnel" searches for that, not for the channel that
        // happened to be showing it.
        if let scene = channel.saverLabel?.lowercased() {
            if scene == token { best = max(best, 70) }
            else if scene.hasPrefix(token) { best = max(best, 45) }
            else if scene.contains(token) { best = max(best, 30) }
        }
        return best
    }
}
