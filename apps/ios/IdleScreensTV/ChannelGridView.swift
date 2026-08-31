import SwiftUI

/// 10-foot gallery: a cinematic hero, then the editorial shelves — the same
/// running order the web home page uses (see HomeSections).
struct ChannelGridView: View {
    @Environment(TVAppState.self) private var app
    @FocusState private var focusedChannelId: String?

    private let columns = Array(repeating: GridItem(.flexible(), spacing: TV.columnGap), count: 3)

    /// The home screen's running order, shared with the web gallery.
    /// See HomeSections — the grouping and sort rules live there so the two
    /// surfaces cannot drift apart.
    private var layout: HomeSections.Layout {
        HomeSections.layout(channels: app.channels, categories: app.categories)
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
                            .font(.tvDisplay)
                            .foregroundStyle(Color.textPrimary)
                        Text("ambient channels · \(app.channels.count) live")
                            .font(.tvSubtitle)
                            .foregroundStyle(Color.textSecondary)
                    }
                    Spacer()
                    // Settings lives in the top tab bar — no header chrome,
                    // so the grid is the only focus surface on this screen.
                }
                .padding(.horizontal, TV.gutter)
                .padding(.top, TV.headerTop)
                .padding(.bottom, TV.sectionGap / 2)

                GeometryReader { geo in
                    ScrollView {
                        VStack(alignment: .leading, spacing: TV.sectionGap) {
                            if app.channels.isEmpty, !app.isLoadingGallery {
                                ContentUnavailableView(
                                    "No channels",
                                    systemImage: "tv",
                                    description: Text(app.galleryError ?? "")
                                )
                            } else {
                                let layout = layout
                                if let hero = layout.hero {
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

                                ForEach(layout.sections) { section in
                                    ChannelSection(title: section.title,
                                                   subtitle: section.subtitle) {
                                        CardGrid(channels: section.channels, columns: columns,
                                                 focusBinding: $focusedChannelId,
                                                 hiddenTags: section.ownedTags)
                                    }
                                }
                            }

                        }
                        .padding(.horizontal, TV.gutter)
                        .padding(.bottom, TV.gutter)
                    }
                    .modifier(DefaultChannelFocus(id: layout.hero?.id ?? layout.sections.first?.channels.first?.id,
                                                  binding: $focusedChannelId))
                }
            }
            .background(focusBackdrop)
            .navigationDestination(isPresented: Binding(
                get: { app.selectedChannelId != nil && app.presentingSurface == .grid },
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
        VStack(alignment: .leading, spacing: TV.headerGap) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.tvShelfTitle)
                    .foregroundStyle(Color.textPrimary)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.tvSubtitle)
                        .foregroundStyle(Color.textSecondary)
                }
            }
            content
        }
    }
}

/// `defaultFocus` takes a non-optional value, but the hero only exists once
/// channels load — so apply it when there is something to focus and leave the
/// view untouched until then.
private struct DefaultChannelFocus: ViewModifier {
    let id: String?
    var binding: FocusState<String?>.Binding

    func body(content: Content) -> some View {
        if let id {
            content.defaultFocus(binding, id)
        } else {
            content
        }
    }
}

private struct CardGrid: View {
    let channels: [PublicChannel]
    let columns: [GridItem]
    /// Reported upward so the focused card can drive the grid's billboard.
    var focusBinding: FocusState<String?>.Binding
    /// Tags the surrounding shelf already says out loud — a "featured" chip
    /// under a heading that reads Featured is a word repeated four times.
    var hiddenTags: Set<String> = []

    var body: some View {
        LazyVGrid(columns: columns, spacing: TV.rowGap) {
            ForEach(channels) { channel in
                ChannelCard(channel: channel,
                            focusBinding: focusBinding,
                            hiddenTags: hiddenTags)
            }
        }
    }
}

// MARK: - Card

/// A poster button with its caption BELOW it, deliberately outside the
/// button. `.card` paints its own chrome behind whatever it wraps, so a
/// label containing the text drew a slab of it across the poster's bottom
/// edge — the single worst artifact on the grid. Keeping the button to the
/// artwork also means focus lifts the poster alone, which is the Apple TV
/// lockup: image moves, text stays put.
struct ChannelCard: View {
    @Environment(TVAppState.self) private var app
    let channel: PublicChannel
    var focusBinding: FocusState<String?>.Binding
    var hiddenTags: Set<String> = []
    /// Which surface is pushing the player, so backing out returns here.
    var surface: TVAppState.ChannelSurface = .grid

    private var isFocused: Bool { focusBinding.wrappedValue == channel.id }

