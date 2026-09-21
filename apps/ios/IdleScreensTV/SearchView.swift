import SwiftUI

/// Native tvOS search. `.searchable` gives the system search field, the
/// on-screen keyboard and — the part that matters on a remote — dictation,
/// so nobody has to spell a channel name out one letter at a time.
///
/// The empty state is not empty: typing is the expensive path, so it offers
/// the catalog's own tags as big focusable targets. Most searches should be
/// one click, not eleven.
struct SearchView: View {
    @Environment(TVAppState.self) private var app
    /// Debug/QA entry point (`-search -q <query>`); empty in normal use.
    var initialQuery: String = ""
    @State private var query = ""
    /// A browse filter picked instead of typing (shared with the iPhone).
    @State private var filter: ChannelBrowse.Filter?
    @FocusState private var focusedChannelId: String?

    private let columns = Array(repeating: GridItem(.flexible(), spacing: TV.columnGap), count: 3)

    private var results: [PublicChannel] {
        ChannelSearch.results(query: query, channels: app.channels, categories: app.categories)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: TV.sectionGap) {
                    if query.trimmingCharacters(in: .whitespaces).isEmpty {
                        browse
                        if let filter {
                            filtered(filter)
                        } else {
                            recentlySteered
                        }
                    } else if results.isEmpty {
                        empty
                    } else {
                        found
                    }
                }
                .padding(.horizontal, TV.gutter)
                .padding(.top, TV.headerTop)
                .padding(.bottom, TV.gutter)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .searchable(text: $query, prompt: "Channel, style or tag")
            .navigationDestination(isPresented: Binding(
                get: { app.selectedChannelId != nil && app.presentingSurface == .search },
                set: { if !$0 { app.exitChannel() } }
            )) {
                ScreenSaverView()
                    .toolbar(.hidden, for: .tabBar)
                    .toolbar(.hidden, for: .navigationBar)
            }
        }
        .task {
            if query.isEmpty { query = initialQuery }
            if app.channels.isEmpty { await app.loadGallery() }
        }
    }

    private var found: some View {
        VStack(alignment: .leading, spacing: TV.headerGap) {
            Text(results.count == 1 ? "1 channel" : "\(results.count) channels")
                .font(.tvShelfTitle)
                .foregroundStyle(Color.textPrimary)
            grid(results)
        }
    }

    private var empty: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("No channels match “\(query)”")
                .font(.tvShelfTitle)
                .foregroundStyle(Color.textPrimary)
            Text("Try a style, a tag, or part of a channel name.")
                .font(.tvBody)
                .foregroundStyle(Color.textSecondary)
        }
    }

    /// Filters the iPhone's Channels tab offers, minus Following (the TV has
    /// no follow list yet) — each is a whole search in one click.
    private var filters: [ChannelBrowse.Filter] {
        // Housekeeping tags (release trains, test fixtures) are how the
        // estate is run, not how anyone browses it.
        let tags = ChannelBrowse.topTags(in: app.channels, limit: 12,
                                         excluding: ["featured", "test"])
            .filter { !$0.hasPrefix("release-") && !$0.hasPrefix("test-") }
            .prefix(9)
        return [.live, .fresh, .remixable] + tags.map { ChannelBrowse.Filter.tag($0) }
    }

    private var browse: some View {
        VStack(alignment: .leading, spacing: TV.headerGap) {
            Text("Browse")
                .font(.tvShelfTitle)
                .foregroundStyle(Color.textPrimary)
            // A wrapping row would be neater, but tvOS focus wants a
            // predictable grid — every swipe lands somewhere.
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 24), count: 4),
                      spacing: 24) {
                ForEach(filters) { option in
                    Button {
                        filter = filter == option ? nil : option
                    } label: {
                        Label(option.title,
                              systemImage: filter == option ? "checkmark" : symbol(for: option))
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
    }

    private func symbol(for filter: ChannelBrowse.Filter) -> String {
        switch filter {
        case .live: return "eye"
        case .fresh: return "sparkles"
        case .remixable: return "slider.horizontal.3"
        case .tag: return "tag"
        default: return "square.grid.2x2"
        }
    }

    /// Something to look at before anything is chosen — the iPhone feed's
    /// own order, so the top of Search is the top of the phone's feed.
    @ViewBuilder private var recentlySteered: some View {
        let recent = Array(ChannelFeed.latestFirst(app.channels)
            .filter { $0.sleeping != true }.prefix(6))
        if !recent.isEmpty {
            VStack(alignment: .leading, spacing: TV.headerGap) {
                Text("Recently steered")
                    .font(.tvShelfTitle)
                    .foregroundStyle(Color.textPrimary)
                grid(recent)
            }
        }
    }

    @ViewBuilder private func filtered(_ filter: ChannelBrowse.Filter) -> some View {
        let matches = ChannelBrowse.apply(filter, to: app.channels, following: [])
        VStack(alignment: .leading, spacing: TV.headerGap) {
            Text(matches.isEmpty ? "Nothing under \(filter.title) right now"
                                 : "\(filter.title) · \(matches.count)")
                .font(.tvShelfTitle)
                .foregroundStyle(Color.textPrimary)
            if !matches.isEmpty { grid(matches) }
        }
    }

    private func grid(_ channels: [PublicChannel]) -> some View {
        LazyVGrid(columns: columns, spacing: TV.rowGap) {
            ForEach(channels) { channel in
                ChannelCard(channel: channel,
                            focusBinding: $focusedChannelId,
                            surface: .search)
            }
        }
    }
}
