import SwiftUI
import UIKit

/// One channel in the feed: live first, its past to the right.
///
/// The scene layer scrolls sideways; the chrome does not. It sits above the
/// pager and re-describes whichever moment is showing, so paging through
/// history reads as the picture changing under a steady frame rather than as a
/// stack of separate screens sliding by.
struct FeedPage: View {
    let channel: PublicChannel
    /// False for a page the feed has built but you haven't flipped to. Only
    /// the page you are looking at holds a web view and a socket.
    let isActive: Bool
    var showsBack: Bool = false

    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(\.viewerChromeInsets) private var insets

    @State private var session = ChannelSession()
    @State private var stops: [ChannelFeed.Stop] = []
    /// The event that put the CURRENT scene on air — history's newest
    /// scene-backed entry. It is what `stops` drops, and exactly the
    /// attribution the live caption wants.
    @State private var liveEvent: ChannelEvent?
    @State private var showOverview = false
    /// `"live"`, or a stop's key. Optional only because `scrollPosition` binds one.
    @State private var moment: String? = FeedPage.liveKey
    @Binding var chromeHidden: Bool
    @State private var showComposer = false
    @State private var showInfo = false
    @State private var toast: String?
    @State private var waking = false
    @State private var recalling = false
    @State private var reloadCount = 0
    @State private var pulse = false

    static let liveKey = "live"
    private static func key(_ stop: ChannelFeed.Stop) -> String { "s\(stop.sceneId)" }

    private var channelId: String { channel.id }
    private var canSteer: Bool { app.token(for: channelId) != nil }
    private var isLive: Bool { moment == Self.liveKey || moment == nil }
    private var currentStop: ChannelFeed.Stop? { stops.first { Self.key($0) == moment } }
    private var currentIndex: Int? { stops.firstIndex { Self.key($0) == moment } }

