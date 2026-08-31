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

    private var browse: some View {
        VStack(alignment: .leading, spacing: TV.sectionGap) {
            let tags = ChannelSearch.popularTags(in: app.channels)
            if !tags.isEmpty {
                VStack(alignment: .leading, spacing: TV.headerGap) {
                    Text("Browse by tag")
                        .font(.tvShelfTitle)
                        .foregroundStyle(Color.textPrimary)
                    // A wrapping row would be neater, but tvOS focus wants a
                    // predictable grid — every swipe lands somewhere.
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 24), count: 4),
                              spacing: 24) {
                        ForEach(tags, id: \.self) { tag in
                            Button(tag) { query = tag }
                                .buttonStyle(.bordered)
                        }
                    }
                }
            }

            let recent = app.channels
                .sorted { ($0.lastEventAt ?? 0) > ($1.lastEventAt ?? 0) }
                .prefix(6)
            if !recent.isEmpty {
                VStack(alignment: .leading, spacing: TV.headerGap) {
                    Text("Recently steered")
                        .font(.tvShelfTitle)
                        .foregroundStyle(Color.textPrimary)
                    grid(Array(recent))
                }
            }
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
