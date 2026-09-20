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
    /// 0 at rest, rising to 0.5 halfway between two moments. Drives the
    /// caption's dissolve, so it is tied to the finger rather than to a timer.
    @State private var swipeProgress: CGFloat = 0
    /// Flipped false→true whenever there is new text to present, which replays
    /// the staggered entrance.
    @State private var captionEntered = false
    /// `"live"`, or a stop's key. Optional only because `scrollPosition` binds one.
    @State private var moment: String? = FeedPage.liveKey
    @Binding var chromeHidden: Bool
    @State private var showComposer = false
    /// The caption opened up into the scene's full credits.
    @State private var captionExpanded = false
    @State private var history: [ChannelEvent] = []
    @State private var toast: String?
    @State private var waking = false
    @State private var recalling = false
    @State private var reloadCount = 0
    @State private var pulse = false

    static let liveKey = "live"
    private static func key(_ stop: ChannelFeed.Stop) -> String { "s\(stop.sceneId)" }

    private var channelId: String { channel.id }
    /// Steering needs an editor or owner key. A viewer key opens a private
    /// channel and must not light up controls that would then be refused.
    private var canSteer: Bool { app.canEdit(channelId) }
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
            .modifier(SwipeProgressReader(progress: $swipeProgress))
            .scrollTargetBehavior(.paging)
            .scrollPosition(id: $moment)
            .scrollIndicators(.hidden)
            .ignoresSafeArea()
            // A still page is not a dead page: the past is a scroll away.
            .scrollDisabled(!isActive)
            .onTapGesture {
                if captionExpanded {
                    withAnimation(.spring(duration: 0.35, bounce: 0.12)) { captionExpanded = false }
                } else {
                    withAnimation(.easeInOut(duration: 0.25)) { chromeHidden.toggle() }
                }
            }
            // Pinch in to zoom out — the same thing the channel name does, for
            // people who reach for the gesture first.
            .simultaneousGesture(
                MagnifyGesture().onEnded { value in
                    if value.magnification < 0.82 { showOverview = true }
                }
            )
            .onChange(of: moment) { _, _ in
                captionExpanded = false
                prefetchAroundCurrent()
                replayCaptionEntrance()
            }

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
        .onAppear { if isActive { activate() } }
        .onChange(of: isActive) { _, nowActive in
            if nowActive { activate() } else { deactivate() }
        }
        .onDisappear { deactivate() }
    }

    // MARK: Lifecycle

    private func activate() {
        replayCaptionEntrance()
        session.start(channelId: channelId, seedSpec: channel.spec, source: .host)
        guard stops.isEmpty else { return }
        Task {
            // History is an enhancement. If it fails the channel still plays,
            // and the page simply has nothing to its right.
            // Deep enough to reach the first publish of scenes the curator
            // re-airs nightly — that is where the real credit lives.
            let events = (try? await app.gallery.fetchHistory(channelId: channelId, limit: 200)) ?? []
            history = events
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
        // Flipping channels: the chrome belongs to its page, so it leaves and
        // arrives with it — but faded and softened while in flight, so two
        // channels' names are never legible at once.
        .scrollTransition(.interactive, axis: .vertical) { content, phase in
            content
                .opacity(phase.isIdentity ? 1 : 0)
                .blur(radius: phase.isIdentity ? 0 : 6)
        }
        .padding(.horizontal, 16)
        .padding(.top, insets.top + 6)
        .padding(.bottom, insets.bottom + 14)
    }

    /// The channel, the way a video app shows one: a face, a name, a Follow
    /// button. No status words — live is a green ring on the avatar, and the
    /// channel's past is the row of story segments above.
    private var topBar: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !stops.isEmpty { momentSegments }

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

                Button { showOverview = true } label: {
                    HStack(spacing: 9) {
                        avatar
                        VStack(alignment: .leading, spacing: 1) {
                            HStack(spacing: 4) {
                                if channel.isProtected == true {
                                    Image(systemName: "lock.fill").font(.system(size: 9))
                                }
                                Text(channel.displayLabel)
                                    .font(.subheadline.weight(.semibold))
                                    .lineLimit(1)
                            }
                        }
                    }
                    .foregroundStyle(Color.primary)
                    .shadow(color: (topScheme == .light ? Color.white : Color.black).opacity(0.5), radius: 5, y: 1)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(channel.displayLabel), show timeline")
                .accessibilityHint("Zooms out to everything this channel has shown")

                followPill
                Spacer(minLength: 6)

                // One badge, and only when it is true: a green dot with the
                // audience beside it. On a past scene it simply is not there —
                // the avatar's ring and the segments already say "not live".
                if isLive && !session.sleeping {
                    liveBadge.transition(.opacity)
                }
            }
            .animation(.easeInOut(duration: 0.25), value: isLive)
        }
    }

    private var liveBadge: some View {
        let viewers = session.viewers ?? 0
        return HStack(spacing: 6) {
            Circle().fill(Color.appSuccess).frame(width: 7, height: 7)
            if viewers > 0 {
                Text("\(viewers)")
                    .font(.caption.weight(.semibold))
                    .monospacedDigit()
                    .contentTransition(.numericText())
            }
        }
        .foregroundStyle(Color.primary)
        .padding(.horizontal, viewers > 0 ? 10 : 8)
        .padding(.vertical, 8)
        .glassCapsule(shape: Capsule())
        .animation(.easeInOut(duration: 0.2), value: viewers)
        .accessibilityElement()
        .accessibilityLabel(viewers > 0 ? "Live, \(viewers) watching" : "Live")
    }

    /// The channel's face: its deterministic generative art, so every channel
    /// has one without anyone uploading anything. A green ring while live.
    private var avatar: some View {
        ProceduralChannelArt(channelId: channelId)
            .frame(width: 36, height: 36)
            .clipShape(Circle())
            .overlay {
                Circle().strokeBorder(
                    isLive && !session.sleeping ? Color.appSuccess : Color.primary.opacity(0.35),
                    lineWidth: 2)
            }
            .animation(.easeInOut(duration: 0.25), value: isLive)
    }

    /// Story segments: one per moment, live first. Says "there is a past, and
    /// you are here in it" with no words at all.
    private var momentSegments: some View {
        let count = stops.count + 1
        let here = (currentIndex ?? -1) + 1
        return HStack(spacing: 3) {
            ForEach(0..<count, id: \.self) { index in
                Capsule()
                    .fill(Color.primary.opacity(index == here ? 0.95 : 0.3))
                    .frame(height: 2.5)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: here)
        .accessibilityElement()
        .accessibilityLabel(here == 0 ? "Live. \(stops.count) earlier scenes" : "Scene \(here) of \(stops.count) earlier")
    }

    private var followPill: some View {
        let following = app.follows.isFollowing(channelId)
        return Button {
            let now = app.follows.toggle(channelId)
            UIImpactFeedbackGenerator(style: now ? .medium : .light).impactOccurred()
        } label: {
            Text(following ? "Following" : "Follow")
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                // Filled when it is an invitation, glass once accepted — the
                // same visual grammar every video app uses.
                .foregroundStyle(following ? Color.primary : Color(uiColor: .systemBackground))
                .background {
                    if following { Color.clear } else { Capsule().fill(Color.primary) }
                }
                .modifier(GlassIf(active: following))
                .contentTransition(.opacity)
        }
        .buttonStyle(.plain)
        .animation(.easeInOut(duration: 0.2), value: following)
        .accessibilityLabel(following ? "Following \(channel.displayLabel). Unfollow" : "Follow \(channel.displayLabel)")
    }

    /// Bottom-left: the scene's name largest, then who made it and on what.
    ///
    /// Leaving is tied to the FINGER: by a quarter of the way into a swipe the
    /// text has dissolved (fade + blur + a slight lift, like breath off glass),
    /// so the words never ride across the screen attached to the wrong picture.
    /// The content swaps while it is invisible. Arriving is a fast staggered
    /// rise — title, then artist, then the small print — replayed for each new
    /// moment and each new channel.
    private var caption: some View {
        let event = currentStop?.event ?? liveEvent
        // 0 (gone) … 1 (fully present), from how far between pages we are.
        let presence = 1 - min(1, swipeProgress / 0.24)
        return VStack(alignment: .leading, spacing: 8) {
            Text(sceneTitle)
                .font(.title2.weight(.bold))
                .lineLimit(captionExpanded ? 4 : 2)
                .minimumScaleFactor(0.8)
                .captionEntrance(captionEntered, order: 0)

            credits(for: event)
                .captionEntrance(captionEntered, order: 1)

            // The prompt behind the change: the one thing here a picture of
            // the same scene could not tell you. One line until asked for.
            if let intent = event?.intent, !intent.isEmpty {
                Text(intent)
                    .font(captionExpanded ? .footnote : .caption)
                    .opacity(captionExpanded ? 0.95 : 0.8)
                    .lineLimit(captionExpanded ? 12 : 1)
                    .captionEntrance(captionEntered, order: 2)
            }

            if captionExpanded {
                sceneFacts(for: event)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        }
        .padding(captionExpanded ? 16 : 0)
        .frame(maxWidth: captionExpanded ? .infinity : 280, alignment: .leading)
        .background {
            if captionExpanded {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(.ultraThinMaterial)
                    .transition(.opacity)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            withAnimation(.spring(duration: 0.35, bounce: 0.12)) { captionExpanded.toggle() }
        }
        .accessibilityAddTraits(.isButton)
        .accessibilityHint(captionExpanded ? "Collapses the scene details" : "Shows the scene details")
        .foregroundStyle(Color.primary)
        .multilineTextAlignment(.leading)
        // Scenes are arbitrary art, so the text carries its own halo — in the
        // OPPOSITE tone to the text, or it just smudges it.
        .shadow(color: (footScheme == .light ? Color.white : Color.black).opacity(captionExpanded ? 0 : 0.6),
                radius: 6, y: 1)
        .opacity(presence)
        .blur(radius: (1 - presence) * 9)
        .offset(y: (1 - presence) * -10)
        .scaleEffect(0.97 + 0.03 * presence, anchor: .bottomLeading)
    }

    /// What the info sheet used to hold, now one tap on the caption: the rest
    /// of the credit, and the scene's vital statistics.
    @ViewBuilder
    private func sceneFacts(for event: ChannelEvent?) -> some View {
        let recorded = currentStop.flatMap { app.scenes.scene(channelId: channelId, sceneId: $0.sceneId) }
        let spec = recorded?.spec ?? (isLive ? channel.spec : nil)
        let rows: [(String, String)] = [
            ("model", (event.flatMap { SceneCredit.original(for: $0, in: history) } ?? event)?.model),
            ("via", (event.flatMap { SceneCredit.original(for: $0, in: history) } ?? event)?.harness),
            ("aired by", event.flatMap { SceneCredit.original(for: $0, in: history) == nil ? nil : $0.actor }),
            ("aired", event.map { $0.date.formatted(date: .abbreviated, time: .shortened) }),
            ("layers", spec.map { "\($0.layers.count)" }),
            ("seed", recorded?.seed.map(String.init)),
        ].compactMap { label, value in
            guard let value, !value.isEmpty else { return nil }
            return (label, value)
        }
        if !rows.isEmpty {
            VStack(spacing: 7) {
                Divider().opacity(0.4)
                ForEach(rows, id: \.0) { row in
                    HStack {
                        Text(row.0).opacity(0.65)
                        Spacer()
                        Text(row.1).fontWeight(.medium).lineLimit(1)
                    }
                    .font(.caption)
                }
            }
        }
    }

    /// Reset without animation, then animate in — so the stagger replays even
    /// when the text changed while the caption was already on screen.
    private func replayCaptionEntrance() {
        var instant = Transaction()
        instant.disablesAnimations = true
        withTransaction(instant) { captionEntered = false }
        DispatchQueue.main.async { captionEntered = true }
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
        // A relay (curator, scheduler) aired this but did not make it. When the
        // log still holds the original publish, the artist is whoever signed
        // that — and the relay drops to the small print as "aired by".
        let origin = event.flatMap { SceneCredit.original(for: $0, in: history) }
        let credited = origin ?? event
        let relay = origin == nil ? nil : event?.actor
        let actor = SteerLine.namedActor(credited?.actor ?? channel.lastSteer?.actor)
        let model = SteerLine.distinct(credited?.model ?? channel.lastSteer?.model, from: actor)
        let harness = SteerLine.distinct(credited?.harness ?? channel.lastSteer?.harness, from: actor, model)
        let when: String? = {
            if let event { return SteerLine.ago(Int(event.at)) }
            return channel.lastEventAt.map { SteerLine.ago($0) }
        }()
        let artist = actor ?? model
        // The model is small print only when someone else took the credit.
        // One line only: with a relay to name, the harness waits in the
        // expanded details rather than pushing "aired by" off the edge.
        let small = [actor == nil ? nil : model, relay == nil ? harness.map { "via \($0)" } : nil,
                     relay.map { "aired by \($0)" }, when].compactMap { $0 }

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
                    .transition(.scale(scale: 0.8).combined(with: .opacity))
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

/// How far between two pages a horizontal pager is: 0 at rest, 0.5 halfway.
///
/// iOS 18 can read a scroll view's offset directly. iOS 17 cannot do it
/// reliably from inside a lazy paging stack, so there the caption skips the
/// finger-tied dissolve and only plays its entrance — still correct, less lush.
private struct SwipeProgressReader: ViewModifier {
    @Binding var progress: CGFloat

    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.onScrollGeometryChange(for: CGFloat.self) { geo in
                let width = max(1, geo.containerSize.width)
                let pages = geo.contentOffset.x / width
                // Quantised: the caption needs ~25 steps, not 120 a second.
                return (abs(pages - pages.rounded()) * 50).rounded() / 50
            } action: { _, now in
                progress = now
            }
        } else {
            content
        }
    }
}

/// Glass only when asked — `glassCapsule` can't sit behind an `if` inside a
/// modifier chain without changing the view's identity mid-animation.
private struct GlassIf: ViewModifier {
    let active: Bool
    func body(content: Content) -> some View {
        if active { content.glassCapsule(shape: Capsule()) } else { content }
    }
}

private extension View {
    /// One line of the caption rising into place. `order` staggers the lines
    /// by 55ms so the block reads top-down instead of popping in as a slab.
    func captionEntrance(_ entered: Bool, order: Int) -> some View {
        self
            .opacity(entered ? 1 : 0)
            .offset(y: entered ? 0 : 14)
            .animation(.spring(duration: 0.38, bounce: 0.18).delay(Double(order) * 0.055), value: entered)
    }
}
