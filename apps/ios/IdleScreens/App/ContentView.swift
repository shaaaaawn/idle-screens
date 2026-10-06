import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            WatchFeedView()
                .tabItem { Label("Watch", systemImage: "play.tv") }
            GalleryView()
                .tabItem { Label("Channels", systemImage: "square.grid.2x2") }
            AgentsView()
                .tabItem { Label("Agents", systemImage: "sparkles") }
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
        .preferredColorScheme(.dark)
        .tint(.appPrimary)
        .background(Color.appBackground.ignoresSafeArea())
    }
}
