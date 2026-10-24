import SwiftUI
import UIKit

struct ContentView: View {
    /// The launch screen, held a beat and lifted: the scene and its chrome rise
    /// out of the launch colour together instead of snapping in under it.
    @State private var curtainUp = false

    var body: some View {
        tabs
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

    private var tabs: some View {
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

/// What to call the device in copy: "this iPad" reads wrong as "this phone".
enum ThisDevice {
    static var noun: String {
        UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "phone"
    }
}

