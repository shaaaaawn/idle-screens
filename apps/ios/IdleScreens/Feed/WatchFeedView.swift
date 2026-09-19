import SwiftUI

/// The Watch tab: every channel, latest update first. Open the app and
/// something is already playing — browsing is the Channels tab's job.
struct WatchFeedView: View {
    @Environment(AppState.self) private var app

    /// QA affordance, mirroring the TV app: `-channel <id>` opens the feed on
    /// that channel instead of the newest, so a specific scene can be checked
    /// without flipping to it.
    private static let launchChannel: String? = {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-channel"), args.indices.contains(i + 1) else { return nil }
        return args[i + 1]
    }()

    private var feed: [PublicChannel] {
        ChannelFeed.latestFirst(app.channels) { app.token(for: $0.id) != nil }
    }

    var body: some View {
        NavigationStack {
            Group {
                if feed.isEmpty {
                    // First run has no cache: never a bare black screen.
                    ZStack {
                        Color.appBackground.ignoresSafeArea()
                        if app.isLoadingGallery {
                            ProgressView().tint(Color.textSecondary).controlSize(.large)
                        } else {
                            ContentUnavailableView {
                                Label("Nothing on air", systemImage: "play.tv")
                            } description: {
                                Text(app.galleryError ?? "Pull down on Channels to refresh.")
                            } actions: {
                                Button("Try again") { Task { await app.loadGallery() } }
                            }
                        }
                    }
                } else {
                    // A refresh can reorder this list under you. The feed's
                    // scroll position is bound to a channel ID, not an index,
                    // so the page you are on stays put while its neighbours
                    // change.
                    ChannelFeedView(channels: feed,
                                    start: feed.contains { $0.id == Self.launchChannel } ? Self.launchChannel : nil)
                }
            }
            .toolbar(.hidden, for: .navigationBar)
        }
        .task {
            if app.channels.isEmpty { await app.loadGallery() }
        }
    }
}
