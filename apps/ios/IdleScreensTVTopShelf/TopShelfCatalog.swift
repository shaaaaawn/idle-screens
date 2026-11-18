import Foundation

/// What the Top Shelf shows, decided without TVServices so the TV tests can
/// check it (the test target compiles this file too). `ContentProvider` turns
/// each entry into a full-screen carousel item.
enum TopShelfCatalog {

    /// The five-or-so fields of `/api/channels?slim=1` the shelf reads.
    struct Channel: Decodable, Equatable {
        var id: String?
        var label: String?
        var tags: [String]?
        var viewers: Int?
        var sleeping: Bool?
        /// The current scene's name ("Cloudbank, Golden Hour"), or a classic saver's id.
        var saver: String?
    }

    struct Entry: Equatable {
        let id: String
        let title: String
        /// Above the title: "Featured" or "Live now".
        let context: String
        /// "Now showing <scene>", when the listing names one.
        let summary: String?
        /// The first tag that isn't "featured", as a word ("Ambient").
        let genre: String?
        /// Screens watching right now.
        let watching: Int
        let featured: Bool
        let imageURL: URL
        /// Only featured channels get a clip (the server renders no others).
        let previewVideoURL: URL?
        let link: URL
    }

    /// The carousel's own cap, and the server's (`PREVIEW_MAX_CHANNELS`).
    static let maxItems = 8

    /// Featured channels first (editorial order), then the most watched; asleep ones never.
    static func entries(from channels: [Channel], baseURL: URL) -> [Entry] {
        let awake = channels.filter { $0.sleeping != true && $0.id?.isEmpty == false }
        let featured = awake.filter { $0.tags?.contains("featured") == true }
        let rest = awake.filter { $0.tags?.contains("featured") != true }
            .sorted { ($0.viewers ?? 0) > ($1.viewers ?? 0) }
        return (featured + rest).prefix(maxItems).compactMap { channel in
            guard let id = channel.id, let link = URL(string: "idlescreens://channel/\(id)") else { return nil }
            let isFeatured = channel.tags?.contains("featured") == true
            let scene = channel.saver.map(word).flatMap { $0.isEmpty ? nil : $0 }
            return Entry(
                id: id,
                title: word(channel.label ?? id),
                context: isFeatured ? "Featured" : "Live now",
                summary: scene.map { "Now showing \($0)" },
                genre: channel.tags?.first { $0 != "featured" }.map { word($0.replacingOccurrences(of: "-", with: " ")) },
                watching: max(0, channel.viewers ?? 0),
                featured: isFeatured,
                imageURL: imageURL(for: id, baseURL: baseURL),
                previewVideoURL: isFeatured ? previewURL(for: id, baseURL: baseURL) : nil,
                link: link
            )
        }
    }

    /// "Watching": "1 screen", "10 screens"; nil when nobody is.
    static func watchingText(_ n: Int) -> String? {
        n > 0 ? "\(n) \(n == 1 ? "screen" : "screens")" : nil
    }

    /// The channel's rendered card, `/c/<id>/og.jpg`: always a JPEG (a
    /// channel without one redirects to the site's card). Not `/c/<id>/thumb`:
    /// for a claimed channel, and for the demo channels until a viewer has
    /// captured a frame, that is an SVG server render, which the Top Shelf
    /// cannot draw. Those tiles spun forever (default, lobby and studio, the
    /// first three featured, on 2026-11-18).
    static func imageURL(for id: String, baseURL: URL) -> URL {
        baseURL.appendingPathComponent("c").appendingPathComponent(id).appendingPathComponent("og.jpg")
    }

    /// `/c/<id>/preview.mp4`: a 302 to ten seconds of the channel as a
    /// 1920×1080 MP4, or 404 until the server's cron has rendered one.
    static func previewURL(for id: String, baseURL: URL) -> URL {
        baseURL.appendingPathComponent("c").appendingPathComponent(id).appendingPathComponent("preview.mp4")
    }

    /// `GET /api/channels?slim=1`: every field above, without the scene specs
    /// the full list carries for the app's live previews (~34 KB against
    /// ~1.9 MB on 2026-11-17). The query goes through URLComponents because
    /// `appendingPathComponent("api/channels?slim=1")` percent-encodes the `?`
    /// into the path and asks for a channel list that doesn't exist.
    static func channelsURL(baseURL: URL) -> URL {
        var parts = URLComponents(url: baseURL.appendingPathComponent("api/channels"), resolvingAgainstBaseURL: false)!
        parts.queryItems = [URLQueryItem(name: "slim", value: "1")]
        return parts.url!
    }

    /// A lowercase name reads as a title: "lobby" → "Lobby". Anything already
    /// cased ("Cut Into Loops", "iPad wall") is left as written.
    static func word(_ s: String) -> String {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let first = t.first, t == t.lowercased() else { return t }
        return first.uppercased() + t.dropFirst()
    }
}
