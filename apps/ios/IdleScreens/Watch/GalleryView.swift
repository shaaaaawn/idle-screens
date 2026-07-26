import SwiftUI

/// Public channel gallery with live native previews and pull-to-refresh.
/// Compact width (iPhone) renders a list; regular width (iPad, landscape
/// splits) renders a poster-card grid like the tvOS app.
struct GalleryView: View {
    @Environment(AppState.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        NavigationStack {
            Group {
                if sizeClass == .regular {
                    ChannelGrid()
                } else {
                    ChannelList()
                }
            }
            .background(Color.appBackground)
            .overlay {
                if app.channels.isEmpty, !app.isLoadingGallery {
                    ContentUnavailableView {
                        Label("No channels", systemImage: "tv")
                    } description: {
                        Text(app.galleryError ?? "Pull to refresh.")
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
}

// MARK: - Compact: list

private struct ChannelList: View {
    @Environment(AppState.self) private var app

    var body: some View {
        List(app.channels) { channel in
            NavigationLink(destination: ChannelViewerView(channelId: channel.id, label: channel.displayLabel)) {
                HStack(spacing: 12) {
                    ChannelPreviewTile(channel: channel)
                        .frame(width: 112, height: 63)
                        .clipShape(RoundedRectangle(cornerRadius: 8))

                    ChannelMeta(channel: channel)
                }
            }
            .listRowBackground(Color.appBackground)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
    }
}

// MARK: - Regular: poster grid

private struct ChannelGrid: View {
    @Environment(AppState.self) private var app

    private let columns = [GridItem(.adaptive(minimum: 300, maximum: 420), spacing: 20)]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 24) {
                ForEach(app.channels) { channel in
                    NavigationLink(destination: ChannelViewerView(channelId: channel.id, label: channel.displayLabel)) {
                        VStack(alignment: .leading, spacing: 10) {
                            ChannelPreviewTile(channel: channel)
                                .aspectRatio(16.0 / 9.0, contentMode: .fit)
                                .clipShape(RoundedRectangle(cornerRadius: 12))

                            ChannelMeta(channel: channel)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(20)
        }
    }
}

// MARK: - Shared pieces

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

private struct ChannelMeta: View {
    let channel: PublicChannel

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(channel.displayLabel)
                .foregroundStyle(Color.textPrimary)
            HStack(spacing: 8) {
                if let viewers = channel.viewers {
                    Label("\(viewers)", systemImage: "eye")
                }
                if let tags = channel.tags, !tags.isEmpty {
                    Text(tags.joined(separator: " · "))
                        .lineLimit(1)
                }
            }
            .font(.caption)
            .foregroundStyle(Color.textSecondary)
        }
    }
}
