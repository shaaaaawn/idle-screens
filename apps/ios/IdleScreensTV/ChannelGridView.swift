import SwiftUI

/// 10-foot gallery: cinematic hero for the first featured channel,
/// "featured" and "channels" sections of 16:9 cards below the fold.
struct ChannelGridView: View {
    @Environment(TVAppState.self) private var app
    @FocusState private var focusedChannelId: String?

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 48), count: 3)

    private var featured: [PublicChannel] {
        app.channels.filter { $0.tags?.contains("featured") == true }
    }
    private var hero: PublicChannel? { featured.first }
    private var featuredRail: [PublicChannel] { Array(featured.dropFirst()) }

    /// Editorial shelves: server-curated categories in catalog order, each
    /// holding its member channels in `categorySort` order. Categories the
    /// catalog doesn't know (stale cache, local dev) still shelve under
    /// their id, so channels never vanish.
    private var shelves: [(category: ChannelCategory, channels: [PublicChannel])] {
        let categorized = Dictionary(grouping: app.channels.filter {
            $0.categoryId != nil && $0.tags?.contains("featured") != true
        }, by: { $0.categoryId ?? "" })

        var catalog = app.categories
        let known = Set(catalog.map(\.id))
        // Orphaned category ids get a bare entry after the curated ones.
        for id in categorized.keys.sorted() where !known.contains(id) {
            catalog.append(ChannelCategory(id: id, title: nil, subtitle: nil, sort: nil))
        }

        return catalog.compactMap { category in
            guard let members = categorized[category.id], !members.isEmpty else { return nil }
            let ordered = members.sorted {
                ($0.categorySort ?? .max, $0.id) < ($1.categorySort ?? .max, $1.id)
            }
            return (category, ordered)
        }
    }

    /// Uncategorized, unfeatured remainder — the browsing long tail.
    private var rest: [PublicChannel] {
        app.channels.filter { $0.tags?.contains("featured") != true && $0.categoryId == nil }
    }

    /// The focused channel drives an ambient billboard behind the grid —
    /// its scene, blurred and dimmed. Browsing feels like previewing.
    @ViewBuilder private var focusBackdrop: some View {
        let focused = app.channels.first { $0.id == focusedChannelId }
        ZStack {
            Color.appBackground
            if let focused {
                Group {
                    if let spec = focused.spec, app.effectiveTier == .t3 {
                        ScenePreviewView(spec: spec, fallbackSeed: focused.id)
                    } else if let kind = ClassicSaverKind.supported(id: focused.classicSaverId),
                              let tier = app.classicRenderTier {
                        // Static frame: the billboard is blurred to 90pt, so
                        // animating it would cost frames nobody can see.
                        ClassicSaverView(kind: kind,
                                         seed: ClassicSaverKind.seed(forChannel: focused.id),
                                         tier: tier,
                                         live: false)
                    } else {
                        ProceduralChannelArt(channelId: focused.id)
                    }
                }
                .blur(radius: 90)
                .opacity(0.26)
                .id(focused.id)
                .transition(.opacity)
            }
            // Keep legibility: darken toward the reading areas.
            LinearGradient(colors: [.black.opacity(0.42), .black.opacity(0.18)],
                           startPoint: .top, endPoint: .bottom)
        }
        .animation(.easeInOut(duration: 0.6), value: focusedChannelId)
        .ignoresSafeArea()
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Fixed header — kept out of the ScrollView so focus-driven
                // scrolling can never push it off screen.
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("idle screens")
                            .font(.system(size: 56, weight: .bold))
                            .foregroundStyle(Color.textPrimary)
                        Text("ambient channels · \(app.channels.count) live")
                            .font(.callout)
                            .foregroundStyle(Color.textSecondary)
                    }
                    Spacer()
                    // Settings lives in the top tab bar — no header chrome,
                    // so the grid is the only focus surface on this screen.
                }
                .padding(.horizontal, 80)
                .padding(.top, 40)
                .padding(.bottom, 40)

                GeometryReader { geo in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 64) {
                            if app.channels.isEmpty, !app.isLoadingGallery {
                                ContentUnavailableView(
                                    "No channels",
                                    systemImage: "tv",
                                    description: Text(app.galleryError ?? "")
                                )
                            } else {
                                if let hero {
                                    Button {
                                        app.selectChannel(hero.id)
                                    } label: {
                                        // Cap at ~58% of the space left after the
                                        // tab bar + header so the whole hero —
                                        // scrim, label, pills — stays above the fold.
                                        HeroChannelCard(channel: hero, height: geo.size.height * 0.58)
                                    }
                                    .buttonStyle(.card)
                                    .focused($focusedChannelId, equals: hero.id)
                                }

                                if !featuredRail.isEmpty {
                                    ChannelSection(title: "featured") {
                                        CardGrid(channels: featuredRail, columns: columns, focusBinding: $focusedChannelId)
                                    }
                                }

                                ForEach(shelves, id: \.category.id) { shelf in
                                    ChannelSection(title: shelf.category.displayTitle,
                                                   subtitle: shelf.category.subtitle) {
                                        CardGrid(channels: shelf.channels, columns: columns, focusBinding: $focusedChannelId)
                                    }
                                }

                                if !rest.isEmpty {
                                    ChannelSection(title: shelves.isEmpty ? "channels" : "more channels") {
                                        CardGrid(channels: rest, columns: columns, focusBinding: $focusedChannelId)
                                    }
                                }
                            }

                        }
                        .padding(.horizontal, 80)
                        .padding(.bottom, 80)
                    }
                }
            }
            .background(focusBackdrop)
            .navigationDestination(isPresented: Binding(
                get: { app.selectedChannelId != nil },
                set: { if !$0 { app.exitChannel() } }
            )) {
                ScreenSaverView()
                    // Fullscreen means fullscreen: no floating tab bar over
                    // the scene while watching.
                    .toolbar(.hidden, for: .tabBar)
                    .toolbar(.hidden, for: .navigationBar)
            }
        }
        .task {
            if app.channels.isEmpty { await app.loadGallery() }
        }
    }
}