    var body: some View {
        ZStack {
            // Behind the cards while they travel: black, so the rounded frames
            // read as frames. The channel's own colour lives INSIDE each card.
            Color.black.ignoresSafeArea()

            ScrollView(.horizontal) {
                LazyHStack(spacing: 0) {
                    livePage
                        .containerRelativeFrame([.horizontal, .vertical])
                        .momentCard()
                        .id(Self.liveKey)
                    ForEach(stops) { stop in
                        HistoryMomentPage(channelId: channelId, stop: stop,
                                          isShowing: isActive && moment == Self.key(stop),
                                          holdingColor: backdropHex)
                            .containerRelativeFrame([.horizontal, .vertical])
                            .momentCard()
                            .id(Self.key(stop))
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.paging)
            .scrollPosition(id: $moment)
            .scrollIndicators(.hidden)
            .ignoresSafeArea()
            // A still page is not a dead page: the past is a scroll away.
            .scrollDisabled(!isActive)
            .onTapGesture { withAnimation(.easeInOut(duration: 0.25)) { chromeHidden.toggle() } }
            // Pinch in to zoom out — the same thing the channel name does, for
            // people who reach for the gesture first.
            .simultaneousGesture(
                MagnifyGesture().onEnded { value in
                    if value.magnification < 0.82 { showOverview = true }
                }
            )
            .onChange(of: moment) { _, _ in prefetchAroundCurrent() }

            if !chromeHidden {
                // The status bar is white and SwiftUI offers no per-view way to
                // flip it. Over a pale scene it would vanish, so the top gets
                // the scrim every photo app uses — only while chrome shows.
                if topScheme == .light {
                    LinearGradient(colors: [.black.opacity(0.34), .black.opacity(0)],
                                   startPoint: .top, endPoint: .bottom)
                        .frame(height: insets.top + 34)
                        .frame(maxHeight: .infinity, alignment: .top)
                        .ignoresSafeArea()
                        .allowsHitTesting(false)
                        .transition(.opacity)
                }
                chrome.transition(.opacity)
            }
            toastLayer
        }
        .sheet(isPresented: $showComposer) {
            ComposerSheet(channelId: channelId, session: session)
                .presentationDetents([.height(150), .medium, .large])
                .presentationBackgroundInteraction(.enabled(upThrough: .medium))
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showOverview) {
            ChannelOverviewSheet(channel: channel, stops: stops, liveEvent: liveEvent,
                                 liveLabel: session.sceneLabel ?? channel.saverLabel,
                                 current: moment) { key in
                withAnimation(.easeInOut(duration: 0.4)) { moment = key }
            }
        }
        .sheet(isPresented: $showInfo) {
            SceneInfoSheet(session: session, channelId: channelId)
                .presentationDetents([.medium])
        }
        .onAppear { if isActive { activate() } }
        .onChange(of: isActive) { _, nowActive in
            if nowActive { activate() } else { deactivate() }
        }
        .onDisappear { deactivate() }
    }

    // MARK: Lifecycle

    private func activate() {
        session.start(channelId: channelId, seedSpec: channel.spec, source: .host)
        guard stops.isEmpty else { return }
        Task {
            // History is an enhancement. If it fails the channel still plays,
            // and the page simply has nothing to its right.
            let events = (try? await app.gallery.fetchHistory(channelId: channelId)) ?? []
            liveEvent = events.filter { $0.sceneId != nil }.max { $0.at < $1.at }
            stops = ChannelFeed.stops(from: events)
            prefetchAroundCurrent()
        }
    }

    /// The colour under the top bar / under the caption, for whichever moment
    /// is showing. It is the scene's declared background, not sampled pixels —
    /// a bright subject on a dark ground will still read as dark. That is the
    /// right call far more often than not, and it costs nothing per frame.
    private var topHex: String? {
        if let stop = currentStop,
           let bg = app.scenes.scene(channelId: channelId, sceneId: stop.sceneId)?.spec?.background {
            return bg.headColor
        }
        return session.backdrop ?? channel.spec?.background?.headColor
    }

    private var footHex: String? {
        if let stop = currentStop,
           let bg = app.scenes.scene(channelId: channelId, sceneId: stop.sceneId)?.spec?.background {
            return bg.footColor
        }
        return session.backdropBottom ?? channel.spec?.background?.footColor ?? topHex
    }

    private var topScheme: ColorScheme { Color.isLight(hex: topHex) ? .light : .dark }
    private var footScheme: ColorScheme { Color.isLight(hex: footHex) ? .light : .dark }

    private var backdropHex: String {
        session.backdrop ?? channel.spec?.background?.primaryColor ?? "0A0A0F"
    }

    /// Paint the pages either side BEFORE the swipe reaches them. A page that
    /// fetches only once it is current arrives as an empty dark slab sliding
    /// in from the edge — the single worst moment in the old transition.
    private func prefetchAroundCurrent() {
        let here = currentIndex ?? -1          // -1 = the live page
        let wanted = [here - 1, here + 1, here + 2].filter { stops.indices.contains($0) }
        app.scenes.prefetch(channelId: channelId, sceneIds: wanted.map { stops[$0].sceneId },
                            from: app.gallery)
    }

    private func deactivate() {
        session.stop()
        // Flip back to a channel and it is live again — returning to a feed
        // page parked on last Tuesday would be disorienting.
        moment = Self.liveKey
    }

    // MARK: Live page

    @ViewBuilder
    private var livePage: some View {
        ZStack {
            Color(hex: backdropHex).ignoresSafeArea()
            if isActive {
                // The web engine draws; nothing in it can be touched.
                WebSceneView(
                    channelId: channelId,
                    baseURL: URL(string: Config.baseURL)!,
                    token: app.token(for: channelId),
                    reloadCount: reloadCount,
                    onFrame: { session.ingest($0) },
                    onFailure: { session.hostFailed() }
                )
                .ignoresSafeArea()
                // Hidden until the first frame proves the page is live, so a
                // slow load shows the channel's colour, not a blank sheet.
                .opacity(session.phase == .live && !session.sleeping ? 1 : 0)
                .animation(.easeInOut(duration: 0.5), value: session.phase)
                .animation(.easeInOut(duration: 0.6), value: session.sleeping)
            } else if let spec = channel.spec {
                // A neighbour mid-flip shows a native still, not a web process.
                ScenePreviewView(spec: spec, fallbackSeed: channelId, live: false)
                    .ignoresSafeArea()
            }
            liveStateLayer
        }
    }

    /// Connecting, unreachable, sleeping — all native. A web error card inside
    /// a native app is exactly the seam this design exists to remove.
    private var liveStateLayer: some View {
        liveStateContent.environment(\.colorScheme, topScheme)
    }

    @ViewBuilder
    private var liveStateContent: some View {
        if !isActive {
            EmptyView()
        } else if session.sleeping {
            VStack(spacing: 14) {
                Image(systemName: "moon.zzz")
                    .font(.system(size: 34))
                    .foregroundStyle(Color.secondary)
                Text("sleeping")
                    .font(.headline)
                    .foregroundStyle(Color.primary)
                if canSteer {
                    Button(action: wake) {
                        Group {
                            if waking {
                                ProgressView().tint(Color(uiColor: .systemBackground))
                            } else {
                                Label("Wake it", systemImage: "sun.max.fill")
                                    .font(.subheadline.weight(.semibold))
                            }
                        }
                        .frame(minWidth: 132, minHeight: 22)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 12)
                        .foregroundStyle(Color(uiColor: .systemBackground))
                        .background(Color.primary, in: Capsule())
                    }
                    .disabled(waking)
                } else {
                    Text("It'll come back when its owner wakes it.")
                        .font(.footnote)
                        .foregroundStyle(Color.secondary)
                }
            }
            .padding(28)
            .glassPanel(shape: RoundedRectangle(cornerRadius: 22))
        } else if session.phase == .unreachable {
            VStack(spacing: 14) {
                Image(systemName: "wifi.exclamationmark")
                    .font(.system(size: 32))
                    .foregroundStyle(Color.secondary)
                Text("can't reach this channel")
                    .font(.headline)
                    .foregroundStyle(Color.primary)
                Button("Try again") {
                    session.retry()
                    reloadCount += 1
                }
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Color(uiColor: .systemBackground))
                .padding(.horizontal, 18)
                .padding(.vertical, 9)
                .background(Color.primary, in: Capsule())
            }
            .padding(28)
            .glassPanel(shape: RoundedRectangle(cornerRadius: 22))
        } else if session.phase == .connecting {
            Circle()
                .fill(Color.primary.opacity(0.18))
                .frame(width: 10, height: 10)
                .scaleEffect(pulse ? 1.6 : 0.8)
                .animation(.easeInOut(duration: 1).repeatForever(autoreverses: true), value: pulse)
                .onAppear { pulse = true }
        }
    }

