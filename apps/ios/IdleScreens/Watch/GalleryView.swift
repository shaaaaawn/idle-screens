import SwiftUI

/// Public channel gallery with live thumbnails and pull-to-refresh.
struct GalleryView: View {
    @Environment(AppState.self) private var app

    var body: some View {
        NavigationStack {
            List(app.channels) { channel in
                NavigationLink(destination: ChannelViewerView(channelId: channel.id, label: channel.displayLabel)) {
                    ChannelRow(channel: channel)
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
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

private struct ChannelRow: View {
    @Environment(AppState.self) private var app
    let channel: PublicChannel

    var body: some View {
        HStack(spacing: 12) {
            AsyncImage(url: app.gallery.thumbURL(for: channel.id)) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                default:
                    Color.appSurfaceRaised
                }
            }
            .frame(width: 96, height: 54)
            .clipShape(RoundedRectangle(cornerRadius: 8))

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
        .listRowBackground(Color.appBackground)
    }
}
