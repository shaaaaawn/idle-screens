import SwiftUI

/// The feed: flip vertically through channels, sideways through one channel's
/// past.
///
/// Two axes, one meaning each, everywhere this appears:
///
/// - **Vertical is which channel.** Up and down, one full page at a time — the
///   gesture a thumb already knows.
/// - **Horizontal is when.** The first page of every channel is live; each
///   swipe left goes one scene further back.
///
/// It is the Watch tab's root (every channel, latest update first) and also
/// what a card on the Channels tab opens (that shelf, starting on the card you
/// tapped) — so the gestures never change meaning between the two.
///
/// Built from nested paging `ScrollView`s. UIKit direction-locks nested scroll
/// views natively, which is what makes a diagonal drag resolve to one axis
/// instead of fighting — no gesture arbitration of our own.
struct ChannelFeedView: View {
    let channels: [PublicChannel]
    var showsBack: Bool = false
    @State private var selection: String?
    /// A feed that is not on screen must hold nothing. `TabView` keeps every
    /// tab's view tree alive, so without this the Watch tab's page kept its web
    /// view and socket running behind the Channels tab — the viewer count read
    /// 2 for one phone, and a hidden scene burned CPU.
    @State private var isOnScreen = false
    /// One switch for the whole feed: hide the chrome on one channel and it
    /// stays hidden as you flip, and the status bar goes with it.
    @State private var chromeHidden = false
    @Environment(\.scenePhase) private var scenePhase

    init(channels: [PublicChannel], start: String? = nil, showsBack: Bool = false) {
        self.channels = channels
        self.showsBack = showsBack
        _selection = State(initialValue: start ?? channels.first?.id)
    }

    var body: some View {
        // Read the insets BEFORE discarding them: the feed ignores the safe
        // area so scenes run edge to edge, which also strips the insets from
        // everything inside it. Each page's chrome pads by these instead.
        GeometryReader { proxy in
            let insets = proxy.safeAreaInsets
            ScrollView(.vertical) {
                LazyVStack(spacing: 0) {
                    ForEach(channels) { channel in
                        FeedPage(channel: channel,
                                 // Exactly one page holds a web view and a socket.
                                 isActive: isOnScreen && scenePhase == .active
                                     && channel.id == selection,
                                 showsBack: showsBack,
                                 chromeHidden: $chromeHidden)
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
        .statusBarHidden(chromeHidden)
        .navigationBarBackButtonHidden()
        .toolbar(.hidden, for: .navigationBar)
        .onAppear {
            isOnScreen = true
            UIApplication.shared.isIdleTimerDisabled = true
            // One full-screen canvas deserves the device; gallery tiles alive
            // on another tab have no business animating behind it.
            PreviewBudget.shared.enterFullscreen()
            if selection == nil { selection = channels.first?.id }
        }
        .onDisappear {
            isOnScreen = false
            UIApplication.shared.isIdleTimerDisabled = false
            PreviewBudget.shared.exitFullscreen()
        }
        // The feed can mount before the gallery has loaded.
        .onChange(of: channels.first?.id) { _, first in
            if selection == nil { selection = first }
        }
    }
}

/// The safe area a page's chrome should respect when the feed has thrown the
/// real one away to run edge to edge.
private struct ViewerChromeInsetsKey: EnvironmentKey {
    static let defaultValue = EdgeInsets()
}

extension EnvironmentValues {
    var viewerChromeInsets: EdgeInsets {
        get { self[ViewerChromeInsetsKey.self] }
        set { self[ViewerChromeInsetsKey.self] = newValue }
    }
}
