import SwiftUI

/// The Channels tab, built for finding something: search and a chip row of
/// filters, categories and tags; a rail of tall live tiles; then each category
/// two-by-two, in the web home page's running order (`HomeSections`).
/// Every tile is a live native render of the channel's scene — the content
/// showcases itself.
struct GalleryView: View {
    @Environment(AppState.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var query = ""
    @State private var gridWidth: CGFloat = 390
    @State private var filter: ChannelBrowse.Filter = .all
    /// A category chip. Separate from `filter` because categories come from the
    /// server's shelves, not from a rule over the channel list.
    @State private var sectionId: String?

    /// Shelves are for wandering; the moment you ask for something specific
    /// — a search, a chip — you get one flat grid of answers instead.
    private var isBrowsingShelves: Bool {
        filter == .all && sectionId == nil && query.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private var results: [PublicChannel] {
        let pool = sectionId.flatMap { id in allSections.first { $0.id == id }?.channels } ?? app.channels
        let filtered = ChannelBrowse.apply(filter, to: pool, following: app.follows.followed)
        return ChannelBrowse.search(query, in: filtered)
    }

    private var filters: [ChannelBrowse.Filter] {
        var list: [ChannelBrowse.Filter] = [.all, .live, .fresh]
        if !app.follows.followed.isEmpty { list.append(.following) }
        list.append(.remixable)
        return list + ChannelBrowse.topTags(in: app.channels).map { .tag($0) }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 28) {
                    if !app.channels.isEmpty { filterBar }
                    if isBrowsingShelves {
                        shelvesContent
                    } else {
                        resultsGrid
                    }
                }
                .padding(.vertical, 8)
                // Measured behind the stack, not in it: a zero-height probe as
                // a row still costs a row's spacing.
                .background {
                    GeometryReader { geo in Color.clear.preference(key: GridWidthKey.self, value: geo.size.width) }
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always),
                        prompt: "Channels, tags, artists, models")
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .background(Color.appBackground)
            .overlay {
                // First run has no cache: never show a bare black screen.
                if app.channels.isEmpty {
                    if app.isLoadingGallery {
                        ProgressView()
                            .tint(.appPrimary)
                            .controlSize(.large)
                    } else {
                        ContentUnavailableView {
                            Label("No channels", systemImage: "tv")
                        } description: {
                            Text(app.galleryError ?? "Pull to refresh.")
                        }
                    }
                }
            }
            .onPreferenceChange(GridWidthKey.self) { gridWidth = $0 }
            .navigationTitle("channels")
            .refreshable { await app.loadGallery() }
        }
        .task {
            if app.channels.isEmpty { await app.loadGallery() }
        }
    }

    // MARK: Browse

    @ViewBuilder
    private var shelvesContent: some View {
        // Tall, because that is the shape you watch in. The curated channel
        // leads, then what you follow, what is being watched, what is newest —
        // one rail doing the work the banner, "Following" and "Watching now"
        // rows each did a third of.
        if !onNow.isEmpty {
            OnNowRail(channels: onNow)
        }
        // Four of each category at once, two by two: you can compare them
        // without dragging a strip sideways, and "All N" opens the rest.
        ForEach(shelves) { shelf in
            SectionGrid(shelf: shelf, columns: gridColumns, cardWidth: gridCardWidth)
        }
    }

    private var gridColumns: Int { sizeClass == .regular ? 4 : 2 }
    private var gridCardWidth: CGFloat {
        max(120, (gridWidth - 32 - CGFloat(gridColumns - 1) * 12) / CGFloat(gridColumns))
    }

    /// Every shelf, hero included — the chips filter the real category, not
    /// the version with the billboard channel taken out.
    private var allSections: [HomeSection] {
        HomeSections.build(channels: app.channels, categories: app.categories)
    }

    private var onNow: [PublicChannel] {
        var seen = Set<String>()
        let lead = [heroChannel].compactMap { $0 }
        let latest = ChannelFeed.latestFirst(app.channels) { app.token(for: $0.id) != nil }
        return (lead + following + watchedNow + latest)
            .filter { $0.sleeping != true && seen.insert($0.id).inserted }
            .prefix(14).map { $0 }
    }


    private var watchedNow: [PublicChannel] {
        Array(ChannelBrowse.apply(.live, to: app.channels, following: []).prefix(12))
    }

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(filters.filter { if case .tag = $0 { return false }; return true }) { item in
                    chip(item.title, selected: item == filter && (item != .all || sectionId == nil)) {
                        filter = (item == filter && item != .all) ? .all : item
                        if item == .all { sectionId = nil }
                    }
                }
                ForEach(allSections) { section in
                    chip(section.title, count: section.channels.count, selected: sectionId == section.id) {
                        sectionId = sectionId == section.id ? nil : section.id
                    }
                }
                ForEach(filters.filter { if case .tag = $0 { return true }; return false }) { item in
                    chip(item.title, selected: item == filter) {
                        filter = item == filter ? .all : item
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private func chip(_ title: String, count: Int? = nil, selected: Bool,
                      action: @escaping () -> Void) -> some View {
        Button {
            withAnimation(.easeInOut(duration: 0.2)) { action() }
        } label: {
            HStack(spacing: 5) {
                Text(title)
                if let count {
                    Text("\(count)").opacity(0.55)
                }
            }
            .font(.footnote.weight(.semibold))
            .padding(.horizontal, 13)
            .padding(.vertical, 8)
            .foregroundStyle(selected ? Color.appBackground : Color.textPrimary)
            .background(selected ? Color.textPrimary : Color.appSurface, in: Capsule())
            .overlay { Capsule().strokeBorder(Color.appBorder.opacity(selected ? 0 : 0.6), lineWidth: 1) }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    @ViewBuilder
    private var resultsGrid: some View {
        let found = results
        if found.isEmpty {
            ContentUnavailableView {
                Label("Nothing matches", systemImage: "magnifyingglass")
            } description: {
                Text(query.isEmpty ? "No channels here right now." : "No channel, tag, artist or model matches “\(query)”.")
            } actions: {
                Button("Show everything") { query = ""; filter = .all; sectionId = nil }
            }
            .padding(.top, 40)
        } else {
            VStack(alignment: .leading, spacing: 12) {
                Text(found.count == 1 ? "1 channel" : "\(found.count) channels")
                    .font(.caption)
                    .foregroundStyle(Color.textSecondary)
                    .padding(.horizontal, 16)
                let columns = gridColumns
                let width = gridCardWidth
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(width), spacing: 12, alignment: .top), count: columns),
                          alignment: .leading, spacing: 20) {
                    ForEach(found) { channel in
                        ChannelCard(channel: channel, width: width, peers: found)
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }

    // MARK: Curation

    /// `default` is the channel the product curates nightly to represent
    /// itself, so it leads — a billboard that changes identity between visits
    /// teaches nobody what this place is. Featured-plus-richness stays as the
    /// fallback for when `default` isn't in the payload.
    private var heroChannel: PublicChannel? {
        if let curated = app.channels.first(where: { $0.id == "default" }) {
            return curated
        }
        let featured = app.channels.filter { $0.tags?.contains("featured") == true }
        let pool = featured.isEmpty ? app.channels : featured
        return pool.max { Self.richness($0) < Self.richness($1) }
    }

    private static func richness(_ channel: PublicChannel) -> Double {
        guard let spec = channel.spec else { return -1 }
        var score = Double(spec.layers.count)
        if spec.background?.stops?.isEmpty == false { score += 2 }
        score += Double(spec.layers.reduce(0) { $0 + min($1.count, 100) }) / 50
        score += Double(channel.viewers ?? 0)
        return score
    }

    /// The same running order as the web home and the Apple TV — Featured,
    /// Evals, the curated categories, Latest, then the tail — from the one
    /// shared builder. The phone used to bucket by each channel's first tag,
    /// which produced shelves the website has never had.
    private var following: [PublicChannel] {
        app.follows.channels(in: app.channels) { app.token(for: $0.id) != nil }
    }

    /// `build`'s sections cover every channel, so without this the billboard
    /// channel would also turn up as a card in whichever shelf claims it
    /// (Featured, Latest, Other, …). Drop it there — dropping the section
    /// entirely if it was the shelf's only channel.
    private var shelves: [HomeSection] {
        let built = HomeSections.build(channels: app.channels, categories: app.categories)
        guard let heroId = heroChannel?.id else { return built }
        // Category shelves must keep `HomeSections.build`'s own minimum after
        // the hero is pulled out, or a category that had exactly the minimum
        // stranded 1-2 cards as a shelf. Featured/Evals/Latest/Other are
        // allowed to run thin by design (e.g. a single new arrival), so only
        // drop those when the hero removal empties them entirely.
        let categoryIds = Set(app.categories.map { $0.id })
        return built.compactMap { section in
            let channels = section.channels.filter { $0.id != heroId }
            let minimum = categoryIds.contains(section.id) ? HomeSections.minimumPerShelf : 1
            guard channels.count >= minimum else { return nil }
            return HomeSection(id: section.id, title: section.title, subtitle: section.subtitle,
                               ownedTags: section.ownedTags, channels: channels)
        }
    }
}

// MARK: - On now

/// The top of the page: tall live tiles, the shape of the feed they open.
private struct OnNowRail: View {
    let channels: [PublicChannel]
    @Environment(AppState.self) private var app

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(spacing: 10) {
                ForEach(channels) { channel in
                    NavigationLink(destination: ChannelFeedView(channels: channels, start: channel.id, showsBack: true,
                                          onRefresh: { await app.loadGallery() })) {
                        tile(channel)
                    }
                    .buttonStyle(.plain)
                    .contextMenu { CardMenu(channel: channel) }
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private func tile(_ channel: PublicChannel) -> some View {
        let viewers = channel.viewers ?? 0
        return ChannelPreviewTile(channel: channel)
            .frame(width: 132, height: 214)
            .overlay {
                LinearGradient(colors: [.black.opacity(0.35), .clear, .clear, .black.opacity(0.8)],
                               startPoint: .top, endPoint: .bottom)
            }
            .overlay(alignment: .topLeading) {
                HStack(spacing: 5) {
                    Circle().fill(viewers > 0 ? Color.appSuccess : Color.white.opacity(0.5))
                        .frame(width: 6, height: 6)
                    if viewers > 0 {
                        Text("\(viewers)").font(.caption2.weight(.bold)).monospacedDigit()
                    }
                }
                .foregroundStyle(.white)
                .padding(9)
            }
            .overlay(alignment: .topTrailing) { CardFollowButton(channelId: channel.id) }
            .overlay(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(channel.displayLabel)
                        .font(.footnote.weight(.semibold))
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    if let line = SteerLine.cardLine(for: channel) {
                        Text(line).font(.caption2).opacity(0.75).lineLimit(1)
                    }
                }
                .foregroundStyle(.white)
                .padding(9)
            }
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(Color.appBorder.opacity(0.5), lineWidth: 1)
            }
            .accessibilityElement(children: .combine)
    }
}

// MARK: - Category, two by two

private struct SectionGrid: View {
    let shelf: HomeSection
    let columns: Int
    let cardWidth: CGFloat

    var body: some View {
        let shown = Array(shelf.channels.prefix(columns * 2))
        VStack(alignment: .leading, spacing: 12) {
            NavigationLink {
                ShelfGridView(title: shelf.title, subtitle: shelf.subtitle,
                              ownedTags: shelf.ownedTags, initial: shelf.channels, sectionId: shelf.id)
            } label: {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(shelf.title)
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(Color.textPrimary)
                        if let subtitle = shelf.subtitle {
                            Text(subtitle).font(.caption).foregroundStyle(Color.textSecondary).lineLimit(1)
                        }
                    }
                    Spacer()
                    if shelf.channels.count > shown.count {
                        HStack(spacing: 3) {
                            Text("All \(shelf.channels.count)")
                            Image(systemName: "chevron.right").font(.caption2.weight(.bold))
                        }
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.textSecondary)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(shelf.channels.count <= shown.count)

            LazyVGrid(columns: Array(repeating: GridItem(.fixed(cardWidth), spacing: 12, alignment: .top),
                                     count: columns),
                      alignment: .leading, spacing: 18) {
                ForEach(shown) { channel in
                    ChannelCard(channel: channel, width: cardWidth, peers: shelf.channels,
                                ownedTags: shelf.ownedTags)
                }
            }
        }
        .padding(.horizontal, 16)
    }
}

// MARK: - A whole shelf

/// Everything in one category, as a grid you can sort — the answer to "show
/// me all of these" that a sideways row never gives.
private struct ShelfGridView: View {
    let title: String
    var subtitle: String?
    var ownedTags: Set<String> = []
    /// The shelf as it was when you tapped through…
    let initial: [PublicChannel]
    /// …and the id to find it again after a refresh, since the page outlives
    /// the snapshot it was opened with.
    var sectionId: String?
    @Environment(AppState.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var order: Order = .curated

    private var channels: [PublicChannel] {
        guard let sectionId else { return initial }
        return HomeSections.build(channels: app.channels, categories: app.categories)
            .first { $0.id == sectionId }?.channels ?? initial
    }

    enum Order: String, CaseIterable, Identifiable {
        case curated = "Curated", recent = "Recently updated", watched = "Most watched", name = "A–Z"
        var id: String { rawValue }
    }

    private var sorted: [PublicChannel] {
        switch order {
        case .curated: channels
        case .recent: channels.sorted { ($0.lastEventAt ?? 0, $1.id) > ($1.lastEventAt ?? 0, $0.id) }
        case .watched: channels.sorted { ($0.viewers ?? 0, $1.id) > ($1.viewers ?? 0, $0.id) }
        case .name: channels.sorted {
            $0.displayLabel.localizedCaseInsensitiveCompare($1.displayLabel) == .orderedAscending
        }
        }
    }

    var body: some View {
        GeometryReader { geo in
            let columns = sizeClass == .regular ? 4 : 2
            let width = max(120, (geo.size.width - 32 - CGFloat(columns - 1) * 12) / CGFloat(columns))
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let subtitle {
                        Text(subtitle)
                            .font(.subheadline)
                            .foregroundStyle(Color.textSecondary)
                    }
                    LazyVGrid(columns: Array(repeating: GridItem(.fixed(width), spacing: 12, alignment: .top),
                                             count: columns),
                              alignment: .leading, spacing: 20) {
                        ForEach(sorted) { channel in
                            ChannelCard(channel: channel, width: width, peers: sorted, ownedTags: ownedTags)
                        }
                    }
                }
                .padding(16)
            }
        }
        .background(Color.appBackground.ignoresSafeArea())
        .refreshable { await app.loadGallery() }
        .navigationTitle(title.lowercased())
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Sort", selection: $order) {
                        ForEach(Order.allCases) { Text($0.rawValue).tag($0) }
                    }
                } label: {
                    Label("Sort", systemImage: "arrow.up.arrow.down")
                }
            }
        }
    }
}

