import SwiftUI

@main
struct IdleScreensApp: App {
    @State private var appState = AppState()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(appState)
                .onOpenURL { url in
                    // Universal link https://idlescreens.com/pair/<code> or
                    // custom scheme idlescreens://pair/<code>.
                    if let code = AppState.pairCode(from: url) {
                        Task { await appState.claimPairCode(code) }
                    }
                }
                .task {
                    // Debug affordance (CLI testing, mirrors the TV's -channel):
                    // `simctl launch booted <id> -pair <code>` claims a pair
                    // code headlessly; `-push <channel>` pushes to the TV.
                    let args = ProcessInfo.processInfo.arguments
                    if let i = args.firstIndex(of: "-pair"), args.indices.contains(i + 1) {
                        await appState.claimPairCode(args[i + 1])
                    }
                    if let i = args.firstIndex(of: "-push"), args.indices.contains(i + 1) {
                        await appState.pushToTV(channelId: args[i + 1])
                    }
                }
        }
        .onChange(of: scenePhase) {
            if scenePhase == .active {
                Task { await appState.loadGallery() }
            }
        }
    }
}
