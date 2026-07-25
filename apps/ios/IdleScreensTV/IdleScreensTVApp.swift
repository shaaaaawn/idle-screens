import SwiftUI

@main
struct IdleScreensTVApp: App {
    @State private var appState = TVAppState()

    var body: some Scene {
        WindowGroup {
            ChannelGridView()
                .environment(appState)
                .preferredColorScheme(.dark)
        }
    }
}
