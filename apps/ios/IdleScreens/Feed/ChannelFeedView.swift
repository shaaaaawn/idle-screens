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
    /// Pull down on the first page. nil = this feed has nothing to refetch.
    var onRefresh: (() async -> Void)? = nil
    @State private var selection: String?
    /// Bumped after a refresh so the page on screen refetches its history too.
    @State private var refreshToken = 0
    /// A feed that is not on screen must hold nothing. `TabView` keeps every
    /// tab's view tree alive, so without this the Watch tab's page kept its web
    /// view and socket running behind the Channels tab — the viewer count read
    /// 2 for one phone, and a hidden scene burned CPU.
    @State private var isOnScreen = false
    /// One switch for the whole feed: hide the chrome on one channel and it
    /// stays hidden as you flip, and the status bar goes with it.
    @State private var chromeHidden = false
    /// A phone turned sideways (compact height): the player's full-screen
    /// mode. No tab bar, and the controls fade on their own like a video
    /// player's, back on a tap.
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    private var sideways: Bool { verticalSizeClass == .compact }
    @State private var autoHide: Task<Void, Never>?
    /// The order the pages are laid out in, by channel id. Held still while
    /// you watch: the caller's list is re-sorted "latest update first" on
    /// every gallery load (cold start swaps the disk cache for fresh data a
    /// second after mount; every return to foreground reloads), and a list
    /// that reorders under a paging scroll view leaves one channel ON SCREEN
    /// while another is SELECTED — the one on screen then never activates
    /// and sits there frozen. Re-sorted only on pull-to-refresh or reopening.
    @State private var order: [String] = []
    @Environment(\.scenePhase) private var scenePhase
    /// Away long enough that the page should let go of its web view and
    /// socket. A glance at another app, the app switcher or Control Center is
    /// not that: the page used to be torn down on any of them, and coming
    /// back reloaded the scene from nothing.
    @State private var parked = false
    @State private var parkTask: Task<Void, Never>?
    /// How long a backgrounded page keeps its scene alive.
    static let backgroundGrace: Duration = .seconds(120)

    /// The caller's channels, in the held order.
    private var pages: [PublicChannel] { FeedOrder.arrange(channels, by: order) }

    init(channels: [PublicChannel], start: String? = nil, showsBack: Bool = false,
         onRefresh: (() async -> Void)? = nil) {
        self.channels = channels
        self.showsBack = showsBack
        self.onRefresh = onRefresh
        _selection = State(initialValue: start ?? channels.first?.id)
    }

    var body: some View {
        // Read the insets BEFORE discarding them: the feed ignores the safe
        // area so scenes run edge to edge, which also strips the insets from
        // everything inside it. Each page's chrome pads by these instead.
        GeometryReader { proxy in
            let insets = proxy.safeAreaInsets
            ScrollViewReader { reader in
            ScrollView(.vertical) {
                LazyVStack(spacing: 0) {
                    ForEach(pages) { channel in
                        FeedPage(channel: channel,
                                 // Exactly one page holds a web view and a socket.
                                 isActive: isOnScreen && !parked
                                     && channel.id == selection,
                                 showsBack: showsBack,
                                 refreshToken: refreshToken,
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
            // ↑ ↓ on an iPad keyboard flip channel (the page on screen has
            // focus and passes these up; it keeps ← → for its history).
            .onKeyPress(.downArrow) { step(+1, reader: reader); return .handled }
            .onKeyPress(.upArrow) { step(-1, reader: reader); return .handled }
            // Pulling down past the newest channel asks for newer ones — the
            // gesture every feed has taught. After it, you land on whatever is
            // now first, because that is what you pulled for.
            .refreshable {
                guard let onRefresh else { return }
                await onRefresh()
                refreshToken += 1
                // The one moment a re-sort is wanted: it is what you pulled for.
                order = channels.map(\.id)
                select(pages.first?.id, reader: reader, animated: true)
            }
            .ignoresSafeArea()
            // Whatever changed the list, make the page on screen and the
            // selected page the same page again. `scrollPosition(id:)` alone
            // does not: an id set before its row is laid out is dropped.
            .onChange(of: order) { _, _ in resync(reader) }
            .onChange(of: channels) { _, refreshed in
                if order.isEmpty { order = refreshed.map(\.id) }
                if selection == nil || !refreshed.contains(where: { $0.id == selection }) {
                    selection = pages.first?.id
                }
                resync(reader)
            }
            .onAppear {
                // Reopening is a fresh look: take the current order.
                order = channels.map(\.id)
                if selection == nil || !channels.contains(where: { $0.id == selection }) {
                    selection = pages.first?.id
                }
                resync(reader)
            }
            }
        }
        // Behind the pages, so it is only ever seen while the first page is
        // pulled down — the one moment it means something.
        .background(alignment: .top) {
            ZStack(alignment: .top) {
                Color.black.ignoresSafeArea()
                if onRefresh != nil {
                    Label("Newest channels", systemImage: "arrow.clockwise")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.7))
                        .padding(.top, 64)
                }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                parkTask?.cancel()
                parkTask = nil
                parked = false
            case .background:
                // Warm neighbours go now; the page on screen stays, so a quick
                // return is the scene still playing (WebKit suspends it while
                // we are away). Gone long enough, it is let go — its picture
                // is kept, so even then it comes back as itself.
                WebScenePool.shared.drain(keepSnapshots: true)
                WebScenePool.shared.persistLaunchStills { id in
                    channels.first { $0.id == id }?.lastEventAt
                }
                parkTask?.cancel()
                parkTask = Task { @MainActor in
                    try? await Task.sleep(for: Self.backgroundGrace)
                    if !Task.isCancelled { parked = true }
                }
            default:
                break
            }
        }
        .statusBarHidden(chromeHidden || sideways)
        // Tap-to-hide is "just the scene": the tab bar goes with the rest of
        // the chrome, on the same animation (the tap wraps it in withAnimation).
        .toolbar(chromeHidden || sideways ? .hidden : .visible, for: .tabBar)
        // Turning sideways shows the controls for a moment, then gets out of
        // the way; any time they come back while sideways, they fade again.
        .onChange(of: sideways) { _, now in
            if now { withAnimation(.easeInOut(duration: 0.25)) { chromeHidden = false } }
            scheduleAutoHide()
        }
        .onChange(of: chromeHidden) { _, _ in scheduleAutoHide() }
        .navigationBarBackButtonHidden()
        .toolbar(.hidden, for: .navigationBar)
        .onAppear {
            isOnScreen = true
            // One full-screen canvas deserves the device; gallery tiles alive
            // on another tab have no business animating behind it. This also
            // disables the idle timer for as long as any feed is fullscreen
            // (see `PreviewBudget.enterFullscreen`), refcounted the same way
            // so an interleaved transition can't wake the device mid-viewing.
            PreviewBudget.shared.enterFullscreen()
            OrientationPolicy.feedAppeared()
        }
        .onDisappear {
            isOnScreen = false
            WebScenePool.shared.drain()
            PreviewBudget.shared.exitFullscreen()
            OrientationPolicy.feedDisappeared()
            autoHide?.cancel()
        }
    }

    private func step(_ delta: Int, reader: ScrollViewProxy) {
        guard let here = pages.firstIndex(where: { $0.id == selection }),
              pages.indices.contains(here + delta) else { return }
        select(pages[here + delta].id, reader: reader, animated: true)
    }

    /// Sideways with the controls showing: fade them in 4 s. Anything else
    /// cancels a pending fade.
    private func scheduleAutoHide() {
        autoHide?.cancel()
        guard sideways, !chromeHidden else { return }
        autoHide = Task { @MainActor in
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled, sideways else { return }
            withAnimation(.easeInOut(duration: 0.4)) { chromeHidden = true }
        }
    }

    private func select(_ id: String?, reader: ScrollViewProxy, animated: Bool) {
        guard let id else { return }
        if animated { withAnimation { selection = id } } else { selection = id }
        resync(reader)
    }

    /// Scroll the selected page into place after layout has caught up.
    private func resync(_ reader: ScrollViewProxy) {
        guard let id = selection else { return }
        DispatchQueue.main.async { reader.scrollTo(id, anchor: .top) }
    }
}

/// The feed's page order, held still while the caller's list is re-sorted.
enum FeedOrder {
    /// `channels` in the order of `ids`. Channels the order does not know yet
    /// go at the end (never above what you are watching); ids that have gone
    /// are dropped. An empty order means "take the list as it comes".
    static func arrange(_ channels: [PublicChannel], by ids: [String]) -> [PublicChannel] {
        guard !ids.isEmpty else { return channels }
        let byId = Dictionary(channels.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let known = Set(ids)
        return ids.compactMap { byId[$0] } + channels.filter { !known.contains($0.id) }
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
