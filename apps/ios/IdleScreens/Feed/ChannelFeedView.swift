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
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    /// Away long enough that the page should let go of its web view and
    /// socket. A glance at another app, the app switcher or Control Center is
    /// not that: the page used to be torn down on any of them, and coming
    /// back reloaded the scene from nothing.
    @State private var parked = false
    @State private var parkTask: Task<Void, Never>?
    /// How long a backgrounded page keeps its scene alive.
    static let backgroundGrace: Duration = .seconds(120)
    /// The page that fills the screen, measured from layout rather than taken
    /// from `scrollPosition`. nil while anything is moving: a swipe, a pull, a
    /// programmatic scroll. What `selection` is checked against once both
    /// have held still for `settleGrace`.
    @State private var settledPage: String?
    @State private var settleCheck: Task<Void, Never>?
    /// Longer than a programmatic page scroll takes to start moving, so a
    /// `select` on its way to its page is never mistaken for a mismatch.
    static let settleGrace: Duration = .milliseconds(500)

    /// The caller's channels, in the held order, minus any this person hid —
    /// a shelf opened from the Channels tab holds its own copy of the list,
    /// so hiding has to be applied here and not only to `app.channels`.
    private var pages: [PublicChannel] { FeedOrder.arrange(app.hidden.visible(channels), by: order) }

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
                            .onGeometryChange(for: Bool.self) { proxy in
                                FeedSelection.fills(proxy.frame(in: .scrollView))
                            } action: { fills in
                                if fills { settledPage = channel.id }
                                else if settledPage == channel.id { settledPage = nil }
                            }
                            .id(channel.id)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.paging)
            // The scroll view reports nil while a pull to refresh drags the
            // first page off its slot. That is not a new page: taken as one,
            // every pull deactivated the page you were on (closing its socket)
            // and started it again as the content sprang back.
            .scrollPosition(id: Binding(get: { selection },
                                        set: { selection = FeedSelection.reported($0, keeping: selection) }))
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
                // The re-sort waits for `onChange(of: refreshToken)`. This
                // closure still holds the `channels` it was built with — the
                // list from BEFORE the refresh — so sorting here landed one
                // refresh behind: the newest channel the pull had just fetched
                // was filed at the bottom, and only the next pull found it.
                refreshToken += 1
            }
            // Runs in the update that follows the refresh, when `channels` is
            // the list it fetched. The one moment a re-sort is wanted: it is
            // what you pulled for.
            .onChange(of: refreshToken) { _, _ in
                order = channels.map(\.id)
                select(pages.first?.id, reader: reader, animated: true)
            }
            .ignoresSafeArea()
            // Whatever changed the list, make the page on screen and the
            // selected page the same page again. `scrollPosition(id:)` alone
            // does not: an id set before its row is laid out is dropped.
            .onChange(of: order) { _, _ in resync(reader) }
            .onChange(of: selection) { _, id in
                SwipeTiming.start("channel \(id ?? "-")")
                checkSettled()
            }
            .onChange(of: settledPage) { _, _ in checkSettled() }
            // Hid the channel on screen: move on to the next one (else the
            // one before), or leave a shelf that has nothing left to show.
            .onChange(of: app.hidden.ids) { _, hidden in
                guard let here = selection, hidden.contains(here) else { return }
                guard let next = FeedOrder.successor(of: here, in: order, among: pages.map(\.id)) else {
                    if showsBack { dismiss() }
                    return
                }
                select(next, reader: reader, animated: true)
            }
            .onChange(of: channels) { _, refreshed in
                if order.isEmpty { order = refreshed.map(\.id) }
                if selection == nil || !refreshed.contains(where: { $0.id == selection }) {
                    selection = pages.first?.id
                }
                resync(reader)
                // A settle check already waiting captured the view as it was:
                // `channels` is a plain property, so its `pages` still list a
                // channel this refresh removed, and it could select it. Start
                // the check again on the refreshed list.
                checkSettled()
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
        // Artwork, not chrome: dark in either appearance (the window goes
        // dark with it — see ContentView.scheme).
        .environment(\.colorScheme, .dark)
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
            settleCheck?.cancel()
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
        // Read the selection when the scroll runs, not when it was asked for:
        // a refresh moves it in between, and a scroll queued with the old id
        // ran after the new selection, aiming the screen at a page that was
        // no longer selected.
        DispatchQueue.main.async {
            guard let id = selection else { return }
            reader.scrollTo(id, anchor: .top)
        }
    }

    /// The safety net under every path above. Once the scroll has held still
    /// on a page for `settleGrace`, that page is the one you are watching: if
    /// the selection names another, the selection is wrong, and the page on
    /// screen sat black — chrome but no scene, its web view never started —
    /// until you swiped away and back. A reorder under a paging scroll view
    /// can leave them apart in ways no single call site sees.
    private func checkSettled() {
        settleCheck?.cancel()
        settleCheck = Task { @MainActor in
            try? await Task.sleep(for: Self.settleGrace)
            guard !Task.isCancelled, isOnScreen,
                  let onScreen = FeedSelection.correction(selected: selection, settled: settledPage,
                                                          among: pages.map(\.id))
            else { return }
            SwipeTiming.mark("on screen \(onScreen) but selected \(selection ?? "-"): selecting it")
            selection = onScreen
        }
    }
}

/// Which page the feed treats as the one you are watching.
enum FeedSelection {
    /// What a position the scroll view reports means. nil is the content
    /// sitting between pages (a pull to refresh drags the first page down off
    /// its slot), not a new page: keep the one you are on.
    static func reported(_ id: String?, keeping current: String?) -> String? {
        id ?? current
    }

    /// The page with this frame (in the scroll view's space) fills the
    /// viewport: the scroll is at rest on it.
    static func fills(_ frame: CGRect) -> Bool {
        frame.height > 1 && abs(frame.minY) < 1
    }

    /// The page to select instead, when the page filling the screen is not the
    /// selected one; nil when there is nothing to fix. Nothing is settled
    /// mid-scroll, and a page that has left the feed is never chosen.
    static func correction(selected: String?, settled: String?, among pages: [String]) -> String? {
        guard let settled, settled != selected, pages.contains(settled) else { return nil }
        return settled
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

    /// Where to land when `id` leaves the feed: the next remaining page after
    /// it in `order`, else the nearest one before it, else nil.
    static func successor(of id: String, in order: [String], among remaining: [String]) -> String? {
        let left = Set(remaining)
        guard let at = order.firstIndex(of: id) else { return remaining.first }
        return order[(at + 1)...].first(where: left.contains)
            ?? order[..<at].last(where: left.contains)
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
