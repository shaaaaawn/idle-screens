import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            GalleryView()
                .tabItem { Label("Watch", systemImage: "tv") }
            MyChannelsView()
                .tabItem { Label("VJ", systemImage: "slider.horizontal.3") }
        }
        .preferredColorScheme(.dark)
        .tint(.appPrimary)
        .background(Color.appBackground.ignoresSafeArea())
    }
}
