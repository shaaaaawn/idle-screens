import SwiftUI
import UIKit

struct ContentView: View {
    /// The launch screen, held a beat and lifted: the scene and its chrome rise
    /// out of the launch colour together instead of snapping in under it.
    @State private var curtainUp = false
    /// QA / store-shot affordance, like `-channel`: `-tab channels` opens on
    /// that tab (watch, channels, agents, settings) so a capture script can
    /// reach it without driving taps.
    @State private var tab: String = {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-tab"), args.indices.contains(i + 1),
              ["watch", "channels", "agents", "settings"].contains(args[i + 1]) else { return "watch" }
        return args[i + 1]
    }()

    @Environment(\.dynamicTypeSize) private var typeSize
    @AppStorage(Appearance.storageKey) private var appearance: Appearance = .system

    var body: some View {
        // Measured once, here: every screen sizes its chrome from it.
        GeometryReader { window in
            let scale = DeviceScale.forSize(window.size)
            tabs
                .environment(\.deviceScale, scale)
                .dynamicTypeSize(typeSize.stepped(DeviceScale.typeSteps(scale)))
                // A foldable folding or unfolding swaps the screen under us:
                // which ways it may turn changes with it.
                .onChange(of: min(window.size.width, window.size.height) >= OrientationPolicy.roomyShortSide) {
                    OrientationPolicy.refresh()
                }
        }
        .overlay {
            Color("LaunchBackground")
                .ignoresSafeArea()
                .opacity(curtainUp ? 0 : 1)
                .allowsHitTesting(false)
        }
        .task {
            // One frame for the first page to lay out and draw its still.
            try? await Task.sleep(for: .milliseconds(120))
            withAnimation(.easeOut(duration: 0.7)) { curtainUp = true }
        }
    }

    /// The chrome follows Settings → Appearance; a feed on screen is artwork
    /// and turns the whole window dark. It has to be the window: the status
    /// bar takes its colour from here, not from the feed's own environment,
    /// and would draw black on black. Decided once, at the root, so two
    /// views never compete for it.
    private var scheme: ColorScheme? {
        tab == "watch" || PreviewBudget.shared.fullscreenDepth > 0 ? .dark : appearance.colorScheme
    }

    private var tabs: some View {
        TabView(selection: $tab) {
            WatchFeedView()
                .tabItem { Label("Watch", systemImage: "play.tv") }
                .tag("watch")
            GalleryView()
                .tabItem { Label("Channels", systemImage: "square.grid.2x2") }
                .tag("channels")
            AgentsView()
                .tabItem { Label("Agents", systemImage: "sparkles") }
                .tag("agents")
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .tag("settings")
        }
        .preferredColorScheme(scheme)
        .tint(.appPrimary)
        .background(Color.appBackground.ignoresSafeArea())
    }
}

/// What to call the device in copy: "this iPad" reads wrong as "this phone".
enum ThisDevice {
    static var noun: String {
        UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "phone"
    }
}

