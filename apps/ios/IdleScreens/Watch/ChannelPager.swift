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
    /// Optional because `scrollPosition(id:)` binds an optional; it is never
    /// nil in practice — it starts on the channel you tapped.
    @State private var selection: String?

    init(channels: [PublicChannel], start: String) {
        self.channels = channels
        _selection = State(initialValue: start)
    }

    var body: some View {
        // Read the insets BEFORE discarding them. The pager has to ignore the
        // safe area so scenes run edge to edge — but that also strips the
        // insets from everything inside it, and the viewer's chrome ended up
        // drawn underneath the clock and the Dynamic Island.
        GeometryReader { proxy in
            let insets = proxy.safeAreaInsets
            // A paging ScrollView, not `TabView(.page)`: the TabView insets its
            // pages from the top even when told to ignore the safe area, which
            // left a 14pt black band above every scene.
            ScrollView(.horizontal) {
                LazyHStack(spacing: 0) {
                    ForEach(channels) { channel in
                        ChannelViewerView(
                            channelId: channel.id,
                            label: channel.displayLabel,
                            // Exactly one page holds a web view and a socket.
                            isActive: channel.id == selection
                        )
                        .environment(\.viewerChromeInsets, insets)
                        .containerRelativeFrame([.horizontal, .vertical])
                        .id(channel.id)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.paging)
            .scrollPosition(id: $selection)
            .scrollIndicators(.hidden)
            .ignoresSafeArea()
        }
        .background(Color.black.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar, .tabBar)
    }
}

/// The safe area the viewer's chrome should respect when an ancestor has
/// thrown the real one away. Zero outside a pager, where SwiftUI's own
/// safe area is intact and no extra padding is wanted.
private struct ViewerChromeInsetsKey: EnvironmentKey {
    static let defaultValue = EdgeInsets()
}

extension EnvironmentValues {
    var viewerChromeInsets: EdgeInsets {
        get { self[ViewerChromeInsetsKey.self] }
        set { self[ViewerChromeInsetsKey.self] = newValue }
    }
}
