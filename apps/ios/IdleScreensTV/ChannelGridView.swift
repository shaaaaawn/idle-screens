import SwiftUI

/// 10-foot gallery: a cinematic hero, then the editorial shelves — the same
/// running order the web home page uses (see HomeSections).
struct ChannelGridView: View {
    @Environment(TVAppState.self) private var app
    /// Which card has focus, reported BY the cards. The grid owns no
    /// @FocusState: SwiftUI re-evaluates a focus state's owner on every move,
    /// which re-ran this whole body — every shelf, every card — per swipe.
    @State private var focus = FocusReport()
    /// The hero's focus alone, so launch can land on it (defaultFocus needs a
    /// focus state). A Bool for one view changes only when focus enters or
    /// leaves the hero — not on every swipe through the shelves.
    @FocusState private var heroFocused: Bool

    private let columns = Array(repeating: GridItem(.flexible(), spacing: TV.columnGap), count: 3)

    /// The home screen's running order, shared with the web gallery.
    /// See HomeSections — the grouping and sort rules live there so the two
    /// surfaces cannot drift apart.
    private var layout: HomeSections.Layout {
        HomeSections.layout(channels: app.channels, categories: app.categories)
    }

    var body: some View {
        let _ = RenderProbe.hit("grid.body")
        // Computed once per body, not per reference: it groups and sorts the
        // whole gallery.
        let layout = self.layout
        // The grid never READS the focused id — only the backdrop and the two
        // cards whose focus changed do — so a remote swipe re-evaluates those,
        // not every shelf on the screen.
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
                                    .focused($heroFocused)
                                    .onChange(of: heroFocused) { if heroFocused { focus.id = hero.id } }
                                }

                                ForEach(layout.sections) { section in
                                    ChannelSection(title: section.title,
                                                   subtitle: section.subtitle) {
                                        CardGrid(channels: section.channels, columns: columns,
                                                 focusReport: focus,
                                                 hiddenTags: section.ownedTags)
                                    }
                                }
                            }

                        }
                        .padding(.horizontal, TV.gutter)
                        .padding(.bottom, TV.gutter)
                    }
                    .defaultFocus($heroFocused, true)
                }
            }
            .background(FocusBackdrop(focus: focus))
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
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-probeswipes") { await probeSwipes() }
            #endif
        }
    }

    #if DEBUG
    /// Debug: while a UI test presses the remote, log what each focus change
    /// cost (draws and body evaluations since the previous one).
    private func probeSwipes() async {
        _ = RenderProbe.drain()
        var last = focus.id
        var moves = 0
        while moves < 40 {
            try? await Task.sleep(for: .milliseconds(50))
            guard focus.id != last else { continue }
            try? await Task.sleep(for: .milliseconds(450))    // let the move's work land
            let c = RenderProbe.drain()
            let line = c.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: " ")
            RenderProbe.log.notice("swipe \(moves) → \(focus.id ?? "-", privacy: .public) \(line, privacy: .public)")
            last = focus.id
            moves += 1
        }
    }
    #endif
}

// MARK: - Focus

/// The id of the focused card, as the cards report it. A reference the grid
/// hands down unchanged, so passing it never invalidates anything; only the
/// views that read `id` (the backdrop) follow focus.
@MainActor @Observable
final class FocusReport {
    var id: String?
}

// MARK: - Backdrop

/// The focused channel drives an ambient billboard behind the grid — its
/// scene, blurred and dimmed, so browsing feels like previewing. Its own view
/// so that following focus re-evaluates this, not the grid.
///
/// On the sprite tier (pre-4K boxes) it is a flat tint of the channel's key
/// colour instead: a 90 pt full-screen blur, crossfaded on every focus move,
/// is GPU work an A8/A10X cannot do while the grid scrolls — remote swipes
/// lagged on the home screen.
private struct FocusBackdrop: View {
    @Environment(TVAppState.self) private var app
    let focus: FocusReport

