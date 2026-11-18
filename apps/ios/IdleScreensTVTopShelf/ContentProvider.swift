import TVServices

/// Dynamic Top Shelf: a full-screen carousel of live channels, featured first.
/// While the app is focused on the home screen, each featured channel plays
/// ten seconds of itself behind its title (`/c/<id>/preview.mp4`, rendered by
/// the server), over its card as the still. Selecting one deep-links straight
/// into that channel fullscreen (`idlescreens://channel/<id>`).
///
/// Deliberately standalone: a Top Shelf extension has tight memory limits,
/// so it reads the slim listing, decodes the fields it needs and never
/// imports the render stack. What it shows is decided in `TopShelfCatalog`.
final class ContentProvider: TVTopShelfContentProvider {

    private static let baseURL = URL(string: "https://idlescreens.com")!

    override func loadTopShelfContent() async -> (any TVTopShelfContent)? {
        guard let channels = try? await fetchChannels() else { return nil }
        let entries = TopShelfCatalog.entries(from: channels, baseURL: Self.baseURL)
        guard !entries.isEmpty else { return nil }
        let clips = await availableClips(entries)

        let items = entries.map { entry -> TVTopShelfCarouselItem in
            let item = TVTopShelfCarouselItem(identifier: entry.id)
            item.contextTitle = entry.context
            item.title = entry.title
            item.summary = entry.summary
            item.genre = entry.genre
            item.setImageURL(entry.imageURL, for: [.screenScale1x, .screenScale2x])
            if clips.contains(entry.id) { item.previewVideoURL = entry.previewVideoURL }
            if let watching = TopShelfCatalog.watchingText(entry.watching) {
                item.namedAttributes = [TVTopShelfNamedAttribute(name: "Watching", values: [watching])]
            }
            item.displayAction = TVTopShelfAction(url: entry.link)
            item.playAction = TVTopShelfAction(url: entry.link)
            return item
        }
        return TVTopShelfCarouselContent(style: .details, items: items)
    }

    /// Which featured channels have a clip right now: a HEAD that ends on the
    /// MP4 (the route 302s to it, or 404s until the server has rendered one).
    /// A channel without one shows its still alone, rather than a video
    /// the system tries and fails to load. Asked in parallel, 4 s each.
    private func availableClips(_ entries: [TopShelfCatalog.Entry]) async -> Set<String> {
        await withTaskGroup(of: String?.self) { group in
            for entry in entries {
                guard let url = entry.previewVideoURL else { continue }
                group.addTask {
                    var request = URLRequest(url: url)
                    request.httpMethod = "HEAD"
                    request.timeoutInterval = 4
                    guard let (_, response) = try? await URLSession.shared.data(for: request),
                          let http = response as? HTTPURLResponse, http.statusCode == 200 else { return nil }
                    return entry.id
                }
            }
            var ids = Set<String>()
            for await id in group { if let id { ids.insert(id) } }
            return ids
        }
    }

    private func fetchChannels() async throws -> [TopShelfCatalog.Channel] {
        var request = URLRequest(url: TopShelfCatalog.channelsURL(baseURL: Self.baseURL))
        request.timeoutInterval = 10
        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode([TopShelfCatalog.Channel].self, from: data)
    }
}