// MARK: - Poster card

private struct ChannelCard: View {
    @Environment(AppState.self) private var app
    let channel: PublicChannel
    let width: CGFloat
    /// The shelf this card sits in, so the viewer can page sideways through
    /// the row you actually entered from rather than the whole catalogue.
    var peers: [PublicChannel] = []
    /// Tags the shelf title already says out loud. A "featured" chip on every
    /// card of the Featured row is one word repeated four times.
    var ownedTags: Set<String> = []

    private var tagLine: String? {
        let tags = (channel.tags ?? []).filter { !ownedTags.contains($0) }
        return tags.isEmpty ? nil : tags.prefix(3).joined(separator: " · ")
    }

    var body: some View {
        NavigationLink(destination: ChannelFeedView(
            channels: peers.isEmpty ? [channel] : peers, start: channel.id, showsBack: true,
                                          onRefresh: { await app.loadGallery() })) {
            VStack(alignment: .leading, spacing: 8) {
                ChannelPreviewTile(channel: channel)
                    .frame(width: width, height: width * 9 / 16)
                    .overlay(alignment: .topLeading) {
                        if let viewers = channel.viewers, viewers > 0 {
                            Label("\(viewers)", systemImage: "eye.fill")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(Color.textPrimary)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(.black.opacity(0.55), in: Capsule())
                                .padding(6)
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay {
                        RoundedRectangle(cornerRadius: 12)
                            .strokeBorder(Color.appBorder.opacity(0.5), lineWidth: 1)
                    }
                    // Follow without leaving the wall: the cheapest "yes" in
                    // the app, so it is one tap from every card.
                    .overlay(alignment: .topTrailing) { CardFollowButton(channelId: channel.id) }

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 5) {
                        // Claimed channels answer only to their token holder.
                        // A symbol, not the web's emoji: it takes the text
                        // colour and scales with Dynamic Type.
                        if channel.isProtected == true {
                            Image(systemName: "lock.fill")
                                .font(.caption2)
                                .foregroundStyle(Color.textTertiary)
                                .accessibilityLabel("Claimed")
                        }
                        Text(channel.displayLabel)
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(Color.textPrimary)
                            .lineLimit(1)
                        if channel.remixOf != nil {
                            Image(systemName: "arrow.triangle.branch")
                                .font(.caption2)
                                .foregroundStyle(Color.textTertiary)
                                .accessibilityLabel(channel.remixOf.flatMap { $0.isEmpty ? nil : "Remixed from \($0)" } ?? "A remix")
                        }
                    }
                    // The wall's liveliest fact: who touched this, and when.
                    if let steered = SteerLine.cardLine(for: channel) {
                        Text(steered)
                            .font(.caption2)
                            .foregroundStyle(Color.textSecondary)
                            .lineLimit(1)
                    }
                    if let tagLine {
                        Text(tagLine)
                            .font(.caption2)
                            .foregroundStyle(Color.textTertiary)
                            .lineLimit(1)
                    }
                }
                .frame(width: width, alignment: .leading)
            }
        }
        .buttonStyle(.plain)
        .contextMenu {
            CardMenu(channel: channel)
        }
    }
}

