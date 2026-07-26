import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            GalleryView()
                .tabItem { Label("Watch", systemImage: "tv") }
            MyChannelsView()
                .tabItem { Label("VJ", systemImage: "slider.horizontal.3") }
            PairedTVView()
                .tabItem { Label("Screens", systemImage: "tv.badge.wifi") }
        }
        .preferredColorScheme(.dark)
        .tint(.appPrimary)
        .background(Color.appBackground.ignoresSafeArea())
    }
}