    var body: some View {
        VStack(alignment: .leading, spacing: TV.captionGap) {
            Button {
                app.selectChannel(channel.id, from: surface)
            } label: {
                ChannelPoster(channel: channel)
            }
            .buttonStyle(.card)
            .focused(focusBinding, equals: channel.id)
            .accessibilityLabel(accessibilityLabel)

            caption
        }
    }

    /// Title block. The focused card's caption comes up to full strength and
    /// the rest sit back — the row reads as one selection, not twelve equal
    /// labels competing at 10 feet.
    private var caption: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let kicker {
                Text(kicker)
                    .font(.tvKicker)
                    .kerning(1.6)
                    .foregroundStyle(Color.textSecondary)
                    .lineLimit(1)
            }
            Text(channel.displayLabel)
                .font(.tvCardTitle)
                .foregroundStyle(Color.textPrimary.opacity(isFocused ? 1 : 0.72))
                .lineLimit(1)
            status
        }
        .animation(TV.focusAnimation, value: isFocused)
        // The caption belongs to the poster above it; VoiceOver reads the
        // button's label instead of these three fragments.
        .accessibilityHidden(true)
    }

    @ViewBuilder private var status: some View {
        if channel.sleeping ?? false {
            Label("sleeping", systemImage: "moon.zzz.fill")
                .font(.tvMeta)
                .foregroundStyle(Color.textSecondary.opacity(0.8))
        } else if let viewers = channel.viewers, viewers > 0 {
            HStack(spacing: 8) {
                Circle()
                    .fill(Color.appAccent)
                    .frame(width: 10, height: 10)
                Text(viewers == 1 ? "1 watching" : "\(viewers) watching")
            }
            .font(.tvMeta)
            .foregroundStyle(Color.textSecondary)
        } else {
            // Hold the line's height so titles across a row stay aligned
            // whether or not anyone is watching.
            Text(" ").font(.tvMeta)
        }
    }

    private var kicker: String? {
        let hidden = hiddenTags.union(["featured"])
        guard let tags = channel.tags?.filter({ !hidden.contains($0) }), !tags.isEmpty else { return nil }
        return tags.prefix(2).joined(separator: " · ").uppercased()
    }

    private var accessibilityLabel: String {
        var parts = [channel.displayLabel]
        if channel.sleeping ?? false {
            parts.append("sleeping")
        } else if let viewers = channel.viewers, viewers > 0 {
            parts.append(viewers == 1 ? "1 watching" : "\(viewers) watching")
        }
        return parts.joined(separator: ", ")
    }
}

/// The artwork alone — everything the focus engine lifts, and nothing else.
struct ChannelPoster: View {
    @Environment(TVAppState.self) private var app
    let channel: PublicChannel

    var body: some View {
        ZStack {
            // Priority: live native scene (the product promise; rendered on a
            // virtual 1080p canvas so it's an exact miniature of fullscreen)
            // → native classic port → web thumb → deterministic art.
            if let spec = channel.spec,
               app.effectiveTier == .t3 || app.effectiveTier == .t2 {
                ScenePreviewView(spec: spec, fallbackSeed: channel.id, live: false)
                    // Belt-and-suspenders: if the preview's canvas layer ever
                    // drops out (system layer eviction renders it
                    // transparent), designed art shows — never a black tile.
                    .background(ProceduralChannelArt(channelId: channel.id))
            } else if let kind = ClassicSaverKind.supported(id: channel.classicSaverId),
                      let tier = app.classicRenderTier {
                // Classic savers have no schema spec — poster them from the
                // native port (one static frame, same seed as the fullscreen
                // view) rather than the server thumb, which is usually black.
                ClassicSaverView(kind: kind,
                                 seed: ClassicSaverKind.seed(forChannel: channel.id),
                                 tier: tier,
                                 live: false)
            } else {
                ThumbImage(url: app.gallery.thumbURL(for: channel.id)) {
                    ProceduralChannelArt(channelId: channel.id)
                }
            }

            if channel.sleeping ?? false {
                // Sleeping is a state worth seeing at a glance, so say it on
                // the artwork rather than only in the caption below.
                Color.black.opacity(0.55)
                Image(systemName: "moon.zzz.fill")
                    .font(.system(.title3))
                    .foregroundStyle(.white.opacity(0.85))
            }
        }
        .frame(maxWidth: .infinity)
        .aspectRatio(16.0 / 9.0, contentMode: .fit)
        .clipped()
        .clipShape(RoundedRectangle(cornerRadius: TV.cardRadius))
    }
}
