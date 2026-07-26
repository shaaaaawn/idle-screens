import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            GalleryView()
                .tabItem { Label("Watch", systemImage: "tv") }
            MyChannelsView()
                .tabItem { Label("VJ", systemImage: "slider.horizontal.3") }
            PairedTVView()
                .tabItem { Label("TV", systemImage: "appletv") }
        }
        .preferredColorScheme(.dark)
        .tint(.appPrimary)
        .background(Color.appBackground.ignoresSafeArea())
    }
}
