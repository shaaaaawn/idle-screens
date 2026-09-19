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
    /// `"live"`, or a stop's key. Optional only because `scrollPosition` binds one.
    @State private var moment: String? = FeedPage.liveKey
    @State private var chromeHidden = false
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
            Color(hex: session.backdrop ?? channel.spec?.background?.primaryColor ?? "0A0A0F")
                .ignoresSafeArea()

            ScrollView(.horizontal) {
                LazyHStack(spacing: 0) {
                    livePage
                        .containerRelativeFrame([.horizontal, .vertical])
                        .id(Self.liveKey)
                    ForEach(stops) { stop in
                        HistoryMomentPage(channelId: channelId, stop: stop,
                                          isShowing: isActive && moment == Self.key(stop))
                            .containerRelativeFrame([.horizontal, .vertical])
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

            if !chromeHidden {
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
            stops = ChannelFeed.stops(from: events)
        }
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
    @ViewBuilder
    private var liveStateLayer: some View {
        if !isActive {
            EmptyView()
        } else if session.sleeping {
            VStack(spacing: 14) {
                Image(systemName: "moon.zzz")
                    .font(.system(size: 34))
                    .foregroundStyle(Color.textSecondary)
                Text("sleeping")
                    .font(.headline)
                    .foregroundStyle(Color.textPrimary)
                if canSteer {
                    Button(action: wake) {
                        Group {
                            if waking {
                                ProgressView().tint(Color.appBackground)
                            } else {
                                Label("Wake it", systemImage: "sun.max.fill")
                                    .font(.subheadline.weight(.semibold))
                            }
                        }
                        .frame(minWidth: 132, minHeight: 22)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 12)
                        .foregroundStyle(Color.appBackground)
                        .background(Color.textPrimary, in: Capsule())
                    }
                    .disabled(waking)
                } else {
                    Text("It'll come back when its owner wakes it.")
                        .font(.footnote)
                        .foregroundStyle(Color.textSecondary)
                }
            }
            .padding(28)
            .glassPanel(shape: RoundedRectangle(cornerRadius: 22))
        } else if session.phase == .unreachable {
            VStack(spacing: 14) {
                Image(systemName: "wifi.exclamationmark")
                    .font(.system(size: 32))
                    .foregroundStyle(Color.textSecondary)
                Text("can't reach this channel")
                    .font(.headline)
                    .foregroundStyle(Color.textPrimary)
                Button("Try again") {
                    session.retry()
                    reloadCount += 1
                }
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Color.appBackground)
                .padding(.horizontal, 18)
                .padding(.vertical, 9)
                .background(Color.textPrimary, in: Capsule())
            }
            .padding(28)
            .glassPanel(shape: RoundedRectangle(cornerRadius: 22))
        } else if session.phase == .connecting {
            Circle()
                .fill(Color.textPrimary.opacity(0.18))
                .frame(width: 10, height: 10)
                .scaleEffect(pulse ? 1.6 : 0.8)
                .animation(.easeInOut(duration: 1).repeatForever(autoreverses: true), value: pulse)
                .onAppear { pulse = true }
        }
    }

    // MARK: Chrome

    private var chrome: some View {
        VStack(spacing: 0) {
            topBar
            Spacer()
            HStack(alignment: .bottom, spacing: 12) {
                caption
                Spacer(minLength: 0)
                actionRail
            }
        }
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
                        .foregroundStyle(.white)
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
                    .foregroundStyle(.white)
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
                .foregroundStyle(.white)
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
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .glassPanel(shape: Capsule())
        }
    }

    /// Bottom-left, where a feed puts what you are looking at.
    private var caption: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                if channel.isProtected == true {
                    Image(systemName: "lock.fill")
                        .font(.caption)
                        .accessibilityLabel("Claimed")
                }
                Text(channel.displayLabel)
                    .font(.title3.weight(.bold))
                    .lineLimit(1)
            }
            if let stop = currentStop {
                Text(stop.event.summary ?? "an earlier scene")
                    .font(.subheadline)
                    .lineLimit(2)
                // The prompt behind the change: the one thing here a picture
                // of the same scene could not tell you.
                if let intent = stop.event.intent, !intent.isEmpty {
                    Text(intent)
                        .font(.caption)
                        .opacity(0.78)
                        .lineLimit(3)
                }
                if let who = Self.attribution(stop.event) {
                    Text(who).font(.caption2).opacity(0.65).lineLimit(1)
                }
            } else {
                Text(session.sceneLabel ?? channel.saverLabel ?? "live")
                    .font(.subheadline)
                    .lineLimit(1)
                if let steered = SteerLine.text(for: channel) {
                    Text(steered).font(.caption2).opacity(0.65).lineLimit(1)
                }
            }
        }
        .foregroundStyle(.white)
        .multilineTextAlignment(.leading)
        // Scenes are arbitrary art: white text needs its own contrast.
        .shadow(color: .black.opacity(0.65), radius: 6, y: 1)
        .frame(maxWidth: 270, alignment: .leading)
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
                    .foregroundStyle(.white)
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
                .foregroundStyle(.white)
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
                    .foregroundStyle(.white)
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

/// One past scene. Fetches its recorded spec the first time it is needed, and
/// only animates while it is the page on screen — a neighbour holds its colour.
private struct HistoryMomentPage: View {
    let channelId: String
    let stop: ChannelFeed.Stop
    let isShowing: Bool
    @Environment(AppState.self) private var app
    @State private var scene: RecordedScene?
    @State private var failed = false

    var body: some View {
        ZStack {
            Color(hex: scene?.spec?.background?.primaryColor ?? "0A0A0F").ignoresSafeArea()
            if let scene, isShowing {
                RecordedSceneView(scene: scene, channelId: channelId)
                    .transition(.opacity)
            } else if failed {
                VStack(spacing: 12) {
                    Image(systemName: "clock.badge.exclamationmark")
                        .font(.system(size: 30))
                        .foregroundStyle(Color.textSecondary)
                    Text("couldn't load this moment")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Color.textPrimary)
                    Button("Try again") { Task { await load() } }
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.textPrimary)
                }
                .padding(24)
                .glassPanel(shape: RoundedRectangle(cornerRadius: 20))
            } else if isShowing {
                ProgressView().tint(Color.textSecondary)
            }
        }
        .animation(.easeInOut(duration: 0.35), value: scene != nil)
        .task(id: isShowing) {
            if isShowing, scene == nil { await load() }
        }
    }

    private func load() async {
        failed = false
        do {
            scene = try await app.gallery.fetchScene(channelId: channelId, sceneId: stop.sceneId)
        } catch {
            failed = true
        }
    }
}
