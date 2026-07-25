import SwiftUI
import UIKit

/// t1 renderer: polls the channel JPEG thumb every ~3s and crossfades.
/// After repeated failures, tells TVAppState to fall through to t0.
struct ThumbStreamView: View {
    let channelId: String
    @Environment(TVAppState.self) private var app

    @State private var image: UIImage?
    @State private var consecutiveFailures = 0

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .transition(.opacity)
                    .id(image)
            }
        }
        .animation(.easeInOut(duration: 0.6), value: image != nil)
        .ignoresSafeArea()
        .task { await poll() }
    }

    private func poll() async {
        let url = app.gallery.thumbURL(for: channelId)
        while !Task.isCancelled {
            do {
                let (data, response) = try await URLSession.shared.data(from: url)
                if let http = response as? HTTPURLResponse,
                   http.statusCode == 200,
                   let fetched = UIImage(data: data) {
                    consecutiveFailures = 0
                    withAnimation(.easeInOut(duration: 0.6)) {
                        image = fetched
                    }
                } else {
                    recordFailure()
                }
            } catch {
                recordFailure()
            }
            try? await Task.sleep(for: .seconds(3))
        }
    }

    private func recordFailure() {
        consecutiveFailures += 1
        if consecutiveFailures >= 3 {
            app.reportThumbFailure()
        }
    }
}
