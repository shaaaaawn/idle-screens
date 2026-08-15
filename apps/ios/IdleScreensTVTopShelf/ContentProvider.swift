import TVServices

/// Dynamic Top Shelf: the featured shelf of live channels, refreshed every
/// time the system asks. Selecting an item deep-links straight into that
/// channel fullscreen (`idlescreens://channel/<id>`), so the TV goes from
/// home screen to ambient art in one click.
///
/// Deliberately standalone: a Top Shelf extension has tight memory limits,
/// so it decodes the two fields it needs and never imports the render stack.
final class ContentProvider: TVTopShelfContentProvider {

    private struct Channel: Decodable {
        let id: String?
        let label: String?
        let tags: [String]?
        let viewers: Int?
        let sleeping: Bool?
    }

    private static let baseURL = URL(string: "https://idlescreens.com")!

    override func loadTopShelfContent() async -> (any TVTopShelfContent)? {
        guard let channels = try? await fetchChannels() else { return nil }

        // Featured channels first (editorial order), then the most watched.
        let awake = channels.filter { $0.sleeping != true && $0.id != nil }
        let featured = awake.filter { $0.tags?.contains("featured") == true }
        let rest = awake.filter { $0.tags?.contains("featured") != true }
            .sorted { ($0.viewers ?? 0) > ($1.viewers ?? 0) }
        let picks = Array((featured + rest).prefix(8))
        guard !picks.isEmpty else { return nil }

        let items = picks.compactMap { channel -> TVTopShelfSectionedItem? in
            guard let id = channel.id else { return nil }
            let item = TVTopShelfSectionedItem(identifier: id)
            item.title = channel.label ?? id
            item.imageShape = .hdtv
            let thumb = Self.baseURL
                .appendingPathComponent("c")
                .appendingPathComponent(id)
                .appendingPathComponent("thumb")
            item.setImageURL(thumb, for: [.screenScale1x, .screenScale2x])
            if let link = URL(string: "idlescreens://channel/\(id)") {
                item.displayAction = TVTopShelfAction(url: link)
                item.playAction = TVTopShelfAction(url: link)
            }
            return item
        }

        let section = TVTopShelfItemCollection(items: items)
        section.title = "Live channels"
        return TVTopShelfSectionedContent(sections: [section])
    }

    private func fetchChannels() async throws -> [Channel] {
        let url = Self.baseURL.appendingPathComponent("api/channels")
        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode([Channel].self, from: data)
    }
}
