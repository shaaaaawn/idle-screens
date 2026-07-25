import SwiftUI

@main
struct IdleScreensApp: App {
    @State private var appState = AppState()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(appState)
        }
        .onChange(of: scenePhase) {
            if scenePhase == .active {
                Task { await appState.loadGallery() }
            }
        }
    }
}
