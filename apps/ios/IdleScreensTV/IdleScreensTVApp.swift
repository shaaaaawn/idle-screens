import SwiftUI

@main
struct IdleScreensTVApp: App {
    @State private var appState = TVAppState()
    @State private var showingSplash = true
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ZStack {
                Group {
                    // Debug affordance: `-pair` renders the pairing QR screen
                    // directly (CLI screenshots — tvOS has no UI scripting).
                    if ProcessInfo.processInfo.arguments.contains("-pair") {
                        PairView()
                    } else if ProcessInfo.processInfo.arguments.contains("-settings") {
                        SettingsView()
                    } else if ProcessInfo.processInfo.arguments.contains("-fallback") {
                        // Debug: the always-renderable ambient stand-in.
                        FallbackSceneView(channelId: "debug-preview")
                    } else if let i = ProcessInfo.processInfo.arguments.firstIndex(of: "-classic"),
                              ProcessInfo.processInfo.arguments.indices.contains(i + 1),
                              let kind = ClassicSaverKind.supported(id: ProcessInfo.processInfo.arguments[i + 1]) {
                        // Debug: render a native classic-saver port in isolation
                        // (bisects renderer bugs from channel-routing bugs).
                        // -env / -mix exercise the aquarium's interpreters.
                        ClassicSaverView(kind: kind, seed: 7, params: {
                            var p: [String: String] = [:]
                            let args = ProcessInfo.processInfo.arguments
                            if let e = args.firstIndex(of: "-env"), args.indices.contains(e + 1) { p["environment"] = args[e + 1] }
                            if let m = args.firstIndex(of: "-mix"), args.indices.contains(m + 1) { p["fishMix"] = args[m + 1] }
                            return p
                        }())
                    } else if let i = ProcessInfo.processInfo.arguments.firstIndex(of: "-poster"),
                              ProcessInfo.processInfo.arguments.indices.contains(i + 1) {
                        // Debug: render one channel's poster tile in isolation
                        // (bisects card-composition bugs from preview bugs).
                        PosterDebugView(channelId: ProcessInfo.processInfo.arguments[i + 1])
                    } else {
                        MainTabView()
                    }
                }

                if showingSplash {
                    BootSplashView()
                        .transition(.opacity)
                }
            }
            .environment(appState)
            .preferredColorScheme(.dark)
            .task {
                // Debug affordance: `xcrun simctl launch booted <id> -channel lobby`
                // jumps straight into a channel, bypassing the grid (CLI testing).
                let args = ProcessInfo.processInfo.arguments
                if let i = args.firstIndex(of: "-channel"), args.indices.contains(i + 1) {
                    // Let the tab/navigation hierarchy install its
                    // navigationDestination first — a binding that is already
                    // true at install time never pushes (cold-start quirk).
                    try? await Task.sleep(for: .milliseconds(300))
                    appState.selectChannel(args[i + 1])
                } else {
                    // Idle on the grid, but reachable: a paired phone can
                    // push a switch through this control socket.
                    appState.startControlSocket()
                }
                // Hold the splash just long enough to cover the first grid
                // paint (cache-first, so content is ready almost immediately).
                try? await Task.sleep(for: .milliseconds(600))
                withAnimation(.easeOut(duration: 0.5)) { showingSplash = false }
            }
            .onChange(of: scenePhase) {
                appState.scenePhaseChanged(active: scenePhase == .active)
            }
            // Top Shelf deep links: idlescreens://channel/<id> from the home
            // screen goes straight into that channel fullscreen.
            .onOpenURL { url in
                if let id = DeepLink.channelId(from: url) {
                    appState.selectChannel(id)
                }
            }
        }
    }
}

/// Parses app deep links. Canonical form is `idlescreens://channel/<id>`
/// (what the Top Shelf provider emits); the bare `idlescreens://<id>`
/// shorthand also resolves so hand-typed links behave.
enum DeepLink {
    static func channelId(from url: URL) -> String? {
        guard url.scheme == "idlescreens" else { return nil }
        let id: String? = switch url.host() {
        case "channel": url.pathComponents.dropFirst().first
        default: url.host()
        }
        guard let id, !id.isEmpty else { return nil }
        return id
    }
}

/// Debug-only card gallery (`-poster <channelId>`): the real `ChannelCard`,
/// one focused and one not, so a design pass can inspect the poster, the
/// caption ramp and the focus treatment without walking the remote there.
private struct PosterDebugView: View {
    let channelId: String
    @Environment(TVAppState.self) private var app
    @FocusState private var focused: String?

    var body: some View {
        ZStack {
            Color.appBackground.ignoresSafeArea()
            if app.channels.isEmpty {
                ProgressView()
            } else {
                HStack(alignment: .top, spacing: TV.columnGap) {
                    ForEach(cards) { channel in
                        ChannelCard(channel: channel, focusBinding: $focused)
                            .frame(width: 500)
                    }
                }
                .padding(TV.gutter)
            }
        }
        .task {
            if app.channels.isEmpty { await app.loadGallery() }
            // Park focus on the first card so focused and unfocused
            // captions are both on screen in one capture.
            focused = cards.first?.id
        }
    }

    /// The requested channel first, then whatever follows it in the gallery.
    private var cards: [PublicChannel] {
        guard let i = app.channels.firstIndex(where: { $0.id == channelId }) else {
            return Array(app.channels.prefix(3))
        }
        return Array(app.channels[i...].prefix(3))
    }
}

/// Top tab bar — the tvOS-native way to reach secondary surfaces: swipe up
/// from anywhere, no walking focus to a corner button. Content pushes
/// (fullscreen channels) hide the bar automatically.
private struct MainTabView: View {
    @Environment(TVAppState.self) private var app
    @State private var selection: Tab = .channels

    enum Tab: Hashable { case channels, settings }

    var body: some View {
        TabView(selection: $selection) {
            ChannelGridView()
                .tabItem { Label("Channels", systemImage: "tv") }
                .tag(Tab.channels)
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .tag(Tab.settings)
        }
        // A paired phone can push a channel while Settings is up — jump to
        // the Channels tab so the saver is actually visible.
        .onChange(of: app.selectedChannelId) {
            if app.selectedChannelId != nil { selection = .channels }
        }
    }
}

/// Branded boot moment: wordmark over the launch-screen color, so the system
/// launch screen dissolves into an identical frame instead of flashing to the
/// grid mid-load.
private struct BootSplashView: View {
    @State private var glow = false

    var body: some View {
        ZStack {
            Color.appBackground.ignoresSafeArea()
            HStack(spacing: 20) {
                Circle()
                    .fill(Color.appPrimary)
                    .frame(width: 22, height: 22)
                    .opacity(glow ? 1 : 0.35)
                    .animation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true),
                               value: glow)
                Text("idle screens")
                    .font(.tvDisplay)
                    .foregroundStyle(Color.textPrimary)
            }
        }
        .onAppear { glow = true }
    }
}
