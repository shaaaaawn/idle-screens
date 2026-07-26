import SwiftUI

@main
struct IdleScreensTVApp: App {
    @State private var appState = TVAppState()

    var body: some Scene {
        WindowGroup {
            Group {
                // Debug affordance: `-pair` renders the pairing QR screen
                // directly (CLI screenshots — tvOS has no UI scripting).
                if ProcessInfo.processInfo.arguments.contains("-pair") {
                    PairView()
                } else {
                    ChannelGridView()
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
                }
        }
    }
}
