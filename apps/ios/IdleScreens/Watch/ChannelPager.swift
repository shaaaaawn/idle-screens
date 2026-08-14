import SwiftUI

/// Swipe sideways to change the channel.
///
/// The axis model this commits to: **horizontal is space** (which channel),
/// leaving **vertical free to mean time** (a channel's history and schedule)
/// when that lands. Fixing the meaning per axis is what stops a gesture having
/// to be learned twice.
///
/// You page within the shelf you entered from, so context is preserved — enter
/// from "featured" and you move through featured, not through everything.
struct ChannelPager: View {
    let channels: [PublicChannel]
    @State private var selection: String

    init(channels: [PublicChannel], start: String) {
        self.channels = channels
        _selection = State(initialValue: start)
    }

    var body: some View {
        TabView(selection: $selection) {
            ForEach(channels) { channel in
                ChannelViewerView(
                    channelId: channel.id,
                    label: channel.displayLabel,
                    // Exactly one page holds a live socket.
                    isActive: channel.id == selection
                )
                .tag(channel.id)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        // The scene is the content; page dots over live artwork are noise, and
        // the chrome already names the channel you're on.
        .ignoresSafeArea()
        .background(Color.black.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar, .tabBar)
    }
}