// MARK: - Sections

private struct ChannelSection<Content: View>: View {
    let title: String
    var subtitle: String? = nil
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 28) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(Color.textPrimary.opacity(0.92))
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.system(size: 24))
                        .foregroundStyle(Color.textSecondary)
                }
            }
            content
        }
    }
}

private struct CardGrid: View {
    @Environment(TVAppState.self) private var app
    let channels: [PublicChannel]
    let columns: [GridItem]
    /// Reported upward so the focused card can drive the grid's billboard.
    var focusBinding: FocusState<String?>.Binding

    var body: some View {
        LazyVGrid(columns: columns, spacing: 48) {
            ForEach(channels) { channel in
                Button {
                    app.selectChannel(channel.id)
                } label: {
                    ChannelCard(channel: channel)
                }
                .buttonStyle(.card)
                .focused(focusBinding, equals: channel.id)
            }
        }
    }
}

// MARK: - Card

private struct ChannelCard: View {
    @Environment(TVAppState.self) private var app
    let channel: PublicChannel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Fixed 16:9 poster. Priority: live native scene (the product
            // promise; canvas-capable t3 hardware only, rendered on a virtual
            // 1080p canvas so it's an exact miniature of fullscreen) → web
            // thumb → deterministic generative art.
            Group {
                if let spec = channel.spec,
                   app.effectiveTier == .t3 || app.effectiveTier == .t2 {
                    ScenePreviewView(spec: spec, fallbackSeed: channel.id, live: false)
                        // Belt-and-suspenders: if the preview's canvas layer
                        // ever drops out (system layer eviction renders it
                        // transparent), designed art shows — never a black tile.
                        .background(ProceduralChannelArt(channelId: channel.id))
                        .opacity((channel.sleeping ?? false) ? 0.35 : 1)
                } else if let kind = ClassicSaverKind.supported(id: channel.classicSaverId),
                          let tier = app.classicRenderTier {
                    // Classic savers have no schema spec — poster them from
                    // the native port (one static frame, same seed as the
                    // fullscreen view) rather than the server thumb, which
                    // for these channels is usually black.
                    ClassicSaverView(kind: kind,
                                     seed: ClassicSaverKind.seed(forChannel: channel.id),
                                     tier: tier,
                                     live: false)
                        .opacity((channel.sleeping ?? false) ? 0.35 : 1)
                } else {
                    ThumbImage(url: app.gallery.thumbURL(for: channel.id)) {
                        ProceduralChannelArt(channelId: channel.id)
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(16.0 / 9.0, contentMode: .fit)
            .clipped()
            .clipShape(RoundedRectangle(cornerRadius: 16))

            VStack(alignment: .leading, spacing: 5) {
                // Editorial kicker — category in caps above the title,
                // the Apple TV+ lockup grammar.
                if let tags = channel.tags?.filter({ $0 != "featured" }), !tags.isEmpty {
                    Text(tags.prefix(2).joined(separator: " · ").uppercased())
                        .font(.system(size: 20, weight: .semibold))
                        .kerning(1.8)
                        .foregroundStyle(Color.textTertiary)
                        .lineLimit(1)
                }
                Text(channel.displayLabel)
                    .font(.system(size: 30, weight: .medium))
                    .foregroundStyle(Color.textPrimary)
                    .lineLimit(1)
                HStack(spacing: 10) {
                    if channel.sleeping ?? false {
                        Label("sleeping", systemImage: "moon.zzz.fill")
                            .foregroundStyle(Color.textTertiary)
                    } else if let viewers = channel.viewers, viewers > 0 {
                        HStack(spacing: 8) {
                            Circle().fill(Color.appAccent).frame(width: 9, height: 9)
                            Text(viewers == 1 ? "1 watching" : "\(viewers) watching")
                        }
                        .foregroundStyle(Color.textSecondary)
                    }
                }
                .font(.system(size: 23))
            }
        }
    }
}
