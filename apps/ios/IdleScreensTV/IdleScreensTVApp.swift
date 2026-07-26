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
                    } else {
                        ChannelGridView()
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
                    appState.selectChannel(args[i + 1])
                } else {
                    // Idle on the grid, but reachable: a paired phone can
                    // push a switch through this control socket.
                    appState.startControlSocket()
                }
                // Hold the splash just long enough to cover the first grid
                // paint (cache-first, so content is ready almost immediately).
                try? await Task.sleep(for: .milliseconds(900))
                withAnimation(.easeOut(duration: 0.5)) { showingSplash = false }
            }
            .onChange(of: scenePhase) {
                appState.scenePhaseChanged(active: scenePhase == .active)
            }
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
                    .font(.system(size: 64, weight: .bold))
                    .foregroundStyle(Color.textPrimary)
            }
        }
        .onAppear { glow = true }
    }
}
