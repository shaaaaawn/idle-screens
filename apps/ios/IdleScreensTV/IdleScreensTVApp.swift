import SwiftUI

@main
struct IdleScreensTVApp: App {
    @State private var appState = TVAppState()

    var body: some Scene {
        WindowGroup {
            ChannelGridView()
                .environment(appState)
                .preferredColorScheme(.dark)
                .task {
                    // Debug affordance: `xcrun simctl launch booted <id> -channel lobby`
                    // jumps straight into a channel, bypassing the grid (CLI testing).
                    let args = ProcessInfo.processInfo.arguments
                    if let i = args.firstIndex(of: "-channel"), args.indices.contains(i + 1) {
                        appState.selectChannel(args[i + 1])
                    }
                }
        }
    }
}
