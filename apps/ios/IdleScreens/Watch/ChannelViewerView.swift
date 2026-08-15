import SwiftUI
import WebKit

/// Full-screen channel viewer, rendered natively from the scene JSON.
///
/// Mirrors the hosted viewer's control bar (back · live status · actions) with
/// native equivalents: the web's "QR / Remote" become "play on your screens"
/// and live steering, because the phone *is* the remote. A RenderGuard steps
/// the renderer down under load instead of letting a heavy scene kill the app.
struct ChannelViewerView: View {
    let channelId: String
    var label: String?
    /// False for a page the pager has built but you haven't swiped to yet.
    /// Only the page you're actually looking at holds a socket.
    var isActive: Bool = true
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var session = ChannelSession()
    @State private var guardrail = RenderGuard()
    @State private var showChrome = true
    @State private var showInfo = false
    @State private var chromeTask: Task<Void, Never>?
    @State private var toast: String?
    @State private var waking = false
    @State private var pulse = false
    @State private var showComposer = false
    @State private var showTimeline = false

    private var seedSpec: SpecSubset? {
        app.channels.first { $0.id == channelId }?.spec
    }

    private var canSteer: Bool { app.token(for: channelId) != nil }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            sceneLayer
            sleepingLayer
            overlayLayer

            if showChrome {
                VStack {
                    topBar
                    Spacer()
                    bottomBar
                }
                .transition(.opacity)
            }
        }
        .statusBarHidden(!showChrome)
        .contentShape(Rectangle())
        .onTapGesture { revealChrome() }
        // Vertical is TIME. Horizontal belongs to the pager (which channel),
        // so this only fires on a gesture that is unambiguously vertical —
        // otherwise a slightly-diagonal page swipe would yank open history.
        .simultaneousGesture(
            DragGesture(minimumDistance: 24)
                .onEnded { value in
                    let dy = value.translation.height
                    let dx = value.translation.width
                    guard abs(dy) > abs(dx) * 1.8, dy > 60 else { return }
                    showTimeline = true
                }
        )
        .navigationBarBackButtonHidden()
        .toolbar(.hidden, for: .navigationBar, .tabBar)
        .animation(.easeInOut(duration: 0.25), value: showChrome)
        .animation(.easeInOut(duration: 0.45), value: session.phase)
        .animation(.easeInOut(duration: 0.45), value: session.hasScene)
        .sheet(isPresented: $showComposer) {
            ComposerSheet(channelId: channelId, session: session)
                .presentationDetents([.height(150), .medium, .large])
                .presentationBackgroundInteraction(.enabled(upThrough: .medium))
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showTimeline) {
            ChannelTimelineSheet(channelId: channelId, canSteer: canSteer)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showInfo) {
            SceneInfoSheet(session: session, channelId: channelId, guardrail: guardrail)
                .presentationDetents([.medium])
        }
        .onChange(of: scenePhase) { _, phase in
            guardrail.setActive(phase == .active)
        }
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = true
            // Gallery tiles stay alive behind a pushed viewer. Fullscreen is one
            // big canvas that deserves the whole device — nothing animating
            // offscreen behind it earns its memory.
            PreviewBudget.shared.enterFullscreen()
            if isActive { session.start(channelId: channelId, seedSpec: seedSpec) }
            revealChrome()
        }
        // A paging TabView builds the neighbouring pages before you reach them.
        // Without this gate every neighbour opens its own channel socket, so
        // swiping through ten channels would leave ten live connections behind.
        .onChange(of: isActive) { _, nowActive in
            if nowActive {
                session.start(channelId: channelId, seedSpec: seedSpec)
                revealChrome()
            } else {
                chromeTask?.cancel()
                session.stop()
            }
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            PreviewBudget.shared.exitFullscreen()
            chromeTask?.cancel()
            session.stop()
        }
    }

    // MARK: Scene

    @ViewBuilder
    private var sceneLayer: some View {
        // The channel's own backdrop paints instantly and stays underneath, so
        // entering never flashes black and the scene cross-fades in over it.
        Color(hex: session.backdrop ?? "0A0A0F")
            .ignoresSafeArea()

        if session.isClassicSpec {
            // Classic savers live only on the web engine.
            HostedViewer(url: app.gallery.viewerURL(for: channelId))
                .ignoresSafeArea()
                .transition(.opacity)
        } else if session.hasScene {
            NativeSceneView(
                layers: session.compiledScene,
                background: session.background,
                tier: guardrail.level.tier,
                paused: guardrail.level == .paused,
                onFrame: { duration, time in
                    guardrail.recordFrame(duration: duration, at: time)
                }
            )
            .ignoresSafeArea()
            .opacity(session.sleeping ? 0 : 1)
            .transition(.opacity)
            .animation(.easeInOut(duration: 0.6), value: session.sleeping)
        } else if session.phase == .unreachable {
            // Designed failure state: say what happened, offer the way out.
            VStack(spacing: 14) {
                Image(systemName: "wifi.exclamationmark")
                    .font(.system(size: 32))
                    .foregroundStyle(Color.textSecondary)
                Text("can't reach this channel")
                    .font(.headline)
                    .foregroundStyle(Color.textPrimary)
                Button("Try again") { session.retry() }
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Color.appBackground)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 9)
                    .background(Color.textPrimary, in: Capsule())
            }
            .transition(.opacity)
        } else {
            // Connecting: no spinner. The backdrop is already the channel's
            // colour, so a quiet pulse beats a spinner that flashes for 200ms.
            Circle()
                .fill(Color.textPrimary.opacity(0.18))
                .frame(width: 10, height: 10)
                .scaleEffect(pulse ? 1.6 : 0.8)
                .animation(.easeInOut(duration: 1).repeatForever(autoreverses: true), value: pulse)
                .onAppear { pulse = true }
                .transition(.opacity)
        }
    }

    /// Sleeping used to be a dead end: a moon and a shrug, even when waking it
    /// was one call away. If you can steer it, the state IS the button.
    @ViewBuilder
    private var sleepingLayer: some View {
        if session.sleeping {
            VStack(spacing: 14) {
                Image(systemName: "moon.zzz")
                    .font(.system(size: 34))
                    .foregroundStyle(Color.textSecondary)
                Text("sleeping")
                    .font(.headline)
                    .foregroundStyle(Color.textPrimary)

                if canSteer {
                    Button {
                        wake()
                    } label: {
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
                    // Don't offer an action that would 403. Say what's true.
                    Text("It'll come back when its owner wakes it.")
                        .font(.footnote)
                        .foregroundStyle(Color.textSecondary)
                }
            }
            .padding(28)
            .glassPanel(shape: RoundedRectangle(cornerRadius: 22))
            .transition(.opacity)
        }
    }

    private func wake() {
        guard let token = app.token(for: channelId), !waking else { return }
        waking = true
        Task {
            defer { waking = false }
            do {
                try await app.mcp.wake(channelId: channelId, token: token)
                // The socket pushes the real state; this just avoids a beat of
                // the button sitting there looking ignored.
                session.optimisticallyAwake()
            } catch {
                flash("couldn't wake it — try again")
            }
        }
    }

    @ViewBuilder
    private var overlayLayer: some View {
        if let overlay = session.overlayText {
            Text(overlay)
                .font(.title2.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 22)
                .padding(.vertical, 14)
                .background(.black.opacity(0.55), in: Capsule())
                .transition(.opacity)
        }
        if let toast {
            VStack {
                Spacer()
                Text(toast)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(.black.opacity(0.7), in: Capsule())
                    .padding(.bottom, 120)
            }
            .transition(.opacity)
        }
    }

    // MARK: Chrome — the web bar's native twin

    private var topBar: some View {
        HStack(spacing: 12) {
            Button { dismiss() } label: {
                Image(systemName: "chevron.left")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(width: 38, height: 38)
                    .glassCapsule(shape: Circle())
            }

            VStack(alignment: .leading, spacing: 1) {
                Text(label ?? channelId)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                HStack(spacing: 5) {
                    Circle()
                        .fill(session.sleeping ? Color.textTertiary : Color.appSuccess)
                        .frame(width: 6, height: 6)
                    Text(statusText)
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.7))
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .glassCapsule(shape: Capsule())
            Spacer()
            if let viewers = session.viewers, viewers > 0 {
                Label("\(viewers)", systemImage: "eye.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 7)
                    .glassCapsule(shape: Capsule())
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    private var statusText: String {
        if let reason = guardrail.reason { return reason }
        if session.sleeping { return "sleeping" }
        return session.sceneLabel ?? "live"
    }

    /// Minimal, one-handed: a single glass cluster near the thumb. Labels are
    /// gone — the composer is where anything wordy lives.
    private var bottomBar: some View {
        HStack(spacing: 8) {
            Button { showComposer = true } label: {
                HStack(spacing: 7) {
                    Image(systemName: "slider.horizontal.3")
                    Text("Compose")
                        .font(.subheadline.weight(.medium))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .glassCapsule(shape: Capsule())
            }

            if !app.pairedScreens.isEmpty {
                glassIcon("play.tv") {
                    Task {
                        let n = await app.pushToAllScreens(channelId: channelId)
                        flash(n > 0 ? "sent to \(n) screen\(n == 1 ? "" : "s")"
                                    : app.pairPushError ?? "couldn't reach your screens")
                    }
                }
            }
            glassIcon("info.circle") { showInfo = true }
            ShareLink(item: app.gallery.viewerURL(for: channelId)) {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .glassCapsule(shape: Circle())
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 24)
    }

    private func glassIcon(_ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .glassCapsule(shape: Circle())
        }
    }

    private func flash(_ message: String) {
        toast = message
        Task {
            try? await Task.sleep(for: .seconds(2))
            if toast == message { toast = nil }
        }
    }

    /// Chrome fades so the scene owns the screen; tap anywhere brings it back.
    private func revealChrome() {
        showChrome = true
        chromeTask?.cancel()
        chromeTask = Task {
            try? await Task.sleep(for: .seconds(ProcessInfo.processInfo.arguments.contains("-chrome-sticky") ? 600 : 6))
            guard !Task.isCancelled else { return }
            showChrome = false
        }
    }
}

// MARK: - Scene info

/// What the scene JSON actually contains, natively — the detail the hosted
/// page only hints at, plus what the renderer decided to do with it.
private struct SceneInfoSheet: View {
    let session: ChannelSession
    let channelId: String
    let guardrail: RenderGuard
    @Environment(AppState.self) private var app
    @State private var events: [ChannelEvent] = []
    @State private var loadingHistory = true

    /// The most recent event that actually says who/what/why. Plenty of events
    /// carry no attribution; showing "agent" with no model and no intent is
    /// worse than showing nothing.
    private var provenance: ChannelEvent? {
        events.first { $0.hasAttribution }
    }

    var body: some View {
        NavigationStack {
            List {
                // Provenance leads. It is the one thing this product knows
                // that a screenshot of the same scene would not.
                if let event = provenance {
                    Section("how this scene got here") {
                        if let intent = event.intent, !intent.isEmpty {
                            Text(intent)
                                .font(.callout)
                                .foregroundStyle(Color.textPrimary)
                        }
                        LabeledContent("author", value: event.actor ?? "agent")
                        if let model = event.model, !model.isEmpty {
                            LabeledContent("model", value: model)
                        }
                        if let harness = event.harness, !harness.isEmpty {
                            LabeledContent("via", value: harness)
                        }
                        LabeledContent("when",
                                       value: event.date.formatted(.relative(presentation: .named)))
                    }
                } else if loadingHistory {
                    Section("how this scene got here") {
                        HStack(spacing: 8) {
                            ProgressView().controlSize(.small)
                            Text("reading the channel's history…")
                                .font(.footnote)
                                .foregroundStyle(Color.textSecondary)
                        }
                    }
                }

                Section("scene") {
                    LabeledContent("channel", value: channelId)
                    LabeledContent("scene", value: session.sceneLabel ?? "—")
                    LabeledContent("layers", value: "\(session.compiledScene.count)")
                    LabeledContent("sprites",
                                   value: "\(session.compiledScene.reduce(0) { $0 + $1.entities.count })")
                    if let viewers = session.viewers {
                        LabeledContent("viewers", value: "\(viewers)")
                    }
                }
                Section("rendering") {
                    LabeledContent("mode", value: guardrail.level.rawValue)
                    LabeledContent("engine", value: "native")
                    if let reason = guardrail.reason {
                        LabeledContent("stepped down", value: reason)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Color.appBackground)
            .navigationTitle("Scene")
            .navigationBarTitleDisplayMode(.inline)
            .task {
                defer { loadingHistory = false }
                events = (try? await app.gallery.fetchHistory(channelId: channelId)) ?? []
            }
        }
    }
}

/// WKWebView fallback for classic savers — transparent over black so there
/// is no white flash while the page paints.
private struct HostedViewer: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView()
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
