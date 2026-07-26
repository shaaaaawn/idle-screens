import SwiftUI

/// Focus-driven gallery of channel poster cards.
struct ChannelGridView: View {
    @Environment(TVAppState.self) private var app
    @State private var showingSettings = false

    // Fixed 3-up: cinematic posters (~554pt) over many small tiles.
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 56), count: 3)

    /// Presentation order: featured first, then most-watched, then awake
    /// channels, then alphabetical. Broken-looking channels sink naturally.
    private var sortedChannels: [PublicChannel] {
        app.channels.sorted { a, b in
            let af = a.tags?.contains("featured") ?? false
            let bf = b.tags?.contains("featured") ?? false
            if af != bf { return af }
            let av = a.viewers ?? 0, bv = b.viewers ?? 0
            if av != bv { return av > bv }
            let asleep = a.sleeping ?? false, bsleep = b.sleeping ?? false
            if asleep != bsleep { return bsleep }
            return a.displayLabel.localizedCaseInsensitiveCompare(b.displayLabel) == .orderedAscending
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Fixed header — kept out of the ScrollView so focus-driven
                // scrolling can never push it off screen.
                HStack(alignment: .firstTextBaseline, spacing: 20) {
                    Text("idle screens")
                        .font(.system(size: 50, weight: .bold))
                        .foregroundStyle(Color.textPrimary)
                    if !app.channels.isEmpty {
                        Text("\(app.channels.count) channels")
                            .font(.system(size: 24))
                            .foregroundStyle(Color.textTertiary)
                    }
                    Spacer()
                    Button {
                        showingSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                            .font(.system(size: 30))
                    }
                    .buttonStyle(.borderless)
                }
                .padding(.horizontal, 90)
                .padding(.top, 40)
                .padding(.bottom, 28)

                ScrollView {
                    VStack(spacing: 48) {
                        if app.channels.isEmpty, !app.isLoadingGallery {
                            ContentUnavailableView(
                                "No channels",
                                systemImage: "tv",
                                description: Text(app.galleryError ?? "")
                            )
                        } else {
                            LazyVGrid(columns: columns, spacing: 56) {
                                ForEach(sortedChannels) { channel in
                                    // Poster-only card button; the text lockup
                                    // sits outside so the focus platter and
                                    // lift apply to the artwork alone.
                                    VStack(alignment: .leading, spacing: 14) {
                                        Button {
                                            app.selectChannel(channel.id)
                                        } label: {
                                            ChannelPoster(channel: channel)
                                        }
                                        .buttonStyle(.card)
                                        ChannelLockup(channel: channel)
                                    }
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 90)
                    .padding(.bottom, 70)
                }
            }
            .background(Color.appBackground.ignoresSafeArea())
            .navigationDestination(isPresented: Binding(
                get: { app.selectedChannelId != nil },
                set: { if !$0 { app.exitChannel() } }
            )) {
                ScreenSaverView()
            }
            .sheet(isPresented: $showingSettings) {
                SettingsView()
            }
            // A paired phone can push a channel while Settings (the pairing
            // QR) is up — drop the sheet so the saver is actually visible.
            .onChange(of: app.selectedChannelId) {
                if app.selectedChannelId != nil { showingSettings = false }
            }
        }
        .task {
            if app.channels.isEmpty { await app.loadGallery() }
        }
    }
}

/// The focusable 16:9 artwork. Poster priority: live native scene (the
/// product promise) → web thumb (classic channels) → deterministic gradient.
/// Live previews only on canvas-capable tiers; sleeping scenes render dimmed.
private struct ChannelPoster: View {
    @Environment(TVAppState.self) private var app
    let channel: PublicChannel

    private var isSleeping: Bool { channel.sleeping ?? false }

    var body: some View {
        // Color.clear owns the frame (a scaledToFill image ignores the height
        // proposal and would inflate the card); overlays overflow and clip.
        Color.clear
            .aspectRatio(16.0 / 9.0, contentMode: .fit)
            .overlay { poster }
            .overlay {
                // Hairline keeps near-black posters from melting into
                // the page background.
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(.white.opacity(0.08), lineWidth: 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    @ViewBuilder private var poster: some View {
        // Live previews are Canvas-rendered — t3 hardware only. t2 devices
        // (A8/A10X) get static art; nine live scenes would swamp them.
        if let spec = channel.spec, app.effectiveTier == .t3 {
            ScenePreviewView(spec: spec, fallbackSeed: channel.id)
                .opacity(isSleeping ? 0.35 : 1)
        } else {
            AsyncImage(url: app.gallery.thumbURL(for: channel.id)) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                default:
                    GradientPlaceholder(seedText: channel.id)
                }
            }
            .opacity(isSleeping ? 0.35 : 1)
        }
    }
}

/// Title + meta row, outside the focus platter.
private struct ChannelLockup: View {
    let channel: PublicChannel

    private var isSleeping: Bool { channel.sleeping ?? false }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(channel.displayLabel)
                .font(.system(size: 31, weight: .medium))
                .foregroundStyle(Color.textPrimary)
                .lineLimit(1)
            HStack(spacing: 10) {
                if isSleeping {
                    Label("sleeping", systemImage: "moon.zzz.fill")
                        .labelStyle(.titleAndIcon)
                        .foregroundStyle(Color.textTertiary)
                } else if let viewers = channel.viewers, viewers > 0 {
                    HStack(spacing: 8) {
                        Circle().fill(Color.appAccent).frame(width: 10, height: 10)
                        Text(viewers == 1 ? "1 watching" : "\(viewers) watching")
                    }
                    .foregroundStyle(Color.textSecondary)
                }
                if let tags = channel.tags, !tags.isEmpty {
                    Text(tags.prefix(3).joined(separator: " · "))
                        .foregroundStyle(Color.textTertiary)
                        .lineLimit(1)
                }
            }
            // tvOS HIG: secondary labels ≥25pt at 10-foot distance.
            .font(.system(size: 25))
        }
        .padding(.horizontal, 6)
    }
}

/// Last-resort poster: a per-channel deterministic dark duotone, so even a
/// channel with no spec and no thumb reads as designed, not broken.
private struct GradientPlaceholder: View {
    let seedText: String

    var body: some View {
        let hue = Double(seedText.utf8.reduce(UInt32(2_166_136_261)) {
            ($0 ^ UInt32($1)) &* 16_777_619
        } % 360) / 360
        LinearGradient(
            colors: [
                Color(hue: hue, saturation: 0.45, brightness: 0.16),
                Color(hue: (hue + 0.09).truncatingRemainder(dividingBy: 1),
                      saturation: 0.55, brightness: 0.05),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}
