import SwiftUI

/// Public channel gallery, streaming-service style: a hero billboard for the
/// channel that is live now, then the same shelves in the same order as the
/// web home page (`HomeSections`).
/// Every tile is a live native render of the channel's scene — the content
/// showcases itself.
struct GalleryView: View {
    @Environment(AppState.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 32) {
                    if let hero = heroChannel {
                        HeroBillboard(channel: hero, compact: sizeClass != .regular,
                                      peers: app.channels)
                            .padding(.horizontal, 16)
                    }
                    ForEach(shelves) { shelf in
                        ChannelShelf(
                            title: shelf.title,
                            subtitle: shelf.subtitle,
                            ownedTags: shelf.ownedTags,
                            channels: shelf.channels,
                            cardWidth: sizeClass == .regular ? 224 : 148
                        )
                    }
                }
                .padding(.vertical, 8)
            }
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
            .navigationTitle("channels")
            .refreshable { await app.loadGallery() }
        }
        .task {
            if app.channels.isEmpty { await app.loadGallery() }
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
    private var shelves: [HomeSection] {
        HomeSections.build(channels: app.channels, categories: app.categories)
    }
}

// MARK: - Hero billboard

private struct HeroBillboard: View {
    let channel: PublicChannel
    let compact: Bool
    var peers: [PublicChannel] = []

    var body: some View {
        NavigationLink(destination: ChannelFeedView(
            channels: peers.isEmpty ? [channel] : peers, start: channel.id, showsBack: true)) {
            ChannelPreviewTile(channel: channel)
                .aspectRatio(compact ? 4.0 / 5.0 : 21.0 / 9.0, contentMode: .fit)
                .overlay(alignment: .bottom) {
                    LinearGradient(
                        colors: [.clear, Color.appBackground.opacity(0.65), Color.appBackground.opacity(0.95)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .frame(height: 180)
                }
                .overlay(alignment: .bottomLeading) {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 6) {
                            Circle().fill(Color.appSuccess).frame(width: 7, height: 7)
                            Text("LIVE NOW")
                                .font(.caption2.weight(.bold))
                                .tracking(1.2)
                                .foregroundStyle(Color.textSecondary)
                        }
                        Text(channel.displayLabel)
                            .font(.system(size: compact ? 30 : 40, weight: .bold))
                            .foregroundStyle(Color.textPrimary)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        // The web hero leads with what the channel is DOING — its
                        // last event, and who made it — rather than its tags.
                        if let summary = channel.lastSteer?.summary, !summary.isEmpty {
                            Text(summary)
                                .font(.subheadline)
                                .foregroundStyle(Color.textSecondary)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                        }
                        if let steered = SteerLine.text(for: channel) {
                            Text(steered)
                                .font(.caption)
                                .foregroundStyle(Color.textTertiary)
                                .lineLimit(1)
                        }
                        HStack(spacing: 12) {
                            Label("Watch", systemImage: "play.fill")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Color.appBackground)
                                .padding(.horizontal, 18)
                                .padding(.vertical, 9)
                                .background(Color.textPrimary, in: Capsule())
                            if let viewers = channel.viewers, viewers > 0 {
                                Label("\(viewers) watching", systemImage: "eye")
                                    .font(.footnote)
                                    .foregroundStyle(Color.textSecondary)
                            }
                        }
                    }
                    .padding(20)
                }
                .clipShape(RoundedRectangle(cornerRadius: 24))
                .overlay {
                    RoundedRectangle(cornerRadius: 24)
                        .strokeBorder(Color.appBorder.opacity(0.6), lineWidth: 1)
                }
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Shelf

private struct ChannelShelf: View {
    let title: String
    var subtitle: String?
    var ownedTags: Set<String> = []
    let channels: [PublicChannel]
    let cardWidth: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Color.textPrimary)
                if let subtitle {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(Color.textSecondary)
                }
            }
            .padding(.horizontal, 16)

            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 12) {
                    ForEach(channels) { channel in
                        ChannelCard(channel: channel, width: cardWidth, peers: channels, ownedTags: ownedTags)
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }
}

// MARK: - Poster card

private struct ChannelCard: View {
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
            channels: peers.isEmpty ? [channel] : peers, start: channel.id, showsBack: true)) {
            VStack(alignment: .leading, spacing: 8) {
                ChannelPreviewTile(channel: channel)
                    .frame(width: width, height: width * 9 / 16)
                    .overlay(alignment: .topTrailing) {
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
                    if let steered = SteerLine.text(for: channel) {
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
    }
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