    var body: some View {
        let _ = RenderProbe.hit("backdrop.body")
        let focusedId = focus.id
        let focused = app.channels.first { $0.id == focusedId }
        let cheap = app.lightweightGallery
        ZStack {
            Color.appBackground
            if let focused {
                Group {
                    if cheap {
                        LinearGradient(colors: [Self.keyColor(of: focused).opacity(0.22), .clear],
                                       startPoint: .top, endPoint: .bottom)
                    } else {
                        Group {
                            if let spec = focused.spec {
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
                    }
                }
                .id(focused.id)
                .transition(.opacity)
            }
            // Keep legibility: darken toward the reading areas.
            LinearGradient(colors: [.black.opacity(0.42), .black.opacity(0.18)],
                           startPoint: .top, endPoint: .bottom)
        }
        .animation(.easeInOut(duration: cheap ? 0.3 : 0.6), value: focusedId)
        .ignoresSafeArea()
    }

    /// A channel's key colour: its scene's ground, else a classic saver's
    /// signature, else the app's own violet.
    static func keyColor(of channel: PublicChannel) -> Color {
        if let hex = channel.spec?.background?.primaryColor { return Color(hex: hex) }
        switch channel.classicSaverId {
        case "metaquarium": return Color(red: 0.05, green: 0.35, blue: 0.40)
        case "warp": return Color(red: 0.35, green: 0.40, blue: 0.85)
        case "rainstorm": return Color(red: 0.30, green: 0.45, blue: 0.60)
        default: return .appPrimary
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

private struct CardGrid: View {
    let channels: [PublicChannel]
    let columns: [GridItem]
    /// Where the focused card reports itself, to drive the grid's billboard.
    var focusReport: FocusReport?
    /// Tags the surrounding shelf already says out loud — a "featured" chip
    /// under a heading that reads Featured is a word repeated four times.
    var hiddenTags: Set<String> = []

    var body: some View {
        LazyVGrid(columns: columns, spacing: TV.rowGap) {
            ForEach(channels) { channel in
                ChannelCard(channel: channel,
                            focusReport: focusReport,
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
    /// Told when this card gains focus (the grid's billboard follows it).
    var focusReport: FocusReport? = nil
    var hiddenTags: Set<String> = []
    /// Which surface is pushing the player, so backing out returns here.
    var surface: TVAppState.ChannelSurface = .grid

    /// This card's own focus. A shared focus state read here made every card
    /// on screen re-evaluate on every remote swipe; this one changes for the
    /// two cards a move actually touches.
    @FocusState private var isFocused: Bool

    var body: some View {
        let _ = RenderProbe.hit("card.body")
        VStack(alignment: .leading, spacing: TV.captionGap) {
            Button {
                app.selectChannel(channel.id, from: surface)
            } label: {
                ChannelPoster(channel: channel)
            }
            .buttonStyle(.card)
            .focused($isFocused)
            .onChange(of: isFocused) { if isFocused { focusReport?.id = channel.id } }
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
            // Who made what is on, and when — the same line the phone and the
            // website print. A space still holds the row's height when a
            // channel has never been steered: no line beats a fake one.
            Text(SteerLine.cardLine(for: channel) ?? " ")
                .font(.tvMeta)
                .foregroundStyle(Color.textSecondary.opacity(0.8))
                .lineLimit(1)
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
                ScenePreviewView(spec: spec, fallbackSeed: channel.id, live: false,
                                 entityBudget: app.lightweightGallery
                                    ? app.renderClass.previewEntityBudget
                                    : SpecSubset.Budget.preview.entities)
                    // Belt-and-suspenders: if the preview's canvas layer ever
                    // drops out (system layer eviction renders it
                    // transparent), designed art shows — never a black tile.
                    // Where every canvas is CPU work, the scene's own ground
                    // colour does that job without a second canvas per tile.
                    .background {
                        if app.lightweightGallery {
                            Color(hex: spec.background?.primaryColor ?? "0A0A0F")
                        } else {
                            ProceduralChannelArt(channelId: channel.id)
                        }
                    }
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