    // MARK: Chrome

    private var chrome: some View {
        VStack(spacing: 0) {
            // A third of the wall has a LIGHT background, where white labels
            // vanish. Each region takes the colour scheme of what it sits on,
            // so text, icons and the glass itself flip together — the system's
            // own light/dark machinery, pointed at the artwork.
            topBar
                .environment(\.colorScheme, topScheme)
            Spacer()
            HStack(alignment: .bottom, spacing: 12) {
                caption
                Spacer(minLength: 0)
                actionRail
            }
            .environment(\.colorScheme, footScheme)
        }
        .animation(.easeInOut(duration: 0.35), value: topScheme)
        .animation(.easeInOut(duration: 0.35), value: footScheme)
        .padding(.horizontal, 16)
        .padding(.top, insets.top + 6)
        .padding(.bottom, insets.bottom + 14)
    }

    private var topBar: some View {
        HStack(spacing: 10) {
            if showsBack {
                Button { dismiss() } label: {
                    Image(systemName: "chevron.left")
                        .font(.headline)
                        .foregroundStyle(Color.primary)
                        .frame(width: 38, height: 38)
                        .glassCapsule(shape: Circle())
                }
                .accessibilityLabel("Back")
            }

            momentPill
            Spacer()

            if isLive, let viewers = session.viewers, viewers > 0 {
                Label("\(viewers)", systemImage: "eye.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.primary)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 8)
                    .glassCapsule(shape: Capsule())
                    .accessibilityLabel("\(viewers) watching")
            }
        }
    }

    /// Where you are in time — and, on the live page, that there is a past to
    /// swipe into at all. An undiscoverable gesture is a missing feature.
    @ViewBuilder
    private var momentPill: some View {
        if let index = currentIndex, let stop = currentStop {
            Button {
                withAnimation(.easeInOut(duration: 0.35)) { moment = Self.liveKey }
            } label: {
                HStack(spacing: 7) {
                    Image(systemName: "chevron.left").font(.caption2.weight(.bold))
                    Text("Live")
                        .font(.caption.weight(.semibold))
                    Text("· \(index + 1) of \(stops.count) · \(SteerLine.ago(Int(stop.event.at)))")
                        .font(.caption)
                        .opacity(0.75)
                }
                .foregroundStyle(Color.primary)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .glassCapsule(shape: Capsule())
            }
            .accessibilityLabel("Back to live")
        } else {
            HStack(spacing: 7) {
                Circle()
                    .fill(session.sleeping ? Color.textTertiary : Color.appSuccess)
                    .frame(width: 7, height: 7)
                Text(session.sleeping ? "ASLEEP" : "LIVE")
                    .font(.caption2.weight(.bold))
                    .tracking(1.1)
                if !stops.isEmpty {
                    Text("· \(stops.count) earlier")
                        .font(.caption)
                        .opacity(0.75)
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.bold))
                        .opacity(0.75)
                }
            }
            .foregroundStyle(Color.primary)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .glassPanel(shape: Capsule())
        }
    }

    /// Bottom-left, where a feed puts what you are looking at: the scene's
    /// name largest, then who made it and on what, then the channel — which is
    /// also the way out to the zoomed-out timeline.
    private var caption: some View {
        let event = currentStop?.event ?? liveEvent
        return VStack(alignment: .leading, spacing: 8) {
            Text(sceneTitle)
                .font(.title2.weight(.bold))
                .lineLimit(2)
                .minimumScaleFactor(0.8)

            credits(for: event)

            // The prompt behind the change: the one thing here a picture of
            // the same scene could not tell you.
            if let intent = currentStop?.event.intent, !intent.isEmpty {
                Text(intent)
                    .font(.caption)
                    .opacity(0.8)
                    .lineLimit(3)
            }

            Button { showOverview = true } label: {
                HStack(spacing: 6) {
                    if channel.isProtected == true {
                        Image(systemName: "lock.fill").font(.caption2)
                    }
                    Text(channel.displayLabel)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    Image(systemName: "square.grid.3x3.fill")
                        .font(.caption2)
                        .opacity(0.8)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .glassCapsule(shape: Capsule())
            }
            .accessibilityLabel("\(channel.displayLabel), show timeline")
            .accessibilityHint("Zooms out to everything this channel has shown")
        }
        .foregroundStyle(Color.primary)
        .multilineTextAlignment(.leading)
        // Scenes are arbitrary art, so the text carries its own halo — in the
        // OPPOSITE tone to the text, or it just smudges it.
        .shadow(color: (footScheme == .light ? Color.white : Color.black).opacity(0.6), radius: 6, y: 1)
        .frame(maxWidth: 280, alignment: .leading)
    }

    private var sceneTitle: String {
        if let stop = currentStop {
            return app.scenes.scene(channelId: channelId, sceneId: stop.sceneId)?.label
                ?? stop.event.summary ?? "an earlier scene"
        }
        return session.sceneLabel ?? channel.saverLabel ?? channel.displayLabel
    }

    /// The artist, then the small print.
    ///
    /// One credit, signed with a brush: whoever made this scene is its artist,
    /// whether that is a named agent or — when nobody signed it — the model
    /// itself. Everything else (model, harness, when) is one quiet line under
    /// it. Four chips of equal weight read as a settings panel, not a credit.
    @ViewBuilder
    private func credits(for event: ChannelEvent?) -> some View {
        let actor = SteerLine.namedActor(event?.actor ?? channel.lastSteer?.actor)
        let model = SteerLine.distinct(event?.model ?? channel.lastSteer?.model, from: actor)
        let harness = SteerLine.distinct(event?.harness ?? channel.lastSteer?.harness, from: actor, model)
        let when: String? = {
            if let event { return SteerLine.ago(Int(event.at)) }
            return channel.lastEventAt.map { SteerLine.ago($0) }
        }()
        let artist = actor ?? model
        // The model is small print only when someone else took the credit.
        let small = [actor == nil ? nil : model, harness.map { "via \($0)" }, when].compactMap { $0 }

        VStack(alignment: .leading, spacing: 5) {
            if let artist {
                Label(artist, systemImage: "paintbrush.pointed.fill")
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 6)
                    .glassPanel(shape: Capsule())
                    .accessibilityLabel("Made by \(artist)")
            }
            if !small.isEmpty {
                Text(small.joined(separator: " · "))
                    .font(.caption)
                    .opacity(0.78)
                    .lineLimit(1)
            }
        }
    }

    static func attribution(_ event: ChannelEvent) -> String? {
        let by = SteerLine.namedActor(event.actor)
        let via = SteerLine.distinct(event.harness, from: by)
        let on = SteerLine.distinct(event.model, from: by, via)
        let parts = [by, via, on].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// Right-hand rail, under the thumb.
    private var actionRail: some View {
        VStack(spacing: 12) {
            if let stop = currentStop {
                if canSteer {
                    railButton(recalling ? "hourglass" : "arrow.uturn.backward", label: "Bring back") {
                        bringBack(stop)
                    }
                    .disabled(recalling)
                }
            } else {
                railButton("slider.horizontal.3", label: "Compose") { showComposer = true }
            }
            if !app.pairedScreens.isEmpty {
                railButton("play.tv", label: "Play on your screens") {
                    Task {
                        let n = await app.pushToAllScreens(channelId: channelId)
                        flash(n > 0 ? "sent to \(n) screen\(n == 1 ? "" : "s")"
                                    : app.pairPushError ?? "couldn't reach your screens")
                    }
                }
            }
            railButton("info.circle", label: "About this scene") { showInfo = true }
            ShareLink(item: app.gallery.viewerURL(for: channelId)) {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(Color.primary)
                    .frame(width: 46, height: 46)
                    .glassCapsule(shape: Circle())
            }
            .accessibilityLabel("Share channel")
        }
    }

    private func railButton(_ icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(Color.primary)
                .frame(width: 46, height: 46)
                .glassCapsule(shape: Circle())
        }
        .accessibilityLabel(label)
    }

    @ViewBuilder
    private var toastLayer: some View {
        if let toast {
            VStack {
                Spacer()
                Text(toast)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Color(white: 1))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(.black.opacity(0.7), in: Capsule())
                    .padding(.bottom, insets.bottom + 150)
            }
            .transition(.opacity)
            .allowsHitTesting(false)
        }
    }

    // MARK: Actions

    private func flash(_ message: String) {
        withAnimation { toast = message }
        Task {
            try? await Task.sleep(for: .seconds(2.2))
            withAnimation { if toast == message { toast = nil } }
        }
    }

    private func wake() {
        guard let token = app.token(for: channelId), !waking else { return }
        waking = true
        Task {
            defer { waking = false }
            do {
                try await app.mcp.wake(channelId: channelId, token: token)
                session.optimisticallyAwake()
            } catch {
                flash("couldn't wake it — try again")
            }
        }
    }

    private func bringBack(_ stop: ChannelFeed.Stop) {
        guard let token = app.token(for: channelId), !recalling else { return }
        recalling = true
        Task {
            defer { recalling = false }
            do {
                try await app.mcp.recall(channelId: channelId, token: token, sceneId: stop.sceneId)
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                flash("it's on air again")
                withAnimation(.easeInOut(duration: 0.35)) { moment = Self.liveKey }
            } catch {
                UINotificationFeedbackGenerator().notificationOccurred(.error)
                flash("couldn't bring that one back")
            }
        }
    }
}

