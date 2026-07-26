import SwiftUI

/// Public channel gallery, streaming-service style: a hero billboard for the
/// featured channel, then horizontally scrolling shelves grouped by tag.
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
                        HeroBillboard(channel: hero, compact: sizeClass != .regular)
                            .padding(.horizontal, 16)
                    }
                    ForEach(shelves) { shelf in
                        ChannelShelf(
                            title: shelf.title,
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
            .navigationTitle("watch")
            .refreshable { await app.loadGallery() }
        }
        .task {
            if app.channels.isEmpty { await app.loadGallery() }
        }
    }

    // MARK: Curation

    /// Featured channels compete for the billboard, but visual richness picks
    /// the winner — a near-black minimal scene makes a terrible hero even
    /// when it's tagged featured.
    private var heroChannel: PublicChannel? {
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

    private struct Shelf: Identifiable {
        let title: String
        let channels: [PublicChannel]
        var id: String { title }
    }

    /// One shelf per primary tag (a channel lives on its first tag's shelf),
    /// ordered by shelf size. Single-channel tags and untagged channels all
    /// pool into a trailing "more" shelf — one-item rows read as broken.
    private var shelves: [Shelf] {
        var groups: [String: [PublicChannel]] = [:]
        for channel in app.channels {
            let key = channel.tags?.first ?? "more"
            groups[key, default: []].append(channel)
        }
        var more = groups.removeValue(forKey: "more") ?? []
        for (key, value) in groups where value.count == 1 && key != "featured" {
            more.append(contentsOf: value)
            groups.removeValue(forKey: key)
        }
        var result = groups
            .sorted { lhs, rhs in
                if lhs.key == "featured" { return true }
                if rhs.key == "featured" { return false }
                if lhs.value.count != rhs.value.count { return lhs.value.count > rhs.value.count }
                return lhs.key < rhs.key
            }
            .map { Shelf(title: $0.key, channels: $0.value) }
        if !more.isEmpty {
            result.append(Shelf(title: "more", channels: more.sorted { $0.displayLabel < $1.displayLabel }))
        }
        return result
    }
}

// MARK: - Hero billboard

private struct HeroBillboard: View {
    let channel: PublicChannel
    let compact: Bool

    var body: some View {
        NavigationLink(destination: ChannelViewerView(channelId: channel.id, label: channel.displayLabel)) {
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
                        Text(channel.displayLabel)
                            .font(.system(size: compact ? 30 : 40, weight: .bold))
                            .foregroundStyle(Color.textPrimary)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        if let tags = channel.tags, !tags.isEmpty {
                            Text(tags.joined(separator: " · "))
                                .font(.subheadline)
                                .foregroundStyle(Color.textSecondary)
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
    let channels: [PublicChannel]
    let cardWidth: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Color.textPrimary)
                .padding(.horizontal, 16)

            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 12) {
                    ForEach(channels) { channel in
                        ChannelCard(channel: channel, width: cardWidth)
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

    var body: some View {
        NavigationLink(destination: ChannelViewerView(channelId: channel.id, label: channel.displayLabel)) {
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

                Text(channel.displayLabel)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Color.textPrimary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
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