private struct CardFollowButton: View {
    let channelId: String
    @Environment(AppState.self) private var app

    var body: some View {
        let following = app.follows.isFollowing(channelId)
        Button {
            let now = app.follows.toggle(channelId)
            UIImpactFeedbackGenerator(style: now ? .medium : .light).impactOccurred()
        } label: {
            Image(systemName: following ? "checkmark" : "plus")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(following ? Color.black : Color.white)
                .frame(width: 26, height: 26)
                .background(following ? Color.white : Color.black.opacity(0.55), in: Circle())
                .contentTransition(.symbolEffect(.replace))
                // A 26pt dot with a 44pt target.
                .padding(9)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(following ? "Following. Unfollow" : "Follow")
    }
}

private struct CardMenu: View {
    let channel: PublicChannel
    @Environment(AppState.self) private var app

    var body: some View {
        let following = app.follows.isFollowing(channel.id)
        Button { _ = app.follows.toggle(channel.id) } label: {
            Label(following ? "Unfollow" : "Follow", systemImage: following ? "star.slash" : "star")
        }
        if !app.pairedScreens.isEmpty {
            Button { Task { await app.pushToAllScreens(channelId: channel.id) } } label: {
                Label("Play on your screens", systemImage: "play.tv")
            }
        }
        ShareLink(item: app.gallery.viewerURL(for: channel.id)) {
            Label("Share", systemImage: "square.and.arrow.up")
        }
    }
}

private struct GridWidthKey: PreferenceKey {
    static let defaultValue: CGFloat = 390
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

// MARK: - Preview tile (shared)

/// Live scene preview when the channel publishes a spec; otherwise the
/// viewer-captured thumb; otherwise a styled placeholder — never a bare
/// empty tile.
struct ChannelPreviewTile: View {
    @Environment(AppState.self) private var app
    let channel: PublicChannel

    var body: some View {
        if let spec = channel.spec {
            ScenePreviewView(spec: spec, fallbackSeed: channel.id)
        } else {
            AsyncImage(url: app.gallery.thumbURL(for: channel.id)) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                default:
                    ZStack {
                        LinearGradient(
                            colors: [Color.appSurfaceRaised, Color.appBackground],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                        Circle()
                            .fill(Color.appPrimary.opacity(0.6))
                            .frame(width: 16, height: 16)
                    }
                }
            }
        }
    }
}