/// One past scene. Its spec comes from the shared store — usually already
/// there, because the page before it prefetched it — so it slides in as a
/// picture, not as a blank. It only ANIMATES while it is the page on screen.
private struct HistoryMomentPage: View {
    let channelId: String
    let stop: ChannelFeed.Stop
    let isShowing: Bool
    /// Held while the scene loads: the channel's own colour, never bare black.
    let holdingColor: String
    @Environment(AppState.self) private var app

    private var scene: RecordedScene? {
        app.scenes.scene(channelId: channelId, sceneId: stop.sceneId)
    }

    var body: some View {
        ZStack {
            Color(hex: scene?.spec?.background?.primaryColor ?? holdingColor).ignoresSafeArea()
            if let scene {
                RecordedSceneView(scene: scene, channelId: channelId, animating: isShowing)
                    .ignoresSafeArea()
                    .transition(.opacity)
            } else if app.scenes.didFail(channelId: channelId, sceneId: stop.sceneId) {
                VStack(spacing: 12) {
                    Image(systemName: "clock.badge.exclamationmark")
                        .font(.system(size: 30))
                        .foregroundStyle(Color.secondary)
                    Text("couldn't load this moment")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Color.primary)
                    Button("Try again") {
                        Task { await app.scenes.load(channelId: channelId, sceneId: stop.sceneId,
                                                     from: app.gallery, retry: true) }
                    }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Color.primary)
                }
                .padding(24)
                .glassPanel(shape: RoundedRectangle(cornerRadius: 20))
            } else if isShowing {
                ProgressView().tint(.white.opacity(0.7))
            }
        }
        .animation(.easeInOut(duration: 0.3), value: scene != nil)
        // The safety net under the prefetch: a page that somehow arrives
        // without its scene still asks for it.
        .task { await app.scenes.load(channelId: channelId, sceneId: stop.sceneId, from: app.gallery) }
    }
}

private extension View {
    /// Moments travel as cards: mid-swipe a page pulls back slightly and
    /// rounds its corners, so you see two frames of a timeline passing rather
    /// than one slab pushing another off the edge. At rest it is full-bleed.
    func momentCard() -> some View {
        scrollTransition(.interactive, axis: .horizontal) { content, phase in
            content
                .scaleEffect(phase.isIdentity ? 1 : 0.93)
                .opacity(phase.isIdentity ? 1 : 0.72)
        }
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
    }
}

extension SpecSubset.Background {
    /// Colour at the top of the background — under the status pill.
    var headColor: String? { stops?.first?.color ?? color ?? primaryColor }
    /// Colour at the bottom — under the caption. Differs for a gradient.
    var footColor: String? { stops?.last?.color ?? color ?? primaryColor }
}
